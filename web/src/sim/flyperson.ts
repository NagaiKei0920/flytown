/**
 * ハエ人の物理（運動学）。BodyCommand を受けて動くだけで、判断はしない。
 * 壁や小物は通り抜けない。車に当たると派手に倒れて 5 秒後に起き上がる（事故として数える）。
 */
import type { BodyCommand, BrainAgent } from '../brain/types.ts';
import { ZERO_COMMAND } from '../brain/types.ts';
import type { SensorFrame } from './sensors.ts';
import type { World } from './world.ts';

export const FLY = {
  radius: 0.28,
  walkMax: 1.7,
  backMax: 0.9,
  airMax: 3.0,
  turnRate: 2.4,
  turnRateAir: 1.8,
  flapMax: 3.0,
  liftMin: 0.12,
  liftMax: 0.4,
  downSeconds: 5,
  getUpSeconds: 0.9,
  eyeHeight: 1.55,
};

export class FlyPerson {
  id: number;
  name: string;
  accent: number;
  x: number;
  z: number;
  y = 0;
  yaw: number;
  px: number;
  pz: number;
  py = 0;
  pyaw: number;
  vx = 0;
  vz = 0;
  vy = 0;
  /** 前向き速度（指令側、m/s）。歩容の速度に使う。 */
  vf = 0;
  turnRate = 0;
  /** 実際に動いた水平速さ（m/s、なめらかにしたもの）。 */
  actualSpeed = 0;
  brain: BrainAgent | null = null;
  cmd: BodyCommand = { ...ZERO_COMMAND };
  sensors: SensorFrame | null = null;
  flapSeconds = 0;
  flapLocked = false;
  /** 触角の傾き -1..1（左が正）と強さ 0..1。見た目のみ。 */
  antennaTilt = 0;
  antennaStrength = 0;
  // 倒れ
  down = false;
  downT = 0;
  tumble = 0;
  tumbleV = 0;
  slide = false;
  invuln = 0;
  accidents = 0;
  blocked = false;
  /** ハエ取り紙にくっついている残り秒数（物理）。 */
  stuckT = 0;
  /** 危険物（紙・殺虫器）に再び反応しない猶予の残り秒数。 */
  hazardGrace = 0;
  /** 記録。 */
  stats = { distance: 0, meals: 0, zaps: 0, flaps: 0, stuck: 0 };
  /** 記録の集計用の内部状態。 */
  acc = { flapping: false, feedGap: 99, feeding: false };
  private lieAngle = 0;
  private lieSet = false;

  constructor(id: number, name: string, accent: number, x: number, z: number, yaw: number) {
    this.id = id;
    this.name = name;
    this.accent = accent;
    this.x = this.px = x;
    this.z = this.pz = z;
    this.yaw = this.pyaw = yaw;
  }

  get grounded(): boolean {
    return this.y < 0.03;
  }
  /** 立ち上がり途中の進行 0..1（0 で倒れたまま、1 で完了）。 */
  get getUpProgress(): number {
    if (!this.down) return 1;
    return Math.max(0, Math.min(1, 1 - this.downT / FLY.getUpSeconds));
  }

  snapshot(): void {
    this.px = this.x; this.pz = this.z; this.py = this.y; this.pyaw = this.yaw;
  }

  knockDown(dirX: number, dirZ: number, power: number): void {
    this.down = true;
    this.downT = FLY.downSeconds;
    this.accidents++;
    const l = Math.hypot(dirX, dirZ) || 1;
    const v = Math.max(5, power * 0.9);
    this.vx = (dirX / l) * v;
    this.vz = (dirZ / l) * v;
    this.vy = 5.5;
    this.y = Math.max(this.y, 0.05);
    this.tumbleV = (dirX * Math.cos(this.yaw) - dirZ * Math.sin(this.yaw) >= 0 ? 1 : -1) * 11;
    this.slide = false;
    this.lieSet = false;
    this.vf = 0;
    this.turnRate = 0;
    this.flapSeconds = 0;
    this.flapLocked = false;
  }

  /** 電撃殺虫器に触れた。コミカルに跳ねて sec 秒気絶する（物理。事故数には数えず zaps に数える）。 */
  zap(fromX: number, fromZ: number, sec: number): void {
    this.down = true;
    this.downT = sec;
    this.stats.zaps++;
    const dx = this.x - fromX;
    const dz = this.z - fromZ;
    const l = Math.hypot(dx, dz) || 1;
    this.vx = (dx / l) * 1.6;
    this.vz = (dz / l) * 1.6;
    this.vy = 3.2;
    this.y = Math.max(this.y, 0.05);
    this.tumbleV = 9;
    this.slide = false;
    this.lieSet = false;
    this.vf = 0;
    this.turnRate = 0;
    this.flapSeconds = 0;
    this.flapLocked = false;
    this.stuckT = 0;
    this.hazardGrace = sec + 2;
  }

  /** 位置と向きを置き直し、倒れ・くっつき・羽ばたきの状態を戻す（お題の開始用）。 */
  teleport(x: number, z: number, yaw: number): void {
    this.x = this.px = x;
    this.z = this.pz = z;
    this.yaw = this.pyaw = yaw;
    this.y = this.py = 0;
    this.vx = this.vz = this.vy = this.vf = 0;
    this.turnRate = 0;
    this.down = false;
    this.downT = 0;
    this.tumble = this.tumbleV = 0;
    this.slide = false;
    this.lieSet = false;
    this.stuckT = 0;
    this.hazardGrace = 0;
    this.invuln = 2;
    this.flapSeconds = 0;
    this.flapLocked = false;
    this.actualSpeed = 0;
  }

  /** ハエ取り紙にくっつく（物理）。 */
  stick(sec: number): void {
    this.stuckT = sec;
    this.hazardGrace = sec + 3;
    this.stats.stuck++;
  }

  /** 1 tick 分の物理。cmd は clamp 済み。 */
  step(dt: number, cmd: BodyCommand, world: World): void {
    if (this.hazardGrace > 0) this.hazardGrace -= dt;
    if (this.stuckT > 0 && !this.down) {
      this.stuckT -= dt;
      cmd = { ...cmd, forward: 0, turn: 0, flap: 0 };
      this.vf = 0;
      this.turnRate = 0;
    }
    const ox = this.x;
    const oz = this.z;
    if (this.down) {
      this.stepDown(dt, world);
    } else {
      this.cmd = cmd;
      if (this.invuln > 0) this.invuln -= dt;
      this.stepControlled(dt, cmd, world);
    }
    const sp = Math.hypot(this.x - ox, this.z - oz) / dt;
    this.actualSpeed += (sp - this.actualSpeed) * (1 - Math.exp(-dt / 0.1));
    if (!this.down) {
      // 衝突で実速度が落ちていれば、速度ベクトルも実際の動きに合わせる
      this.vx = (this.x - ox) / dt;
      this.vz = (this.z - oz) / dt;
    }
  }

  private stepControlled(dt: number, cmd: BodyCommand, world: World): void {
    // 羽ばたき（連続 3 秒まで）
    const wantFlap = !this.flapLocked && cmd.flap > 0.15;
    if (wantFlap) {
      this.flapSeconds += dt;
      if (this.flapSeconds >= FLY.flapMax) {
        this.flapLocked = true;
        this.flapSeconds = FLY.flapMax;
      }
    }
    if (this.grounded && !wantFlap) {
      if (cmd.flap < 0.15) {
        this.flapLocked = false;
        this.flapSeconds = 0;
      }
    }
    const flapEff = wantFlap && !this.flapLocked ? cmd.flap : 0;
    if (flapEff > 0) {
      const target = FLY.liftMin + (FLY.liftMax - FLY.liftMin) * flapEff;
      this.vy += ((target - this.y) * 40 - this.vy * 9) * dt;
    } else {
      this.vy -= 6 * dt;
      if (this.vy < -1.2) this.vy = -1.2;
    }
    this.y += this.vy * dt;
    if (this.y > FLY.liftMax) {
      this.y = FLY.liftMax;
      if (this.vy > 0) this.vy = 0;
    }
    if (this.y <= 0) {
      this.y = 0;
      if (this.vy < 0) this.vy = 0;
    }
    const air = this.y > 0.03;

    // 前進と旋回
    const vmax = cmd.forward >= 0 ? (air ? FLY.airMax : FLY.walkMax) : FLY.backMax;
    const target = cmd.forward * vmax;
    const tau = air ? 0.45 : 0.12;
    this.vf += (target - this.vf) * (1 - Math.exp(-dt / tau));
    const turnT = cmd.turn * (air ? FLY.turnRateAir : FLY.turnRate);
    this.turnRate += (turnT - this.turnRate) * (1 - Math.exp(-dt / 0.08));
    this.yaw += this.turnRate * dt;
    this.x += Math.sin(this.yaw) * this.vf * dt;
    this.z += Math.cos(this.yaw) * this.vf * dt;
    const pos = { x: this.x, z: this.z };
    this.blocked = world.resolveCircle(pos, FLY.radius, this.y);
    this.x = pos.x;
    this.z = pos.z;
  }

  private stepDown(dt: number, world: World): void {
    this.downT -= dt;
    const airborne = this.y > 0 || this.vy > 0;
    if (!this.slide && airborne) {
      this.vy -= 14 * dt;
      this.y += this.vy * dt;
      this.tumble += this.tumbleV * dt;
      if (this.y <= 0) {
        this.y = 0;
        if (this.vy < -2.5) {
          this.vy *= -0.3;
          this.vx *= 0.6;
          this.vz *= 0.6;
        } else {
          this.vy = 0;
          this.slide = true;
        }
      }
    } else {
      this.slide = true;
      this.y = 0;
      const k = Math.exp(-3.2 * dt);
      this.vx *= k;
      this.vz *= k;
      // 寝姿勢（仰向けまたはうつ伏せ）へ収束し、起き上がりで 0 に戻る
      if (!this.lieSet) {
        this.lieAngle = Math.PI / 2 + Math.PI * Math.round((this.tumble - Math.PI / 2) / Math.PI);
        this.lieSet = true;
      }
      if (this.downT > FLY.getUpSeconds) {
        this.tumble += (this.lieAngle - this.tumble) * (1 - Math.exp(-12 * dt));
      } else {
        const up = 2 * Math.PI * Math.round(this.lieAngle / (2 * Math.PI));
        const u = this.getUpProgress;
        const e = u * u * (3 - 2 * u);
        this.tumble = this.lieAngle + (up - this.lieAngle) * e;
      }
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const pos = { x: this.x, z: this.z };
    world.resolveCircle(pos, FLY.radius, this.y);
    this.x = pos.x;
    this.z = pos.z;
    if (this.downT <= 0) {
      this.down = false;
      this.tumble = 0;
      this.tumbleV = 0;
      this.slide = false;
      this.vx = this.vz = this.vy = 0;
      this.invuln = 2;
    }
  }
}
