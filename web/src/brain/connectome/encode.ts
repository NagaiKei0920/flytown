/**
 * SensorFrame -> 入力チャネルの刺激量（左右 0..1）。docs/MODEL.md 8 章の表がこの実装の仕様。
 * 出力は Float32Array[2 * CHANNEL_NAMES.length]、チャネル c の左が [2c]、右が [2c+1]。
 * 雑音（MODEL.md 4 章）は感覚ニューロンごとに必要なので、ここではなく batch.ts が加える。
 */
import type { EyeSensors, SensorFrame } from '../../sim/sensors.ts';

/** meta.input.channels の並び（回路を作り直して並びが変わったら batch.ts の起動時検査で落ちる）。 */
export const CHANNEL_NAMES = [
  'vinegar', 'geosmin', 'co2', 'cva', 'fruit', 'sugar', 'bitter', 'water', 'heat', 'cold',
  'humid', 'dry', 'wind', 'bristle', 'ocellar', 'lplc2', 'lc4', 'lplc1', 'lc16',
] as const;
export type ChannelName = (typeof CHANNEL_NAMES)[number];
export const CHANNEL_INDEX: Record<string, number> = Object.fromEntries(CHANNEL_NAMES.map((n, i) => [n, i]));
export const STIM_LEN = CHANNEL_NAMES.length * 2;

/** 調整できる定数。意味は MODEL.md 8 章。 */
export const ENCODE = {
  /**
   * 迫る物（LPLC2・LC4）: 像の拡大 x = g(size) * expansion（rad/s、レイごと、片目で最大）に、しきい値のある S 字 s = x^n / (x^n + K^n)。
   * g(size) = 1 / (1 + (size / sizeC)^4)。size = 当たった物の見かけの角度（度）。視野を埋める壁・建物は g が 0 に近く、小さな物だけ通す。
   * LPLC2 は中くらいの物の拡大（sizeC 45 度、K 0.25 rad/s）、LC4 は小さく速い拡大（sizeC 25 度、K 0.4 rad/s）。
   */
  loomLplc2: { sizeC: 45, K: 0.25, n: 2 },
  loomLc4: { sizeC: 25, K: 0.4, n: 2 },
  /** 単眼: s = min(1, max(0, 明るさ - 自分の平均) / ocellarFull)。平均は時定数 ocellarTau 秒の移動平均（順応）。 */
  ocellarFull: 1.0,
  ocellarTau: 5.0,
  /** 風: s = min(1, |w| / windFull)。 */
  windFull: 5.0,
  /** 湿度の中立点。これより高い分が humid、低い分が dry。 */
  humidNeutral: 0.5,
};

/** 単眼の順応の状態（ハエ人ごとに 1 つ）。自分の左右それぞれの明るさの、ゆっくりした移動平均。 */
export class EncodeState {
  avgL = NaN;
  avgR = NaN;
}

const sat01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

const RAD2DEG = 180 / Math.PI;
/** 片目の 12 本のレイから、拡大の駆動 s = hill(max_i g(size_i) * expansion_i) を作る。 */
function loomDrive(eye: EyeSensors, p: { sizeC: number; K: number; n: number }): number {
  let m = 0;
  for (const r of eye.rays) {
    if (r.expansion <= 0) continue;
    const q = (r.size * RAD2DEG) / p.sizeC;
    const x = r.expansion / (1 + q * q * q * q);
    if (x > m) m = x;
  }
  if (m <= 0) return 0;
  const a = Math.pow(m, p.n);
  return a / (a + Math.pow(p.K, p.n));
}

function set(out: Float32Array, ch: ChannelName, l: number, r: number): void {
  const c = CHANNEL_INDEX[ch] * 2;
  out[c] = sat01(l);
  out[c + 1] = sat01(r);
}

export function encodeSensors(f: SensorFrame, out: Float32Array, st?: EncodeState): void {
  const L = f.field.left;
  const R = f.field.right;
  // 匂い
  set(out, 'vinegar', L.odor.fermentation, R.odor.fermentation);
  set(out, 'geosmin', L.odor.geosmin, R.odor.geosmin);
  set(out, 'co2', L.odor.co2, R.odor.co2);
  set(out, 'cva', L.odor.cva, R.odor.cva);
  set(out, 'fruit', L.odor.sweet, R.odor.sweet);
  // 味
  set(out, 'sugar', L.taste.sugar, R.taste.sugar);
  set(out, 'bitter', L.taste.bitter, R.taste.bitter);
  set(out, 'water', L.taste.water, R.taste.water);
  // 温度・湿度
  set(out, 'heat', L.warm, R.warm);
  set(out, 'cold', L.cold, R.cold);
  const hn = ENCODE.humidNeutral;
  // 中立（0.5）で humid = dry = 0。humid = max(0, h - 0.5) * 2、dry = max(0, 0.5 - h) * 2。
  set(out, 'humid', (L.humidity - hn) / (1 - hn), (R.humidity - hn) / (1 - hn));
  set(out, 'dry', (hn - L.humidity) / hn, (hn - R.humidity) / hn);
  // 風: 世界座標の風ベクトルを体の左右に分ける。真横から来ると風上側だけ、正面・背面から来ると左右同じ。
  const wx = L.wind.x * 0.5 + R.wind.x * 0.5;
  const wz = L.wind.z * 0.5 + R.wind.z * 0.5;
  const sp = Math.hypot(wx, wz);
  if (sp > 1e-6) {
    const yaw = f.self.yaw;
    const a = (wx * Math.cos(yaw) - wz * Math.sin(yaw)) / sp; // 風の向きの「左向き」成分。-1 = 左から吹いて右へ抜ける
    const m = sat01(sp / ENCODE.windFull);
    set(out, 'wind', m * (0.5 - 0.5 * a), m * (0.5 + 0.5 * a));
  } else set(out, 'wind', 0, 0);
  // 粉じん（頭の剛毛）
  set(out, 'bristle', L.dust, R.dust);
  // 光（単眼）: 順応した明るさの差。一定の環境光は 0 に落ち、明るさの変化と左右差だけが入る。
  // 左右それぞれ自分の移動平均（順応）を引く。左右で一定の差（太陽に向いたとき等）も順応で 0 に落ちる。
  let aL = f.light.left;
  let aR = f.light.right;
  if (st) {
    if (Number.isNaN(st.avgL)) { st.avgL = aL; st.avgR = aR; }
    const k = 1 - Math.exp(-f.dt / ENCODE.ocellarTau);
    st.avgL += (f.light.left - st.avgL) * k;
    st.avgR += (f.light.right - st.avgR) * k;
    aL = st.avgL;
    aR = st.avgR;
  } else {
    aL = aR = 0.5 * (f.light.left + f.light.right);
  }
  const oc = (b: number, a: number) => Math.max(0, b - a) / ENCODE.ocellarFull;
  set(out, 'ocellar', oc(f.light.left, aL), oc(f.light.right, aR));
  // 迫る物
  set(out, 'lplc2', loomDrive(f.left, ENCODE.loomLplc2), loomDrive(f.right, ENCODE.loomLplc2));
  set(out, 'lc4', loomDrive(f.left, ENCODE.loomLc4), loomDrive(f.right, ENCODE.loomLc4));
  // 障害物の多さ: 左目は左 + 前、右目は右 + 前の平均
  const o = f.obstacle;
  set(out, 'lplc1', 0.5 * (o.left + o.front), 0.5 * (o.right + o.front));
  set(out, 'lc16', 0.5 * (o.left + o.front), 0.5 * (o.right + o.front));
}
