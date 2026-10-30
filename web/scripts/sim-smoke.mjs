// ヘッドレスでシミュレーションを回して数値を出す（Node 24 の型除去で .ts を直接読む）。
import { Sim } from '../src/sim/sim.ts';
import { ManualBrain } from '../src/brain/manualBrain.ts';

const sim = new Sim({});
const brain = new ManualBrain();
sim.attachBrain(0, brain);
let t0 = performance.now();
const log = [];
for (let i = 0; i < 50 * 120; i++) {
  const sec = i / 50;
  brain.setKeys(sec < 10 ? ['KeyW'] : sec < 14 ? ['KeyW', 'KeyA'] : sec < 17 ? ['KeyW', 'Space'] : sec < 30 ? ['KeyW', 'Space', 'KeyD'] : ['KeyS']);
  sim.step();
  if (i % 500 === 0) {
    const f = sim.flies[0];
    log.push(`t=${sec.toFixed(0)} fly0 x=${f.x.toFixed(1)} z=${f.z.toFixed(1)} y=${f.y.toFixed(2)} flap=${f.flapSeconds.toFixed(2)} lock=${f.flapLocked} loomL=${f.sensors?.left.loomingMax.toFixed(2)} obsF=${f.sensors?.obstacle.front.toFixed(2)} lightL=${f.sensors?.light.left.toFixed(2)}`);
  }
}
const ms = performance.now() - t0;
console.log(log.join('\n'));
const finite = sim.cars.every((c) => Number.isFinite(c.x + c.z)) && sim.npcs.every((n) => Number.isFinite(n.x + n.z));
console.log(`ticks=${sim.tick} wall=${ms.toFixed(0)}ms per_tick=${(ms / sim.tick).toFixed(3)}ms accidents=${sim.accidents} finite=${finite}`);
console.log('cars moving:', sim.cars.filter((c) => c.speed > 0.5).length, '/', sim.cars.length);
console.log('npc sample', sim.npcs.slice(0, 3).map((n) => `${n.x.toFixed(1)},${n.z.toFixed(1)}`).join(' | '));
// 事故テスト: 動いている車の 6 m 前にハエ人 1 を置く
const car = sim.cars.find((c) => c.speed > 3);
const f1 = sim.flies[1];
f1.x = car.x + Math.sin(car.yaw) * 6; f1.z = car.z + Math.cos(car.yaw) * 6; f1.invuln = 0;
let hitAt = -1;
for (let i = 0; i < 50 * 12; i++) { sim.step(); if (f1.down && hitAt < 0) hitAt = i / 50; }
console.log(`accident test: hit at ${hitAt.toFixed(2)}s accidents=${f1.accidents} downNow=${f1.down} y=${f1.y.toFixed(2)} (expect hit, recovered after ~5s)`);

// ---- M4: 場とオブジェクト ----
let ok = true;
const check = (name, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); if (!cond) ok = false; };
{
  const s2 = new Sim({ flyCount: 2, npcCount: 0, carCount: 0 });
  const tf = s2.town;
  const A = [-80, -60]; // 何も無い歩道
  const at = (dx, dz = 0) => tf.sample(A[0] + dx, 1.6, A[1] + dz, s2.time, 99);
  const run = (sec) => { for (let i = 0; i < sec * 50; i++) s2.step(); };
  const base = at(0);
  console.log('neutral sample', JSON.stringify(base));
  check('neutral spot: all zero, humidity 0.5', base.odor.fermentation + base.odor.sweet + base.warm + base.cold + base.dust < 1e-3 && base.humidity === 0.5, `vin=${base.odor.fermentation} warm=${base.warm} hum=${base.humidity}`);
  // 置く
  const ban = tf.addItem('banana', A[0], A[1], 0);
  tf.setWind(90, 0.6); // 東へ 0.6 m/s
  run(30);
  const e = [0, 3, 6, 12, 20].map((d) => at(d).odor.sweet);
  const w = [-3, -6].map((d) => at(d).odor.sweet);
  console.log('banana fruit odor downwind 0/3/6/12/20 m:', e.map((v) => v.toFixed(2)).join(' '), ' upwind 3/6 m:', w.map((v) => v.toFixed(2)).join(' '));
  check('banana plume: downwind > upwind, decays with distance', e[1] > w[0] * 1.5 && e[1] > e[2] && e[2] > e[3] && e[3] > e[4] && e[4] > 0.01, `down3=${e[1].toFixed(2)} up3=${w[0].toFixed(2)}`);
  const vin = at(3).odor.fermentation;
  check('banana also vinegar', vin > 0.02, `vin@3m=${vin.toFixed(2)}`);
  check('banana sugar contact within 0.6 m only', at(0.3).taste.sugar === 1 && at(1.5).taste.sugar === 0, `0.3m=${at(0.3).taste.sugar} 1.5m=${at(1.5).taste.sugar}`);
  // 風向を北へ
  tf.setWind(0, 0.6); // -z へ
  run(40);
  const north = tf.sample(A[0], 1.6, A[1] - 6, s2.time, 99).odor.sweet;
  const east = at(6).odor.sweet;
  check('wind turned north: plume moves to -z', north > east * 1.5, `north6=${north.toFixed(2)} east6=${east.toFixed(2)}`);
  // 消す
  tf.removeItem(ban.id);
  run(60);
  const gone = tf.sample(A[0], 1.6, A[1], s2.time, 99).odor.sweet;
  check('removed banana: plume decays', gone < 0.02, `fruit@source after 60 s = ${gone.toFixed(3)}`);
  // 熱・冷・湿
  const B = [-100, 120];
  const hItem = tf.addItem('heater', B[0], B[1], 0);
  const iItem = tf.addItem('ice', B[0] + 30, B[1], 0);
  const mItem = tf.addItem('humidifier', B[0] + 60, B[1], 0);
  const g = (x, z) => tf.sample(x, 1.6, z, s2.time, 99);
  console.log('heater warm 0/3/6 m:', [0, 3, 6].map((d) => g(B[0] + d, B[1]).warm.toFixed(2)).join(' '), ' ice cold 0/3/6:', [0, 3, 6].map((d) => g(B[0] + 30 + d, B[1]).cold.toFixed(2)).join(' '), ' humid 0/3/6:', [0, 3, 6].map((d) => g(B[0] + 60 + d, B[1]).humidity.toFixed(2)).join(' '));
  check('items placed (not null)', hItem && iItem && mItem, '');
  check('heater warm', g(B[0], B[1]).warm > 0.95 && g(B[0] + 3, B[1]).warm > 0.2 && g(B[0] + 6.1, B[1]).warm === 0, '');
  check('ice cold', g(B[0] + 30, B[1]).cold > 0.95 && g(B[0] + 33, B[1]).cold > 0.2, '');
  check('humidifier humid', g(B[0] + 60, B[1]).humidity > 0.95 && g(B[0] + 66.1, B[1]).humidity === 0.5, '');
  // 送風機: 東向き（rot = pi/2）
  const C = [-10, 120];
  const fan = tf.addItem('fan', C[0], C[1], Math.PI / 2);
  tf.setWind(0, 0);
  const wf = [2, 6, 10].map((d) => tf.sample(C[0] + d, 1.6, C[1], s2.time, 99).wind.x);
  const wb = tf.sample(C[0] - 4, 1.6, C[1], s2.time, 99).wind.x;
  console.log('fan wind.x ahead 2/6/10 m:', wf.map((v) => v.toFixed(2)).join(' '), ' behind 4 m:', wb.toFixed(2));
  check('fan blows ahead only', wf[0] > 2 && wf[1] > 0.5 && Math.abs(wb) < 1e-6, '');
  tf.removeItem(fan.id);
  check('fan removed: wind 0', tf.sample(C[0] + 2, 1.6, C[1], s2.time, 99).wind.x === 0, '');
  // コーン: 衝突を足す・消す
  const D = [-40, -120];
  const cone = tf.addItem('cone', D[0], D[1], 0);
  check('cone placed', cone !== null, '');
  const blocked = s2.world.isBlocked(D[0], D[1], 0.1);
  tf.removeItem(cone.id);
  check('cone blocks then not after removal', blocked && !s2.world.isBlocked(D[0], D[1], 0.1), `blocked=${blocked}`);
  // 味
  const fo = s2.world.layout.pois.find((p) => p.id === 'fountain');
  check('fountain water contact and humidity', g(fo.x + 5.3, fo.z).taste.water === 1 && g(fo.x + 7, fo.z).taste.water === 0 && g(fo.x, fo.z).humidity > 0.95, `water@5.3=${g(fo.x + 5.3, fo.z).taste.water} hum=${g(fo.x, fo.z).humidity}`);
  // 殺虫器: 触れると 4 s 気絶
  const f0 = s2.flies[0];
  const Z = [40, -120];
  const zp = tf.addItem('zapper', Z[0], Z[1], 0);
  f0.x = f0.px = Z[0] - 3; f0.z = f0.pz = Z[1]; f0.yaw = f0.pyaw = Math.PI / 2; f0.hazardGrace = 0;
  // 脳が無いので、物理だけ確認するため位置を動かして接触させる
  f0.x = Z[0] - 0.7; 
  s2.step();
  check('zapper touch -> zapped', f0.down && f0.stats.zaps === 1, `down=${f0.down} zaps=${f0.stats.zaps} downT=${f0.downT.toFixed(2)}`);
  let tDown = 0;
  while (f0.down && tDown < 10) { s2.step(); tDown += 0.02; }
  check('stun lasts about 4 s', tDown > 3.7 && tDown < 4.3, `stun=${tDown.toFixed(2)} s accidents=${f0.accidents}`);
  check('no re-zap in grace period', f0.stats.zaps === 1, `zaps=${f0.stats.zaps}`);
  tf.removeItem(zp.id);
  // ハエ取り紙: 6 s くっつく
  const f1 = s2.flies[1];
  const P = [70, -120];
  const pp = tf.addItem('paper', P[0], P[1], 0);
  f1.x = f1.px = P[0] + 0.3; f1.z = f1.pz = P[1]; f1.hazardGrace = 0;
  s2.step();
  check('fly paper: stuck', f1.stuckT > 5.9, `stuckT=${f1.stuckT.toFixed(2)} stuck=${f1.stats.stuck}`);
  let tStuck = 0;
  while (f1.stuckT > 0 && tStuck < 10) { s2.step(); tStuck += 0.02; }
  check('stuck lasts about 6 s', tStuck > 5.7 && tStuck < 6.3, `stuck=${tStuck.toFixed(2)} s`);
  tf.removeItem(pp.id);
  // 遠方の cVA
  console.log('fly positions', s2.flies.map((f) => `${f.x.toFixed(1)},${f.z.toFixed(1)}`).join(' | '));
  const c1 = tf.sample(s2.flies[0].x + 3, 1.6, s2.flies[0].z, s2.time, 1).odor.cva;
  const c0 = tf.sample(s2.flies[0].x + 3, 1.6, s2.flies[0].z, s2.time, 0).odor.cva;
  check('cVA excludes self', c1 > 0.1 && c0 < c1, `others=${c1.toFixed(2)} self-excluded-sample(id0)=${c0.toFixed(2)}`);
  // 性能: 場の更新時間
  const t1 = performance.now();
  for (let i = 0; i < 100; i++) tf.update([], s2.flies);
  console.log(`field update: ${((performance.now() - t1) / 100).toFixed(3)} ms per 0.1 s step (4 odor channels, ${tf.sources.length} sources)`);
}
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
