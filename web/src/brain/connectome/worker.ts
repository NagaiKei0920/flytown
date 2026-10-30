/**
 * 脳 Worker: 全ハエ人の脳を 50 Hz のシミュレーション時間で進める。描画とは独立。
 * 受け取った tick を 1 つずつ順に処理し、メッセージごとに最後の tick の出力を返す。
 */
import { BrainBatch } from './batch.ts';
import { loadCircuit } from './circuit.ts';
import { STIM_LEN } from './encode.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(m: FromWorker, transfer?: Transferable[]): void;
};

let batch: BrainBatch | null = null;
let n = 0;
let outLen = 0;
let ready: Promise<void> | null = null;
const all: number[] = [];
const idsBuf: number[] = [];

async function init(m: Extract<ToWorker, { t: 'init' }>): Promise<void> {
  const t0 = performance.now();
  const circuit = await loadCircuit(m.baseUrl);
  const t1 = performance.now();
  n = m.n;
  batch = new BrainBatch(circuit, n, { seed: m.seed, learn: true, noise: true });
  batch.warmupAll(150, 25); // 暖機 3 s（MODEL.md 6 章の mu / sd と同じ条件）+ 体ごとに 0.5 s
  batch.captureBaseline(); // 好みの基準（注射前）
  const t2 = performance.now();
  outLen = batch.outLen;
  for (let i = 0; i < n; i++) all.push(i);
  const meta = circuit.meta;
  ctx.postMessage({
    t: 'ready',
    layout: { ...batch.layout, outLen, recNames: meta.readout.rec_names, panelNames: meta.panel.names, probeChannels: [...batch.probeChannelNames] },
    loadMs: t1 - t0,
    warmMs: t2 - t1,
  });
}

function runTicks(m: Extract<ToWorker, { t: 'ticks' }>): void {
  const b = batch;
  if (!b) return;
  const t0 = performance.now();
  const nt = m.ticks.length;
  for (let k = 0; k < nt; k++) {
    idsBuf.length = 0;
    for (let a = 0; a < n; a++) {
      if (m.active[k * n + a]) {
        b.setStimulus(a, m.stim.subarray((k * n + a) * STIM_LEN, (k * n + a + 1) * STIM_LEN));
        idsBuf.push(a);
      }
    }
    if (idsBuf.length) b.stepAgents(idsBuf);
    // 好みの探りは優先度が低い。遅れているとき（1 メッセージに 3 tick 以上たまっているとき）は止めて追いつく。
    if (nt <= 2) b.probeWork();
  }
  const out = new Float32Array(n * outLen);
  for (let a = 0; a < n; a++) b.writeOutput(a, out, a * outLen);
  ctx.postMessage({ t: 'result', lastTick: m.ticks[nt - 1], ticksDone: nt, out, procMs: performance.now() - t0 }, [out.buffer]);
}

ctx.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.t === 'init') {
      ready = init(m).catch((err) => ctx.postMessage({ t: 'error', message: String(err?.stack ?? err) }));
    } else if (m.t === 'ticks') {
      void ready?.then(() => runTicks(m));
    } else if (m.t === 'inject') {
      batch?.inject(m.agent, m.kind, m.dose, m.durationMs);
    } else if (m.t === 'reset') {
      batch?.reset(m.agent);
    }
  } catch (err) {
    ctx.postMessage({ t: 'error', message: String((err as Error)?.stack ?? err) });
  }
};
