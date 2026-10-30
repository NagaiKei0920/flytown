/**
 * circuit.bin / meta.json の読み込み。docs/MODEL.md 1 章。
 * 重みは Float32Array のまま保持する（計算時に float64 へ広がる）。バッファのコピーはしない。
 */

export interface ChannelCells {
  left: number[];
  right: number[];
  mid: number[];
}

/** meta.json のうち使う部分。 */
export interface CircuitMeta {
  N: number;
  E: number;
  dt: number;
  substeps: number;
  rmax: number;
  classes: string[];
  alpha_by_class: number[];
  neuron_class: number[];
  bias: { sens: number; brain: number };
  input: { amp: number; noise_sd: number; channels: Record<string, ChannelCells> };
  output: Record<string, ChannelCells>;
  dan: { pam: number[]; ppl1: number[]; all: number[] };
  plastic: {
    edge: number[];
    pre: number[];
    post: number[];
    mbon_of_edge: number[];
    mbon: number[];
    dan: number[];
    D_rows: number[];
    D_cols: number[];
    D_vals: number[];
    eta_d: number;
    eta_r: number;
    d_min: number;
    n_mbon: number;
    mbon_valence: number[];
  };
  readout: {
    K: number;
    V0: number;
    W_A01: number;
    W_P9?: number;
    SD_FLOOR: number;
    SD_REL: number;
    rec_names: string[];
    mu: number[];
    sd: number[];
  };
  panel: { names: string[]; index: number[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface Circuit {
  N: number;
  E: number;
  indptr: Int32Array;
  indices: Int32Array;
  weights: Float32Array;
  meta: CircuitMeta;
}

export function parseCircuit(buf: ArrayBuffer, meta: CircuitMeta): Circuit {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'FTC1') throw new Error(`circuit.bin: bad magic ${magic}`);
  const N = dv.getUint32(4, true);
  const E = dv.getUint32(8, true);
  const off0 = 12;
  const indptr = new Int32Array(buf, off0, N + 1);
  const indices = new Int32Array(buf, off0 + 4 * (N + 1), E);
  const weights = new Float32Array(buf, off0 + 4 * (N + 1) + 4 * E, E);
  if (N !== meta.N || E !== meta.E) throw new Error(`circuit.bin / meta.json mismatch: ${N},${E} vs ${meta.N},${meta.E}`);
  if (indptr[N] !== E) throw new Error('circuit.bin: indptr[N] != E');
  return { N, E, indptr, indices, weights, meta };
}

/** baseUrl は Vite の import.meta.env.BASE_URL（末尾スラッシュ付き）。 */
export async function loadCircuit(baseUrl: string): Promise<Circuit> {
  const dir = `${baseUrl}circuit/`;
  const [mr, br] = await Promise.all([fetch(`${dir}meta.json`), fetch(`${dir}circuit.bin`)]);
  if (!mr.ok || !br.ok) throw new Error(`circuit fetch failed: meta ${mr.status}, bin ${br.status}`);
  const meta = (await mr.json()) as CircuitMeta;
  return parseCircuit(await br.arrayBuffer(), meta);
}
