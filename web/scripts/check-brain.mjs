// 脳の動作確認（合否つき）: 暖機後の読み出し、可塑性による好みの変化、ドーパミン注入。 npm run check:brain
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCircuit } from '../src/brain/connectome/circuit.ts';
import { BrainBatch, PROBE_CHANNELS } from '../src/brain/connectome/batch.ts';
import { CHANNEL_INDEX, STIM_LEN, EncodeState, encodeSensors } from '../src/brain/connectome/encode.ts';
import { Sim } from '../src/sim/sim.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ab = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const meta = JSON.parse(readFileSync(path.join(root, 'web/public/circuit/meta.json'), 'utf8'));
const circ = parseCircuit(ab(path.join(root, 'web/public/circuit/circuit.bin')), meta);

const stim = (ch, v) => { const s = new Float32Array(STIM_LEN); s[2 * CHANNEL_INDEX[ch]] = v; s[2 * CHANNEL_INDEX[ch] + 1] = v; return s; };
const out = (b, a) => { const o = new Float32Array(b.outLen); b.writeOutput(a, o, 0); return o; };
const fmt = (a) => Array.from(a).map((x) => x.toFixed(3)).join(' ');
let ok = true;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!cond) ok = false; };

// 1. 暖機後の無刺激の命令（mu で z が 0 付近 -> forward は V0 付近）
function readChange(bb, a) {
  const o = new Float32Array(bb.outLen);
  bb.writeOutput(a, o, 0);
  return o.subarray(bb.layout.prefChange, bb.layout.prefChange + PROBE_CHANNELS.length);
}
const b = new BrainBatch(circ, 2, { seed: 5, probeEvery: 0 });
b.warmupAll(150, 25);
let o = out(b, 0);
for (let i = 0; i < 100; i++) b.stepAgents([0, 1]);
o = out(b, 0);
console.log('idle cmd [forward turn flap groom feed]:', fmt(o.subarray(0, 5)), ' z:', fmt(o.subarray(b.layout.z, b.layout.z + 13)));
check('idle forward near V0=0.5', Math.abs(o[0] - 0.5) < 0.3, `forward=${o[0].toFixed(3)}`);

// 2. 可塑性: fruit 匂いとご褒美(PAM)を 3 回対提示 -> fruit の好みが上がる、対照 vinegar は変わらない
b.captureBaseline();
const pre = Float32Array.from(b.probeNow(0));
const chgPre = Float32Array.from(readChange(b, 0));
check('prefChange is ~0 for all odors right after baseline', chgPre.every((x) => Math.abs(x) < 1e-6), fmt(chgPre));
for (let k = 0; k < 3; k++) {
  b.setStimulus(0, stim('fruit', 1)); // 匂い 4 s、後半 2 s にご褒美
  for (let i = 0; i < 100; i++) { if (i === 50) b.inject(0, 'reward', 3, 2000); b.stepAgents([0]); }
  b.setStimulus(0, new Float32Array(STIM_LEN));
  for (let i = 0; i < 100; i++) b.stepAgents([0]);
}
const post = Float32Array.from(b.probeNow(0));
const chgPost = Float32Array.from(readChange(b, 0));
const ctrl = Float32Array.from(b.probeNow(1)); // 学習していない体
const chgCtrl = Float32Array.from(readChange(b, 1));
console.log('prefChange post', fmt(chgPost), ' ctrl', fmt(chgCtrl));
check('prefChange moves for paired odor (fruit), control stays ~0', Math.abs(chgPost[PROBE_CHANNELS.indexOf('fruit')]) > 0.01 && chgCtrl.every((x) => Math.abs(x) < 0.01), `fruit ${chgPost[PROBE_CHANNELS.indexOf('fruit')].toFixed(3)}`);
console.log('probe channels:', PROBE_CHANNELS.join(' '));
console.log('pre  ', fmt(pre));
console.log('post ', fmt(post));
console.log('ctrl ', fmt(ctrl));
const iF = PROBE_CHANNELS.indexOf('fruit'), iV = PROBE_CHANNELS.indexOf('vinegar');
check('learning changes fruit preference vs control', Math.abs(post[iF] - ctrl[iF]) > 0.01, `fruit post=${post[iF].toFixed(3)} ctrl=${ctrl[iF].toFixed(3)} (delta ${(post[iF] - pre[iF]).toFixed(3)})`);
check('unpaired odor (vinegar) changes less', Math.abs(post[iV] - pre[iV]) < Math.abs(post[iF] - pre[iF]), `vinegar delta ${(post[iV] - pre[iV]).toFixed(3)}`);
const d = b.state(0).d;
let dmin = 0; for (const x of d) if (x < dmin) dmin = x;
check('d has moved (plasticity active) and stays >= -1', dmin < -1e-3 && dmin >= -1, `min d = ${dmin.toFixed(4)}`);

// 3. ドーパミン: reward で PAM 群の発火率が上がる。punish で PPL1 群
const b2 = new BrainBatch(circ, 1, { seed: 6, probeEvery: 0 });
b2.warmup(0, 100);
const da0 = out(b2, 0).subarray(b2.layout.da, b2.layout.da + 2);
const base = [da0[0], da0[1]];
b2.inject(0, 'reward', 3, 1000);
for (let i = 0; i < 50; i++) b2.stepAgent(0);
const da1 = out(b2, 0).subarray(b2.layout.da, b2.layout.da + 2);
check('reward raises PAM rate', da1[0] > base[0] + 0.05, `pam ${base[0].toFixed(3)} -> ${da1[0].toFixed(3)}`);
b2.inject(0, 'punish', 3, 1000);
for (let i = 0; i < 50; i++) b2.stepAgent(0);
const da2 = out(b2, 0).subarray(b2.layout.da, b2.layout.da + 2);
check('punish raises PPL1 rate', da2[1] > base[1] + 0.05, `ppl1 ${base[1].toFixed(3)} -> ${da2[1].toFixed(3)}`);

// 4. 刺激に対する命令: 左に強い匂い(vinegar) と looming
const b3 = new BrainBatch(circ, 1, { seed: 7, probeEvery: 0 });
b3.warmup(0, 150);
const base3 = Float32Array.from(out(b3, 0));
const sL = new Float32Array(STIM_LEN); sL[2 * CHANNEL_INDEX.lplc2] = 1; sL[2 * CHANNEL_INDEX.lplc2 + 1] = 1;
b3.setStimulus(0, sL);
for (let i = 0; i < 50; i++) b3.stepAgent(0);
const o3 = out(b3, 0);
console.log('looming cmd:', fmt(o3.subarray(0, 5)), ' idle:', fmt(base3.subarray(0, 5)));
// 5. 本物の Field（TownField）の中立な場所で、静止したハエ人の無刺激の旋回・身繕い（M2 では dry=1 と単眼の絶対値で偏りが出ていた）
{
  const sim = new Sim({ flyCount: 1, npcCount: 0, carCount: 0 });
  const f = sim.flies[0];
  // 場の合計が小さい地点を、歩道上の格子から選ぶ
  const cand = [];
  for (let x = -140; x <= 140; x += 20) for (let z = -140; z <= 140; z += 20) {
    const smp = sim.field.sample(x, 1.6, z, 0, 0);
    const tot = Object.values(smp.odor).reduce((a, b) => a + b, 0) + smp.warm + smp.cold + smp.dust + Math.abs(smp.humidity - 0.5) + smp.taste.sugar + smp.taste.bitter + smp.taste.water + smp.light;
    if (tot < 0.01 && !sim.world.isBlocked(x, z, 1)) cand.push([x, z]);
  }
  const spots = cand.filter((_, i) => i % Math.max(1, Math.floor(cand.length / 4)) === 0).slice(0, 4);
  const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  const turns = [], grooms = [], fwd = [];
  const bb = new BrainBatch(circ, 1, { seed: 11, probeEvery: 0 });
  bb.warmup(0, 150);
  for (const [x, z] of spots) for (const yaw of yaws) {
    f.x = f.px = x; f.z = f.pz = z; f.yaw = f.pyaw = yaw;
    const st = new EncodeState();
    const stim = new Float32Array(STIM_LEN);
    let sumT = 0, sumG = 0, sumF = 0, n = 0;
    for (let i = 0; i < 750; i++) { // 15 s、後半 5 s を平均
      sim.step();
      encodeSensors(f.sensors, stim, st);
      bb.setStimulus(0, stim);
      bb.stepAgent(0);
      if (i >= 500) { const o = out(bb, 0); sumT += o[1]; sumG += o[3]; sumF += o[0]; n++; }
    }
    turns.push(sumT / n); grooms.push(sumG / n); fwd.push(sumF / n);
  }
  const mean = (a) => a.reduce((p, q) => p + q, 0) / a.length;
  const maxAbs = (a) => Math.max(...a.map(Math.abs));
  console.log(`neutral spots ${spots.length} x yaws ${yaws.length}: turn mean=${mean(turns).toFixed(3)} max|turn|=${maxAbs(turns).toFixed(3)}  groom mean=${mean(grooms).toFixed(3)} max=${Math.max(...grooms).toFixed(3)}  forward mean=${mean(fwd).toFixed(3)}`);
  check('idle turn bias near 0 with real Field', maxAbs(turns) < 0.1, `max|turn|=${maxAbs(turns).toFixed(3)}`);
  check('idle groom near 0 with real Field', Math.max(...grooms) < 0.1, `max groom=${Math.max(...grooms).toFixed(3)}`);
}
console.log(ok ? 'CHECK PASS' : 'CHECK FAIL');
process.exit(ok ? 0 : 1);
