"""刺激を与えて回路を回す共通部品。"""
import numpy as np

from .assemble import Assembly, load_params
from .model import CLASSES

STEPS_PER_S = 50


class Sim:
    def __init__(self, A: Assembly, params, net=None):
        self.A, self.params = A, params
        self.net = A.net(params) if net is None else net
        self.sens = np.where(A.cls == CLASSES.index("SENS"))[0]
        self.rec_names = []
        self.rec_idx = []
        for g, (ix, sd) in A.outputs.items():
            if g in ("DNa01", "DNa02", "DNp09", "DNp01"):
                for s, nm in ((0, "L"), (1, "R")):
                    self.rec_names.append(f"{g}_{nm}")
                    self.rec_idx.append(ix[sd == s])
            else:
                self.rec_names.append(g)
                self.rec_idx.append(ix)
        self.kc = np.where(A.cls == CLASSES.index("MB_KC"))[0]
        self.mbon = A.mbon
        self.dan = A.dan

    def stim_vector(self, stim, extra=None):
        """stim: {チャネル: (左, 右)} または {チャネル: x}。正中・不明の細胞は左右の平均。extra: {クラスタ名: (idx, val)}"""
        I = np.zeros(self.A.n)
        for ch, v in stim.items():
            ix, sd = self.A.channels[ch]
            l, r = (v, v) if np.isscalar(v) else v
            amp = self.params["amp"]
            val = np.where(sd == 0, l, np.where(sd == 1, r, 0.5 * (l + r)))
            I[ix] += amp * val
        if extra:
            for ix, val in extra:
                I[ix] += val
        return I

    def run(self, T_s, stim_fn, seed=0, state=None, learn=False, record_kc=False):
        """stim_fn(t_s) -> I_stim (n,) か None。戻り値: dict(rates: (T, n_rec), r_end, d_end, kc_frac, rmax, mbon)"""
        net = self.net
        rng = np.random.default_rng(seed)
        r, d = state if state is not None else net.init_state()
        T = int(round(T_s * STEPS_PER_S))
        rec = np.zeros((T, len(self.rec_idx)))
        mb = np.zeros((T, len(self.mbon)))
        kcf = np.zeros(T)
        rmax = 0.0
        sd = self.params["noise_sd"]
        for t in range(T):
            I = stim_fn(t / STEPS_PER_S) if stim_fn is not None else None
            I = np.zeros(self.A.n) if I is None else I.copy()
            I[self.sens] += rng.normal(0.0, sd, len(self.sens))
            r, d = net.step(r, d, I, learn=learn)
            for j, ix in enumerate(self.rec_idx):
                rec[t, j] = r[ix].mean()
            mb[t] = r[self.mbon]
            kcf[t] = (r[self.kc] > KC_THR).mean()
            rmax = max(rmax, r.max())
        return {"rec": rec, "mbon": mb, "kc_frac": kcf, "rmax": rmax, "state": (r, d)}


KC_THR = 0.05
