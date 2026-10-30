/**
 * 場の発生源（Source）と、プレイヤーが置く刺激オブジェクト（ItemKind）の定義。THREE には依存しない。
 * 数値はすべて場の強さ（0..1 の尺度）と m / s。ここに行動の台本は無い。置いた物が出す物理量だけを決める。
 */

/** 格子で流れる匂い（拡散 + 風 + 減衰）。cVA は別（field.ts の説明を参照）。 */
export type GridOdor = 'vinegar' | 'fruit' | 'geosmin' | 'co2';
export const GRID_ODORS: readonly GridOdor[] = ['vinegar', 'fruit', 'geosmin', 'co2'];

/** 滑らかな円形の場: 中心で s、半径 r で 0。 */
export interface Radial {
  s: number;
  r: number;
}

export type TasteKind = 'sugar' | 'bitter' | 'water';

export interface Source {
  id: number;
  /** 置いた物の番号（街の既定の発生源は null）。 */
  itemId: number | null;
  label: string;
  x: number;
  z: number;
  /** 匂いの放出量（格子 1 マスに毎秒足す量）。 */
  q?: Partial<Record<GridOdor, number>>;
  warm?: Radial;
  cold?: Radial;
  /** 湿度の上げ幅（中心で +s）。 */
  humid?: Radial;
  dust?: Radial;
  /** 接触したときだけ味になる。頭が点（または線分）から r 以内。 */
  contact?: { taste: TasteKind; r: number; seg?: { tx: number; tz: number; half: number } };
  /** 送風。向き (dx, dz) の円錐。 */
  wind?: { dx: number; dz: number; speed: number; range: number };
  /** ハエ取り紙: r 以内の地面にいると sec 秒くっつく（物理）。 */
  sticky?: { r: number; sec: number };
  /** 電撃殺虫器: r 以内に触ると sec 秒気絶（物理）。 */
  zap?: { r: number; sec: number };
}

export type ItemKind =
  | 'garbage' | 'banana' | 'cake' | 'coffee' | 'heater' | 'ice' | 'fan'
  | 'humidifier' | 'mold' | 'zapper' | 'paper' | 'cone';

export interface ItemDef {
  kind: ItemKind;
  label: string;
  /** 向きが意味を持つか（送風機）。 */
  directional?: boolean;
  /** 実体の衝突（半径 m、高さ m）。 */
  collider?: { r: number; h: number };
  /** 光源（街の明るさに足す）。 */
  light?: { y: number; intensity: number; radius: number };
  make(x: number, z: number, rot: number): Omit<Source, 'id' | 'itemId' | 'label' | 'x' | 'z'>;
}

/** 向き rot（rad）から単位ベクトル。rot = 0 で +z、ハエ人の yaw と同じ向き。 */
export const dirOf = (rot: number): { dx: number; dz: number } => ({ dx: Math.sin(rot), dz: Math.cos(rot) });

export const ITEM_DEFS: ItemDef[] = [
  { kind: 'garbage', label: 'ゴミ', make: () => ({ q: { vinegar: 1.5 } }) },
  { kind: 'banana', label: 'バナナ', make: () => ({ q: { fruit: 0.8, vinegar: 0.4 }, contact: { taste: 'sugar', r: 0.7 } }) },
  { kind: 'cake', label: 'ケーキ', make: () => ({ q: { fruit: 1.0 }, contact: { taste: 'sugar', r: 0.7 } }) },
  { kind: 'coffee', label: 'コーヒー', make: () => ({ contact: { taste: 'bitter', r: 0.7 } }) },
  { kind: 'heater', label: 'ヒーター', make: () => ({ warm: { s: 1.0, r: 6 } }) },
  { kind: 'ice', label: '氷', make: () => ({ cold: { s: 1.0, r: 6 } }) },
  {
    kind: 'fan', label: '送風機', directional: true, collider: { r: 0.3, h: 0.9 },
    make: (_x, _z, rot) => ({ wind: { ...dirOf(rot), speed: 4.0, range: 14 } }),
  },
  { kind: 'humidifier', label: '加湿器', make: () => ({ humid: { s: 0.5, r: 6 } }) },
  { kind: 'mold', label: 'カビ箱', make: () => ({ q: { geosmin: 1.3 } }) },
  {
    kind: 'zapper', label: '殺虫器', collider: { r: 0.35, h: 1.5 }, light: { y: 1.2, intensity: 1.3, radius: 13 },
    make: () => ({ zap: { r: 0.8, sec: 4 } }),
  },
  { kind: 'paper', label: 'ハエ取り紙', make: () => ({ q: { fruit: 0.7 }, sticky: { r: 0.7, sec: 6 } }) },
  { kind: 'cone', label: 'コーン', collider: { r: 0.22, h: 0.75 }, make: () => ({}) },
];

export const ITEM_DEF: Record<ItemKind, ItemDef> = Object.fromEntries(ITEM_DEFS.map((d) => [d.kind, d])) as Record<ItemKind, ItemDef>;

/** 置いた物。 */
export interface PlacedItem {
  id: number;
  kind: ItemKind;
  x: number;
  z: number;
  rot: number;
  colliderId: number | null;
  /** world.layout.lights に足した光源（消すとき取り除く）。 */
  lightRef: { x: number; y: number; z: number; intensity: number; radius: number } | null;
}
