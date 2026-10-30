"""発火率モデル（numpy, float64 計算、重みは float32 に丸めた値）。docs/MODEL.md が正。

状態 r (N,) float64。1 ステップ = 20 ms（50 Hz）= 2 サブステップ x 10 ms。
  サブステップ: drive = W r + b + I + extra(r, d)
                r <- r + alpha * (phi(drive) - r)         alpha_i = 1 - exp(-0.01 / tau_i)
                phi(x) = RMAX * tanh(max(x, 0) / RMAX)
  入力 I はステップ内で一定。ステップ末に KC->MBON の変化分 d を更新する。
"""
from dataclasses import dataclass, field

import numpy as np
import scipy.sparse as sp

DT_STEP = 0.02
SUBSTEPS = 2
DT_SUB = DT_STEP / SUBSTEPS
RMAX = 10.0
# 3 要素則の定数（flybot plasticity.py と同形。ETA_D は FLYTOWN で 50 Hz・数秒の対提示に合わせて再設定）
ETA_D = 1.0       # [1/s]
ETA_R = 0.05      # [1/s]

TAU_MS = {
    "SENS": 20.0, "MB_KC": 20.0, "MB_APL": 30.0, "MB_MBON": 50.0, "MB_DAN": 200.0, "MB_PN": 20.0,
    "CX_ring": 50.0, "CX_compass": 50.0, "CX_PFN": 50.0, "CX_FB": 100.0, "CX_goal": 300.0,
    "LAL": 30.0, "DN": 30.0, "MN": 30.0, "LH": 30.0, "OTHER": 20.0,
}
CLASSES = list(TAU_MS)


def phi(x):
    return RMAX * np.tanh(np.maximum(x, 0.0) / RMAX)


@dataclass
class Net:
    """読み込んだ回路。W は post 行の CSR（indices = pre）。"""
    n: int
    indptr: np.ndarray
    indices: np.ndarray
    w32: np.ndarray            # float32 の重み（符号・ゲイン込み）
    cls: np.ndarray            # (n,) CLASSES の添字
    bias: np.ndarray           # (n,) float64
    alpha: np.ndarray          # (n,) float64
    pl_edge: np.ndarray        # 可塑的結線の CSR 位置 (ne,)
    pl_pre: np.ndarray
    pl_post: np.ndarray
    pl_mbon: np.ndarray        # 結線ごとの MBON 番号 (0..n_mbon-1)
    dan_idx: np.ndarray        # DAN のニューロン番号
    D: np.ndarray              # (n_mbon, n_dan) 行和 1
    mbon_idx: np.ndarray
    eta_d: float = ETA_D
    eta_r: float = ETA_R
    W: sp.csr_matrix = field(init=False, repr=False)

    def __post_init__(self):
        self.W = sp.csr_matrix((self.w32.astype(np.float64), self.indices, self.indptr), shape=(self.n, self.n))
        self.pl_w0 = self.w32[self.pl_edge].astype(np.float64)

    def init_state(self):
        return np.zeros(self.n), np.zeros(len(self.pl_edge))

    def step(self, r, d, I, learn=True):
        """1 ステップ（20 ms）進める。r, d は上書きせず新しい配列を返す。I: (n,) float64。"""
        for _ in range(SUBSTEPS):
            drive = self.W @ r + self.bias + I
            if len(self.pl_edge):
                ex = np.bincount(self.pl_post, weights=self.pl_w0 * d * r[self.pl_pre], minlength=self.n)
                drive = drive + ex
            r = r + self.alpha * (phi(drive) - r)
        if learn and len(self.pl_edge):
            g = self.D @ r[self.dan_idx]                       # (n_mbon,)
            gate = g[self.pl_mbon] * r[self.pl_pre]
            d = d + DT_STEP * (-self.eta_d * gate * (1.0 + d) - self.eta_r * d)
            d = np.maximum(d, -1.0)
        return r, d


def alpha_of(cls):
    tau = np.array([TAU_MS[CLASSES[c]] for c in cls]) * 1e-3
    return 1.0 - np.exp(-DT_SUB / tau)
