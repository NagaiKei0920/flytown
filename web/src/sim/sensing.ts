/**
 * センサ計算。レイ 12 本 x 2 眼、障害物の多さ、明るさ、触角位置の場。
 * 計算して返すだけで、脳の判断には関与しない。
 */
import type { Car } from './cars.ts';
import { CAR_HALF_LEN, CAR_HALF_WID, CAR_HEIGHT } from './cars.ts';
import type { FlyPerson } from './flyperson.ts';
import { FLY } from './flyperson.ts';
import type { Npc } from './npcs.ts';
import type { EyeSensors, Field, RayHit, SensorFrame } from './sensors.ts';
import { HitKind, SENSOR_SPEC } from './sensors.ts';
import type { World } from './world.ts';
import { SUN_DIR, sunVisible } from './world.ts';

export interface SenseContext {
  world: World;
  cars: Car[];
  npcs: Npc[];
  flies: FlyPerson[];
  field: Field;
  t: number;
  tick: number;
  dt: number;
}

const DEG = Math.PI / 180;

/** 水平レイと回転した箱（車）の交差距離。 */
function rayObb(ox: number, oz: number, dx: number, dz: number, c: Car): number {
  const s = Math.sin(c.yaw);
  const co = Math.cos(c.yaw);
  // 車のローカル座標: 前方 f = (s, co)、右方向 r = (co, -s)（左は (co,-s) の逆…前方基準の横成分）
  const rx = ox - c.x;
  const rz = oz - c.z;
  const lf = rx * s + rz * co;
  const ll = rx * co - rz * s;
  const df = dx * s + dz * co;
  const dl = dx * co - dz * s;
  let tmin = -Infinity;
  let tmax = Infinity;
  const slab = (o: number, d: number, h: number): boolean => {
    if (Math.abs(d) < 1e-9) return Math.abs(o) <= h;
    let t1 = (-h - o) / d;
    let t2 = (h - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(lf, df, CAR_HALF_LEN)) return -1;
  if (!slab(ll, dl, CAR_HALF_WID)) return -1;
  return tmin;
}

function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const fx = ox - cx;
  const fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

export function computeSensors(ctx: SenseContext, fp: FlyPerson): SensorFrame {
  const { world, cars, npcs, flies, field } = ctx;
  const R = SENSOR_SPEC.maxRange;
  const lying = fp.down ? Math.min(1, Math.abs(Math.sin(fp.tumble))) : 0;
  const eyeY = fp.y + FLY.eyeHeight * (1 - 0.75 * lying);
  const fwdX = Math.sin(fp.yaw);
  const fwdZ = Math.cos(fp.yaw);
  const ex = fp.x + fwdX * 0.1;
  const ez = fp.z + fwdZ * 0.1;

  // 近い動体だけ拾う
  const nearCars = cars.filter((c) => Math.hypot(c.x - ex, c.z - ez) < R + 4);
  const nearNpcs = npcs.filter((n) => Math.hypot(n.x - ex, n.z - ez) < R + 1);
  const nearFlies = flies.filter((o) => o !== fp && Math.hypot(o.x - ex, o.z - ez) < R + 1);

  const makeEye = (sign: 1 | -1): EyeSensors => {
    const [a0, a1] = SENSOR_SPEC.leftEyeAzimuthDeg;
    const n = SENSOR_SPEC.raysPerEye;
    const rays: RayHit[] = [];
    let lmax = 0;
    let lsum = 0;
    let nearest = R;
    for (let i = 0; i < n; i++) {
      const az = (sign * (a0 + ((a1 - a0) * i) / (n - 1))) * DEG;
      const pitch = SENSOR_SPEC.pitchDeg[i % 2] * DEG;
      const slope = Math.tan(pitch);
      const ang = fp.yaw + az;
      const dx = Math.sin(ang);
      const dz = Math.cos(ang);
      let best = R;
      let kind: HitKind = HitKind.None;
      let tvx = 0;
      let tvz = 0;
      const hs = world.raycast(ex, ez, dx, dz, R, eyeY, slope);
      if (hs) { best = hs.t; kind = HitKind.Static; }
      for (const c of nearCars) {
        const t = rayObb(ex, ez, dx, dz, c);
        if (t < 0 || t >= best) continue;
        const y = eyeY + slope * t;
        if (y < 0 || y > CAR_HEIGHT) continue;
        best = t; kind = HitKind.Car; tvx = c.vx; tvz = c.vz;
      }
      for (const m of nearNpcs) {
        const t = rayCircle(ex, ez, dx, dz, m.x, m.z, 0.3);
        if (t < 0 || t >= best) continue;
        const y = eyeY + slope * t;
        if (y < 0 || y > 1.8) continue;
        best = t; kind = HitKind.Person; tvx = m.vx; tvz = m.vz;
      }
      for (const o of nearFlies) {
        const t = rayCircle(ex, ez, dx, dz, o.x, o.z, 0.3);
        if (t < 0 || t >= best) continue;
        const y = eyeY + slope * t;
        if (y < o.y || y > o.y + 1.8) continue;
        best = t; kind = HitKind.FlyPerson; tvx = o.vx; tvz = o.vz;
      }
      const approach = kind === HitKind.None ? 0 : (fp.vx - tvx) * dx + (fp.vz - tvz) * dz;
      const looming = kind === HitKind.None ? 0 : Math.max(0, approach) / Math.max(best, 0.5);
      rays.push({ azimuth: az, distance: best, approach, looming, kind });
      lmax = Math.max(lmax, looming);
      lsum += looming;
      nearest = Math.min(nearest, best);
    }
    return { rays, loomingMax: lmax, loomingSum: lsum, nearest };
  };

  const left = makeEye(1);
  const right = makeEye(-1);

  // 障害物の多さ（近いほど 1）
  const sector = (lo: number, hi: number): number => {
    let sum = 0;
    let cnt = 0;
    for (const eye of [left, right]) {
      for (const r of eye.rays) {
        const a = r.azimuth / DEG;
        if (a >= lo && a < hi) {
          sum += r.kind === HitKind.None ? 0 : Math.max(0, 1 - r.distance / 12);
          cnt++;
        }
      }
    }
    return cnt ? sum / cnt : 0;
  };
  const obstacle = { front: sector(-35, 35), left: sector(35, 125), right: sector(-125, -35) };

  // 明るさ
  const sunHL = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
  const sunX = SUN_DIR[0] / sunHL;
  const sunZ = SUN_DIR[2] / sunHL;
  const sunny = sunVisible(world, fp.x, eyeY, fp.z);
  const bright = (sign: 1 | -1): number => {
    const ang = fp.yaw + sign * 60 * DEG;
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const facingSun = 0.5 + 0.5 * (dx * sunX + dz * sunZ);
    let b = 0.35 + (sunny ? 0.65 * (0.6 + 0.4 * facingSun) : 0);
    for (const L of world.layout.lights) {
      const lx = L.x - fp.x;
      const lz = L.z - fp.z;
      const d = Math.hypot(lx, lz, L.y - eyeY);
      if (d > L.radius) continue;
      const k = 1 - d / L.radius;
      const cosv = (lx * dx + lz * dz) / Math.max(1e-6, Math.hypot(lx, lz));
      b += L.intensity * k * k * (0.5 + 0.5 * cosv);
    }
    return Math.min(2, b);
  };

  // 触角位置の場
  const antY = eyeY + 0.12;
  const lx0 = Math.cos(fp.yaw);
  const lz0 = -Math.sin(fp.yaw);
  const fl = field.sample(fp.x + fwdX * 0.14 + lx0 * 0.09, antY, fp.z + fwdZ * 0.14 + lz0 * 0.09, ctx.t, fp.id);
  const fr = field.sample(fp.x + fwdX * 0.14 - lx0 * 0.09, antY, fp.z + fwdZ * 0.14 - lz0 * 0.09, ctx.t, fp.id);

  const odorSum = (s: typeof fl) => s.odor.fermentation + s.odor.geosmin + s.odor.co2 + s.odor.sweet + s.odor.smoke + s.odor.cva;
  const ol = odorSum(fl);
  const or = odorSum(fr);
  fp.antennaStrength = Math.min(1, (ol + or) / 2);
  fp.antennaTilt = ol + or > 1e-4 ? (ol - or) / (ol + or) : 0;

  const fwdSpeed = fp.vx * fwdX + fp.vz * fwdZ;
  return {
    t: ctx.t,
    tick: ctx.tick,
    dt: ctx.dt,
    left,
    right,
    obstacle,
    light: { left: bright(1), right: bright(-1) },
    field: { left: fl, right: fr },
    self: {
      x: fp.x,
      z: fp.z,
      yaw: fp.yaw,
      speed: Math.hypot(fp.vx, fp.vz),
      forwardSpeed: fwdSpeed,
      turnRate: fp.turnRate,
      height: fp.y,
      grounded: fp.grounded,
      knockedDown: fp.down,
      flapSeconds: fp.flapSeconds,
      flapLocked: fp.flapLocked,
    },
  };
}
