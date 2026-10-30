/**
 * 街の場（Field の実装）。THREE には依存しない。
 *
 * 匂い 4 種（vinegar, fruit, geosmin, co2）: 2 m 格子（150 x 150）上の拡散 + 風による移流（風上差分）+ 減衰、0.1 秒ごとに更新。
 *   建物のマスは壁（拡散は反射、風で運ばれた分は壁に吸われる）。風は全体の風 + 送風機の円錐。
 * cVA: 他のハエ人から（自分の分は嗅がない）。格子ではなく、風下に伸びる指数減衰の解析式。
 * 温度・湿度・粉じん・光: 発生源からの滑らかな円形の場（解析式）。
 * 味: 頭が食べ物から接触距離以内のときだけ非 0。
 * 判断に関わるものは無い。置いた物が出す物理量を返すだけ。
 */
import type { Field, FieldSample } from './sensors.ts';
import { zeroFieldSample } from './sensors.ts';
import type { GridOdor, ItemKind, PlacedItem, Radial, Source } from './items.ts';
import { GRID_ODORS, ITEM_DEF } from './items.ts';
import type { World } from './world.ts';
import { SIDEWALK_MID, TOWN_HALF, blockCenter } from './world.ts';

export const CELL = 2;
export const GN = (2 * TOWN_HALF) / CELL; // 150
export const UPDATE_DT = 0.1;
/** 拡散係数（m^2/s、街の乱流拡散の見立て）。 */
export const DIFFUSION = 1.5;
/** 匂いの減衰率（1/s）。風 0.5 m/s で 10〜20 m 届く。 */
export const DECAY = 0.05;
/** 1 マスの濃さの上限。 */
const CAP = 1.3;
/** 車の排気（co2）。1 台が毎秒そのマスに足す量。 */
const CAR_CO2 = 0.9;
/** cVA: 1 体が作る濃さと、風なしのときの 1/e 距離（m）。 */
const CVA_Q = 0.9;
const CVA_LEN = 7;

/** 滑らかな円形: 中心 1、半径で 0 になる (1 - u^2)^2。 */
const bump = (d: number, r: number): number => {
  if (d >= r) return 0;
  const u = d / r;
  const v = 1 - u * u;
  return v * v;
};

interface CarLike { x: number; z: number; speed: number }
interface FlyLike { id: number; x: number; z: number }

export class TownField implements Field {
  readonly world: World;
  readonly sources: Source[] = [];
  readonly items: PlacedItem[] = [];
  /** 格子の濃さ。GRID_ODORS の順。 */
  readonly grid: Float32Array[] = GRID_ODORS.map(() => new Float32Array(GN * GN));
  private tmp = new Float32Array(GN * GN);
  private solid = new Uint8Array(GN * GN);
  private nextId = 1;
  private nextItemId = 1;
  /** 全体の風（世界座標、m/s）。 */
  windX = 0;
  windZ = 0;
  private windGrid: { x: Float32Array; z: Float32Array } | null = null;
  private fanCount = 0;
  private flies: FlyLike[] = [];
  private t = 0;
  /** 更新に使った累計時間（秒）。 */
  simTime = 0;

  constructor(world: World) {
    this.world = world;
    for (const b of world.layout.buildings) {
      const i0 = Math.max(0, Math.floor((b.x - b.w / 2 + TOWN_HALF) / CELL));
      const i1 = Math.min(GN - 1, Math.floor((b.x + b.w / 2 + TOWN_HALF) / CELL));
      const j0 = Math.max(0, Math.floor((b.z - b.d / 2 + TOWN_HALF) / CELL));
      const j1 = Math.min(GN - 1, Math.floor((b.z + b.d / 2 + TOWN_HALF) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cx = -TOWN_HALF + (i + 0.5) * CELL;
          const cz = -TOWN_HALF + (j + 0.5) * CELL;
          if (Math.abs(cx - b.x) < b.w / 2 && Math.abs(cz - b.z) < b.d / 2) this.solid[j * GN + i] = 1;
        }
      }
    }
    this.setWind(90, 0.5); // 既定: 東（+x）へ 0.5 m/s
    this.addDefaultSources();
  }

  // -------------------------------------------------------------- 風

  /** 風向 dirDeg（北 = -z から時計回り、風が吹いていく向き）と強さ（m/s）。 */
  setWind(dirDeg: number, speed: number): void {
    const a = (dirDeg * Math.PI) / 180;
    this.windX = Math.sin(a) * speed;
    this.windZ = -Math.cos(a) * speed;
  }
  get windSpeed(): number {
    return Math.hypot(this.windX, this.windZ);
  }
  /** 風が吹いていく向き（度、北 = -z から時計回り）。 */
  get windDirDeg(): number {
    return ((Math.atan2(this.windX, -this.windZ) * 180) / Math.PI + 360) % 360;
  }

  // -------------------------------------------------------------- 発生源

  private cellOf(x: number, z: number): number {
    const i = Math.max(0, Math.min(GN - 1, Math.floor((x + TOWN_HALF) / CELL)));
    const j = Math.max(0, Math.min(GN - 1, Math.floor((z + TOWN_HALF) / CELL)));
    return j * GN + i;
  }

  addSource(s: Omit<Source, 'id'>): Source {
    const src: Source = { ...s, id: this.nextId++ };
    this.sources.push(src);
    return src;
  }

  private addDefaultSources(): void {
    const L = this.world.layout;
    const poi = (id: string) => L.pois.find((p) => p.id === id);
    const door = (kind: string) => poi(`shop-${kind}`);
    const shopFace = (kind: string) => L.buildings.find((b) => b.shop === kind);
    const add = (label: string, x: number, z: number, rest: Partial<Source>) =>
      this.addSource({ itemId: null, label, x, z, ...rest });
    /** 店先の接触線分（ファサード中央、間口に沿う）。 */
    const frontage = (kind: string, taste: 'sugar' | 'bitter') => {
      const b = shopFace(kind);
      if (!b?.face) return undefined;
      const fx = b.x + (b.face.x * b.w) / 2;
      const fz = b.z + (b.face.z * b.d) / 2;
      const half = b.face.x !== 0 ? b.d / 2 - 2.5 : b.w / 2 - 2.5;
      return { fx, fz, contact: { taste, r: 0.75, seg: { tx: -b.face.z, tz: b.face.x, half: Math.min(3.5, half) } } };
    };

    const g = poi('garbage');
    if (g) add('ゴミ捨て場', g.x, g.z, { q: { vinegar: 1.5 } });
    const f = door('fruit');
    if (f) add('果物屋', f.x, f.z, { q: { fruit: 1.0, vinegar: 0.6 } });
    const bk = door('bakery');
    if (bk) add('パン屋・ケーキ屋', bk.x, bk.z, { q: { fruit: 1.1 } });
    const bf = frontage('bakery', 'sugar');
    if (bf) add('パン屋・ケーキ屋の店先', bf.fx, bf.fz, { contact: bf.contact });
    const cf = frontage('coffee', 'bitter');
    if (cf) add('喫茶店', cf.fx, cf.fz, { contact: cf.contact });
    // 焼き鳥屋: 熱 + 少量の co2（煙の見立て。専用の煙チャネルは無い）。焼き台の位置に置く。
    const grill = L.props.find((p) => p.kind === 'grill');
    if (grill) add('焼き鳥屋', grill.x, grill.z, { warm: { s: 1.0, r: 5 }, q: { co2: 0.25 } });
    // 室外機: 熱。冷凍倉庫の室外機は「冷凍倉庫」の冷気側として扱い、熱源にしない。
    const cold = door('cold');
    for (const p of L.props) {
      if (p.kind !== 'hvac') continue;
      if (cold && Math.hypot(p.x - cold.x, p.z - cold.z) < 12) continue;
      add('室外機', p.x, p.z, { warm: { s: 0.65, r: 3.5 } });
    }
    // 夏のアスファルト: 広場の東の歩道に熱だまり
    add('熱いアスファルト', blockCenter(1) + 22 + 0.0, blockCenter(1) + 6, { warm: { s: 0.8, r: 6 } });
    if (cold) add('冷凍倉庫', cold.x, cold.z, { cold: { s: 0.9, r: 9 } });
    const kk = door('kakigori');
    if (kk) add('かき氷屋', kk.x, kk.z, { cold: { s: 0.7, r: 6 } });
    const fo = poi('fountain');
    if (fo) add('噴水', fo.x, fo.z, { humid: { s: 0.5, r: 13 }, contact: { taste: 'water', r: 5.6 } });
    const al = poi('alley');
    if (al) {
      add('カビ臭い路地', al.x - 3, al.z, { q: { geosmin: 1.0 } });
      add('カビ臭い路地', al.x + 10, al.z, { q: { geosmin: 1.0 } });
    }
    const co = poi('construction');
    if (co) {
      add('工事現場', co.x, co.z, { dust: { s: 0.85, r: 17 } });
      for (const p of L.props) if (p.kind === 'sand') add('砂山', p.x, p.z, { dust: { s: 0.9, r: 6 } });
    }
    void SIDEWALK_MID;
  }

  /** 刺激オブジェクトを置く。置けない場所なら null。 */
  addItem(kind: ItemKind, x: number, z: number, rot = 0): PlacedItem | null {
    if (Math.abs(x) > 146 || Math.abs(z) > 146) return null;
    if (this.world.isBlocked(x, z, 0.3)) return null;
    const def = ITEM_DEF[kind];
    const itemId = this.nextItemId++;
    const item: PlacedItem = { id: itemId, kind, x, z, rot, colliderId: null, lightRef: null };
    this.addSource({ itemId, label: def.label, x, z, ...def.make(x, z, rot) });
    if (def.collider) item.colliderId = this.world.addDynamicCircle(x, z, def.collider.r, def.collider.h);
    if (def.light) {
      item.lightRef = { x, y: def.light.y, z, intensity: def.light.intensity, radius: def.light.radius };
      this.world.layout.lights.push(item.lightRef);
    }
    this.items.push(item);
    this.rebuildWind();
    return item;
  }

  removeItem(id: number): boolean {
    const k = this.items.findIndex((i) => i.id === id);
    if (k < 0) return false;
    const it = this.items[k];
    this.items.splice(k, 1);
    const si = this.sources.findIndex((s) => s.itemId === id);
    if (si >= 0) this.sources.splice(si, 1);
    if (it.colliderId !== null) this.world.disableCollider(it.colliderId);
    if (it.lightRef) {
      const li = this.world.layout.lights.indexOf(it.lightRef);
      if (li >= 0) this.world.layout.lights.splice(li, 1);
    }
    this.rebuildWind();
    return true;
  }

  /** (x, z) から maxDist 以内で最も近い置いた物。 */
  nearestItem(x: number, z: number, maxDist: number): PlacedItem | null {
    let best: PlacedItem | null = null;
    let bd = maxDist;
    for (const it of this.items) {
      const d = Math.hypot(it.x - x, it.z - z);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** 送風機の円錐の風を格子に焼く（置く・消すときだけ）。 */
  private rebuildWind(): void {
    const fans = this.sources.filter((s) => s.wind);
    this.fanCount = fans.length;
    if (!fans.length) { this.windGrid = null; return; }
    if (!this.windGrid) this.windGrid = { x: new Float32Array(GN * GN), z: new Float32Array(GN * GN) };
    const { x: wx, z: wz } = this.windGrid;
    wx.fill(0);
    wz.fill(0);
    for (const f of fans) {
      const w = f.wind!;
      const i0 = Math.max(0, Math.floor((f.x - w.range + TOWN_HALF) / CELL));
      const i1 = Math.min(GN - 1, Math.floor((f.x + w.range + TOWN_HALF) / CELL));
      const j0 = Math.max(0, Math.floor((f.z - w.range + TOWN_HALF) / CELL));
      const j1 = Math.min(GN - 1, Math.floor((f.z + w.range + TOWN_HALF) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const v = this.fanWindAt(w, f, -TOWN_HALF + (i + 0.5) * CELL, -TOWN_HALF + (j + 0.5) * CELL);
          wx[j * GN + i] += v.x;
          wz[j * GN + i] += v.z;
        }
      }
    }
  }

  private fanWindAt(w: NonNullable<Source['wind']>, f: Source, x: number, z: number): { x: number; z: number } {
    const rx = x - f.x;
    const rz = z - f.z;
    const along = rx * w.dx + rz * w.dz;
    if (along <= 0 || along > w.range) return { x: 0, z: 0 };
    const perp = Math.abs(rx * w.dz - rz * w.dx);
    const hw = 1.5 + along * 0.5;
    const m = w.speed * (1 - along / w.range) * Math.exp(-((perp / hw) ** 2));
    return { x: w.dx * m, z: w.dz * m };
  }

  // -------------------------------------------------------------- 更新（0.1 秒ごと）

  update(cars: readonly CarLike[], flies: readonly FlyLike[]): void {
    this.flies = flies as FlyLike[];
    this.simTime += UPDATE_DT;
    // 放出
    for (const s of this.sources) {
      if (!s.q) continue;
      const idx = this.solidFree(this.cellOf(s.x, s.z));
      for (let c = 0; c < GRID_ODORS.length; c++) {
        const q = s.q[GRID_ODORS[c]];
        if (q) this.grid[c][idx] = Math.min(CAP, this.grid[c][idx] + q * UPDATE_DT);
      }
    }
    const co2 = this.grid[GRID_ODORS.indexOf('co2')];
    for (const c of cars) {
      if (c.speed < 0.3) continue;
      const idx = this.cellOf(c.x, c.z);
      if (!this.solid[idx]) co2[idx] = Math.min(CAP, co2[idx] + CAR_CO2 * UPDATE_DT);
    }
    for (let c = 0; c < this.grid.length; c++) this.stepChannel(this.grid[c]);
  }

  /** 壁のマスなら隣の空きマスを探す。 */
  private solidFree(idx: number): number {
    if (!this.solid[idx]) return idx;
    for (const d of [1, -1, GN, -GN, GN + 1, GN - 1, -GN + 1, -GN - 1, 2, -2, 2 * GN, -2 * GN]) {
      const k = idx + d;
      if (k >= 0 && k < GN * GN && !this.solid[k]) return k;
    }
    return idx;
  }

  private stepChannel(g: Float32Array): void {
    const t = this.tmp;
    const solid = this.solid;
    const kd = (DIFFUSION * UPDATE_DT) / (CELL * CELL);
    const ka = UPDATE_DT / CELL;
    const keep = 1 - DECAY * UPDATE_DT;
    const wg = this.windGrid;
    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        const idx = j * GN + i;
        if (solid[idx]) { t[idx] = 0; continue; }
        const c = g[idx];
        const l = i > 0 ? (solid[idx - 1] ? c : g[idx - 1]) : 0;
        const r = i < GN - 1 ? (solid[idx + 1] ? c : g[idx + 1]) : 0;
        const u = j > 0 ? (solid[idx - GN] ? c : g[idx - GN]) : 0;
        const d = j < GN - 1 ? (solid[idx + GN] ? c : g[idx + GN]) : 0;
        const wx = this.windX + (wg ? wg.x[idx] : 0);
        const wz = this.windZ + (wg ? wg.z[idx] : 0);
        // 風上差分。風上が壁なら流入なし（差 0）。
        const ax = wx > 0 ? wx * (c - l) : wx * (r - c);
        const az = wz > 0 ? wz * (c - u) : wz * (d - c);
        const v = (c + kd * (l + r + u + d - 4 * c) - ka * (ax + az)) * keep;
        t[idx] = v > 1e-5 ? v : 0;
      }
    }
    g.set(t);
  }

  // -------------------------------------------------------------- 取得

  /** 格子の双一次補間（0..CAP）。 */
  gridAt(ch: number, x: number, z: number): number {
    const g = this.grid[ch];
    const fx = (x + TOWN_HALF) / CELL - 0.5;
    const fz = (z + TOWN_HALF) / CELL - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fz);
    const ax = fx - i0;
    const az = fz - j0;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= GN || j >= GN ? 0 : g[j * GN + i]);
    return (
      at(i0, j0) * (1 - ax) * (1 - az) + at(i0 + 1, j0) * ax * (1 - az) +
      at(i0, j0 + 1) * (1 - ax) * az + at(i0 + 1, j0 + 1) * ax * az
    );
  }

  private windAt(x: number, z: number): { x: number; z: number } {
    if (!this.windGrid) return { x: this.windX, z: this.windZ };
    const idx = this.cellOf(x, z);
    return { x: this.windX + this.windGrid.x[idx], z: this.windZ + this.windGrid.z[idx] };
  }

  private cva(x: number, z: number, selfId: number | undefined): number {
    const sp = this.windSpeed;
    const wx = sp > 1e-6 ? this.windX / sp : 1;
    const wz = sp > 1e-6 ? this.windZ / sp : 0;
    const stretch = 1 + 0.8 * sp;
    let sum = 0;
    for (const f of this.flies) {
      if (f.id === selfId) continue;
      const rx = x - f.x;
      const rz = z - f.z;
      const along = rx * wx + rz * wz;
      const perp = Math.abs(rx * wz - rz * wx);
      const sa = along > 0 ? CVA_LEN * stretch : CVA_LEN / stretch;
      sum += CVA_Q * Math.exp(-Math.hypot(along / sa, perp / CVA_LEN));
    }
    return Math.min(1, sum);
  }

  private radial(x: number, z: number, key: 'warm' | 'cold' | 'dust'): number {
    let s = 0;
    for (const src of this.sources) {
      const r = src[key] as Radial | undefined;
      if (r) s += r.s * bump(Math.hypot(x - src.x, z - src.z), r.r);
    }
    return Math.min(1, s);
  }

  /** 頭 (x, z) から接触距離以内にある味。 */
  private taste(x: number, z: number): { sugar: number; bitter: number; water: number } {
    const out = { sugar: 0, bitter: 0, water: 0 };
    for (const s of this.sources) {
      const c = s.contact;
      if (!c) continue;
      let d: number;
      if (c.seg) {
        const px = x - s.x;
        const pz = z - s.z;
        const a = Math.max(-c.seg.half, Math.min(c.seg.half, px * c.seg.tx + pz * c.seg.tz));
        d = Math.hypot(px - a * c.seg.tx, pz - a * c.seg.tz);
      } else d = Math.hypot(x - s.x, z - s.z);
      const v = Math.max(0, Math.min(1, (c.r - d) / 0.1));
      if (v > out[c.taste]) out[c.taste] = v;
    }
    return out;
  }

  sample(x: number, _y: number, z: number, tSec: number, selfId?: number): FieldSample {
    this.t = tSec;
    const s = zeroFieldSample();
    s.odor.fermentation = Math.min(1, this.gridAt(0, x, z));
    s.odor.sweet = Math.min(1, this.gridAt(1, x, z));
    s.odor.geosmin = Math.min(1, this.gridAt(2, x, z));
    s.odor.co2 = Math.min(1, this.gridAt(3, x, z));
    s.odor.cva = this.cva(x, z, selfId);
    s.warm = this.radial(x, z, 'warm');
    s.cold = this.radial(x, z, 'cold');
    s.dust = this.radial(x, z, 'dust');
    let h = 0.5;
    for (const src of this.sources) if (src.humid) h += src.humid.s * bump(Math.hypot(x - src.x, z - src.z), src.humid.r);
    s.humidity = Math.max(0, Math.min(1, h));
    const w = this.windAt(x, z);
    s.wind.x = w.x;
    s.wind.z = w.z;
    const ts = this.taste(x, z);
    s.taste.sugar = ts.sugar;
    s.taste.bitter = ts.bitter;
    s.taste.water = ts.water;
    let li = 0;
    for (const L of this.world.layout.lights) {
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < L.radius) { const k = 1 - d / L.radius; li += L.intensity * k * k; }
    }
    s.light = Math.min(2, li);
    return s;
  }

  /** 危険物（くっつく・気絶）の発生源。 */
  hazards(): Source[] {
    return this.sources.filter((s) => s.sticky || s.zap);
  }

  get fans(): number {
    return this.fanCount;
  }
}
