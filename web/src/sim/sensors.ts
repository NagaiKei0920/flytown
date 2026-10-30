/**
 * センサ API。脳（M2）が毎 tick 読む入力の型。計算は sensing.ts、ここは型と Field の定義だけ。
 *
 * 座標: x 右、y 上、z 手前（Three.js と同じ）。ハエ人の向き yaw は 0 で +z を向き、増えると左へ回る。
 * 「左右」はハエ人から見た左右。方位角 azimuth は正面 0、左が正。
 */

/** 見つけた物の種類（デバッグ用。脳には使わせない想定）。 */
export const HitKind = { None: 0, Static: 1, Car: 2, Person: 3, FlyPerson: 4 } as const;
export type HitKind = (typeof HitKind)[keyof typeof HitKind];

/** 1 本のレイの結果。 */
export interface RayHit {
  /** 方位角（rad）。正面 0、左が正。 */
  azimuth: number;
  /** 当たるまでの距離（m）。何もなければ maxRange。 */
  distance: number;
  /** 接近速度（m/s）。正は近づいている（自分が進む、または相手が来る）。静止物は自分の速度のレイ方向成分。 */
  approach: number;
  /** looming 量（1/s）= max(0, approach) / max(distance, 0.5)。像の拡大率の近似。光学流の詳細計算はしない。 */
  looming: number;
  kind: HitKind;
}

/** 片目 12 本のレイ。 */
export interface EyeSensors {
  rays: RayHit[];
  /** 12 本の looming の最大。 */
  loomingMax: number;
  /** 12 本の looming の合計。 */
  loomingSum: number;
  /** 12 本のうち最短の距離（m）。 */
  nearest: number;
}

/** 匂いの種類。M4 で拡張してよい。値はすべて 0..1 に正規化した濃さ。 */
export type OdorChannel = 'fermentation' | 'geosmin' | 'co2' | 'sweet' | 'smoke' | 'cva';
export const ODOR_CHANNELS: readonly OdorChannel[] = ['fermentation', 'geosmin', 'co2', 'sweet', 'smoke', 'cva'];

/** 触角の位置での場の値。 */
export interface FieldSample {
  /** 匂いの濃さ 0..1。 */
  odor: Record<OdorChannel, number>;
  /** 暖かさ 0..1（快適温度より高い分）。 */
  warm: number;
  /** 冷たさ 0..1（快適温度より低い分）。 */
  cold: number;
  /** 湿度 0..1。0 乾燥、0.5 中立、1 湿潤。 */
  humidity: number;
  /** 風（m/s）。世界座標の x, z 成分。 */
  wind: { x: number; z: number };
  /** 粉じん 0..1。 */
  dust: number;
  /** 味 0..1。口吻・頭が食べ物から 0.6 m 以内（接触）のときだけ非 0。 */
  taste: { sugar: number; bitter: number; water: number };
  /** 置いた光源・殺虫器などによる追加の明るさ（参考値。目に入る明るさは SensorFrame.light）。 */
  light: number;
}

export function zeroFieldSample(): FieldSample {
  return {
    odor: { fermentation: 0, geosmin: 0, co2: 0, sweet: 0, smoke: 0, cva: 0 },
    warm: 0,
    cold: 0,
    humidity: 0.5,
    wind: { x: 0, z: 0 },
    dust: 0,
    taste: { sugar: 0, bitter: 0, water: 0 },
    light: 0,
  };
}

/**
 * 差し込み式の場（実装は field.ts の TownField）。
 * sample は触角の世界座標 (x, y, z) と時刻 t（秒）から値を返す。selfId を渡すと、そのハエ人自身の cVA は除く。
 */
export interface Field {
  sample(x: number, y: number, z: number, tSec: number, selfId?: number): FieldSample;
}

/** 常に 0（湿度は中立 0.5）を返す空の場。テスト用。 */
export class StubField implements Field {
  sample(_x: number, _y: number, _z: number, _t: number, _selfId?: number): FieldSample {
    return zeroFieldSample();
  }
}

/** 脳へ渡す 1 tick 分の入力。 */
export interface SensorFrame {
  /** 時刻（秒）。シミュレーション内の経過時間。 */
  t: number;
  tick: number;
  /** この tick の長さ（秒）。 */
  dt: number;
  left: EyeSensors;
  right: EyeSensors;
  /**
   * 障害物の多さ 0..1。前方・左・右の扇形に入るレイの距離から、近いほど大きくなる値の平均。
   * 前方は方位角 |a|<35 度、左は 35..125 度、右は -125..-35 度。
   */
  obstacle: { front: number; left: number; right: number };
  /** 左右の目に入る明るさ。日向で約 1、日陰で低く、店の照明の近くで 1 を超える（上限 2）。 */
  light: { left: number; right: number };
  /** 左右の触角位置での場の値。 */
  field: { left: FieldSample; right: FieldSample };
  /** 自分の体の状態（固有感覚。M2 は使っても使わなくてもよい）。 */
  self: {
    x: number;
    z: number;
    yaw: number;
    /** 水平速度の大きさ（m/s）。 */
    speed: number;
    /** 前向きの速度成分（m/s）。後退で負。 */
    forwardSpeed: number;
    /** 旋回の角速度（rad/s）。左が正。 */
    turnRate: number;
    /** 地面からの高さ（m）。 */
    height: number;
    grounded: boolean;
    knockedDown: boolean;
    /** 連続羽ばたき時間（s）。3 で強制着地。 */
    flapSeconds: number;
    /** 羽ばたきが禁止されている（強制着地後、羽ばたきを一度離すまで）。 */
    flapLocked: boolean;
  };
}

/** レイの仕様（定数）。 */
export const SENSOR_SPEC = {
  raysPerEye: 12,
  maxRange: 30,
  /** 目の位置の高さ（m、立っているとき）。 */
  eyeHeight: 1.55,
  /** 左目の方位角の範囲（度）。右目は符号反転。 */
  leftEyeAzimuthDeg: [-30, 150] as const,
  /** 偶数番のレイの仰角と奇数番のレイの仰角（度）。低い物（ベンチ、自転車）も拾うため。 */
  pitchDeg: [-3, -22] as const,
};
