/**
 * 読み出し（docs/MODEL.md 6 章）: DN 群の平均発火率 -> z 化 -> 体の命令。
 * 係数は meta.readout から読む。式を変えるときは readoutCommands だけ直す。
 */
import type { CircuitMeta } from './circuit.ts';

export interface ReadoutCommands {
  forward: number;
  backward: number;
  turn: number;
  escape: number;
  flap: number;
  groom: number;
  feed: number;
}

/** rec_names の各名前 -> 細胞番号の配列。`X_L` `X_R` は片側、接尾辞なしは左右+正中の全細胞。 */
export function buildRecGroups(meta: CircuitMeta): Int32Array[] {
  return meta.readout.rec_names.map((nm) => {
    const m = /^(.*)_([LR])$/.exec(nm);
    if (m && meta.output[m[1]]) {
      const g = meta.output[m[1]];
      return Int32Array.from(m[2] === 'L' ? g.left : g.right);
    }
    const g = meta.output[nm];
    if (!g) throw new Error(`readout: unknown group ${nm}`);
    return Int32Array.from([...g.left, ...g.right, ...g.mid]);
  });
}

export function groupMeans(groups: Int32Array[], r: Float64Array, out: Float64Array): void {
  for (let g = 0; g < groups.length; g++) {
    const ix = groups[g];
    let a = 0;
    for (let j = 0; j < ix.length; j++) a += r[ix[j]];
    out[g] = a / ix.length;
  }
}

const clip = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * 唯一の写像関数。means は rec_names の順の平均発火率。z は同じ順で出力（脳パネル用）。
 * Python 側（pipeline/readout.py）が式を変えたらここだけ更新する。
 */
export function readoutCommands(meta: CircuitMeta, means: Float64Array, z: Float64Array, out: ReadoutCommands): void {
  const ro = meta.readout;
  const names = ro.rec_names;
  for (let i = 0; i < names.length; i++) z[i] = (means[i] - ro.mu[i]) / Math.max(ro.sd[i], ro.SD_FLOOR, ro.SD_REL * ro.mu[i]);
  const zi = (nm: string) => z[names.indexOf(nm)];
  const K = ro.K;
  const zp9 = 0.5 * (zi('DNp09_L') + zi('DNp09_R'));
  const zmdn = zi('MDN');
  out.forward = clip(ro.V0 + K * (zp9 - zmdn), 0, 1);
  out.backward = clip(K * zmdn, 0, 1);
  const wP9 = ro.W_P9 ?? 0;
  out.turn = clip(K * (zi('DNa02_L') - zi('DNa02_R') + ro.W_A01 * (zi('DNa01_L') - zi('DNa01_R')) + wP9 * (zi('DNp09_L') - zi('DNp09_R'))), -1, 1);
  out.escape = clip(K * 0.5 * (zi('DNp01_L') + zi('DNp01_R')), 0, 1);
  out.flap = clip(K * zi('DNg02'), 0, 1);
  out.groom = clip(K * 0.5 * (zi('DNg11') + zi('DNg12')), 0, 1);
  out.feed = clip(K * zi('FEED'), 0, 1);
}

export function newReadoutCommands(): ReadoutCommands {
  return { forward: 0, backward: 0, turn: 0, escape: 0, flap: 0, groom: 0, feed: 0 };
}

/**
 * ReadoutCommands -> BodyCommand の 5 値。後退は前進から引き（MDN が上がると前進が下がり後退が上がる）、
 * 羽ばたきは DNg02 と DNp01（巨大線維）の大きい方（SPEC 5.3: DNp01 + DNg02 系 -> 羽ばたき・跳躍）。
 */
export function toBody(c: ReadoutCommands, out: Float64Array, o = 0): void {
  out[o] = clip(c.forward - c.backward, -1, 1);
  out[o + 1] = c.turn;
  out[o + 2] = Math.max(c.flap, c.escape);
  out[o + 3] = c.groom;
  out[o + 4] = c.feed;
}
