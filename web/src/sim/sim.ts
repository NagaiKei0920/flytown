/**
 * シミュレーション本体。固定 20 ms tick（50 Hz）。THREE には依存しない。
 */
import type { BrainAgent } from '../brain/types.ts';
import { ZERO_COMMAND, clampCommand } from '../brain/types.ts';
import { CAR_HALF_LEN, CAR_HALF_WID, CarSystem } from './cars.ts';
import { FLY, FlyPerson } from './flyperson.ts';
import { NpcSystem } from './npcs.ts';
import { computeSensors } from './sensing.ts';
import type { Field } from './sensors.ts';
import { TownField, UPDATE_DT } from './field.ts';
import { World, generateTown } from './world.ts';

export const TICK = 0.02;

export interface SimOptions {
  seed?: number;
  flyCount?: number;
  npcCount?: number;
  carCount?: number;
  field?: Field;
  /** ハエ人ごとの既定の脳を作る。null を返すと脳なし（指令 0）。 */
  brainFactory?: (flyId: number) => BrainAgent | null;
}

export const FLY_ACCENTS = [0xf28b82, 0x4fb3a9, 0xf2c14e, 0x9b8cd9, 0x6fa8dc, 0xe69ac4];

export class Sim {
  readonly world: World;
  readonly flies: FlyPerson[] = [];
  readonly carSys: CarSystem;
  readonly npcSys: NpcSystem;
  field: Field;
  /** 既定の場（TownField）。opts.field を渡したときは null。 */
  readonly town: TownField | null;
  private fieldAcc = 0;
  time = 0;
  tick = 0;
  /** 既定の置き物の位置（お題で殺虫器を戻すのに使う）。 */
  readonly homes: { zapper: { x: number; z: number } | null } = { zapper: null };
  /** 累計の事故件数（車に当たった回数）。 */
  get accidents(): number {
    return this.flies.reduce((a, f) => a + f.accidents, 0);
  }

  constructor(opts: SimOptions = {}) {
    const seed = opts.seed ?? 20261029;
    this.world = new World(generateTown(seed));
    this.town = opts.field ? null : new TownField(this.world);
    this.field = opts.field ?? this.town!;
    const nFly = opts.flyCount ?? 4;
    for (let i = 0; i < nFly; i++) {
      const sp = this.world.layout.flySpawns[i % this.world.layout.flySpawns.length];
      const fp = new FlyPerson(i, `ハエ人 ${i + 1}`, FLY_ACCENTS[i % FLY_ACCENTS.length], sp.x, sp.z, sp.yaw);
      fp.brain = opts.brainFactory?.(i) ?? null;
      this.flies.push(fp);
    }
    this.carSys = new CarSystem(opts.carCount ?? 15, seed);
    this.npcSys = new NpcSystem(opts.npcCount ?? 20, seed);
    if (this.town) {
      // 既定の置き物: コンビニ前の殺虫器と、果物屋前のハエ取り紙（どちらも消せる）。
      const L = this.world.layout;
      const cv = L.buildings.find((b) => b.shop === 'convenience');
      if (cv?.face) {
        const fx = cv.x + (cv.face.x * cv.w) / 2 + cv.face.x * 3.2 - cv.face.z * 6;
        const fz = cv.z + (cv.face.z * cv.d) / 2 + cv.face.z * 3.2 + cv.face.x * 6;
        this.town.addItem('zapper', fx, fz, 0);
        this.homes.zapper = { x: fx, z: fz };
      }
      const fr = L.buildings.find((b) => b.shop === 'fruit');
      if (fr?.face) {
        const fx = fr.x + (fr.face.x * fr.w) / 2 + fr.face.x * 3.4 + fr.face.z * 2;
        const fz = fr.z + (fr.face.z * fr.d) / 2 + fr.face.z * 3.4 - fr.face.x * 2;
        this.town.addItem('paper', fx, fz, 0);
      }
    }
  }

  get cars() { return this.carSys.cars; }
  get npcs() { return this.npcSys.npcs; }

  attachBrain(flyId: number, brain: BrainAgent | null): void {
    const f = this.flies[flyId];
    if (!f) return;
    f.brain?.dispose?.();
    f.brain = brain;
  }

  step(dt = TICK): void {
    this.tick++;
    this.time += dt;
    for (const f of this.flies) f.snapshot();
    this.carSys.update(dt, { npcs: this.npcs });
    this.npcSys.update(dt, this.cars);

    if (this.town) {
      this.fieldAcc += dt;
      while (this.fieldAcc >= UPDATE_DT - 1e-9) {
        this.fieldAcc -= UPDATE_DT;
        this.town.update(this.cars, this.flies);
      }
    }
    const ctx = { world: this.world, cars: this.cars, npcs: this.npcs, flies: this.flies, field: this.field, t: this.time, tick: this.tick, dt };
    for (const f of this.flies) {
      f.sensors = computeSensors(ctx, f);
      let cmd = { ...ZERO_COMMAND };
      if (!f.down && f.brain) cmd = clampCommand(f.brain.step(f.sensors, dt * 1000));
      f.step(dt, cmd, this.world);
    }
    this.collide();
    this.hazards();
    for (const f of this.flies) this.record(f, dt);
  }

  /** 環境の物理: ハエ取り紙（くっつく）と電撃殺虫器（気絶）。判断ではなく接触したときの結果だけ。 */
  private hazards(): void {
    if (!this.town) return;
    const hz = this.town.hazards();
    if (!hz.length) return;
    for (const f of this.flies) {
      if (f.down || f.hazardGrace > 0) continue;
      for (const h of hz) {
        const d = Math.hypot(f.x - h.x, f.z - h.z);
        if (h.zap && d < h.zap.r && f.y < 1.5) { f.zap(h.x, h.z, h.zap.sec); break; }
        if (h.sticky && d < h.sticky.r && f.y < 0.15) { f.stick(h.sticky.sec); break; }
      }
    }
  }

  /** 記録: 歩いた距離、食べた回数、羽ばたき回数。 */
  private record(f: FlyPerson, dt: number): void {
    const st = f.stats;
    if (!f.down) st.distance += Math.hypot(f.x - f.px, f.z - f.pz);
    const flapping = !f.down && f.cmd.flap > 0.15 && !f.flapLocked;
    if (flapping && !f.acc.flapping) st.flaps++;
    f.acc.flapping = flapping;
    const s = f.sensors;
    const touching = !!s && (s.field.left.taste.sugar + s.field.left.taste.bitter + s.field.left.taste.water +
      s.field.right.taste.sugar + s.field.right.taste.bitter + s.field.right.taste.water) > 0.2;
    const feeding = !f.down && f.cmd.feed > 0.5 && touching;
    if (feeding && !f.acc.feeding && f.acc.feedGap >= 1) st.meals++;
    f.acc.feedGap = feeding ? 0 : f.acc.feedGap + dt;
    f.acc.feeding = feeding;
  }

  private collide(): void {
    for (const f of this.flies) {
      // 車
      for (const c of this.cars) {
        const dx = f.x - c.x;
        const dz = f.z - c.z;
        if (dx * dx + dz * dz > 25) continue;
        const s = Math.sin(c.yaw);
        const co = Math.cos(c.yaw);
        const lf = dx * s + dz * co;
        const ll = dx * co - dz * s;
        const qf = Math.max(-CAR_HALF_LEN, Math.min(CAR_HALF_LEN, lf));
        const ql = Math.max(-CAR_HALF_WID, Math.min(CAR_HALF_WID, ll));
        const ddf = lf - qf;
        const ddl = ll - ql;
        const d2 = ddf * ddf + ddl * ddl;
        if (d2 >= FLY.radius * FLY.radius || f.y > 1.6) continue;
        if (!f.down && f.invuln <= 0 && c.speed > 1.0) {
          f.knockDown(c.vx, c.vz, c.speed);
          continue;
        }
        if (!f.down && c.speed <= 1.0) {
          // 止まっている車は壁として押し出す
          const d = Math.sqrt(d2) || 1e-6;
          const push = FLY.radius - d;
          const nf = d2 > 1e-10 ? ddf / d : 1;
          const nl = d2 > 1e-10 ? ddl / d : 0;
          f.x += (nf * s + nl * co) * push;
          f.z += (nf * co - nl * s) * push;
        }
      }
      // 人間 NPC
      if (!f.down) {
        for (const n of this.npcs) {
          const dx = f.x - n.x;
          const dz = f.z - n.z;
          const min = FLY.radius + 0.3;
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min) {
            const d = Math.sqrt(d2) || 1e-6;
            f.x = n.x + (dx / d) * min;
            f.z = n.z + (dz / d) * min;
          }
        }
      }
      // ハエ人どうし
      for (const o of this.flies) {
        if (o.id <= f.id) continue;
        const dx = o.x - f.x;
        const dz = o.z - f.z;
        const min = FLY.radius * 2;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 1e-6;
          const push = (min - d) / 2;
          f.x -= (dx / d) * push; f.z -= (dz / d) * push;
          o.x += (dx / d) * push; o.z += (dz / d) * push;
        }
      }
      const pos = { x: f.x, z: f.z };
      this.world.resolveCircle(pos, FLY.radius, f.y);
      f.x = pos.x; f.z = pos.z;
    }
  }
}
