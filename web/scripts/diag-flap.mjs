// 羽ばたきの原因調査（ヘッドレス）。4 体 + NPC 20 + 車 15 の街を実際の脳で走らせ、チャネル別・物体別に集計する。
//   node scripts/diag-flap.mjs [--seeds 6] [--sec 60]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCircuit } from '../src/brain/connectome/circuit.ts';
import { BrainBatch } from '../src/brain/connectome/batch.ts';
import { CHANNEL_INDEX, STIM_LEN, EncodeState, encodeSensors } from '../src/brain/connectome/encode.ts';
import { Sim } from '../src/sim/sim.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const meta = JSON.parse(readFileSync(path.join(root, 'web/public/circuit/meta.json'), 'utf8'));
const circ = parseCircuit(ab(path.join(root, 'web/public/circuit/circuit.bin')), meta);
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const nSeeds = Number(arg('--seeds', 6));
const SEC = Number(arg('--sec', 60));
const WARM = 5;
const ZERO = (arg('--zero', '') || '').split(',').filter(Boolean);

class SyncBrain {
  constructor(seed) {
    this.id = 'sync'; this.label = 'sync';
    this.batch = new BrainBatch(circ, 1, { seed, probeEvery: 0 });
    this.batch.warmup(0, 150);
    this.stim = new Float32Array(STIM_LEN);
    this.es = new EncodeState();
    this.out = new Float32Array(this.batch.outLen);
    this.cmd = { forward: 0, turn: 0, flap: 0, groom: 0, feed: 0 };
  }
  step(s) {
    encodeSensors(s, this.stim, this.es);
    for (const z of ZERO) { this.stim[2 * CHANNEL_INDEX[z]] = 0; this.stim[2 * CHANNEL_INDEX[z] + 1] = 0; }
    this.batch.setStimulus(0, this.stim);
    this.batch.stepAgent(0);
    this.batch.writeOutput(0, this.out, 0);
    const o = this.out, c = this.cmd;
    c.forward = o[0]; c.turn = o[1]; c.flap = o[2]; c.groom = o[3]; c.feed = o[4];
    return c;
  }
  reset() {}
}
const KINDS = ['none', 'static', 'car', 'person', 'fly'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

const agg = { ticks: 0, flap05: 0, flapSum: 0, flapN: 0, nearCarTicks: 0, flap05far: 0, farTicks: 0, flapFarSum: 0, lp2: 0, lc4: 0, lp1: 0, lc16: 0,
  domKind: [0, 0, 0, 0, 0], domKindFlap: [0, 0, 0, 0, 0], loomHist: {}, speed: 0 };
for (let seed = 0; seed < nSeeds; seed++) {
  const sim = new Sim({ seed: 20261029 + seed, flyCount: 4, npcCount: 20, carCount: 15 });
  sim.flies.forEach((f, i) => sim.attachBrain(i, new SyncBrain(100 * seed + i + 1)));
  for (let i = 0; i < (WARM + SEC) * 50; i++) {
    sim.step();
    if (i < WARM * 50) continue;
    for (const f of sim.flies) {
      if (f.down || !f.sensors) continue;
      const s = f.sensors;
      const flap = f.cmd.flap;
      let nearCar = Infinity;
      for (const c of sim.cars) nearCar = Math.min(nearCar, Math.hypot(c.x - f.x, c.z - f.z));
      agg.ticks++;
      agg.flapSum += flap;
      if (flap > 0.5) agg.flap05++;
      if (nearCar > 35) {
        agg.farTicks++; agg.flapFarSum += flap; if (flap > 0.5) agg.flap05far++;
        // 支配レイの種類
        let best = null;
        for (const eye of [s.left, s.right]) for (const r of eye.rays) if (!best || r.looming > best.looming) best = r;
        if (best && best.looming > 0.05) { agg.domKind[best.kind]++; if (flap > 0.5) agg.domKindFlap[best.kind]++; }
      }
      const st = (f.brain).stim;
      agg.lp2 += (st[2 * CHANNEL_INDEX.lplc2] + st[2 * CHANNEL_INDEX.lplc2 + 1]) / 2;
      agg.lc4 += (st[2 * CHANNEL_INDEX.lc4] + st[2 * CHANNEL_INDEX.lc4 + 1]) / 2;
      agg.lp1 += (st[2 * CHANNEL_INDEX.lplc1] + st[2 * CHANNEL_INDEX.lplc1 + 1]) / 2;
      agg.lc16 += (st[2 * CHANNEL_INDEX.lc16] + st[2 * CHANNEL_INDEX.lc16 + 1]) / 2;
      agg.speed += Math.hypot(f.vx, f.vz);
    }
  }
  console.error(`seed ${seed} done`);
}
const n = agg.ticks;
console.log(JSON.stringify({ ticks: n, flapMean: agg.flapSum / n, flapGt05: agg.flap05 / n, farTicks: agg.farTicks, flapFarMean: agg.flapFarSum / agg.farTicks, flapGt05Far: agg.flap05far / agg.farTicks,
  meanStim: { lplc2: agg.lp2 / n, lc4: agg.lc4 / n, lplc1: agg.lp1 / n, lc16: agg.lc16 / n }, speed: agg.speed / n,
  dominantKind_far: Object.fromEntries(KINDS.map((k, i) => [k, agg.domKind[i]])), dominantKindFlap_far: Object.fromEntries(KINDS.map((k, i) => [k, agg.domKindFlap[i]])) }, null, 1));
