/**
 * メインスレッド側: 全ハエ人の脳を 1 つの Worker に束ねる窓口と、BrainAgent 実装 ConnectomeBrain。
 *
 * Sim.step は同期なので、ConnectomeBrain.step は「直近に Worker から届いた命令」を返す（遅れは 1〜数 tick）。
 * センサ入力はその tick の分をためておき、マイクロタスクでまとめて Worker へ送る。Sim が 1 フレームに
 * 何 tick 進めても、tick は 1 つも落とさず Worker が順に処理する。追いつけないときは `[flytown:brain] lag` を出す。
 */
import type { SensorFrame } from '../../sim/sensors.ts';
import type { BodyCommand, BrainAgent, BrainDebug } from '../types.ts';
import { ZERO_COMMAND } from '../types.ts';
import type { DopamineKind } from './batch.ts';
import { EncodeState, STIM_LEN, encodeSensors } from './encode.ts';
import type { BrainLayout, FromWorker, ToWorker } from './protocol.ts';

/** これ以上 tick がたまったら lag として報告する（5 tick = 100 ms）。 */
export const LAG_TICKS = 5;
/** これ以上たまったら古い tick から捨てる（10 秒分）。捨てたことも報告する。 */
export const MAX_PENDING_TICKS = 500;
/** 1 tick の計算がこの時間（ms）を超えたら lag として報告する。 */
export const STEP_BUDGET_MS = 20;

/** 脳パネル用の活動の尺度: mean rate / ACTIVITY_FULL を 0..1 に切る。 */
const ACTIVITY_FULL = 2.0;

export interface ConnectomeDebug {
  /** 区分（sensory, MB, LH, CX, DN, other）ごとの平均発火率。 */
  rates: Record<string, number>;
  /** ドーパミン細胞群の平均発火率。 */
  dopamine: { pam: number; ppl1: number };
  /** 読み出しの z 値（rec_names の名前で引ける）。 */
  z: Record<string, number>;
  /** 匂いチャネルごとの接近駆動 -1..1（約 2 秒ごとに更新）。 */
  preference: Record<string, number>;
  /** 暖機直後の基準からの好みの変化（-1..+1、起動直後は 0）。 */
  preferenceChange: Record<string, number>;
  /** Worker に未処理の tick 数。 */
  lagTicks: number;
}

export interface HubOptions {
  /** circuit/ の置き場の基準 URL（絶対 URL、末尾スラッシュ付き）。 */
  baseUrl: string;
  seed?: number;
  /** Worker の数。既定: 2 体ごとに 1 つ、最大 3（体 1〜2 -> 1、3〜4 -> 2、5〜6 -> 3）。体は均等に割り振る。 */
  workers?: number;
  /** ログの出力先を差し替える（テスト用）。 */
  log?: (msg: string) => void;
}

interface Shard {
  worker: Worker;
  /** この Worker が受け持つ全体の体番号。 */
  ids: number[];
  ready: boolean;
  out: Float32Array | null;
  sent: number;
  done: number;
  stepMs: number;
}

export class ConnectomeHub {
  readonly n: number;
  readonly brains: ConnectomeBrain[] = [];
  ready = false;
  layout: BrainLayout | null = null;
  lagTicks = 0;
  lastStepMs = 0;
  readonly stats = { ticksSent: 0, ticksDone: 0, lagEvents: 0, dropped: 0 };
  private shards: Shard[] = [];
  private owner: { shard: number; local: number }[] = [];
  private opts: HubOptions;
  private slots: { tick: number; stim: Float32Array; active: Uint8Array }[] = [];
  private adapt: EncodeState[] = [];
  private flushScheduled = false;
  private lastLagLog = -1e9;

  constructor(n: number, opts: HubOptions) {
    this.n = n;
    this.opts = opts;
    for (let i = 0; i < n; i++) this.adapt.push(new EncodeState());
    const k = Math.max(1, Math.min(n, opts.workers ?? Math.min(3, Math.ceil(n / 2))));
    for (let s = 0; s < k; s++) this.shards.push({ worker: null as unknown as Worker, ids: [], ready: false, out: null, sent: 0, done: 0, stepMs: 0 });
    for (let i = 0; i < n; i++) {
      const s = i % k;
      this.owner.push({ shard: s, local: this.shards[s].ids.length });
      this.shards[s].ids.push(i);
    }
    this.shards.forEach((sh, si) => {
      sh.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      sh.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(si, e.data);
      sh.worker.onerror = (e) => this.log(`[flytown:error] brain worker ${si}: ${e.message}`);
      this.post(sh, { t: 'init', baseUrl: opts.baseUrl, n: sh.ids.length, seed: (opts.seed ?? 1) * 101 + si });
    });
    for (let i = 0; i < n; i++) this.brains.push(new ConnectomeBrain(this, i));
  }

  private log(msg: string): void {
    (this.opts.log ?? console.log)(msg);
  }

  private post(sh: Shard, m: ToWorker, transfer?: Transferable[]): void {
    sh.worker.postMessage(m, transfer ?? []);
  }

  private onMessage(si: number, m: FromWorker): void {
    const sh = this.shards[si];
    if (m.t === 'ready') {
      this.layout = m.layout;
      sh.ready = true;
      this.log(`[flytown:brain] worker ${si} ready agents=${sh.ids.length} circuit_load=${m.loadMs.toFixed(0)}ms warmup=${m.warmMs.toFixed(0)}ms`);
      if (this.shards.every((x) => x.ready)) {
        this.ready = true;
        this.log(`[flytown:brain] ready n=${this.n} workers=${this.shards.length}`);
      }
    } else if (m.t === 'result') {
      sh.out = m.out;
      sh.done += m.ticksDone;
      sh.stepMs = m.procMs / Math.max(1, m.ticksDone);
      this.lastStepMs = Math.max(...this.shards.map((x) => x.stepMs));
      this.updateLag();
      if (sh.stepMs > STEP_BUDGET_MS) this.reportLag(`worker ${si} step_ms=${sh.stepMs.toFixed(1)} (budget ${STEP_BUDGET_MS})`);
    } else if (m.t === 'error') {
      this.log(`[flytown:error] brain worker ${si}: ${m.message}`);
    }
  }

  private updateLag(): void {
    this.lagTicks = Math.max(...this.shards.map((x) => x.sent - x.done));
    this.stats.ticksSent = Math.max(...this.shards.map((x) => x.sent));
    this.stats.ticksDone = Math.min(...this.shards.map((x) => x.done));
  }

  private reportLag(detail: string): void {
    const now = performance.now();
    this.stats.lagEvents++;
    if (now - this.lastLagLog < 2000) return;
    this.lastLagLog = now;
    this.log(`[flytown:brain] lag ${detail} pending_ticks=${this.lagTicks} events=${this.stats.lagEvents}`);
  }

  /** ConnectomeBrain.step から呼ばれる。その tick の刺激量をためる。 */
  pushFrame(agent: number, s: SensorFrame): void {
    if (!this.ready) return;
    let slot = this.slots[this.slots.length - 1];
    if (!slot || slot.tick !== s.tick) {
      slot = { tick: s.tick, stim: new Float32Array(this.n * STIM_LEN), active: new Uint8Array(this.n) };
      this.slots.push(slot);
    }
    encodeSensors(s, slot.stim.subarray(agent * STIM_LEN, (agent + 1) * STIM_LEN), this.adapt[agent]);
    slot.active[agent] = 1;
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    this.flushScheduled = false;
    const k = this.slots.length;
    if (!k) return;
    this.updateLag();
    if (this.lagTicks + k >= MAX_PENDING_TICKS) {
      // メモリを守るため、これ以上は送らずに捨てる。捨てたことは必ず報告する。
      this.stats.dropped += k;
      this.slots.length = 0;
      this.reportLag(`overflow: dropped ${k} ticks (total dropped ${this.stats.dropped})`);
      return;
    }
    const ticks = this.slots.map((sl) => sl.tick);
    for (const sh of this.shards) {
      const m = sh.ids.length;
      const stim = new Float32Array(k * m * STIM_LEN);
      const active = new Uint8Array(k * m);
      for (let i = 0; i < k; i++) {
        const sl = this.slots[i];
        for (let j = 0; j < m; j++) {
          const g = sh.ids[j];
          stim.set(sl.stim.subarray(g * STIM_LEN, (g + 1) * STIM_LEN), (i * m + j) * STIM_LEN);
          active[i * m + j] = sl.active[g];
        }
      }
      sh.sent += k;
      this.post(sh, { t: 'ticks', ticks, stim, active }, [stim.buffer, active.buffer]);
    }
    this.slots.length = 0;
    this.updateLag();
    if (this.lagTicks >= LAG_TICKS) this.reportLag(`queue ${this.lagTicks} ticks`);
  }

  inject(agent: number, kind: DopamineKind, dose: 1 | 2 | 3, durationMs: number): void {
    const o = this.owner[agent];
    this.post(this.shards[o.shard], { t: 'inject', agent: o.local, kind, dose, durationMs });
  }

  reset(agent: number): void {
    const o = this.owner[agent];
    this.post(this.shards[o.shard], { t: 'reset', agent: o.local });
  }

  /** agent の最新の出力（Float32Array の窓）。未準備なら null。 */
  view(agent: number): Float32Array | null {
    const L = this.layout;
    const o = this.owner[agent];
    const out = this.shards[o.shard].out;
    if (!L || !out) return null;
    return out.subarray(o.local * L.outLen, (o.local + 1) * L.outLen);
  }

  dispose(): void {
    for (const sh of this.shards) sh.worker.terminate();
  }
}

export class ConnectomeBrain implements BrainAgent {
  readonly id: string;
  readonly label = '神経回路（FlyWire）';
  private hub: ConnectomeHub;
  private idx: number;
  private cmd: BodyCommand = { ...ZERO_COMMAND };

  constructor(hub: ConnectomeHub, idx: number) {
    this.hub = hub;
    this.idx = idx;
    this.id = `connectome-${idx}`;
  }

  step(sensors: SensorFrame, _dtMs: number): BodyCommand {
    this.hub.pushFrame(this.idx, sensors);
    const v = this.hub.view(this.idx);
    if (!v) return this.cmd;
    const c = this.hub.layout!.cmd;
    const o = this.cmd;
    o.forward = v[c];
    o.turn = v[c + 1];
    o.flap = v[c + 2];
    o.groom = v[c + 3];
    o.feed = v[c + 4];
    return o;
  }

  reset(): void {
    this.hub.reset(this.idx);
  }

  /** ドーパミン注入。reward = PAM（ご褒美）、punish = PPL1（お仕置き）、all = DAN 全部。dose 1/2/3 = 電流 1.5/3.0/4.5。 */
  inject(kind: DopamineKind, dose: 1 | 2 | 3, durationMs: number): void {
    this.hub.inject(this.idx, kind, dose, durationMs);
  }

  /** 匂いチャネルごとの接近駆動 -1..1。Worker が約 2 秒ごとに更新した値。未準備なら空。 */
  getPreference(): Record<string, number> {
    return this.getConnectomeDebug()?.preference ?? {};
  }

  getConnectomeDebug(): ConnectomeDebug | null {
    const v = this.hub.view(this.idx);
    const L = this.hub.layout;
    if (!v || !L) return null;
    const rates: Record<string, number> = {};
    L.panelNames.forEach((nm, i) => (rates[nm] = v[L.panel + i]));
    const z: Record<string, number> = {};
    L.recNames.forEach((nm, i) => (z[nm] = v[L.z + i]));
    const preference: Record<string, number> = {};
    L.probeChannels.forEach((nm, i) => (preference[nm] = v[L.pref + i]));
    const preferenceChange: Record<string, number> = {};
    L.probeChannels.forEach((nm, i) => (preferenceChange[nm] = v[L.prefChange + i]));
    return { rates, dopamine: { pam: v[L.da], ppl1: v[L.da + 1] }, z, preference, preferenceChange, lagTicks: this.hub.lagTicks };
  }

  getDebug(): BrainDebug {
    const d = this.getConnectomeDebug();
    if (!d) return { note: '回路を読み込み中' };
    const activity: Record<string, number> = {};
    for (const [k, r] of Object.entries(d.rates)) activity[k] = Math.max(0, Math.min(1, r / ACTIVITY_FULL));
    return { activity, extra: { ...d } };
  }
}
