"""抽出結果 + パラメータ -> Net（重み・クラス・チャネル）。ゲインの掛け方はここが唯一の場所。"""
import json

import numpy as np
import pandas as pd
import scipy.sparse as sp
from scipy.sparse.linalg import eigs

from .common import DATA, FLYBOT, SIGN
from .model import CLASSES, ETA_D, ETA_R, Net, alpha_of
from .variant import R2
from .spec import INPUT_CHANNELS, OUTPUT_GROUPS, select, select_output

CDIR = DATA / ("circuit_r2" if R2 else "circuit")      # r2（不採用の実験）の中間物は別フォルダ
PANEL = {"SENS": "sensory", "MB_KC": "MB", "MB_APL": "MB", "MB_MBON": "MB", "MB_DAN": "MB", "MB_PN": "MB",
         "CX_ring": "CX", "CX_compass": "CX", "CX_PFN": "CX", "CX_FB": "CX", "CX_goal": "CX",
         "LAL": "other", "DN": "DN", "MN": "DN", "LH": "LH", "OTHER": "other"}
DEFAULT_PARAMS = {
    "rho": 1.0,           # 全体の重みの大きさ（シナプス数の入力比に比例する W のスペクトル半径をこの値にする）
    "b_sens": 0.3,          # 感覚ニューロンの自発的な入力（定数バイアス）
    "b_brain": 0.05,        # 感覚以外のニューロンの自発的な入力（定数バイアス。低下も測れるようにするため）
    "amp": 3.0,             # 刺激 1.0 のときの感覚ニューロンへの入力電流
    "noise_sd": 0.05,       # 感覚ニューロンの入力ノイズ（外部入力として加える）
    "class_gain": {},       # 後シナプス側クラスごとの倍率（調整用、0.1〜10）
    "pair_gain": {},        # (前クラス>後クラス) の倍率（KC 疎化の較正用）
    "tonic_w": 0.0,         # TONIC 細胞から DN クラスへの結線の重み（DN の静止時発火率の目標に合わせて較正）
}


def load_params():
    p = dict(DEFAULT_PARAMS)
    f = CDIR / "params.json"
    if f.exists():
        p.update(json.loads(f.read_text()))
    return p


def save_params(p):
    (CDIR / "params.json").write_text(json.dumps(p, indent=1, ensure_ascii=False))


def classify(nr):
    n = len(nr)
    cc = nr["cell_class"].fillna("")
    ct = nr["cell_type"].fillna("")
    fbg = nr["fb_group"].fillna("")
    cls = np.array(["OTHER"] * n, dtype=object)
    cls[(nr["super_class"] == "descending").to_numpy()] = "DN"
    cls[nr["seed_lh"].to_numpy()] = "LH"
    cls[((cc == "ALPN") & (fbg == "MB_PN")).to_numpy()] = "MB_PN"
    cls[(cc == "Kenyon_Cell").to_numpy()] = "MB_KC"
    cls[(cc == "MBON").to_numpy()] = "MB_MBON"
    cls[ct.isin(["APL", "DPM"]).to_numpy()] = "MB_APL"
    cls[cc.isin(["DAN", "MBIN"]).to_numpy() & ~ct.isin(["APL", "DPM"]).to_numpy()] = "MB_DAN"
    for g in ["CX_ring", "CX_compass", "CX_PFN", "CX_FB", "CX_goal", "LAL"]:
        cls[(fbg == g).to_numpy()] = g
    cls[((nr["super_class"] == "motor")).to_numpy()] = "MN"
    cls[nr["seed_in"].to_numpy()] = "SENS"
    return np.array([CLASSES.index(c) for c in cls], np.int32)


def channels_of(nr):
    """入力チャネルごとの (ニューロン番号, 側 0=左 1=右 2=正中/不明)。"""
    out = {}
    side = nr["side"].fillna("").to_numpy()
    sc = np.where(side == "left", 0, np.where(side == "right", 1, 2))
    for ch, rule in INPUT_CHANNELS.items():
        m = select(nr, rule)
        ix = np.where(m)[0]
        out[ch] = (ix.astype(np.int32), sc[ix].astype(np.int8))
    return out


def output_groups(nr, feeding):
    out = {}
    side = nr["side"].fillna("").to_numpy()
    sc = np.where(side == "left", 0, np.where(side == "right", 1, 2))
    for g, pat in OUTPUT_GROUPS.items():
        ix = np.where(select_output(nr, pat))[0]
        out[g] = (ix.astype(np.int32), sc[ix].astype(np.int8))
    ids = set(feeding["root_ids"])
    ix = np.where(nr["root_id"].astype(str).isin(ids).to_numpy())[0]
    out["FEED"] = (ix.astype(np.int32), sc[ix].astype(np.int8))
    return out


def compass_labels(nr):
    lab = [None] * len(nr)
    ct = nr["cell_type"].fillna("").to_numpy()
    sd = nr["side"].fillna("").to_numpy()
    for i in np.where((nr["fb_group"] == "CX_compass").to_numpy())[0]:
        t = ct[i]
        if t == "EPG":
            lab[i] = "EPG"
        elif t == "Delta7":
            lab[i] = "D7"
        elif t == "PEG":
            lab[i] = "PEG"
        elif t.startswith("PEN_a"):
            lab[i] = "PENa_" + sd[i][:1].upper()
        elif t.startswith("PEN_b"):
            lab[i] = "PENb_" + sd[i][:1].upper()
    return lab


def flybot_pair_gain(nr, p, q):
    """flybot の gains.npz（タイプ対ごとの倍率）を、重なるニューロン対に掛ける。倍率の配列と、掛けた結線数。"""
    z = np.load(FLYBOT / "data" / "circuit" / "gains.npz", allow_pickle=True)
    gd = dict(zip([str(x) for x in z["names"]], z["gains"].astype(np.float64)))
    lab = compass_labels(nr)
    fbg = nr["fb_group"].fillna("").to_numpy()
    mbset = {"MB_KC", "MB_PN", "MB_APL", "MB_DAN", "MB_MBON"}
    g = np.ones(len(p))
    cnt = 0
    for e in range(len(p)):
        a, b = p[e], q[e]
        k = None
        if lab[a] is not None and lab[b] is not None:
            k = f"cx:{lab[a]}>{lab[b]}"
        elif fbg[a] in mbset and fbg[b] in mbset:
            k = f"mb:{fbg[a]}>{fbg[b]}"
        if k is not None and k in gd:
            g[e] = gd[k]
            cnt += 1
    return g, cnt


class Assembly:
    """重いもの（読み込み・ゲイン・スペクトル半径）を 1 回だけ計算する。"""

    def __init__(self):
        nr = pd.read_parquet(CDIR / "neurons_raw.parquet")
        z = np.load(CDIR / "edges_raw.npz")
        p0, q0, syn0 = z["pre"], z["post"], z["syn"].astype(np.float64)
        # TONIC: 定数出力の 1 細胞（クラス SENS）。DN クラスへの持続入力（自発発火の代理）を結線で運ぶ。docs/consult/004
        # r1（出荷版）では作らない。r2（不採用の実験）のみ。
        if R2:
            row = {c: (False if nr[c].dtype == bool else (0 if c == "root_id" else None)) for c in nr.columns}
            row.update({"cell_type": "TONIC", "super_class": "sensory", "seed_in": True})
            self.nr = pd.concat([nr, pd.DataFrame([row])], ignore_index=True)
            self.tonic = len(nr)
        else:
            self.nr = nr
            self.tonic = -1
        self.n = len(self.nr)
        self.p, self.q, self.syn = p0, q0, syn0
        self.cls = classify(self.nr)
        nt = self.nr["top_nt"].map(lambda x: SIGN.get(x, 1) if isinstance(x, str) else 1).to_numpy().astype(np.float64)
        nt[self.nr["seed_in"].to_numpy()] = 1.0          # 感覚細胞は全てコリン作動性（注釈の予測が不安定）なので興奮性に固定
        self.sign = nt
        tot = np.bincount(self.q, weights=self.syn, minlength=self.n)
        self.base_frac = self.syn / np.maximum(tot[self.q], 1.0)
        self.fb_gain, self.fb_gain_n = flybot_pair_gain(self.nr, self.p, self.q)
        # 持続入力の結線（DN クラス、巨大線維 DNp01 を除く）。ここから先の結線配列に足す（入力比・スペクトル半径には入れない）
        ctype = self.nr["cell_type"].fillna("").to_numpy()
        if R2:
            self.dn_tonic = np.where((self.cls == CLASSES.index("DN")) & (ctype != "DNp01"))[0]
            ne0 = len(self.p)
            self.p = np.concatenate([self.p, np.full(len(self.dn_tonic), self.tonic, np.int32)])
            self.q = np.concatenate([self.q, self.dn_tonic.astype(np.int32)])
            self.syn = np.concatenate([self.syn, np.ones(len(self.dn_tonic))])
            self.base_frac = np.concatenate([self.base_frac, np.zeros(len(self.dn_tonic))])
            self.fb_gain = np.concatenate([self.fb_gain, np.ones(len(self.dn_tonic))])
            self.tonic_edges = np.arange(ne0, len(self.p))
        else:
            self.dn_tonic = np.zeros(0, np.int64)
            self.tonic_edges = np.zeros(0, np.int64)
        self.cls_p, self.cls_q = self.cls[self.p], self.cls[self.q]
        W = sp.csr_matrix((self.base_frac * self.sign[self.p], (self.q, self.p)), shape=(self.n, self.n))   # 持続入力の結線は base_frac = 0
        v = eigs(W, k=1, which="LM", return_eigenvectors=False, tol=1e-6, maxiter=5000, v0=np.ones(self.n))
        self.rho_raw = float(np.abs(v[0]))
        self.channels = channels_of(self.nr)
        self.feeding = json.loads((CDIR / "feeding.json").read_text())
        self.outputs = output_groups(self.nr, self.feeding)
        order = np.lexsort((self.p, self.q))            # post 行優先、行内は pre 昇順
        self.order = order
        self.mbon = np.where(self.cls == CLASSES.index("MB_MBON"))[0]
        self.dan = np.where(self.cls == CLASSES.index("MB_DAN"))[0]

    def weights(self, params):
        """結線ごとの float64 重み（符号・全ゲイン込み）。"""
        w = self.base_frac * self.sign[self.p] * (params["rho"] / self.rho_raw) * self.fb_gain
        cg = np.ones(len(CLASSES))
        for k, v in params.get("class_gain", {}).items():
            cg[CLASSES.index(k)] *= v
        w = w * cg[self.cls_q]
        # 調整用ゲイン（最大 20 個）。キー: "cls:<クラス>" / "out:<出力群>"（後シナプス側）, "ch:<入力チャネル>"（前シナプス側）,
        # "inh:out:<出力群>" / "exc:out:<出力群>"（その群へ入る抑制性/興奮性の前細胞からの結線だけ）
        for k, v in params.get("tuned_gain", {}).items():
            parts = k.split(":")
            sel = np.ones(len(w), bool)
            if parts[0] in ("inh", "exc"):
                sel &= (self.sign[self.p] < 0) if parts[0] == "inh" else (self.sign[self.p] > 0)
                parts = parts[1:]
            kind, name = parts
            if kind == "cls":
                sel &= self.cls_q == CLASSES.index(name)
            elif kind == "out":
                m = np.zeros(self.n, bool)
                m[self.outputs[name][0]] = True
                sel &= m[self.q]
            elif kind == "ch":
                m = np.zeros(self.n, bool)
                m[self.channels[name][0]] = True
                sel &= m[self.p]
            else:
                raise ValueError(k)
            w = np.where(sel, w * v, w)
        for k, v in params["pair_gain"].items():
            a, b = k.split(">")
            m = (self.cls_p == CLASSES.index(a)) & (self.cls_q == CLASSES.index(b))
            w = np.where(m, w * v, w)
        if R2:
            w[self.tonic_edges] = params.get("tonic_w", 0.0)      # 持続入力は全てのゲインのあとで決める（ゲインは掛けない）
        return w

    def net(self, params, w=None):
        w = self.weights(params) if w is None else w
        o = self.order
        indptr = np.concatenate([[0], np.cumsum(np.bincount(self.q, minlength=self.n))]).astype(np.int32)
        indices = self.p[o].astype(np.int32)
        w32 = w[o].astype(np.float32)
        kc, mb = CLASSES.index("MB_KC"), CLASSES.index("MB_MBON")
        pl = np.where((self.cls_p[o] == kc) & (self.cls_q[o] == mb))[0].astype(np.int32)
        mpos = -np.ones(self.n, np.int64)
        mpos[self.mbon] = np.arange(len(self.mbon))
        dpos = -np.ones(self.n, np.int64)
        dpos[self.dan] = np.arange(len(self.dan))
        D = np.zeros((len(self.mbon), len(self.dan)))
        for a, b, s in zip(self.p, self.q, self.syn):
            if dpos[a] >= 0 and mpos[b] >= 0:
                D[mpos[b], dpos[a]] += s
        rs = D.sum(1, keepdims=True)
        D = np.where(rs > 0, D / np.maximum(rs, 1e-9), 0.0)
        bias = np.zeros(self.n)
        bias[:] = params["b_brain"]
        bias[self.cls == CLASSES.index("SENS")] = params["b_sens"]
        return Net(n=self.n, indptr=indptr, indices=indices, w32=w32, cls=self.cls, bias=bias, alpha=alpha_of(self.cls),
                   pl_edge=pl, pl_pre=indices[pl], pl_post=self.q[o][pl].astype(np.int32), pl_mbon=mpos[self.q[o][pl]],
                   dan_idx=self.dan, D=D, mbon_idx=self.mbon, eta_d=params.get("eta_d", ETA_D), eta_r=params.get("eta_r", ETA_R))
