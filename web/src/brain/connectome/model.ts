/**
 * 発火率モデルと KC -> MBON の 3 要素則（docs/MODEL.md 2〜5 章）。
 * 状態は float64。重みは共有の Float32Array。1 ステップあたりの配列確保は無い。
 */
import type { Circuit } from './circuit.ts';

/** 回路から作る共有の（読み取り専用の）データ。 */
export class Net {
  readonly N: number;
  readonly indptr: Int32Array;
  readonly indices: Int32Array;
  readonly weights: Float32Array;
  readonly alpha: Float64Array;
  readonly bias: Float64Array;
  readonly rmax: number;
  readonly dt: number;
  readonly substeps: number;
  // 可塑的結線
  readonly ne: number;
  readonly plPre: Int32Array;
  readonly plPost: Int32Array;
  readonly plMbon: Int32Array;
  readonly plW0: Float64Array;
  readonly danIdx: Int32Array;
  readonly nMbon: number;
  readonly dPtr: Int32Array;
  readonly dCol: Int32Array;
  readonly dVal: Float64Array;
  readonly etaD: number;
  readonly etaR: number;
  readonly dMin: number;

  constructor(c: Circuit) {
    const m = c.meta;
    this.N = c.N;
    this.indptr = c.indptr;
    this.indices = c.indices;
    this.weights = c.weights;
    this.rmax = m.rmax;
    this.dt = m.dt;
    this.substeps = m.substeps;
    this.alpha = new Float64Array(c.N);
    this.bias = new Float64Array(c.N);
    const sens = m.classes.indexOf('SENS');
    for (let i = 0; i < c.N; i++) {
      const k = m.neuron_class[i];
      this.alpha[i] = m.alpha_by_class[k];
      this.bias[i] = k === sens ? m.bias.sens : m.bias.brain;
    }
    const p = m.plastic;
    this.ne = p.edge.length;
    this.plPre = Int32Array.from(p.pre);
    this.plPost = Int32Array.from(p.post);
    this.plMbon = Int32Array.from(p.mbon_of_edge);
    this.plW0 = new Float64Array(this.ne);
    for (let e = 0; e < this.ne; e++) this.plW0[e] = c.weights[p.edge[e]];
    this.danIdx = Int32Array.from(p.dan);
    this.nMbon = p.n_mbon;
    // D を行 CSR へ
    const nnz = p.D_rows.length;
    this.dPtr = new Int32Array(p.n_mbon + 1);
    for (let j = 0; j < nnz; j++) this.dPtr[p.D_rows[j] + 1]++;
    for (let m2 = 0; m2 < p.n_mbon; m2++) this.dPtr[m2 + 1] += this.dPtr[m2];
    this.dCol = new Int32Array(nnz);
    this.dVal = new Float64Array(nnz);
    const fill = this.dPtr.slice(0, p.n_mbon);
    for (let j = 0; j < nnz; j++) {
      const row = p.D_rows[j];
      const pos = fill[row]++;
      this.dCol[pos] = p.D_cols[j];
      this.dVal[pos] = p.D_vals[j];
    }
    this.etaD = p.eta_d;
    this.etaR = p.eta_r;
    this.dMin = p.d_min;
  }
}

/** エージェントごとの状態と作業領域。 */
export class BrainState {
  r: Float64Array;
  /** 次のサブステップの書き込み先（r と入れ替えて使う）。 */
  rn: Float64Array;
  d: Float64Array;
  readonly drive: Float64Array;
  readonly g: Float64Array;

  constructor(net: Net) {
    this.r = new Float64Array(net.N);
    this.rn = new Float64Array(net.N);
    this.d = new Float64Array(net.ne);
    this.drive = new Float64Array(net.N);
    this.g = new Float64Array(net.nMbon);
  }

  reset(): void {
    this.r.fill(0);
    this.d.fill(0);
  }

  copyFrom(o: BrainState): void {
    this.r.set(o.r);
    this.d.set(o.d);
  }
}

/**
 * 疎行列の積 drive = W r + bias + I を、1・2・4 体まとめて行う（行列の index / weight の読みと、
 * 同じ行の足し算の連鎖を体の間で共有する）。r の和の順序は体数によらず同じ（行内の昇順）。
 */
function spmv1(net: Net, r0: Float64Array, I0: Float64Array, d0: Float64Array): void {
  const N = net.N, ip = net.indptr, ix = net.indices, w = net.weights, bias = net.bias;
  let k = ip[0];
  for (let i = 0; i < N; i++) {
    const e = ip[i + 1];
    let a = bias[i] + I0[i];
    for (; k < e; k++) a += w[k] * r0[ix[k]];
    d0[i] = a;
  }
}

function spmv2(net: Net, r0: Float64Array, r1: Float64Array, I0: Float64Array, I1: Float64Array, d0: Float64Array, d1: Float64Array): void {
  const N = net.N, ip = net.indptr, ix = net.indices, w = net.weights, bias = net.bias;
  let k = ip[0];
  for (let i = 0; i < N; i++) {
    const e = ip[i + 1];
    const b = bias[i];
    let a0 = b + I0[i], a1 = b + I1[i];
    for (; k < e; k++) {
      const j = ix[k], ww = w[k];
      a0 += ww * r0[j];
      a1 += ww * r1[j];
    }
    d0[i] = a0; d1[i] = a1;
  }
}

function spmv4(
  net: Net,
  r0: Float64Array, r1: Float64Array, r2: Float64Array, r3: Float64Array,
  I0: Float64Array, I1: Float64Array, I2: Float64Array, I3: Float64Array,
  d0: Float64Array, d1: Float64Array, d2: Float64Array, d3: Float64Array,
): void {
  const N = net.N, ip = net.indptr, ix = net.indices, w = net.weights, bias = net.bias;
  let k = ip[0];
  for (let i = 0; i < N; i++) {
    const e = ip[i + 1];
    const b = bias[i];
    let a0 = b + I0[i], a1 = b + I1[i], a2 = b + I2[i], a3 = b + I3[i];
    for (; k < e; k++) {
      const j = ix[k], ww = w[k];
      a0 += ww * r0[j];
      a1 += ww * r1[j];
      a2 += ww * r2[j];
      a3 += ww * r3[j];
    }
    d0[i] = a0; d1[i] = a1; d2[i] = a2; d3[i] = a3;
  }
}

/** サブステップの後半: 可塑項を足し、r <- r + alpha (phi(drive) - r)。r と rn を入れ替える。 */
function finishSubstep(net: Net, st: BrainState): void {
  const N = net.N, alpha = net.alpha, drive = st.drive, d = st.d, r = st.r, rn = st.rn;
  const rmax = net.rmax;
  const ne = net.ne, plPre = net.plPre, plPost = net.plPost, plW0 = net.plW0;
  for (let e = 0; e < ne; e++) drive[plPost[e]] += plW0[e] * d[e] * r[plPre[e]];
  // phi(x) = rmax tanh(max(x,0)/rmax)。Math.tanh / Math.exp は 1 回 20 ns 前後で、このループの大半を占めるので、
  // y = x/rmax < 0.25 は tanh の級数（13 次、打ち切り誤差 5e-10 x rmax 未満）、それ以上は 1 - 2/(exp(2y)+1)（誤差 1e-16 程度）。
  const k1 = 1 / rmax;
  const k2 = 2 / rmax;
  const lim = 0.25 * rmax;
  for (let i = 0; i < N; i++) {
    const x = drive[i];
    const ri = r[i];
    let t: number;
    if (x <= 0) {
      // 駆動が無いと r は指数的に 0 へ減る。非正規化数（遅い）にならないよう 1e-20 未満は 0 にする（影響 < 1e-20）。
      rn[i] = ri < 1e-20 ? 0 : ri - alpha[i] * ri;
      continue;
    } else if (x < lim) {
      const y = x * k1;
      const y2 = y * y;
      t = rmax * y * (1 + y2 * (-1 / 3 + y2 * (2 / 15 + y2 * (-17 / 315 + y2 * (62 / 2835 + y2 * (-1382 / 155925 + y2 * (21844 / 6081075)))))));
    } else t = rmax * (1 - 2 / (Math.exp(x * k2) + 1));
    rn[i] = ri + alpha[i] * (t - ri);
  }
  st.r = rn;
  st.rn = r;
}

function learnStep(net: Net, st: BrainState): void {
  const ne = net.ne;
  if (ne === 0) return;
  const r = st.r, d = st.d, g = st.g;
  const dPtr = net.dPtr, dCol = net.dCol, dVal = net.dVal, dan = net.danIdx;
  for (let m = 0; m < net.nMbon; m++) {
    let a = 0;
    for (let j = dPtr[m]; j < dPtr[m + 1]; j++) a += dVal[j] * r[dan[dCol[j]]];
    g[m] = a;
  }
  const plMbon = net.plMbon, plPre = net.plPre;
  const dt = net.dt, eD = net.etaD, eR = net.etaR, dMin = net.dMin;
  for (let e = 0; e < ne; e++) {
    const de = d[e];
    const gate = g[plMbon[e]] * r[plPre[e]];
    const v = de + dt * (-eD * gate * (1 + de) - eR * de);
    d[e] = v < dMin ? dMin : v;
  }
}

/** 複数体を 1 ステップ（20 ms）進める。Is[i] はステップ内で一定の入力電流。 */
export function stepBrains(net: Net, sts: BrainState[], Is: Float64Array[], learn: boolean): void {
  const n = sts.length;
  for (let s = 0; s < net.substeps; s++) {
    let i = 0;
    while (i < n) {
      const left = n - i;
      if (left >= 4) {
        const a = sts[i], b = sts[i + 1], c = sts[i + 2], d = sts[i + 3];
        spmv4(net, a.r, b.r, c.r, d.r, Is[i], Is[i + 1], Is[i + 2], Is[i + 3], a.drive, b.drive, c.drive, d.drive);
        finishSubstep(net, a); finishSubstep(net, b); finishSubstep(net, c); finishSubstep(net, d);
        i += 4;
      } else if (left >= 2) {
        const a = sts[i], b = sts[i + 1];
        spmv2(net, a.r, b.r, Is[i], Is[i + 1], a.drive, b.drive);
        finishSubstep(net, a); finishSubstep(net, b);
        i += 2;
      } else {
        const a = sts[i];
        spmv1(net, a.r, Is[i], a.drive);
        finishSubstep(net, a);
        i += 1;
      }
    }
  }
  if (learn) for (let i = 0; i < n; i++) learnStep(net, sts[i]);
}

/** 1 体を 1 ステップ（20 ms）進める。 */
export function stepBrain(net: Net, st: BrainState, I: Float64Array, learn: boolean): void {
  stepBrains(net, [st], [I], learn);
}
