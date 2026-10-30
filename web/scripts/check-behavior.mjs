// 行動の計測（ヘッドレス）。実際の回路（Worker なし、BrainBatch を同期で）+ 実際の TownField + 固定シード。
//   npm run check:behavior            20 シード（既定）
//   node scripts/check-behavior.mjs --seeds 3 --workers 2 --no-write   試走
// 結果は表で出力し、docs/reports/m5_behavior.md に書く。合否は付けるが、何も調整しない。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

// ------------------------------------------------------------------ 共通

const WIND_DEG = 90; // 東（+x）へ
const WIND_SPEED = 0.5; // m/s（既定）
const PLUME_WARM_S = 40; // 匂いが定常になるまでの時間（脳なし）
const ODOR_TEST_S = 60;
const HEAT_TEST_S = 30;
const LOOM_TEST_S = 10;
const START_DIST = 6; // 発生源から風下へ
const NEAR = 2; // 「近づいた」とみなす距離
const ZONE = 6; // ヒーターの暖かい範囲の半径

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ ワーカー側

async function workerMain() {
  const { parseCircuit } = await import('../src/brain/connectome/circuit.ts');
  const { BrainBatch } = await import('../src/brain/connectome/batch.ts');
  const { STIM_LEN, EncodeState, encodeSensors } = await import('../src/brain/connectome/encode.ts');
  const { Sim } = await import('../src/sim/sim.ts');

  const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const meta = JSON.parse(readFileSync(path.join(root, 'web/public/circuit/meta.json'), 'utf8'));
  const circ = parseCircuit(ab(path.join(root, 'web/public/circuit/circuit.bin')), meta);

  /** 同期の脳: ConnectomeBrain と同じ符号化・同じ BrainBatch。Worker の遅れ（1〜数 tick）だけ無い。 */
  class SyncBrain {
    constructor(seed) {
      this.id = 'sync';
      this.label = 'sync';
      this.batch = new BrainBatch(circ, 1, { seed, probeEvery: 0 });
      this.batch.warmup(0, 150);
      this.stim = new Float32Array(STIM_LEN);
      this.es = new EncodeState();
      this.out = new Float32Array(this.batch.outLen);
      this.cmd = { forward: 0, turn: 0, flap: 0, groom: 0, feed: 0 };
    }
    step(sensors) {
      encodeSensors(sensors, this.stim, this.es);
      this.batch.setStimulus(0, this.stim);
      this.batch.stepAgent(0);
      this.batch.writeOutput(0, this.out, 0);
      const o = this.out, c = this.cmd;
      c.forward = o[0]; c.turn = o[1]; c.flap = o[2]; c.groom = o[3]; c.feed = o[4];
      return c;
    }
    reset() {}
  }

  const newSim = (carCount) => {
    const sim = new Sim({ flyCount: 1, npcCount: 0, carCount });
    sim.town.setWind(WIND_DEG, WIND_SPEED);
    // 既定の置き物（殺虫器・ハエ取り紙）は外す。計測に混ざらないように。
    for (const it of [...sim.town.items]) sim.town.removeItem(it.id);
    return sim;
  };
  const run = (sim, sec) => { for (let i = 0; i < Math.round(sec * 50); i++) sim.step(); };

  // 計測地点: 発生源 S から風下（+x）20 m までが空いていて、場が中立で、既定の発生源から 25 m 以上離れた歩道上の点。
  const sites = (() => {
    const sim = newSim(0);
    const f = sim.flies[0];
    const cand = [];
    for (let x = -130; x <= 110; x += 10) for (let z = -130; z <= 130; z += 10) {
      let ok = true;
      for (let k = -8; k <= 22 && ok; k++) if (sim.world.isBlocked(x + k, z, 0.6)) ok = false;
      if (!ok) continue;
      for (const k of [-6, 0, 6, 12, 20]) {
        const s = sim.field.sample(x + k, 1.6, z, 0, 99);
        const tot = Object.values(s.odor).reduce((a, b) => a + b, 0) + s.warm + s.cold + s.dust + Math.abs(s.humidity - 0.5) + s.taste.sugar + s.taste.bitter + s.taste.water + s.light;
        if (tot > 0.01) ok = false;
      }
      if (ok && sim.town.sources.some((s) => Math.hypot(s.x - x, s.z - z) < 25)) ok = false;
      if (ok) cand.push({ x, z });
    }
    // 互いに 60 m 以上離れた 5 地点を、決まった順に選ぶ
    const out = [];
    for (const c of cand) if (out.every((o) => Math.hypot(o.x - c.x, o.z - c.z) >= 60)) out.push(c);
    void f;
    return out.slice(0, 5);
  })();
  if (sites.length < 3) throw new Error(`計測地点が足りません: ${sites.length}`);

  const place = (f, x, z, yaw) => {
    f.x = f.px = x; f.z = f.pz = z; f.yaw = f.pyaw = yaw;
    f.y = f.py = 0; f.vx = f.vz = f.vy = 0; f.vf = 0; f.turnRate = 0;
    f.flapSeconds = 0; f.flapLocked = false;
  };
  /** 置いた直後はレイの距離の履歴が飛んで looming が偽に立つ。脳をつなぐ前に数 tick 進めて履歴を作る。 */
  const settle = (sim) => { for (let i = 0; i < 3; i++) sim.step(); };
  const siteOf = (seed) => sites[seed % sites.length];
  const yawOf = (seed) => mulberry(seed * 7919 + 3)() * Math.PI * 2;

  /** 発生源 S の周りで fly を seconds 秒走らせ、S からの距離の履歴を返す。 */
  const track = (sim, f, S, sec) => {
    let minD = Infinity, t2 = -1, inZone = 0;
    const n = Math.round(sec * 50);
    for (let i = 0; i < n; i++) {
      sim.step();
      const d = Math.hypot(f.x - S.x, f.z - S.z);
      if (d < minD) minD = d;
      if (t2 < 0 && d <= NEAR) t2 = (i + 1) / 50;
      if (d <= ZONE) inZone++;
    }
    return { minD, tNear: t2, within: minD <= NEAR, dEnd: Math.hypot(f.x - S.x, f.z - S.z), dwell: inZone / 50, accidents: f.accidents, zaps: f.stats.zaps };
  };

  // ---------------------------------------------------------------- 実験

  function odor(job) {
    const S = siteOf(job.seed);
    const sim = newSim(0);
    const f = sim.flies[0];
    if (job.src !== 'none') sim.town.addItem(job.src, S.x, S.z, 0);
    place(f, S.x + START_DIST, S.z, yawOf(job.seed));
    run(sim, PLUME_WARM_S);
    place(f, S.x + START_DIST, S.z, yawOf(job.seed));
    settle(sim);
    sim.attachBrain(0, new SyncBrain(1000 + job.seed));
    return track(sim, f, S, ODOR_TEST_S);
  }

  function heat(job) {
    const S = siteOf(job.seed);
    const sim = newSim(0);
    const f = sim.flies[0];
    if (job.src !== 'none') sim.town.addItem('heater', S.x, S.z, 0);
    place(f, S.x + 2, S.z, yawOf(job.seed));
    run(sim, 1);
    place(f, S.x + 2, S.z, yawOf(job.seed));
    settle(sim);
    sim.attachBrain(0, new SyncBrain(2000 + job.seed));
    return track(sim, f, S, HEAT_TEST_S);
  }

  function loom(job) {
    // 走っている車を 1 台選び、その 25 m 前に車の方を向けてハエ人を置く。対照は同じ姿勢で車を 0 台にした街。
    const sim = newSim(15);
    run(sim, 10 + (job.seed % 10) * 1.3);
    const moving = sim.cars.filter((c) => c.speed > 3);
    if (!moving.length) return { skipped: true };
    const car = moving[job.seed % moving.length];
    const L = 25;
    const px = car.x + Math.sin(car.yaw) * L, pz = car.z + Math.cos(car.yaw) * L;
    const yaw = car.yaw + Math.PI;
    let sim2 = sim, f;
    if (!job.car) { sim2 = newSim(0); run(sim2, 10); }
    f = sim2.flies[0];
    place(f, px, pz, yaw);
    f.invuln = 0;
    settle(sim2);
    sim2.attachBrain(0, new SyncBrain(3000 + job.seed));
    let maxFlap = 0, escapeAt = -1, hitAt = -1, minCar = Infinity, forwardAtEscape = 0;
    for (let i = 0; i < LOOM_TEST_S * 50; i++) {
      sim2.step();
      if (f.cmd.flap > maxFlap) maxFlap = f.cmd.flap;
      if (escapeAt < 0 && f.cmd.flap > 0.15) { escapeAt = (i + 1) / 50; forwardAtEscape = f.cmd.forward; }
      if (job.car) for (const c of sim2.cars) { const d = Math.hypot(c.x - f.x, c.z - f.z); if (d < minCar) minCar = d; }
      if (f.accidents > 0 && hitAt < 0) { hitAt = (i + 1) / 50; break; }
    }
    return { escaped: escapeAt >= 0, escapeAt, maxFlap, hit: hitAt >= 0, hitAt, minCar: job.car ? minCar : null, forwardAtEscape };
  }

  function learn(job) {
    const S = siteOf(job.seed);
    const R = sites[(job.seed + 1) % sites.length]; // 休む場所（別の中立地点）
    const sim = newSim(0);
    const f = sim.flies[0];
    sim.town.addItem('banana', S.x, S.z, 0);
    const yaw = yawOf(job.seed);
    place(f, S.x + START_DIST, S.z, yaw);
    run(sim, PLUME_WARM_S);
    const brain = new SyncBrain(4000 + job.seed);
    sim.attachBrain(0, brain);
    const prefIdx = brain.batch.probeChannelNames.indexOf('fruit');

    const go = () => { place(f, S.x + START_DIST, S.z, yaw); f.brain = null; settle(sim); place(f, S.x + START_DIST, S.z, yaw); f.brain = brain; };
    go();
    const prefPre = brain.batch.probeNow(0)[prefIdx];
    const pre = track(sim, f, S, ODOR_TEST_S);

    // 訓練: 匂いの中に 4 s 置き、休み場所に 8 s 置く。3 回。ご褒美は対提示（匂いの後半 2 s）か、非対提示（休みの 4 s 後）。
    // 位置は固定（強制曝露）。脳の出力は使わない。センサは実際の場から。
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < 12 * 50; i++) {
        const t = i / 50;
        const inOdor = t < 4;
        if (inOdor) place(f, S.x + 3, S.z, -Math.PI / 2); else place(f, R.x, R.z, 0);
        const injectAt = job.paired ? 2 : 8;
        if (i === injectAt * 50) brain.batch.inject(0, 'reward', 3, 2000);
        sim.step();
      }
    }
    go();
    const prefPost = brain.batch.probeNow(0)[prefIdx];
    const post = track(sim, f, S, ODOR_TEST_S);
    return { pre, post, prefPre, prefPost };
  }

  parentPort.postMessage({ t: 'ready', sites });
  parentPort.on('message', (job) => {
    if (job.t === 'stop') process.exit(0);
    const t0 = performance.now();
    let r;
    try {
      r = job.exp === 'odor' ? odor(job) : job.exp === 'heat' ? heat(job) : job.exp === 'loom' ? loom(job) : learn(job);
    } catch (e) {
      r = { error: String(e?.stack ?? e) };
    }
    parentPort.postMessage({ t: 'done', job, r, ms: performance.now() - t0 });
  });
}

// ------------------------------------------------------------------ 本体側

function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const frac = (k, n) => { const [lo, hi] = wilson(k, n); return `${k}/${n} (${pct(k / n)}, 95% CI ${pct(lo)}-${pct(hi)})`; };
const ms = (a, d = 1) => `${mean(a).toFixed(d)} ± ${(sd(a) / Math.sqrt(Math.max(1, a.length))).toFixed(d)}`;

async function mainThread() {
  const args = process.argv.slice(2);
  const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const nSeeds = Number(arg('--seeds', 20));
  const nWorkers = Number(arg('--workers', Math.min(3, Math.max(1, os.cpus().length - 4))));
  const write = !args.includes('--no-write');

  const jobs = [];
  for (let s = 0; s < nSeeds; s++) {
    jobs.push({ exp: 'learn', paired: true, seed: s }, { exp: 'learn', paired: false, seed: s });
  }
  for (let s = 0; s < nSeeds; s++) {
    jobs.push({ exp: 'odor', src: 'banana', seed: s }, { exp: 'odor', src: 'mold', seed: s }, { exp: 'odor', src: 'none', seed: s });
  }
  for (let s = 0; s < nSeeds; s++) {
    jobs.push({ exp: 'heat', src: 'heater', seed: s }, { exp: 'heat', src: 'none', seed: s });
    jobs.push({ exp: 'loom', car: true, seed: s }, { exp: 'loom', car: false, seed: s });
  }
  const results = [];
  let next = 0, done = 0, sitesInfo = null;
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    for (let w = 0; w < nWorkers; w++) {
      const wk = new Worker(new URL(import.meta.url), { workerData: { w } });
      const feed = () => {
        if (next < jobs.length) wk.postMessage(jobs[next++]);
        else { wk.postMessage({ t: 'stop' }); }
      };
      wk.on('message', (m) => {
        if (m.t === 'ready') { sitesInfo = m.sites; feed(); }
        else if (m.t === 'done') {
          if (m.r.error) { reject(new Error(m.r.error)); return; }
          results.push({ ...m.job, ...m.r });
          done++;
          if (done % 10 === 0 || done === jobs.length) console.error(`  ${done}/${jobs.length} jobs, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
          if (done === jobs.length) resolve();
          else feed();
        }
      });
      wk.on('error', reject);
    }
  });
  const wall = (performance.now() - t0) / 1000;

  const pick = (f) => results.filter(f);
  const lines = [];
  const out = (s = '') => { lines.push(s); console.log(s); };

  const metaBytes = readFileSync(path.join(root, 'web/public/circuit/meta.json'));
  const binBytes = readFileSync(path.join(root, 'web/public/circuit/circuit.bin'));
  const hash = createHash('sha256').update(metaBytes).update(binBytes).digest('hex').slice(0, 12);
  const today = new Date().toISOString().slice(0, 10);

  out('# M5 行動計測（ヘッドレス）');
  out();
  out(`日付: ${today}。回路: sha256(meta.json + circuit.bin) 先頭 12 桁 = \`${hash}\`。実行: \`npm run check:behavior\`（${nSeeds} シード、所要 ${wall.toFixed(0)} 秒、ワーカー ${nWorkers}）。`);
  out();
  out('実際の回路（BrainBatch を Worker なしで同期実行）、実際の TownField、固定シード。ハエ人 1 体、NPC・車なし（looming の実験を除く）。何も調整していない。合否は事前に決めた基準との比較で、結果が悪くてもそのまま載せる。');
  out();
  out('設定: 風は東 0.5 m/s。計測地点は発生源から風下 20 m が空いていて場が中立な歩道上の点（' + sitesInfo.length + ' 地点、シード番号で巡回）。ハエ人の向きはシードから決めた一様乱数、脳の雑音もシードごと。対照は同じ地点・向き・脳のシードで発生源だけ無し。脳の暖機は無刺激 3 s。');
  out();

  // --- 匂い
  out('## 1. 匂いへの接近と回避（発生源の風下 6 m から 60 s）');
  out();
  out('近づいた = 発生源から 2 m 以内に入ったこと。対照は発生源なし（同じ点との距離を測る）。');
  out();
  out('| 条件 | 2 m 以内に入った割合 | 最短距離 m（平均 ± 標準誤差） | 60 s 後の距離 m | 初到達までの時間 s（到達した個体） |');
  out('|---|---|---|---|---|');
  const rowOdor = (name, src) => {
    const r = pick((x) => x.exp === 'odor' && x.src === src);
    const k = r.filter((x) => x.within).length;
    out(`| ${name} | ${frac(k, r.length)} | ${ms(r.map((x) => x.minD))} | ${ms(r.map((x) => x.dEnd))} | ${k ? ms(r.filter((x) => x.within).map((x) => x.tNear)) : '-'} |`);
    return { k, n: r.length };
  };
  const ban = rowOdor('バナナ（果実 + 酢）', 'banana');
  const mold = rowOdor('カビ箱（ジオスミン）', 'mold');
  const ctl = rowOdor('対照（発生源なし）', 'none');
  out();
  const okBan = ban.k / ban.n > ctl.k / ctl.n;
  const okMold = mold.k / mold.n < ctl.k / ctl.n;
  out(`- バナナ: 割合が対照より高い -> ${okBan ? '合' : '否'}（${pct(ban.k / ban.n)} 対 ${pct(ctl.k / ctl.n)}）。`);
  out(`- ジオスミン: 割合が対照より低い -> ${okMold ? '合' : '否'}（${pct(mold.k / mold.n)} 対 ${pct(ctl.k / ctl.n)}）。対照が低いと「低い」は検出しにくい。最短距離も併せて見る。`);
  out();

  // --- 熱
  out('## 2. 熱の回避（ヒーターの 2 m 横から 30 s）');
  out();
  out(`暖かい範囲 = 半径 ${ZONE} m。滞在時間 = その範囲に居た秒数。`);
  out();
  out('| 条件 | 範囲内の滞在 s | 30 s 後の距離 m | 最短距離 m |');
  out('|---|---|---|---|');
  const hh = pick((x) => x.exp === 'heat' && x.src === 'heater');
  const hc = pick((x) => x.exp === 'heat' && x.src === 'none');
  out(`| ヒーター | ${ms(hh.map((x) => x.dwell))} | ${ms(hh.map((x) => x.dEnd))} | ${ms(hh.map((x) => x.minD))} |`);
  out(`| 対照（なし） | ${ms(hc.map((x) => x.dwell))} | ${ms(hc.map((x) => x.dEnd))} | ${ms(hc.map((x) => x.minD))} |`);
  out();
  const okHeat = mean(hh.map((x) => x.dwell)) < mean(hc.map((x) => x.dwell));
  out(`- ヒーターで滞在が短い -> ${okHeat ? '合' : '否'}（${mean(hh.map((x) => x.dwell)).toFixed(1)} s 対 ${mean(hc.map((x) => x.dwell)).toFixed(1)} s）。`);
  out();

  // --- looming
  out('## 3. 迫る車からの逃避（車の 25 m 前、車の方を向いて 10 s）');
  out();
  out('逃避 = 羽ばたき指令 > 0.15 が出たこと。対照は同じ姿勢で車 0 台の街。事故 = 車に当たって倒れたこと。');
  out();
  out('| 条件 | 逃避した割合 | 逃避までの時間 s | 事故 | 車との最短距離 m |');
  out('|---|---|---|---|---|');
  const lc = pick((x) => x.exp === 'loom' && x.car && !x.skipped);
  const l0 = pick((x) => x.exp === 'loom' && !x.car && !x.skipped);
  const esc = (r) => r.filter((x) => x.escaped);
  out(`| 車あり | ${frac(esc(lc).length, lc.length)} | ${esc(lc).length ? ms(esc(lc).map((x) => x.escapeAt)) : '-'} | ${lc.filter((x) => x.hit).length}/${lc.length} | ${ms(lc.map((x) => x.minCar))} |`);
  out(`| 対照（車なし） | ${frac(esc(l0).length, l0.length)} | ${esc(l0).length ? ms(esc(l0).map((x) => x.escapeAt)) : '-'} | - | - |`);
  out();
  const okLoom = esc(lc).length / Math.max(1, lc.length) > esc(l0).length / Math.max(1, l0.length);
  out(`- 車ありで逃避が多い -> ${okLoom ? '合' : '否'}。`);
  out();

  // --- 学習
  out('## 4. 学習（果実の匂い + ご褒美 3 回）');
  out();
  out('手順: 各シードで、バナナの風下 6 m から 60 s（前）-> 訓練 -> 同じ姿勢から 60 s（後）。訓練 = 匂いの中に 4 s、休み場所に 8 s、を 3 回（位置は固定、センサは実際の場）。対提示 = 匂いの後半 2 s にご褒美（PAM、量 3、2 s）。非対提示 = 同じ回数のご褒美を匂いの 4 s 後に出す。');
  out();
  out('| 条件 | 前: 2 m 以内 | 後: 2 m 以内 | 差（点） | 前: 最短距離 m | 後: 最短距離 m | 好み(果物)前 | 好み(果物)後 |');
  out('|---|---|---|---|---|---|---|---|');
  const lrow = (name, paired) => {
    const r = pick((x) => x.exp === 'learn' && x.paired === paired);
    const kp = r.filter((x) => x.pre.within).length;
    const kq = r.filter((x) => x.post.within).length;
    out(`| ${name} | ${frac(kp, r.length)} | ${frac(kq, r.length)} | ${(100 * (kq - kp) / r.length).toFixed(0)} | ${ms(r.map((x) => x.pre.minD))} | ${ms(r.map((x) => x.post.minD))} | ${ms(r.map((x) => x.prefPre), 3)} | ${ms(r.map((x) => x.prefPost), 3)} |`);
    return { gain: (kq - kp) / r.length, n: r.length, dMin: mean(r.map((x) => x.post.minD - x.pre.minD)), dPref: mean(r.map((x) => x.prefPost - x.prefPre)) };
  };
  const lp = lrow('対提示', true);
  const lu = lrow('非対提示', false);
  out();
  const diff = (lp.gain - lu.gain) * 100;
  out(`- 接近割合の差（対提示 - 非対提示）: ${diff.toFixed(0)} 点。SPEC の基準 +20 点 -> ${diff >= 20 ? '合' : '否'}。`);
  out(`- 前後の最短距離の変化: 対提示 ${lp.dMin.toFixed(2)} m、非対提示 ${lu.dMin.toFixed(2)} m。好み(果物)の変化: 対提示 ${lp.dPref.toFixed(3)}、非対提示 ${lu.dPref.toFixed(3)}。`);
  const preEq = pick((x) => x.exp === 'learn' && x.paired).every((x) => {
    const y = results.find((z) => z.exp === 'learn' && !z.paired && z.seed === x.seed);
    return y && y.pre.minD === x.pre.minD;
  });
  out(`- 前の計測は同じシードなら同じはず: 対提示と非対提示の「前」が全シードで一致 -> ${preEq ? '一致（決定的）' : '不一致（再現性に問題あり）'}。`);
  out();

  out('## 要約');
  out();
  out('| 項目 | 結果 | 基準 | 合否 |');
  out('|---|---|---|---|');
  out(`| バナナへの接近 | ${pct(ban.k / ban.n)}（対照 ${pct(ctl.k / ctl.n)}） | 対照より高い | ${okBan ? '合' : '否'} |`);
  out(`| ジオスミンの回避 | ${pct(mold.k / mold.n)}（対照 ${pct(ctl.k / ctl.n)}） | 対照より低い | ${okMold ? '合' : '否'} |`);
  out(`| 熱の回避 | 滞在 ${mean(hh.map((x) => x.dwell)).toFixed(1)} s（対照 ${mean(hc.map((x) => x.dwell)).toFixed(1)} s） | 対照より短い | ${okHeat ? '合' : '否'} |`);
  out(`| 車からの逃避 | ${pct(esc(lc).length / Math.max(1, lc.length))}（対照 ${pct(esc(l0).length / Math.max(1, l0.length))}） | 対照より高い | ${okLoom ? '合' : '否'} |`);
  out(`| 学習 | ${diff.toFixed(0)} 点 | +20 点以上 | ${diff >= 20 ? '合' : '否'} |`);
  out();
  out('## 限界');
  out();
  out('- 脳は同期実行。ゲームの Worker 経由では命令が 1〜数 tick 遅れる。');
  out('- 地点は 5 つ、シードは 20。割合の 95% 信頼区間は広い（Wilson）。差が信頼区間に収まるなら有意とは言えない。');
  out('- 学習の訓練は位置固定の強制曝露。ゲームで人が注射する状況（動き回るハエ人の近くで打つ）とは違う。');
  out('- 閾値（2 m、6 m、0.15、60 s）は計測前に決めた。結果を見てから変えていない。');
  out();

  if (write) {
    writeFileSync(path.join(root, 'docs/reports/m5_behavior.md'), lines.join('\n') + '\n');
    console.error('wrote docs/reports/m5_behavior.md');
  }
  writeFileSync(path.join(root, 'data', 'behavior_raw.json'), JSON.stringify(results));
}

if (isMainThread) await mainThread();
else { void workerData; await workerMain(); }
