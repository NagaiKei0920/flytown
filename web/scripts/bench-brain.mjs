// 脳の計算速度。 npm run bench:brain  （50 Hz の 1 ステップを全エージェント分で何 ms か）
//   環境変数: REPEAT=3（最良の回を採用）/ STEPS=300 / NOPROBE=1 / THREADS=1,2,3 （ワーカー数。既定は 1 と 3）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { parseCircuit } from '../src/brain/connectome/circuit.ts';
import { BrainBatch } from '../src/brain/connectome/batch.ts';
import { STIM_LEN } from '../src/brain/connectome/encode.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const load = () => {
  const meta = JSON.parse(readFileSync(path.join(root, 'web/public/circuit/meta.json'), 'utf8'));
  return parseCircuit(ab(path.join(root, 'web/public/circuit/circuit.bin')), meta);
};

function makeBatch(circ, n, seed, probeEvery) {
  const b = new BrainBatch(circ, n, { seed, learn: true, noise: true, probeEvery });
  const stim = new Float32Array(STIM_LEN);
  for (let a = 0; a < n; a++) { for (let i = 0; i < STIM_LEN; i++) stim[i] = Math.random() * 0.5; b.setStimulus(a, stim); }
  return b;
}
const IDS = (n) => (IDS.c ??= {})[n] ??= Array.from({ length: n }, (_, i) => i);
function tick(b, n, out) {
  b.stepAgents(IDS(n));
  for (let a = 0; a < n; a++) b.writeOutput(a, out, 0);
  b.probeWork();
}

if (!isMainThread) {
  const { n, seed, probeEvery } = workerData;
  const circ = load();
  const b = makeBatch(circ, n, seed, probeEvery);
  const out = new Float32Array(b.outLen);
  parentPort.on('message', (m) => {
    if (m === 'step') { tick(b, n, out); parentPort.postMessage('done'); }
  });
  parentPort.postMessage('ready');
} else {
  const STEPS = Number(process.env.STEPS ?? 300);
  const BUDGET = 20;
  const REPEAT = Number(process.env.REPEAT ?? 3); // 他のプロセスの負荷を避けるため、平均が最小の回を採る
  const probeEvery = process.env.NOPROBE ? 0 : undefined; // undefined = 既定 (PROBE_EVERY)
  const threadList = (process.env.THREADS ?? '1,3').split(',').map(Number);
  const circ = load();
  let allOk = true;
  const stats = (times) => {
    const sorted = Array.from(times).sort((x, y) => x - y);
    return { mean: times.reduce((x, y) => x + y, 0) / times.length, p95: sorted[Math.floor(times.length * 0.95)], max: sorted[sorted.length - 1] };
  };
  const report = (n, k, st) => {
    const ok = st.p95 < BUDGET;
    if (!ok) allOk = false;
    console.log(`agents=${n} workers=${k}: mean ${st.mean.toFixed(2)} ms/step  p95 ${st.p95.toFixed(2)}  max ${st.max.toFixed(2)}${st.cpu !== undefined ? `  cpu ${st.cpu.toFixed(2)}` : ''}  probe=${probeEvery === 0 ? 'off' : 'on'}  ${ok ? 'OK' : 'OVER 20 ms'}`);
  };
  for (const n of [1, 4, 6]) {
    for (const k of threadList) {
      const kk = Math.min(k, n);
      let best = null;
      for (let rep = 0; rep < REPEAT; rep++) {
      const times = new Float64Array(STEPS);
      if (kk === 1) {
        const b = makeBatch(circ, n, 3, probeEvery);
        const out = new Float32Array(b.outLen);
        for (let i = 0; i < 100; i++) tick(b, n, out);
        const c0 = process.cpuUsage();
        for (let s = 0; s < STEPS; s++) { const t0 = performance.now(); tick(b, n, out); times[s] = performance.now() - t0; }
        const c1 = process.cpuUsage(c0);
        times.cpu = (c1.user + c1.system) / 1000 / STEPS;
      } else {
        // エージェントを kk 個のワーカーに均等に割る
        const per = Array.from({ length: kk }, (_, i) => Math.floor(n / kk) + (i < n % kk ? 1 : 0));
        const ws = per.map((m, i) => new Worker(fileURLToPath(import.meta.url), { workerData: { n: m, seed: 3 + i, probeEvery }, execArgv: ['--experimental-strip-types'] }));
        const roundTrip = () => Promise.all(ws.map((w) => new Promise((res) => w.once('message', res))));
        await roundTrip(); // ready
        const step = async () => { const p = roundTrip(); for (const w of ws) w.postMessage('step'); await p; };
        for (let i = 0; i < 100; i++) await step();
        for (let s = 0; s < STEPS; s++) { const t0 = performance.now(); await step(); times[s] = performance.now() - t0; }
        await Promise.all(ws.map((w) => w.terminate()));
      }
      const st = stats(times);
      if (times.cpu !== undefined) st.cpu = times.cpu;
      if (!best || st.mean < best.mean) best = st;
      if (st.cpu !== undefined) best.cpu = Math.min(best.cpu ?? 1e9, st.cpu);
      }
      report(n, kk, best);
    }
  }
  console.log(allOk ? 'BENCH PASS (p95 < 20 ms in every configuration)' : 'BENCH: some configurations exceed 20 ms (see lines above)');
}
