/**
 * 人間の歩行者（台本で動かしてよい）。歩道の角（ノード）をつなぐグラフ上を歩き、
 * 車が近くにいなければ横断歩道を渡る。
 */
import { Rng } from './rng.ts';
import { N_BLOCKS, N_ROADS, ROAD_C, SIDEWALK_MID } from './world.ts';
import type { Car } from './cars.ts';

interface Node {
  id: number;
  x: number;
  z: number;
  nb: { to: number; cross: boolean }[];
  valid: boolean;
}

function nodeId(i: number, j: number, sx: number, sz: number): number {
  return (i * N_ROADS + j) * 4 + (sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0);
}

export function buildSidewalkGraph(): Node[] {
  const nodes: Node[] = [];
  for (let i = 0; i < N_ROADS; i++) {
    for (let j = 0; j < N_ROADS; j++) {
      for (let q = 0; q < 4; q++) {
        const sx = q & 1 ? 1 : -1;
        const sz = q & 2 ? 1 : -1;
        const bi = i + (sx > 0 ? 0 : -1);
        const bj = j + (sz > 0 ? 0 : -1);
        nodes.push({
          id: nodes.length,
          x: ROAD_C[i] + sx * SIDEWALK_MID,
          z: ROAD_C[j] + sz * SIDEWALK_MID,
          nb: [],
          valid: bi >= 0 && bi < N_BLOCKS && bj >= 0 && bj < N_BLOCKS,
        });
      }
    }
  }
  const link = (a: number, b: number, cross: boolean) => {
    if (!nodes[a].valid || !nodes[b].valid) return;
    nodes[a].nb.push({ to: b, cross });
    nodes[b].nb.push({ to: a, cross });
  };
  for (let bi = 0; bi < N_BLOCKS; bi++) {
    for (let bj = 0; bj < N_BLOCKS; bj++) {
      const a = nodeId(bi, bj, 1, 1);
      const b = nodeId(bi + 1, bj, -1, 1);
      const c = nodeId(bi, bj + 1, 1, -1);
      const d = nodeId(bi + 1, bj + 1, -1, -1);
      link(a, b, false);
      link(a, c, false);
      link(b, d, false);
      link(c, d, false);
    }
  }
  for (let i = 0; i < N_ROADS; i++) {
    for (let j = 0; j < N_ROADS; j++) {
      for (const s of [-1, 1]) {
        link(nodeId(i, j, s, 1), nodeId(i, j, s, -1), true);
        link(nodeId(i, j, 1, s), nodeId(i, j, -1, s), true);
      }
    }
  }
  return nodes;
}

export const NPC_SHIRTS = [0xf4a6a6, 0xa9d6c2, 0x9ec5e8, 0xf6d28f, 0xc9b8e8, 0xf4f1ea, 0xe8b4c8, 0x8fb8a8, 0xf2b896];
export const NPC_PANTS = [0x6c7a96, 0x8a8f99, 0x5f6b7a, 0xb8a58c, 0x4f5b6b, 0x9aa5b5];
export const NPC_SKIN = [0xf1d0b5, 0xe8bd9a, 0xd9a984, 0xc08e6a, 0xf6dcc6];
export const NPC_HAIR = [0x3b3030, 0x5a4636, 0x1f1b1b, 0x8a6a4a, 0xb9a08a];

export class Npc {
  id: number;
  x = 0;
  z = 0;
  yaw = 0;
  px = 0;
  pz = 0;
  pyaw = 0;
  vx = 0;
  vz = 0;
  speed = 0;
  walkSpeed: number;
  from = 0;
  to = 0;
  prev = -1;
  t = 0;
  len = 1;
  crossing = false;
  edgeCross = false;
  waitT = 0;
  shirt: number;
  pants: number;
  skin: number;
  hair: number;
  constructor(id: number, walkSpeed: number, rng: Rng) {
    this.id = id;
    this.walkSpeed = walkSpeed;
    this.shirt = rng.pick(NPC_SHIRTS);
    this.pants = rng.pick(NPC_PANTS);
    this.skin = rng.pick(NPC_SKIN);
    this.hair = rng.pick(NPC_HAIR);
  }
}

export class NpcSystem {
  npcs: Npc[] = [];
  private nodes: Node[];
  private valid: number[];
  private rng: Rng;

  constructor(count: number, seed: number) {
    this.rng = new Rng(seed ^ 0x9e37);
    this.nodes = buildSidewalkGraph();
    this.valid = this.nodes.filter((n) => n.valid).map((n) => n.id);
    for (let i = 0; i < count; i++) {
      const n = new Npc(i, this.rng.range(1.0, 1.5), this.rng);
      n.from = this.rng.pick(this.valid);
      this.chooseNext(n, false);
      n.t = this.rng.next() * n.len;
      this.place(n);
      n.px = n.x; n.pz = n.z; n.pyaw = n.yaw;
      this.npcs.push(n);
    }
  }

  private chooseNext(n: Npc, allowCross: boolean): void {
    const cur = this.nodes[n.from];
    let opts = cur.nb.filter((e) => e.to !== n.prev && (allowCross || !e.cross));
    if (opts.length === 0) opts = cur.nb.filter((e) => allowCross || !e.cross);
    if (opts.length === 0) opts = cur.nb;
    const weights = opts.map((e) => (e.cross ? 0.6 : 1));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    let pick = opts[0];
    for (let k = 0; k < opts.length; k++) {
      r -= weights[k];
      if (r <= 0) { pick = opts[k]; break; }
    }
    n.to = pick.to;
    n.crossing = false;
    const a = this.nodes[n.from];
    const b = this.nodes[n.to];
    n.len = Math.hypot(b.x - a.x, b.z - a.z);
    n.t = 0;
    n.edgeCross = pick.cross;
  }

  private place(n: Npc): void {
    const a = this.nodes[n.from];
    const b = this.nodes[n.to];
    const u = n.len > 0 ? n.t / n.len : 0;
    n.x = a.x + (b.x - a.x) * u;
    n.z = a.z + (b.z - a.z) * u;
    if (n.len > 0) n.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  }

  update(dt: number, cars: Car[]): void {
    for (const n of this.npcs) {
      n.px = n.x; n.pz = n.z; n.pyaw = n.yaw;
      const edgeCross = n.edgeCross;
      if (n.waitT > 0) {
        n.waitT -= dt;
        n.speed = 0; n.vx = 0; n.vz = 0;
        continue;
      }
      // 横断の開始前に車を確認
      if (edgeCross && !n.crossing && n.t === 0) {
        const a = this.nodes[n.from];
        const b = this.nodes[n.to];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        let busy = false;
        for (const c of cars) {
          if (c.speed > 1.2 && Math.hypot(c.x - mx, c.z - mz) < 18) { busy = true; break; }
        }
        if (busy) { n.waitT = 0.4; continue; }
        n.crossing = true;
      }
      const sp = n.crossing ? Math.max(n.walkSpeed, 1.5) : n.walkSpeed;
      n.t += sp * dt;
      n.speed = sp;
      if (n.t >= n.len) {
        n.prev = n.from;
        n.from = n.to;
        this.chooseNext(n, true);
        if (this.rng.chance(0.12)) n.waitT = this.rng.range(1.5, 5);
      }
      this.place(n);
      n.vx = Math.sin(n.yaw) * n.speed;
      n.vz = Math.cos(n.yaw) * n.speed;
    }
  }
}
