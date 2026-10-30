/**
 * 複数のハエ人の脳を 1 つの共有回路で進める（Worker の中身。node からも使える）。
 * 状態 r, d はエージェントごと、重みは共有。
 */
import type { Circuit } from './circuit.ts';
import { CHANNEL_INDEX, CHANNEL_NAMES, STIM_LEN } from './encode.ts';
import { BrainState, Net, stepBrains } from './model.ts';
import { buildRecGroups, groupMeans, newReadoutCommands, readoutCommands, toBody } from './readout.ts';
import type { ReadoutCommands } from './readout.ts';

export type DopamineKind = 'reward' | 'punish' | 'all';
export const DOSE_CURRENT = [1.5, 3.0, 4.5] as const;

/** 好みの探りに使う匂いのチャネル。 */
export const PROBE_CHANNELS = ['vinegar', 'geosmin', 'co2', 'cva', 'fruit'] as const;
/** 探りの 1 回の長さ（ステップ）。平均は後半。 */
export const PROBE_STEPS = 8;
/** MBON の差（接近駆動の変化）を -1..1 にする尺度: pref = tanh(delta / PROBE_SCALE)。 */
export const PROBE_SCALE = 1.0;
/** 探りの既定の周期（ステップ）。探り 1 回 = 6 ジョブ x 8 ステップ = 48 ステップ分の計算なので、50 以下だと脳の計算量が約 2 倍になる。 */
export const PROBE_EVERY = 100;

export interface BatchOptions {
  seed?: number;
  /** 学習（可塑性）。ゲームでは常に true。 */
  learn?: boolean;
  /** 感覚ニューロンへの入力雑音。一致試験では false。 */
  noise?: boolean;
  /** 好みの探りの周期（ステップ）。0 で無効。既定 PROBE_EVERY（100 = 2 秒。1 秒未満にはしない）。 */
  probeEvery?: number;
}

class Rng {
  s: number;
  spare = 0;
  has = false;
  constructor(seed: number) { this.s = (seed >>> 0) || 1; }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  gauss(): number {
    if (this.has) { this.has = false; return this.spare; }
    let u = this.next();
    if (u < 1e-12) u = 1e-12;
    const v = this.next();
    const m = Math.sqrt(-2 * Math.log(u));
    this.spare = m * Math.sin(2 * Math.PI * v);
    this.has = true;
    return m * Math.cos(2 * Math.PI * v);
  }
}

interface Agent {
  st: BrainState;
  I: Float64Array;
  stim: Float32Array;
  rng: Rng;
  /** ドーパミン注入: [reward, punish, all] の残りステップ数と電流。 */
  daSteps: Int32Array;
  daCur: Float64Array;
  steps: number;
  // 好みの探り
  snap: BrainState;
  probeAcc: Float64Array; // [baseline, odor...] の接近駆動
  probeNext: number; // 実行中のジョブ番号（0..nJobs-1）。nJobs なら待機
  probeStep: number; // ジョブ内の経過ステップ
  probeSum: number;
  probeDue: number; // 次に探りを始めるステップ
  pscr: BrainState; // 探り用の作業状態
  pI: Float64Array;
  pref: Float32Array;
  prefBase: Float64Array; // 基準時点の (匂いの接近駆動 - 無刺激の接近駆動)
  prefBaseValid: boolean;
  prefChange: Float32Array; // 基準からの変化 tanh((x - base) / PROBE_SCALE)
  means: Float64Array;
  z: Float64Array;
  cmd: ReadoutCommands;
  body: Float64Array;
  panel: Float64Array;
  da: Float64Array;
}

export class BrainBatch {
  readonly circuit: Circuit;
  readonly net: Net;
  readonly nAgents: number;
  readonly learn: boolean;
  readonly noise: boolean;
  readonly probeEvery: number;
  private agents: Agent[] = [];
  private recGroups: Int32Array[];
  private sensIdx: Int32Array;
  private chLeft: Int32Array[] = [];
  private chRight: Int32Array[] = [];
  private chMid: Int32Array[] = [];
  private panelIdx: Uint8Array;
  private panelCount: number[];
  private pam: Int32Array;
  private ppl1: Int32Array;
  private all: Int32Array;
  private mbon: Int32Array;
  private mbonVal: Float64Array;
  private probeCh: number[];
  readonly probeChannelNames = PROBE_CHANNELS;
  private probeStim = new Float32Array(STIM_LEN);
  private noiseSd: number;
  private amp: number;
  /** 1 エージェントの出力の長さ。 */
  readonly outLen: number;
  readonly layout: { cmd: number; backward: number; escape: number; z: number; panel: number; da: number; pref: number; prefChange: number };

  constructor(circuit: Circuit, nAgents: number, opts: BatchOptions = {}) {
    this.circuit = circuit;
    const meta = circuit.meta;
    this.net = new Net(circuit);
    this.nAgents = nAgents;
    this.learn = opts.learn ?? true;
    this.noise = opts.noise ?? true;
    this.probeEvery = opts.probeEvery ?? PROBE_EVERY;
    this.noiseSd = meta.input.noise_sd;
    this.amp = meta.input.amp;
    // チャネル並びの検査
    const names = Object.keys(meta.input.channels);
    for (const n of names) if (!(n in CHANNEL_INDEX)) throw new Error(`unknown channel in meta: ${n}`);
    for (const n of CHANNEL_NAMES) if (!meta.input.channels[n]) throw new Error(`channel missing in meta: ${n}`);
    for (const n of CHANNEL_NAMES) {
      const c = meta.input.channels[n];
      this.chLeft.push(Int32Array.from(c.left));
      this.chRight.push(Int32Array.from(c.right));
      this.chMid.push(Int32Array.from(c.mid));
    }
    const sens = meta.classes.indexOf('SENS');
    const s: number[] = [];
    for (let i = 0; i < circuit.N; i++) if (meta.neuron_class[i] === sens) s.push(i);
    this.sensIdx = Int32Array.from(s);
    this.recGroups = buildRecGroups(meta);
    this.panelIdx = Uint8Array.from(meta.panel.index);
    this.panelCount = new Array(meta.panel.names.length).fill(0);
    for (let i = 0; i < circuit.N; i++) this.panelCount[this.panelIdx[i]]++;
    this.pam = Int32Array.from(meta.dan.pam);
    this.ppl1 = Int32Array.from(meta.dan.ppl1);
    this.all = Int32Array.from(meta.dan.all);
    this.mbon = Int32Array.from(meta.plastic.mbon);
    this.mbonVal = Float64Array.from(meta.plastic.mbon_valence);
    this.probeCh = PROBE_CHANNELS.map((n) => CHANNEL_INDEX[n]);
    const nrec = meta.readout.rec_names.length;
    const np = meta.panel.names.length;
    const nPref = PROBE_CHANNELS.length;
    this.layout = { cmd: 0, backward: 5, escape: 6, z: 7, panel: 7 + nrec, da: 7 + nrec + np, pref: 7 + nrec + np + 2, prefChange: 7 + nrec + np + 2 + nPref };
    this.outLen = this.layout.prefChange + nPref;
    for (let a = 0; a < nAgents; a++) {
      this.agents.push({
        st: new BrainState(this.net),
        I: new Float64Array(circuit.N),
        stim: new Float32Array(STIM_LEN),
        rng: new Rng((opts.seed ?? 1) * 7919 + a * 104729 + 17),
        daSteps: new Int32Array(3),
        daCur: new Float64Array(3),
        steps: 0,
        snap: new BrainState(this.net),
        probeAcc: new Float64Array(1 + nPref),
        probeNext: 1 + nPref,
        probeStep: 0,
        probeSum: 0,
        pscr: new BrainState(this.net),
        pI: new Float64Array(circuit.N),
        probeDue: this.probeEvery > 0 ? Math.round((this.probeEvery * (a + 1)) / nAgents) : Infinity,
        pref: new Float32Array(nPref),
        prefBase: new Float64Array(nPref),
        prefBaseValid: false,
        prefChange: new Float32Array(nPref),
        means: new Float64Array(nrec),
        z: new Float64Array(nrec),
        cmd: newReadoutCommands(),
        body: new Float64Array(5),
        panel: new Float64Array(np),
        da: new Float64Array(2),
      });
    }
  }

  setStimulus(a: number, stim: ArrayLike<number>): void {
    this.agents[a].stim.set(stim as Float32Array);
  }

  /** ドーパミン注入（シミュレーション時間の durationMs）。 */
  inject(a: number, kind: DopamineKind, dose: 1 | 2 | 3, durationMs: number): void {
    const ag = this.agents[a];
    const k = kind === 'reward' ? 0 : kind === 'punish' ? 1 : 2;
    ag.daCur[k] = DOSE_CURRENT[dose - 1];
    ag.daSteps[k] = Math.max(0, Math.round(durationMs / (this.net.dt * 1000)));
  }

  reset(a: number): void {
    const ag = this.agents[a];
    ag.st.reset();
    ag.snap.reset();
    ag.stim.fill(0);
    ag.daSteps.fill(0);
    ag.pref.fill(0);
    ag.prefChange.fill(0);
    ag.prefBaseValid = false; // 次に完了した探りを新しい基準にする
    ag.probeNext = 1 + PROBE_CHANNELS.length;
  }

  /** 刺激 stim と注入電流から I を作る。noise=false なら雑音なし。 */
  private buildInput(ag: Agent, I: Float64Array, stim: Float32Array, withNoise: boolean, withDa: boolean): void {
    I.fill(0);
    const amp = this.amp;
    for (let c = 0; c < CHANNEL_NAMES.length; c++) {
      const sl = stim[2 * c];
      const sr = stim[2 * c + 1];
      if (sl === 0 && sr === 0) continue;
      const L = this.chLeft[c];
      const R = this.chRight[c];
      const M = this.chMid[c];
      const al = amp * sl;
      const ar = amp * sr;
      const am = amp * 0.5 * (sl + sr);
      for (let j = 0; j < L.length; j++) I[L[j]] += al;
      for (let j = 0; j < R.length; j++) I[R[j]] += ar;
      for (let j = 0; j < M.length; j++) I[M[j]] += am;
    }
    if (withNoise && this.noise) {
      const sd = this.noiseSd;
      const si = this.sensIdx;
      const rng = ag.rng;
      for (let j = 0; j < si.length; j++) I[si[j]] += sd * rng.gauss();
    }
    if (withDa) {
      for (let k = 0; k < 3; k++) {
        if (ag.daSteps[k] > 0) {
          const g = k === 0 ? this.pam : k === 1 ? this.ppl1 : this.all;
          const cur = ag.daCur[k];
          for (let j = 0; j < g.length; j++) I[g[j]] += cur;
          ag.daSteps[k]--;
        }
      }
    }
  }

  private sts: BrainState[] = [];
  private ins: Float64Array[] = [];

  /** 指定したエージェントをまとめて 1 ステップ進め、出力を更新する（まとめた方が速い）。 */
  stepAgents(ids: ArrayLike<number>): void {
    const sts = this.sts, ins = this.ins;
    sts.length = 0;
    ins.length = 0;
    for (let j = 0; j < ids.length; j++) {
      const ag = this.agents[ids[j]];
      this.buildInput(ag, ag.I, ag.stim, true, true);
      sts.push(ag.st);
      ins.push(ag.I);
    }
    stepBrains(this.net, sts, ins, this.learn);
    for (let j = 0; j < ids.length; j++) {
      const ag = this.agents[ids[j]];
      ag.steps++;
      this.summarize(ag);
    }
  }

  stepAgent(a: number): void {
    this.one[0] = a;
    this.stepAgents(this.one);
  }
  private one = [0];

  /** 外部から I を直接与える（一致試験用）。 */
  stepRaw(a: number, I: Float64Array, learn = this.learn): void {
    const ag = this.agents[a];
    stepBrains(this.net, [ag.st], [I], learn);
    ag.steps++;
  }

  state(a: number): BrainState {
    return this.agents[a].st;
  }

  private summarize(ag: Agent): void {
    const meta = this.circuit.meta;
    const r = ag.st.r;
    groupMeans(this.recGroups, r, ag.means);
    readoutCommands(meta, ag.means, ag.z, ag.cmd);
    toBody(ag.cmd, ag.body);
    ag.panel.fill(0);
    const pi = this.panelIdx;
    for (let i = 0; i < r.length; i++) ag.panel[pi[i]] += r[i];
    for (let p = 0; p < ag.panel.length; p++) ag.panel[p] /= this.panelCount[p];
    let s = 0;
    for (let j = 0; j < this.pam.length; j++) s += r[this.pam[j]];
    ag.da[0] = s / this.pam.length;
    s = 0;
    for (let j = 0; j < this.ppl1.length; j++) s += r[this.ppl1[j]];
    ag.da[1] = s / this.ppl1.length;
  }

  /** MBON の接近駆動: sum(r_mbon * valence)（ACh +1、Glu -1）。 */
  private approachDrive(r: Float64Array): number {
    let a = 0;
    for (let j = 0; j < this.mbon.length; j++) a += r[this.mbon[j]] * this.mbonVal[j];
    return a;
  }

  /** ジョブ job の入力 pI を作り、作業状態をスナップショットへ戻す。 */
  private startProbeJob(ag: Agent, job: number): void {
    ag.pscr.copyFrom(ag.snap);
    const stim = this.probeStim;
    stim.fill(0);
    if (job > 0) {
      const c = this.probeCh[job - 1];
      stim[2 * c] = 1;
      stim[2 * c + 1] = 1;
    }
    this.buildInput(ag, ag.pI, stim, false, false);
    ag.probeStep = 0;
    ag.probeSum = 0;
  }

  private probeAfterStep(ag: Agent): void {
    ag.probeStep++;
    if (ag.probeStep > PROBE_STEPS >> 1) ag.probeSum += this.approachDrive(ag.pscr.r);
  }

  private finishProbeJob(ag: Agent, job: number): void {
    ag.probeAcc[job] = ag.probeSum / (PROBE_STEPS - (PROBE_STEPS >> 1));
    if (job === PROBE_CHANNELS.length) {
      for (let c = 0; c < PROBE_CHANNELS.length; c++) {
        const x = ag.probeAcc[1 + c] - ag.probeAcc[0];
        ag.pref[c] = Math.tanh(x / PROBE_SCALE);
        if (!ag.prefBaseValid) ag.prefBase[c] = x;
        ag.prefChange[c] = Math.tanh((x - ag.prefBase[c]) / PROBE_SCALE);
      }
      ag.prefBaseValid = true;
    }
  }

  /**
   * 好みの探りを進める。呼ぶたび、探り中の各エージェントを 1 ステップだけ進める（計算を各 tick に均す）。
   * 周期が来たらスナップショット（r, d の複製）を取り、ジョブ 0 = 基準（刺激なし）、ジョブ 1.. = 各匂い（両側 s = 1）を
   * 複製の上で学習なし・雑音なしに PROBE_STEPS ステップ走らせる。
   * pref = tanh((匂いの接近駆動 - 無刺激の接近駆動) / PROBE_SCALE)（生の値。MBON の価値割り当てが未検証なので UI の主表示には使わない）。
   * prefChange = tanh((その差 - 暖機直後の差) / PROBE_SCALE)（学習で動いた分。UI の主表示）。接近駆動 = 後半の sum(r_mbon * valence)（ACh +1、Glu -1）。
   * @returns 進めたステップ数
   */
  probeWork(): number {
    const nJobs = 1 + PROBE_CHANNELS.length;
    const sts = this.psts, ins = this.pins, act = this.pact;
    sts.length = 0; ins.length = 0; act.length = 0;
    for (let a = 0; a < this.nAgents; a++) {
      const ag = this.agents[a];
      if (ag.probeNext >= nJobs) {
        if (ag.steps < ag.probeDue) continue;
        ag.snap.copyFrom(ag.st);
        ag.probeNext = 0;
        ag.probeDue = ag.steps + this.probeEvery;
        this.startProbeJob(ag, 0);
      }
      sts.push(ag.pscr); ins.push(ag.pI); act.push(ag);
    }
    if (sts.length === 0) return 0;
    stepBrains(this.net, sts, ins, false);
    for (const ag of act) {
      this.probeAfterStep(ag);
      if (ag.probeStep >= PROBE_STEPS) {
        this.finishProbeJob(ag, ag.probeNext);
        ag.probeNext++;
        if (ag.probeNext < nJobs) this.startProbeJob(ag, ag.probeNext);
      }
    }
    return sts.length;
  }
  private psts: BrainState[] = [];
  private pins: Float64Array[] = [];
  private pact: Agent[] = [];

  /** 同期で全部の探りを 1 回計算する（テスト用）。進行中の探りは壊す。 */
  probeNow(a: number): Float32Array {
    const ag = this.agents[a];
    ag.snap.copyFrom(ag.st);
    const nJobs = 1 + PROBE_CHANNELS.length;
    for (let j = 0; j < nJobs; j++) {
      this.startProbeJob(ag, j);
      while (ag.probeStep < PROBE_STEPS) {
        stepBrains(this.net, [ag.pscr], [ag.pI], false);
        this.probeAfterStep(ag);
      }
      this.finishProbeJob(ag, j);
    }
    ag.probeNext = nJobs;
    return ag.pref;
  }

  /** 全員の基準の好みを今の状態で取る（暖機の直後、注射の前に呼ぶ）。以後 prefChange は 0 から始まる。 */
  captureBaseline(): void {
    for (let a = 0; a < this.nAgents; a++) {
      this.agents[a].prefBaseValid = false;
      this.probeNow(a);
    }
  }

  /** 暖機: 刺激なし・雑音ありで steps ステップ。 */
  warmup(a: number, steps: number): void {
    const ag = this.agents[a];
    const save = ag.stim.slice();
    ag.stim.fill(0);
    for (let i = 0; i < steps; i++) this.stepAgent(a);
    ag.stim.set(save);
  }

  /** 暖機済みの 1 体の r を他の体へ写し、雑音の違いで散らす。 */
  warmupAll(steps: number, spread: number): void {
    this.warmup(0, steps);
    for (let a = 1; a < this.nAgents; a++) {
      this.agents[a].st.r.set(this.agents[0].st.r);
      this.warmup(a, spread);
    }
  }

  /** 出力を out[o..o+outLen) へ書く。 */
  writeOutput(a: number, out: Float32Array, o: number): void {
    const ag = this.agents[a];
    const L = this.layout;
    for (let i = 0; i < 5; i++) out[o + L.cmd + i] = ag.body[i];
    out[o + L.backward] = ag.cmd.backward;
    out[o + L.escape] = ag.cmd.escape;
    for (let i = 0; i < ag.z.length; i++) out[o + L.z + i] = ag.z[i];
    for (let i = 0; i < ag.panel.length; i++) out[o + L.panel + i] = ag.panel[i];
    out[o + L.da] = ag.da[0];
    out[o + L.da + 1] = ag.da[1];
    for (let i = 0; i < ag.pref.length; i++) out[o + L.pref + i] = ag.pref[i];
    for (let i = 0; i < ag.prefChange.length; i++) out[o + L.prefChange + i] = ag.prefChange[i];
  }
}
