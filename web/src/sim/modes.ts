/**
 * お題モード（SPEC 8 章）。THREE には依存しない。
 * ハエ人の動きには触れない。開始時に置き直すことと、条件の判定と得点の計算だけを行う。
 */
import type { Sim } from './sim.ts';
import type { FlyPerson } from './flyperson.ts';

export type ModeId = 'bakery' | 'zapper' | 'road';
export const MODE_IDS: readonly ModeId[] = ['bakery', 'zapper', 'road'];
/** 制限時間（秒）。 */
export const MODE_LIMIT = 180;

/** 実行中の数値。 */
export interface RunStats {
  elapsed: number;
  injections: number;
  accidents: number;
  zaps: number;
  /** 殺虫器から 4 m 以内にいた秒数。 */
  nearSec: number;
}

export interface RunResult extends RunStats {
  mode: ModeId;
  flyIdx: number;
  /** 条件を満たした（パン屋に着いた、道を渡った、3 分守り切った）。 */
  success: boolean;
  /** 得点（小さいほど良い）。失敗は null。殺虫器は zaps * 1000 + nearSec。 */
  score: number | null;
  best: number | null;
  newBest: boolean;
}

interface Run {
  mode: ModeId;
  fly: FlyPerson;
  flyIdx: number;
  t0: number;
  lastT: number;
  base: { accidents: number; zaps: number };
  stats: RunStats;
  zapper?: { x: number; z: number };
}

const BAKERY_START = { x: -22, z: -18, yaw: Math.PI / 2 };
const BAKERY_GOAL_R = 3;
const ROAD_START = { x: -6.5, z: -30, yaw: 0 };
const ROAD_GOAL_X = 4.5;
const ZAPPER_NEAR = 4;

const key = (m: ModeId) => `flytown.best.${m}`;

export function loadBest(m: ModeId): number | null {
  try {
    const v = localStorage.getItem(key(m));
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveBest(m: ModeId, v: number): void {
  try {
    localStorage.setItem(key(m), String(v));
  } catch {
    /* 保存できない環境では記録しない */
  }
}

/** 殺虫器の得点（zaps * 1000 + nearSec）を分けて返す。 */
export function splitZapScore(score: number): { zaps: number; nearSec: number } {
  const zaps = Math.floor(score / 1000 + 1e-9);
  return { zaps, nearSec: score - zaps * 1000 };
}

export class ModeController {
  private sim: Sim;
  private run: Run | null = null;
  /** 終了したときに呼ばれる。 */
  onFinish: ((r: RunResult) => void) | null = null;

  constructor(sim: Sim) {
    this.sim = sim;
  }

  get active(): ModeId | null {
    return this.run?.mode ?? null;
  }
  get flyIndex(): number {
    return this.run?.flyIdx ?? -1;
  }
  get stats(): RunStats | null {
    return this.run?.stats ?? null;
  }

  start(mode: ModeId, flyIdx: number): void {
    const sim = this.sim;
    const fly = sim.flies[flyIdx];
    if (!fly) return;
    const L = sim.world.layout;
    let zapper: { x: number; z: number } | undefined;
    if (mode === 'bakery') {
      fly.teleport(BAKERY_START.x, BAKERY_START.z, BAKERY_START.yaw);
    } else if (mode === 'road') {
      let z = ROAD_START.z;
      while (sim.world.isBlocked(ROAD_START.x, z, 0.5) && z > -50) z -= 1.5;
      fly.teleport(ROAD_START.x, z, ROAD_START.yaw);
    } else {
      // 殺虫器が無ければ既定の位置に戻し、その 12 m 手前から、少し横にそれた向きで歩き出す。
      let zp = sim.town?.items.find((i) => i.kind === 'zapper');
      if (!zp && sim.town && sim.homes.zapper) zp = sim.town.addItem('zapper', sim.homes.zapper.x, sim.homes.zapper.z, 0) ?? undefined;
      const Z = zp ? { x: zp.x, z: zp.z } : (sim.homes.zapper ?? { x: L.flySpawns[0].x, z: L.flySpawns[0].z });
      zapper = Z;
      let placed = false;
      for (let a = 0; a < 12 && !placed; a++) {
        const ang = (a * Math.PI) / 6;
        const dx = Math.cos(ang), dz = Math.sin(ang);
        const px = Z.x + dx * 12, pz = Z.z + dz * 12;
        let clear = true;
        for (let k = 0; k <= 12 && clear; k++) if (sim.world.isBlocked(Z.x + dx * k, Z.z + dz * k, 0.45) && k > 1) clear = false;
        if (!clear || Math.abs(px) > 140 || Math.abs(pz) > 140) continue;
        const yaw = Math.atan2(-dx, -dz) + 0.25;
        fly.teleport(px, pz, yaw);
        placed = true;
      }
      if (!placed) fly.teleport(Z.x - 6, Z.z + 3, Math.PI / 2);
    }
    fly.brain?.reset();
    this.run = {
      mode, fly, flyIdx, t0: sim.time, lastT: sim.time,
      base: { accidents: fly.accidents, zaps: fly.stats.zaps },
      stats: { elapsed: 0, injections: 0, accidents: 0, zaps: 0, nearSec: 0 },
      zapper,
    };
  }

  cancel(): void {
    this.run = null;
  }

  noteInjection(flyIdx: number): void {
    if (this.run && this.run.flyIdx === flyIdx) this.run.stats.injections++;
  }

  /** 毎フレーム呼ぶ。条件を判定し、終わったら onFinish を呼ぶ。 */
  update(): void {
    const r = this.run;
    if (!r) return;
    const sim = this.sim;
    const f = r.fly;
    const s = r.stats;
    const dt = Math.max(0, sim.time - r.lastT);
    r.lastT = sim.time;
    s.elapsed = sim.time - r.t0;
    s.accidents = f.accidents - r.base.accidents;
    s.zaps = f.stats.zaps - r.base.zaps;
    let reached = false;
    if (r.mode === 'bakery') {
      const d = sim.world.layout.pois.find((p) => p.id === 'shop-bakery');
      if (d && Math.hypot(f.x - d.x, f.z - d.z) < BAKERY_GOAL_R && !f.down) reached = true;
    } else if (r.mode === 'road') {
      if (f.x >= ROAD_GOAL_X && Math.abs(f.x) < 8 && !f.down) reached = true;
    } else if (r.zapper) {
      if (Math.hypot(f.x - r.zapper.x, f.z - r.zapper.z) < ZAPPER_NEAR) s.nearSec += dt;
    }
    if (reached) this.finish(true);
    else if (s.elapsed >= MODE_LIMIT) this.finish(r.mode === 'zapper');
  }

  private finish(success: boolean): void {
    const r = this.run;
    if (!r) return;
    this.run = null;
    const s = r.stats;
    if (success && r.mode !== 'zapper') s.elapsed = Math.min(s.elapsed, MODE_LIMIT);
    if (r.mode === 'zapper') s.elapsed = MODE_LIMIT;
    let score: number | null = null;
    if (success) {
      if (r.mode === 'bakery') score = s.elapsed * (s.injections + 1);
      else if (r.mode === 'road') score = s.elapsed * (s.accidents + 1);
      else score = s.zaps * 1000 + s.nearSec;
    }
    const prev = loadBest(r.mode);
    const newBest = score !== null && (prev === null || score < prev);
    if (newBest && score !== null) saveBest(r.mode, score);
    this.onFinish?.({ ...s, mode: r.mode, flyIdx: r.flyIdx, success, score, best: newBest ? score : prev, newBest });
  }
}
