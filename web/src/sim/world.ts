/**
 * 街のレイアウト（純データ）と衝突世界。THREE には依存しない。
 * 街は約 300 m x 300 m。道路は 60 m ピッチの 5 x 5、ブロックは 4 x 4。
 * 座標は x 右、z 手前、y 上。車は左側通行。
 */
import { Rng } from './rng.ts';

export const ROAD_C = [-120, -60, 0, 60, 120] as const;
export const N_ROADS = 5;
export const N_BLOCKS = 4;
/** 道路中心から歩道の外縁まで。 */
export const ROAD_HALF = 7;
/** 道路中心から車道の縁まで。 */
export const CARRIAGE_HALF = 3.5;
/** 歩道の中心線（道路中心から）。 */
export const SIDEWALK_MID = 5.25;
/** 車線の中心（道路中心から）。 */
export const LANE_OFF = 1.75;
export const TOWN_HALF = 150;
/** 歩ける範囲（外周の生垣の内側）。 */
export const WALK_LIMIT = 146;
/** 建物の外面（ブロック中心から）。 */
export const FACADE = 22;
/** ブロックの半幅（道路の縁まで）。 */
export const BLOCK_HALF = 23;
/** 歩道を含むブロックの半幅。 */
export const SLAB_HALF = 26.5;
export const SUN_DIR: readonly [number, number, number] = (() => {
  const v = [0.62, 0.66, 0.42];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l] as const;
})();

export function blockCenter(i: number): number {
  return ROAD_C[i] + 30;
}

export type ShopKind = 'bakery' | 'coffee' | 'yakitori' | 'fruit' | 'convenience' | 'cold' | 'kakigori';

export interface BuildingSpec {
  id: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: number;
  roofColor: number;
  /** 上段のセットバック。 */
  tier?: { w: number; d: number; h: number; dx: number; dz: number };
  windows: boolean;
  shop?: ShopKind;
  /** 店の正面の向き（単位ベクトル）。 */
  face?: { x: number; z: number };
  zone: 'normal' | 'shop' | 'alley';
  /** Kenney City Kit (CC0) のモデル名（public/models/commercial/<name>.glb）。無ければ手続き生成の箱。 */
  model?: string;
  scale?: number;
  rotY?: number;
}

export type PropKind =
  | 'tree' | 'lamp' | 'bench' | 'bin' | 'bags' | 'bike' | 'crate' | 'parasol' | 'table' | 'sign'
  | 'container' | 'sand' | 'column' | 'hvac' | 'cone' | 'barrier' | 'grill' | 'lantern' | 'fence'
  | 'planter' | 'crane' | 'fountain';

export interface PropSpec {
  kind: PropKind;
  x: number;
  z: number;
  rot: number;
  scale: number;
  color: number;
  /** fence の長さ、その他の補助寸法。 */
  len?: number;
}

export interface Collider {
  id: number;
  shape: 'box' | 'circle';
  x: number;
  z: number;
  hx: number;
  hz: number;
  r: number;
  /** 高さ（m）。これより高い位置にいれば乗り越えられる。 */
  h: number;
  tag: 'building' | 'prop' | 'fence' | 'wall';
}

export interface LightSource {
  x: number;
  y: number;
  z: number;
  intensity: number;
  radius: number;
}

export interface Poi {
  id: string;
  label: string;
  kind: 'garbage' | 'alley' | 'fountain' | 'construction' | 'shop';
  x: number;
  z: number;
  radius: number;
  shopKind?: ShopKind;
}

export interface Zone {
  kind: 'plaza' | 'construction' | 'alley';
  x: number;
  z: number;
  hx: number;
  hz: number;
}

export interface TownLayout {
  seed: number;
  buildings: BuildingSpec[];
  props: PropSpec[];
  lights: LightSource[];
  pois: Poi[];
  zones: Zone[];
  flySpawns: { x: number; z: number; yaw: number }[];
}

interface ShopDef {
  kind: ShopKind;
  ix: number;
  iz: number;
  qx: 1 | -1;
  qz: 1 | -1;
  face: 'x' | 'z';
  w: number;
  d: number;
  h: number;
  wall: number;
  label: string;
}


/** Kenney City Kit Commercial の寸法（モデル単位）。GLB のアクセサ min/max から取得。 */
export interface KenneyBuilding { name: string; w: number; d: number; h: number }
export const KENNEY_MID: KenneyBuilding[] = [
  { name: 'building-a', w: 0.88, d: 0.94, h: 1.29 }, { name: 'building-b', w: 0.97, d: 0.94, h: 1.29 },
  { name: 'building-c', w: 0.88, d: 1.09, h: 0.89 }, { name: 'building-d', w: 0.84, d: 0.9, h: 1.29 },
  { name: 'building-e', w: 1.64, d: 1.01, h: 0.89 }, { name: 'building-f', w: 0.84, d: 1.03, h: 1.69 },
  { name: 'building-g', w: 0.97, d: 0.92, h: 1.69 }, { name: 'building-h', w: 0.88, d: 1.01, h: 1.29 },
  { name: 'building-i', w: 1.24, d: 1.3, h: 1.68 }, { name: 'building-j', w: 2.08, d: 1.34, h: 1.69 },
  { name: 'building-k', w: 2.08, d: 0.94, h: 1.47 }, { name: 'building-l', w: 1.37, d: 1.4, h: 2.27 },
  { name: 'building-m', w: 1.24, d: 1.24, h: 3.15 }, { name: 'building-n', w: 2.32, d: 1.82, h: 2.48 },
];
export const KENNEY_SKY: KenneyBuilding[] = [
  { name: 'building-skyscraper-a', w: 1.36, d: 1.36, h: 2.88 }, { name: 'building-skyscraper-b', w: 1.36, d: 1.36, h: 4.48 },
  { name: 'building-skyscraper-c', w: 1.28, d: 1.39, h: 4.08 }, { name: 'building-skyscraper-d', w: 1.28, d: 1.39, h: 5.47 },
  { name: 'building-skyscraper-e', w: 1.29, d: 1.24, h: 4.08 },
];

const PALETTE = [0xf3e9dc, 0xf6d6d6, 0xd7ebe0, 0xd6e4f2, 0xe3dcf2, 0xf8dfc6, 0xe9e6df, 0xf2eed0, 0xcfe3e6, 0xf1d9e6];
const ROOFS = [0xc9c4bd, 0xb9c4cf, 0xd3b8b0, 0xb6c7b9];

/** 店の定義。w は x 方向、d は z 方向の寸法（m）。 */
export const SHOP_DEFS: ShopDef[] = [
  { kind: 'bakery', ix: 1, iz: 0, qx: -1, qz: 1, face: 'z', w: 15, d: 14, h: 8, wall: 0xfbe3d0, label: 'パン屋' },
  { kind: 'coffee', ix: 2, iz: 1, qx: -1, qz: -1, face: 'x', w: 14, d: 14, h: 8, wall: 0xe6d5c3, label: '喫茶店' },
  { kind: 'yakitori', ix: 0, iz: 1, qx: 1, qz: 1, face: 'x', w: 12, d: 14, h: 7, wall: 0xf1d2c4, label: '焼き鳥屋' },
  { kind: 'fruit', ix: 1, iz: 2, qx: 1, qz: -1, face: 'z', w: 16, d: 12, h: 6.5, wall: 0xf6ecc0, label: '果物屋' },
  { kind: 'convenience', ix: 3, iz: 2, qx: -1, qz: 1, face: 'x', w: 15, d: 16, h: 6.5, wall: 0xf4f6f8, label: 'コンビニ' },
  { kind: 'cold', ix: 3, iz: 3, qx: 1, qz: 1, face: 'z', w: 19, d: 17, h: 12, wall: 0xdfeaf2, label: '冷凍倉庫' },
  { kind: 'kakigori', ix: 0, iz: 3, qx: -1, qz: -1, face: 'x', w: 8, d: 9, h: 4, wall: 0xe5f1f4, label: 'かき氷屋' },
];

const SPECIAL = { plaza: [1, 1], construction: [3, 0], alley: [2, 2] } as const;

function isSpecial(ix: number, iz: number): boolean {
  return Object.values(SPECIAL).some(([a, b]) => a === ix && b === iz);
}

export function generateTown(seed = 20261029): TownLayout {
  const rng = new Rng(seed);
  const buildings: BuildingSpec[] = [];
  const props: PropSpec[] = [];
  const lights: LightSource[] = [];
  const pois: Poi[] = [];
  const zones: Zone[] = [];
  const doors: { x: number; z: number }[] = [];
  let bid = 0;

  // 店
  for (const s of SHOP_DEFS) {
    const cx = blockCenter(s.ix);
    const cz = blockCenter(s.iz);
    // 正面方向の軸は外縁に接し、もう一方の軸も外縁に寄せる
    const ex = cx + s.qx * FACADE;
    const ez = cz + s.qz * FACADE;
    const x = ex - (s.qx * s.w) / 2;
    const z = ez - (s.qz * s.d) / 2;
    const face = s.face === 'x' ? { x: s.qx as number, z: 0 } : { x: 0, z: s.qz as number };
    buildings.push({
      id: bid++, x, z, w: s.w, d: s.d, h: s.h, color: s.wall, roofColor: 0xcbc6c0,
      windows: s.kind !== 'cold', shop: s.kind, face, zone: 'shop',
    });
    // 戸口（歩道側 2.5 m 先）
    const fx = face.x !== 0 ? x + (face.x * s.w) / 2 : x;
    const fz = face.z !== 0 ? z + (face.z * s.d) / 2 : z;
    const door = { x: fx + face.x * 2.5, z: fz + face.z * 2.5 };
    doors.push(door);
    pois.push({ id: `shop-${s.kind}`, label: s.label, kind: 'shop', x: door.x, z: door.z, radius: 5, shopKind: s.kind });
    shopFront(s, x, z, face, fx, fz, props, lights, rng);
  }

  // 通常ブロック
  for (let ix = 0; ix < N_BLOCKS; ix++) {
    for (let iz = 0; iz < N_BLOCKS; iz++) {
      const cx = blockCenter(ix);
      const cz = blockCenter(iz);
      if (!isSpecial(ix, iz)) {
        for (const qx of [-1, 1] as const) {
          for (const qz of [-1, 1] as const) {
            const taken = SHOP_DEFS.some((s) => s.ix === ix && s.iz === iz && s.qx === qx && s.qz === qz);
            if (taken) continue;
            const dist0 = Math.hypot(cx + qx * 12, cz + qz * 12);
            const center = Math.max(0, 1 - dist0 / 170);
            const pool = center > 0.4 && rng.chance(0.65) ? KENNEY_SKY : KENNEY_MID;
            const km = rng.pick(pool);
            const fit = 18.5 / Math.max(km.w, km.d);
            const sc = fit * rng.range(0.72, 1.0);
            const w = km.w * sc;
            const d = km.d * sc;
            const h = km.h * sc;
            const x = cx + qx * (FACADE - w / 2);
            const z = cz + qz * (FACADE - d / 2);
            const b: BuildingSpec = {
              id: bid++, x, z, w, d, h,
              color: 0xffffff, roofColor: 0xffffff, windows: true, zone: 'normal',
              model: km.name, scale: sc, rotY: qz > 0 ? 0 : Math.PI,
            };
            buildings.push(b);
          }
        }
        // 路地に小物
        for (let k = 0; k < 2; k++) {
          const alongX = rng.chance(0.5);
          const side = rng.chance(0.5) ? 1 : -1;
          const off = rng.range(7, 19) * side;
          const jit = rng.range(-1.1, 1.1);
          const kind: PropKind = rng.chance(0.5) ? 'bin' : 'bike';
          props.push({
            kind, x: alongX ? cx + off : cx + jit, z: alongX ? cz + jit : cz + off,
            rot: alongX ? 0 : Math.PI / 2, scale: 1, color: 0,
          });
        }
      }
    }
  }

  // 広場
  {
    const [ix, iz] = SPECIAL.plaza;
    const cx = blockCenter(ix);
    const cz = blockCenter(iz);
    zones.push({ kind: 'plaza', x: cx, z: cz, hx: BLOCK_HALF, hz: BLOCK_HALF });
    props.push({ kind: 'fountain', x: cx, z: cz, rot: 0, scale: 1, color: 0 });
    pois.push({ id: 'fountain', label: '噴水', kind: 'fountain', x: cx, z: cz, radius: 9 });
    for (const [dx, dz] of [[-14, -14], [14, -14], [-14, 14], [14, 14], [0, -17], [0, 17], [-17, 0], [17, 0]]) {
      props.push({ kind: 'tree', x: cx + dx, z: cz + dz, rot: rng.range(0, 6.28), scale: rng.range(0.95, 1.2), color: 0 });
    }
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      props.push({ kind: 'bench', x: cx + Math.cos(a) * 9, z: cz + Math.sin(a) * 9, rot: -a + Math.PI / 2, scale: 1, color: 0 });
    }
    for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
      props.push({ kind: 'lamp', x: cx + dx, z: cz + dz, rot: 0, scale: 1, color: 0 });
    }
    for (const [dx, dz] of [[-19, -9], [19, 9], [9, -19], [-9, 19]]) {
      props.push({ kind: 'planter', x: cx + dx, z: cz + dz, rot: 0, scale: 1, color: 0 });
    }
  }

  // 工事現場
  {
    const [ix, iz] = SPECIAL.construction;
    const cx = blockCenter(ix);
    const cz = blockCenter(iz);
    zones.push({ kind: 'construction', x: cx, z: cz, hx: 19, hz: 19 });
    pois.push({ id: 'construction', label: '工事現場', kind: 'construction', x: cx, z: cz, radius: 18 });
    const F = 19;
    props.push({ kind: 'fence', x: cx, z: cz - F, rot: 0, scale: 1, color: 0, len: 2 * F });
    props.push({ kind: 'fence', x: cx - F, z: cz, rot: Math.PI / 2, scale: 1, color: 0, len: 2 * F });
    props.push({ kind: 'fence', x: cx + F, z: cz, rot: Math.PI / 2, scale: 1, color: 0, len: 2 * F });
    props.push({ kind: 'fence', x: cx - 11, z: cz + F, rot: 0, scale: 1, color: 0, len: 16 });
    props.push({ kind: 'fence', x: cx + 11, z: cz + F, rot: 0, scale: 1, color: 0, len: 16 });
    for (const gx of [-9, -3, 3, 9]) {
      for (const gz of [-8, -2, 4]) props.push({ kind: 'column', x: cx + gx, z: cz + gz, rot: 0, scale: 1, color: 0 });
    }
    props.push({ kind: 'container', x: cx - 14, z: cz + 12, rot: Math.PI / 2, scale: 1, color: 0xf4b183 });
    props.push({ kind: 'container', x: cx - 14, z: cz + 8, rot: Math.PI / 2, scale: 1, color: 0x9fc5e8 });
    props.push({ kind: 'crane', x: cx + 14, z: cz - 14, rot: 0, scale: 1, color: 0 });
    props.push({ kind: 'sand', x: cx + 12, z: cz + 9, rot: 0, scale: 1, color: 0 });
    props.push({ kind: 'sand', x: cx + 7, z: cz + 14, rot: 0, scale: 0.7, color: 0 });
    for (const dx of [-4, 4]) props.push({ kind: 'cone', x: cx + dx, z: cz + F + 2, rot: 0, scale: 1, color: 0 });
    props.push({ kind: 'barrier', x: cx - 8, z: cz + F + 3, rot: 0, scale: 1, color: 0 });
    props.push({ kind: 'barrier', x: cx + 8, z: cz + F + 3, rot: 0, scale: 1, color: 0 });
  }

  // 路地ブロック
  {
    const [ix, iz] = SPECIAL.alley;
    const cx = blockCenter(ix);
    const cz = blockCenter(iz);
    zones.push({ kind: 'alley', x: cx, z: cz, hx: FACADE, hz: 2.5 });
    const nz0 = cz - FACADE;
    const nz1 = cz - 2.5;
    const sz0 = cz + 2.5;
    const sz1 = cz + FACADE;
    buildings.push({ id: bid++, x: cx, z: (nz0 + nz1) / 2, w: 2 * FACADE, d: nz1 - nz0, h: 16, color: 0xe7ddd0, roofColor: 0xb9b2aa, windows: true, zone: 'alley' });
    buildings.push({ id: bid++, x: cx, z: (sz0 + sz1) / 2, w: 2 * FACADE, d: sz1 - sz0, h: 22.4, color: 0xd9e0e6, roofColor: 0xb4bbc2, windows: true, zone: 'alley' });
    pois.push({ id: 'alley', label: '路地', kind: 'alley', x: cx, z: cz, radius: 8 });
    for (let k = 0; k < 7; k++) {
      props.push({ kind: 'bike', x: cx - 12 + k * 1.15, z: nz1 + 0.6, rot: Math.PI / 2, scale: 1, color: 0 });
    }
    for (const dx of [-5, 6, 13]) props.push({ kind: 'sign', x: cx + dx, z: cz + 0.2, rot: 0, scale: 1, color: 0 });
    for (const dx of [-8, -1, 6, 12]) props.push({ kind: 'hvac', x: cx + dx, z: sz0 + 0.3, rot: 0, scale: 1, color: 0 });
    // ゴミ捨て場（路地の西端）
    const gx = cx - 17;
    const gz = cz + 1.2;
    pois.push({ id: 'garbage', label: 'ゴミ捨て場', kind: 'garbage', x: gx, z: gz, radius: 6 });
    for (let k = 0; k < 4; k++) props.push({ kind: 'bin', x: gx - 1.5 + k * 0.9, z: gz + 1.0, rot: 0, scale: 1.1, color: 0 });
    for (let k = 0; k < 5; k++) props.push({ kind: 'bags', x: gx - 1.2 + rng.range(0, 3), z: gz - 0.9 + rng.range(-0.4, 0.4), rot: rng.range(0, 6.28), scale: rng.range(0.8, 1.2), color: 0 });
  }

  // 歩道の街路設備（街灯・木・ベンチ）
  for (let ix = 0; ix < N_BLOCKS; ix++) {
    for (let iz = 0; iz < N_BLOCKS; iz++) {
      const cx = blockCenter(ix);
      const cz = blockCenter(iz);
      for (let side = 0; side < 4; side++) {
        const nx = side === 0 ? 1 : side === 1 ? -1 : 0;
        const nz = side === 2 ? 1 : side === 3 ? -1 : 0;
        const tx = -nz;
        const tz = nx;
        const place = (kind: PropKind, u: number, off: number, rot: number, scale = 1) => {
          const x = cx + nx * off + tx * u;
          const z = cz + nz * off + tz * u;
          if (doors.some((d) => Math.hypot(d.x - x, d.z - z) < 5)) return;
          if (ix === SPECIAL.alley[0] && iz === SPECIAL.alley[1] && nx !== 0 && Math.abs(u) < 4.5) return;
          props.push({ kind, x, z, rot, scale, color: 0 });
        };
        place('lamp', -13, 26.0, 0);
        place('lamp', 13, 26.0, 0);
        for (const u of [-19, -7, 7, 19]) {
          if (rng.chance(0.62)) place('tree', u + rng.range(-1.5, 1.5), 23.8, rng.range(0, 6.28), rng.range(0.85, 1.2));
        }
        if (rng.chance(0.3)) place('bench', rng.range(-12, 12), 23.7, nx !== 0 ? Math.PI / 2 : 0);
      }
    }
  }

  // 外周の公園帯
  for (let k = 0; k < 90; k++) {
    const side = rng.int(0, 3);
    const t = rng.range(-142, 142);
    const o = rng.range(129, 143);
    const x = side === 0 ? o : side === 1 ? -o : t;
    const z = side === 2 ? o : side === 3 ? -o : t;
    props.push({ kind: 'tree', x, z, rot: rng.range(0, 6.28), scale: rng.range(1.0, 1.7), color: 0 });
  }

  const flySpawns = [
    { x: blockCenter(1) + 8, z: blockCenter(1) + 12, yaw: 2.4 },
    { x: blockCenter(1) - 12, z: blockCenter(1) + 6, yaw: -0.8 },
    { x: blockCenter(1) + 4, z: blockCenter(1) - 14, yaw: 3.0 },
    { x: blockCenter(1) - 6, z: blockCenter(1) - 6, yaw: 0.6 },
    { x: blockCenter(1) + 14, z: blockCenter(1) - 3, yaw: 1.2 },
    { x: blockCenter(1) - 15, z: blockCenter(1) - 12, yaw: 0 },
  ];

  return { seed, buildings, props, lights, pois, zones, flySpawns };
}

function shopFront(
  s: ShopDef, bx: number, bz: number, face: { x: number; z: number },
  fx: number, fz: number, props: PropSpec[], lights: LightSource[], rng: Rng,
): void {
  const tx = -face.z;
  const tz = face.x;
  const at = (n: number, t: number) => ({ x: fx + face.x * n + tx * t, z: fz + face.z * n + tz * t });
  const add = (kind: PropKind, n: number, t: number, rot = 0, scale = 1, color = 0) => {
    const p = at(n, t);
    props.push({ kind, x: p.x, z: p.z, rot, scale, color });
  };
  const alongRot = face.x !== 0 ? Math.PI / 2 : 0;
  switch (s.kind) {
    case 'bakery':
      add('planter', 1.2, -4);
      add('planter', 1.2, 4);
      add('sign', 1.6, 2.2, alongRot);
      break;
    case 'coffee':
      add('table', 2.0, -3, 0);
      add('table', 2.0, 0.5, 0);
      add('parasol', 2.0, -3, 0, 1, 0xa8d5ba);
      add('parasol', 2.0, 0.5, 0, 1, 0xa8d5ba);
      break;
    case 'yakitori':
      add('grill', 1.4, -1.2, alongRot);
      add('lantern', 0.4, -3.2);
      add('lantern', 0.4, 3.2);
      add('hvac', -0.4, 5.2);
      lights.push({ x: fx + face.x * 1.4, y: 1.5, z: fz + face.z * 1.4, intensity: 0.25, radius: 5 });
      break;
    case 'fruit':
      for (let k = 0; k < 5; k++) add('crate', 1.3, -4.5 + k * 1.15, alongRot, 1, [0xf26d6d, 0xf7c35f, 0xa6d96a, 0xf59e5b, 0xd9a0e6][k]);
      add('parasol', 1.3, 0, 0, 1, 0xf7e08a);
      break;
    case 'convenience':
      add('sign', 1.8, -4.4, alongRot);
      add('bin', 1.2, 4.4);
      lights.push({ x: fx + face.x * 2, y: 3, z: fz + face.z * 2, intensity: 1.0, radius: 16 });
      lights.push({ x: fx + face.x * 2 + tx * 5, y: 3, z: fz + face.z * 2 + tz * 5, intensity: 0.6, radius: 10 });
      lights.push({ x: fx + face.x * 2 - tx * 5, y: 3, z: fz + face.z * 2 - tz * 5, intensity: 0.6, radius: 10 });
      break;
    case 'cold':
      for (let k = 0; k < 3; k++) add('hvac', -0.4, -6 + k * 1.2, 0, 1.6);
      break;
    case 'kakigori':
      add('parasol', 1.5, 0, 0, 1.3, 0xbfe6f2);
      add('table', 1.5, 0, 0);
      add('sign', 2.8, 1.8, alongRot);
      break;
  }
  void bx; void bz; void rng;
}

// ---------------------------------------------------------------------------
// 衝突世界

const CELL = 10;
const GRID_N = 34;
const GRID_OFF = (GRID_N * CELL) / 2;

export interface RayResult {
  t: number;
  collider: Collider;
}

export class World {
  readonly layout: TownLayout;
  readonly colliders: Collider[] = [];
  private grid: number[][] = [];
  private stamp: number[] = [];
  private stampId = 0;

  constructor(layout: TownLayout) {
    this.layout = layout;
    for (let i = 0; i < GRID_N * GRID_N; i++) this.grid.push([]);
    for (const b of layout.buildings) {
      this.addBox(b.x, b.z, b.w / 2, b.d / 2, b.h + (b.tier?.h ?? 0), 'building');
    }
    for (const p of layout.props) this.addProp(p);
    // 外周の生垣
    const L = 150;
    const T = 1.5;
    this.addBox(0, -(WALK_LIMIT + T), L + T, T, 3, 'wall');
    this.addBox(0, WALK_LIMIT + T, L + T, T, 3, 'wall');
    this.addBox(-(WALK_LIMIT + T), 0, T, L + T, 3, 'wall');
    this.addBox(WALK_LIMIT + T, 0, T, L + T, 3, 'wall');
    this.stamp = new Array(this.colliders.length).fill(0);
  }

  private addBox(x: number, z: number, hx: number, hz: number, h: number, tag: Collider['tag']): void {
    const c: Collider = { id: this.colliders.length, shape: 'box', x, z, hx, hz, r: 0, h, tag };
    this.insert(c, hx, hz);
  }
  /** 実行中に小物（三角コーン等）の衝突体を足す。戻り値は衝突体の番号。 */
  addDynamicCircle(x: number, z: number, r: number, h: number): number {
    this.addCircle(x, z, r, h, 'prop');
    this.stamp.push(0);
    return this.colliders.length - 1;
  }
  /** 衝突体を無効にする（高さを -1 にする。resolveCircle・raycast とも無視する）。 */
  disableCollider(id: number): void {
    const c = this.colliders[id];
    if (c) c.h = -1;
  }
  /** 点 (x, z) が背の高い（0.5 m 超）衝突体の中か。小物を置けるかの判定用。 */
  isBlocked(x: number, z: number, margin = 0.2): boolean {
    let hit = false;
    this.forNear(x, z, margin + 1, (c) => {
      if (c.h <= 0.5) return;
      if (c.shape === 'circle') {
        if (Math.hypot(x - c.x, z - c.z) < c.r + margin) hit = true;
      } else if (Math.abs(x - c.x) < c.hx + margin && Math.abs(z - c.z) < c.hz + margin) hit = true;
    });
    return hit;
  }

  private addCircle(x: number, z: number, r: number, h: number, tag: Collider['tag']): void {
    const c: Collider = { id: this.colliders.length, shape: 'circle', x, z, hx: r, hz: r, r, h, tag };
    this.insert(c, r, r);
  }
  private insert(c: Collider, hx: number, hz: number): void {
    this.colliders.push(c);
    const x0 = Math.floor((c.x - hx + GRID_OFF) / CELL);
    const x1 = Math.floor((c.x + hx + GRID_OFF) / CELL);
    const z0 = Math.floor((c.z - hz + GRID_OFF) / CELL);
    const z1 = Math.floor((c.z + hz + GRID_OFF) / CELL);
    for (let gx = Math.max(0, x0); gx <= Math.min(GRID_N - 1, x1); gx++) {
      for (let gz = Math.max(0, z0); gz <= Math.min(GRID_N - 1, z1); gz++) this.grid[gz * GRID_N + gx].push(c.id);
    }
  }

  private addProp(p: PropSpec): void {
    const s = p.scale;
    const cs = Math.abs(Math.cos(p.rot));
    const sn = Math.abs(Math.sin(p.rot));
    const box = (hx: number, hz: number, h: number, tag: Collider['tag'] = 'prop') =>
      this.addBox(p.x, p.z, cs * hx + sn * hz, sn * hx + cs * hz, h, tag);
    switch (p.kind) {
      case 'tree': this.addCircle(p.x, p.z, 0.22 * s, 7, 'prop'); break;
      case 'lamp': this.addCircle(p.x, p.z, 0.1, 5, 'prop'); break;
      case 'bench': box(0.9, 0.3, 0.5); break;
      case 'bin': this.addCircle(p.x, p.z, 0.32 * s, 1, 'prop'); break;
      case 'bags': this.addCircle(p.x, p.z, 0.42 * s, 0.6, 'prop'); break;
      case 'bike': box(0.85, 0.3, 1.0); break;
      case 'crate': box(0.5, 0.4, 0.55); break;
      case 'parasol': this.addCircle(p.x, p.z, 0.15, 2.3, 'prop'); break;
      case 'table': this.addCircle(p.x, p.z, 0.42, 0.75, 'prop'); break;
      case 'sign': box(0.35, 0.06, 1.1); break;
      case 'container': box(3.0, 1.25, 2.6); break;
      case 'sand': this.addCircle(p.x, p.z, 1.6 * s, 1.2, 'prop'); break;
      case 'column': box(0.3, 0.3, 10); break;
      case 'hvac': box(0.55 * s, 0.4 * s, 1.2 * s); break;
      case 'cone': this.addCircle(p.x, p.z, 0.2, 0.7, 'prop'); break;
      case 'barrier': box(1.0, 0.15, 1.0); break;
      case 'grill': box(0.8, 0.4, 1.0); break;
      case 'fence': box((p.len ?? 4) / 2, 0.12, 2.0, 'fence'); break;
      case 'planter': this.addCircle(p.x, p.z, 0.42, 0.8, 'prop'); break;
      case 'crane': this.addCircle(p.x, p.z, 1.0, 40, 'prop'); break;
      case 'fountain': this.addCircle(p.x, p.z, 5.0, 0.7, 'prop'); break;
      case 'lantern': break;
    }
  }

  /** 近傍の衝突体を列挙する（重複あり得る）。 */
  forNear(x: number, z: number, r: number, cb: (c: Collider) => void): void {
    const x0 = Math.floor((x - r + GRID_OFF) / CELL);
    const x1 = Math.floor((x + r + GRID_OFF) / CELL);
    const z0 = Math.floor((z - r + GRID_OFF) / CELL);
    const z1 = Math.floor((z + r + GRID_OFF) / CELL);
    this.stampId++;
    for (let gx = Math.max(0, x0); gx <= Math.min(GRID_N - 1, x1); gx++) {
      for (let gz = Math.max(0, z0); gz <= Math.min(GRID_N - 1, z1); gz++) {
        for (const id of this.grid[gz * GRID_N + gx]) {
          if (this.stamp[id] === this.stampId) continue;
          this.stamp[id] = this.stampId;
          cb(this.colliders[id]);
        }
      }
    }
  }

  /**
   * 円（半径 r、地面からの高さ y）を建物・小物から押し出す。壁抜けしない。
   * 戻り値は押し出しがあったか。
   */
  resolveCircle(pos: { x: number; z: number }, r: number, y: number): boolean {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.forNear(pos.x, pos.z, r + 1, (c) => {
        if (c.h <= y) return;
        if (c.shape === 'circle') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const d = Math.hypot(dx, dz);
          const min = r + c.r;
          if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1;
            const nz = d > 1e-6 ? dz / d : 0;
            pos.x = c.x + nx * min;
            pos.z = c.z + nz * min;
            moved = true;
          }
        } else {
          const qx = Math.max(c.x - c.hx, Math.min(pos.x, c.x + c.hx));
          const qz = Math.max(c.z - c.hz, Math.min(pos.z, c.z + c.hz));
          const dx = pos.x - qx;
          const dz = pos.z - qz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-10) {
              const d = Math.sqrt(d2);
              pos.x = qx + (dx / d) * r;
              pos.z = qz + (dz / d) * r;
            } else {
              // 中心が箱の中: 最も近い面へ
              const ox = c.hx - Math.abs(pos.x - c.x);
              const oz = c.hz - Math.abs(pos.z - c.z);
              if (ox < oz) pos.x = c.x + Math.sign(pos.x - c.x || 1) * (c.hx + r);
              else pos.z = c.z + Math.sign(pos.z - c.z || 1) * (c.hz + r);
            }
            moved = true;
          }
        }
      });
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /**
   * 水平方向のレイ。高さは y0 + slope * t で変わる（slope は上向き正）。
   * 高さが 0..collider.h の範囲にあるときだけ当たる。
   */
  raycast(ox: number, oz: number, dx: number, dz: number, maxT: number, y0: number, slope: number): RayResult | null {
    let best: RayResult | null = null;
    for (let t0 = 0; t0 <= maxT + 5; t0 += 5) {
      const sx = ox + dx * t0;
      const sz = oz + dz * t0;
      this.forNear(sx, sz, 5.5, (c) => {
        const t = rayCollider(c, ox, oz, dx, dz);
        if (t < 0 || t > maxT) return;
        if (best && t >= best.t) return;
        const y = y0 + slope * t;
        if (y < 0 || y > c.h) return;
        best = { t, collider: c };
      });
      if (best && (best as RayResult).t <= t0) break;
    }
    return best;
  }
}

/** 水平レイと衝突体の交差距離。当たらなければ -1。 */
function rayCollider(c: Collider, ox: number, oz: number, dx: number, dz: number): number {
  if (c.shape === 'circle') {
    const fx = ox - c.x;
    const fz = oz - c.z;
    const b = fx * dx + fz * dz;
    const cc = fx * fx + fz * fz - c.r * c.r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t;
  }
  let tmin = -Infinity;
  let tmax = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return tmin <= tmax;
  };
  if (!slab(ox, dx, c.x - c.hx, c.x + c.hx)) return -1;
  if (!slab(oz, dz, c.z - c.hz, c.z + c.hz)) return -1;
  return tmin;
}

/** 太陽が見えるか（建物の影に入っていないか）。 */
export function sunVisible(world: World, x: number, y: number, z: number): boolean {
  const hl = Math.hypot(SUN_DIR[0], SUN_DIR[2]);
  const dx = SUN_DIR[0] / hl;
  const dz = SUN_DIR[2] / hl;
  const slope = SUN_DIR[1] / hl;
  return world.raycast(x, z, dx, dz, 70, y, slope) === null;
}
