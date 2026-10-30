// Python (pipeline/model.py) との一致試験。docs/PARITY.md。 npm run verify:parity
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCircuit } from '../src/brain/connectome/circuit.ts';
import { Net, BrainState, stepBrain, stepBrains } from '../src/brain/connectome/model.ts';
import { buildRecGroups, groupMeans } from '../src/brain/connectome/readout.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const meta = JSON.parse(readFileSync(path.join(root, 'web/public/circuit/meta.json'), 'utf8'));
const circ = parseCircuit(ab(path.join(root, 'web/public/circuit/circuit.bin')), meta);
const sched = JSON.parse(readFileSync(path.join(root, 'pipeline/out/parity_schedule.json'), 'utf8'));
const net = new Net(circ);
const st = new BrainState(net);
const I = new Float64Array(net.N);

const ratesBuf = ab(path.join(root, 'pipeline/out/parity_rates.bin'));
const rdv = new DataView(ratesBuf);
const steps = rdv.getUint32(4, true), nrec = rdv.getUint32(8, true);
const rates = new Float64Array(ratesBuf, 16, steps * nrec);
if (steps !== sched.steps || nrec !== sched.rec_names.length) throw new Error('rates.bin header mismatch');

const stBuf = ab(path.join(root, 'pipeline/out/parity_state.bin'));
const sdv = new DataView(stBuf);
const nStates = sdv.getUint32(4, true), N = sdv.getUint32(8, true), ne = sdv.getUint32(12, true);
if (N !== net.N || ne !== net.ne) throw new Error('state.bin size mismatch');
const snaps = new Map();
let off = 20;
for (let i = 0; i < nStates; i++) {
  const step = sdv.getUint32(off, true); off += 4;
  const r = new Float64Array(stBuf.slice(off, off + 8 * N)); off += 8 * N;
  const d = new Float64Array(stBuf.slice(off, off + 8 * ne)); off += 8 * ne;
  snaps.set(step, { r, d });
}

// rec_names -> 細胞（readout.ts と同じ定義）。meta.readout.rec_names と台本の rec_names が同じことも確認。
if (JSON.stringify(sched.rec_names) !== JSON.stringify(meta.readout.rec_names)) throw new Error('rec_names differ');
const groups = buildRecGroups(meta);
const amp = sched.amp;
const chan = meta.input.channels;
const ctIdx = (name) => {
  const ti = meta.neuron_type.types.indexOf(name);
  const out = [];
  for (let i = 0; i < meta.N; i++) if (meta.neuron_type.index[i] === ti) out.push(i);
  return out;
};
const items = sched.schedule.map((s) => {
  const it = { ...s };
  if (s.type === 'celltype') it.cells = ctIdx(s.name);
  return it;
});

const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) { const e = Math.abs(a[i] - b[i]); if (e > m) m = e; } return m; };

let maxRate = 0;
let maxRateStep = -1;
const means = new Float64Array(nrec);
const report = {};
const check = (step) => {
  const s = snaps.get(step);
  if (!s) return;
  report[step] = { r: maxAbs(st.r, s.r), d: maxAbs(st.d, s.d) };
};
check(0);
const t0 = performance.now();
for (let t = 0; t < steps; t++) {
  I.fill(0);
  for (const s of items) {
    if (t < s.start || t >= s.end) continue;
    if (s.type === 'channel') {
      const c = chan[s.name];
      for (const i of c.left) I[i] += amp * s.left;
      for (const i of c.right) I[i] += amp * s.right;
      for (const i of c.mid) I[i] += amp * 0.5 * (s.left + s.right);
    } else if (s.type === 'celltype') {
      for (const i of s.cells) I[i] += amp * s.value_amp;
    } else if (s.type === 'group') {
      for (const i of sched.pam_idx) I[i] += s.value;
    } else throw new Error(`unknown schedule type ${s.type}`);
  }
  stepBrain(net, st, I, true);
  groupMeans(groups, st.r, means);
  for (let k = 0; k < nrec; k++) {
    const e = Math.abs(means[k] - rates[t * nrec + k]);
    if (e > maxRate) { maxRate = e; maxRateStep = t; }
  }
  if (t + 1 === 100 || t + 1 === 300) check(t + 1);
}
const ms = performance.now() - t0;
const TOL = 1e-6;
let ok = maxRate <= TOL;
console.log(`rates   max abs err = ${maxRate.toExponential(3)} (step ${maxRateStep}, ${steps} steps x ${nrec} groups)`);
for (const k of Object.keys(report)) {
  console.log(`state@${k.padStart(3)} r max abs err = ${report[k].r.toExponential(3)}   d max abs err = ${report[k].d.toExponential(3)}`);
  if (report[k].r > TOL || report[k].d > TOL) ok = false;
}
console.log(`run time ${ms.toFixed(0)} ms (${(ms / steps).toFixed(2)} ms/step)`);
console.log(ok ? 'PARITY PASS (<= 1e-6)' : 'PARITY FAIL');

// 追加確認（合否には含めない専用の項目ではなく、同じ 1e-6 で判定）: 5 体まとめて（4 体ブロック + 1 体）進めても 1 体と同じか。
{
  const sts = Array.from({ length: 5 }, () => new BrainState(net));
  const Is = sts.map(() => new Float64Array(net.N));
  for (let t = 0; t < steps; t++) {
    for (let a = 0; a < 5; a++) {
      const Ia = Is[a];
      Ia.fill(0);
      for (const s of items) {
        if (t < s.start || t >= s.end || s.type !== 'channel') continue;
        const c = chan[s.name];
        for (const i of c.left) Ia[i] += amp * s.left;
        for (const i of c.right) Ia[i] += amp * s.right;
        for (const i of c.mid) Ia[i] += amp * 0.5 * (s.left + s.right);
      }
    }
    stepBrains(net, sts, Is, true);
  }
  // 体 0 と体 4 は同じ入力 -> 同じ状態。単体実行との比較は channel だけの台本なので、体 0 と体 4 の一致と 1 体実行との差を見る。
  const single = new BrainState(net);
  const I1 = new Float64Array(net.N);
  for (let t = 0; t < steps; t++) {
    I1.fill(0);
    for (const s of items) {
      if (t < s.start || t >= s.end || s.type !== 'channel') continue;
      const c = chan[s.name];
      for (const i of c.left) I1[i] += amp * s.left;
      for (const i of c.right) I1[i] += amp * s.right;
      for (const i of c.mid) I1[i] += amp * 0.5 * (s.left + s.right);
    }
    stepBrain(net, single, I1, true);
  }
  const e = Math.max(...sts.map((s) => Math.max(maxAbs(s.r, single.r), maxAbs(s.d, single.d))));
  console.log(`batched(5 agents: 4+1 blocks) vs single: max abs diff = ${e.toExponential(3)}`);
  if (e > TOL) ok = false;
}
console.log(ok ? 'ALL PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
