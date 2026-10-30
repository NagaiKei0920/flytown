/**
 * 車（台本で動かしてよい）。格子状の道路を左側通行で走り、交差点では 1 台ずつ通過し、
 * ときどき一時停止する。前の車と歩行者の横断には止まる。ハエ人には止まらない（事故は物理）。
 */
import { Rng } from './rng.ts';
import { CARRIAGE_HALF, LANE_OFF, N_ROADS, ROAD_C } from './world.ts';

const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const STOP_DIST = 7.5;
export const CAR_HALF_LEN = 2.1;
export const CAR_HALF_WID = 0.92;
export const CAR_HEIGHT = 1.5;

const left = (d: readonly [number, number]): [number, number] => [d[1], -d[0]];
const right = (d: readonly [number, number]): [number, number] => [-d[1], d[0]];

interface Pt {
  x: number;
  z: number;
}

export const CAR_COLORS = [0xf2a9a2, 0xf6d28f, 0xa9d6c2, 0x9ec5e8, 0xc9b8e8, 0xf4f1ea, 0xe8b4c8, 0x8fa8c8];

export class Car {
  id: number;
  x = 0;
  z = 0;
  yaw = 0;
  px = 0;
  pz = 0;
  pyaw = 0;
  speed = 0;
  vx = 0;
  vz = 0;
  color: number;
  vmax: number;
  mode: 'road' | 'wait' | 'cross' = 'road';
  dir = 0;
  ni = 0;
  nj = 0;
  pts: Pt[] = [];
  cum: number[] = [];
  s = 0;
  reserved = false;
  willStop = false;
  stopDone = false;
  stopT = 0;
  stuckT = 0;
  turning = false;

  constructor(id: number, color: number, vmax: number) {
    this.id = id;
    this.color = color;
    this.vmax = vmax;
  }

  setPath(pts: Pt[]): void {
    this.pts = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    this.s = 0;
  }
  get total(): number {
    return this.cum[this.cum.length - 1];
  }
  place(): void {
    const s = Math.min(this.s, this.total);
    let k = 1;
    while (k < this.cum.length - 1 && this.cum[k] < s) k++;
    const a = this.pts[k - 1];
    const b = this.pts[k];
    const seg = this.cum[k] - this.cum[k - 1];
    const u = seg > 1e-6 ? (s - this.cum[k - 1]) / seg : 0;
    this.x = a.x + (b.x - a.x) * u;
    this.z = a.z + (b.z - a.z) * u;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    if (Math.hypot(dx, dz) > 1e-6) this.yaw = Math.atan2(dx, dz);
  }
}

export interface CarContext {
  npcs: { x: number; z: number; crossing: boolean }[];
}

export class CarSystem {
  cars: Car[] = [];
  private occ: number[][] = [];
  private rng: Rng;

  constructor(count: number, seed: number) {
    this.rng = new Rng(seed ^ 0xca75);
    for (let i = 0; i < N_ROADS; i++) this.occ.push(new Array(N_ROADS).fill(-1));
    let guard = 0;
    while (this.cars.length < count && guard++ < 2000) {
      const car = new Car(this.cars.length, this.rng.pick(CAR_COLORS), this.rng.range(8, 11.5));
      if (!this.spawn(car)) continue;
      if (this.cars.some((o) => Math.hypot(o.x - car.x, o.z - car.z) < 9)) continue;
      this.cars.push(car);
    }
    for (const c of this.cars) {
      c.px = c.x; c.pz = c.z; c.pyaw = c.yaw;
    }
  }

  private spawn(car: Car): boolean {
    const i = this.rng.int(0, N_ROADS - 1);
    const j = this.rng.int(0, N_ROADS - 1);
    const dir = this.rng.int(0, 3);
    const d = DIRS[dir];
    const i2 = i + d[0];
    const j2 = j + d[1];
    if (i2 < 0 || i2 >= N_ROADS || j2 < 0 || j2 >= N_ROADS) return false;
    car.dir = dir;
    car.ni = i2;
    car.nj = j2;
    this.roadPath(car, i, j);
    car.s = this.rng.range(0, car.total - 4);
    car.speed = this.rng.range(3, 8);
    car.mode = 'road';
    car.willStop = this.rng.chance(0.3);
    car.place();
    return true;
  }

  /** ノード (i,j) の出口から次ノードの入口までの直線。 */
  private roadPath(car: Car, i: number, j: number): void {
    const d = DIRS[car.dir];
    const l = left(d);
    const ax = ROAD_C[i];
    const az = ROAD_C[j];
    const bx = ROAD_C[car.ni];
    const bz = ROAD_C[car.nj];
    car.setPath([
      { x: ax + d[0] * STOP_DIST + l[0] * LANE_OFF, z: az + d[1] * STOP_DIST + l[1] * LANE_OFF },
      { x: bx - d[0] * STOP_DIST + l[0] * LANE_OFF, z: bz - d[1] * STOP_DIST + l[1] * LANE_OFF },
    ]);
  }

  private beginCross(car: Car): void {
    const d = DIRS[car.dir];
    const opts: { dir: number; w: number }[] = [];
    const exists = (dir: number) => {
      const i2 = car.ni + DIRS[dir][0];
      const j2 = car.nj + DIRS[dir][1];
      return i2 >= 0 && i2 < N_ROADS && j2 >= 0 && j2 < N_ROADS;
    };
    const leftDir = (car.dir + 3) % 4;
    const rightDir = (car.dir + 1) % 4;
    // DIRS の並びは +z, +x, -z, -x。left(d) は (dz,-dx) なので、+z の左は +x(=index 1)。
    const dirOf = (v: readonly [number, number]) => DIRS.findIndex((q) => q[0] === v[0] && q[1] === v[1]);
    const ld = dirOf(left(d));
    const rd = dirOf(right(d));
    void leftDir; void rightDir;
    if (exists(car.dir)) opts.push({ dir: car.dir, w: 0.6 });
    if (exists(ld)) opts.push({ dir: ld, w: 0.2 });
    if (exists(rd)) opts.push({ dir: rd, w: 0.2 });
    let sum = 0;
    for (const o of opts) sum += o.w;
    let r = this.rng.next() * sum;
    let pick = opts[0].dir;
    for (const o of opts) {
      r -= o.w;
      if (r <= 0) { pick = o.dir; break; }
    }
    const d2 = DIRS[pick];
    const nx = ROAD_C[car.ni];
    const nz = ROAD_C[car.nj];
    const l1 = left(d);
    const l2 = left(d2);
    const E = { x: nx - d[0] * STOP_DIST + l1[0] * LANE_OFF, z: nz - d[1] * STOP_DIST + l1[1] * LANE_OFF };
    const X = { x: nx + d2[0] * STOP_DIST + l2[0] * LANE_OFF, z: nz + d2[1] * STOP_DIST + l2[1] * LANE_OFF };
    const pts: Pt[] = [];
    if (pick === car.dir) {
      pts.push(E, X);
      car.turning = false;
    } else {
      const C = { x: nx + l1[0] * LANE_OFF + l2[0] * LANE_OFF, z: nz + l1[1] * LANE_OFF + l2[1] * LANE_OFF };
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const c = t * t;
        pts.push({ x: a * E.x + b * C.x + c * X.x, z: a * E.z + b * C.z + c * X.z });
      }
      car.turning = true;
    }
    car.setPath(pts);
    car.mode = 'cross';
    car.dir = pick;
  }

  update(dt: number, ctx: CarContext): void {
    for (const car of this.cars) {
      car.px = car.x; car.pz = car.z; car.pyaw = car.yaw;
      this.updateCar(car, dt, ctx);
    }
  }

  private updateCar(car: Car, dt: number, ctx: CarContext): void {
    let vLimit = car.mode === 'cross' ? (car.turning ? 4.5 : 8) : car.vmax;
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);

    // 前の車
    if (car.stuckT < 8) {
      for (const o of this.cars) {
        if (o === car) continue;
        const dx = o.x - car.x;
        const dz = o.z - car.z;
        const ahead = dx * fx + dz * fz;
        if (ahead <= 0 || ahead > 16) continue;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 1.7) continue;
        const gap = ahead - 2 * CAR_HALF_LEN - 1.2;
        vLimit = Math.min(vLimit, Math.sqrt(2 * 5 * Math.max(gap, 0)) + (gap > 0 ? 0 : 0));
      }
    }
    // 横断中の歩行者
    for (const n of ctx.npcs) {
      if (!n.crossing) continue;
      const dx = n.x - car.x;
      const dz = n.z - car.z;
      const ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 12) continue;
      if (Math.abs(dx * fz - dz * fx) > 2.6) continue;
      vLimit = Math.min(vLimit, Math.sqrt(2 * 5 * Math.max(ahead - CAR_HALF_LEN - 1.5, 0)));
    }

    if (car.mode === 'road' || car.mode === 'wait') {
      const dist = car.total - car.s;
      if (!car.reserved && dist < 14 && this.occ[car.ni][car.nj] < 0) {
        this.occ[car.ni][car.nj] = car.id;
        car.reserved = true;
      }
      const mustStop = !car.reserved || (car.willStop && !car.stopDone);
      if (mustStop || car.mode === 'wait') {
        vLimit = Math.min(vLimit, Math.sqrt(2 * 4 * Math.max(dist - 0.2, 0)));
      }
      if (car.mode === 'wait') {
        vLimit = 0;
        car.stopT -= dt;
        if (car.stopT <= 0) {
          car.stopDone = true;
          car.mode = 'road';
        }
      } else if (dist <= 0.35) {
        if (car.reserved && car.willStop && !car.stopDone) {
          if (car.speed < 0.6) {
            car.mode = 'wait';
            car.stopT = this.rng.range(1.2, 3.5);
          }
        } else if (car.reserved) {
          this.beginCross(car);
        }
      }
    }

    const dv = vLimit - car.speed;
    car.speed += Math.max(-9 * dt, Math.min(3.5 * dt, dv));
    if (car.speed < 0) car.speed = 0;
    car.stuckT = car.speed < 0.2 ? car.stuckT + dt : 0;
    car.s += car.speed * dt;

    if (car.mode === 'cross' && car.s >= car.total) {
      this.occ[car.ni][car.nj] = -1;
      car.reserved = false;
      const ci = car.ni;
      const cj = car.nj;
      const d = DIRS[car.dir];
      car.ni = ci + d[0];
      car.nj = cj + d[1];
      this.roadPath(car, ci, cj);
      car.mode = 'road';
      car.willStop = this.rng.chance(0.3);
      car.stopDone = false;
      car.turning = false;
    }
    if ((car.mode === 'road') && car.s > car.total) car.s = car.total;
    car.place();
    car.vx = Math.sin(car.yaw) * car.speed;
    car.vz = Math.cos(car.yaw) * car.speed;
  }
}

export { CARRIAGE_HALF };
