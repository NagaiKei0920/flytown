"""安定化の較正（行動を狙わない）。

  A. 恒常性: 各クラス（後シナプス側）の入力ゲインを、一巡の標準刺激（各チャネルを 1.5 s ずつ）の下での平均発火率が
     目標値に近づくよう乗算更新（0.1〜10 倍に制限）。発散も消失もしない作動点を作る。
  B. KC 疎化: PN>KC と APL>KC の倍率を、匂い入力時に KC の 5〜10 % が発火する値に二分法で決める。
結果は data/circuit/params.json。
"""
import json
import time

import numpy as np

from .assemble import CDIR, Assembly, load_params, save_params
from .model import CLASSES
from .variant import R2
from .sim import KC_THR, Sim

TARGET_RATE = 0.1
TUNE_CLASSES = ["MB_PN", "MB_MBON", "MB_DAN", "LAL", "DN", "MN", "LH", "OTHER"]
EPISODE_S = 1.5
CHANNELS = ["vinegar", "geosmin", "co2", "cva", "fruit", "sugar", "bitter", "water", "heat", "cold", "humid", "dry",
            "wind", "bristle", "ocellar", "lplc2", "lc4", "lplc1", "lc16"]


def standard_run(S, seed=0):
    """各チャネルを両側 1.0 で EPISODE_S 秒ずつ。クラス別の平均発火率（時間平均）と最大値を返す。"""
    vecs = [S.stim_vector({ch: 1.0}) for ch in CHANNELS]
    state = S.run(3.0, None, seed=seed)["state"]
    tot = np.zeros(S.A.n)
    rmax = 0.0
    nstep = 0
    for v in vecs:
        net = S.net
        rng = np.random.default_rng(seed)
        r, d = state
        for t in range(int(EPISODE_S * 50)):
            I = v.copy()
            I[S.sens] += rng.normal(0, S.params["noise_sd"], len(S.sens))
            r, d = net.step(r, d, I, learn=False)
            tot += r
            nstep += 1
            rmax = max(rmax, r.max())
        state = (r, d)
    return tot / nstep, rmax


def class_means(A, rate):
    return {c: float(rate[A.cls == i].mean()) for i, c in enumerate(CLASSES)}


def homeostasis(A, params, iters=16, log=print, classes=None):
    classes = TUNE_CLASSES if classes is None else classes
    params = dict(params)
    params["class_gain"] = dict(params.get("class_gain", {}))
    for it in range(iters):
        S = Sim(A, params)
        rate, rmax = standard_run(S)
        m = class_means(A, rate)
        log(f"  hom {it}: rmax {rmax:.2f} " + " ".join(f"{c}:{m[c]:.3f}" for c in classes))
        for c in classes:
            f = np.clip((TARGET_RATE / (m[c] + 1e-4)) ** 0.3, 0.7, 1.4)
            params["class_gain"][c] = float(np.clip(params["class_gain"].get(c, 1.0) * f, 0.1, 10.0))
    return params


DN_REST_TARGET = 1.0     # DN クラスの静止時発火率の中央値の目標（RMAX の 10 %、tanh の線形域）。docs/consult/004


def dn_rest_median(A, params, warm_s=4.0, meas_s=4.0, seed=3):
    S = Sim(A, params)
    net, rng = S.net, np.random.default_rng(seed)
    r, d = net.init_state()
    acc = np.zeros(A.n)
    for t in range(int((warm_s + meas_s) * 50)):
        I = np.zeros(A.n)
        I[S.sens] += rng.normal(0, params["noise_sd"], len(S.sens))
        r, d = net.step(r, d, I, learn=False)
        if t >= int(warm_s * 50):
            acc += r
    acc /= int(meas_s * 50)
    return float(np.median(acc[A.dn_tonic]))


def tonic_calibrate(A, params, log=print):
    """TONIC -> DN の重みを、DN（DNp01 を除く）の静止時発火率の中央値が DN_REST_TARGET になるよう二分法で決める。"""
    params = dict(params)
    lo, hi = 0.0, 20.0
    for it in range(12):
        mid = 0.5 * (lo + hi)
        params["tonic_w"] = mid
        m = dn_rest_median(A, params)
        log(f"  tonic {it}: w {mid:.3f} DN rest median {m:.3f}")
        if m < DN_REST_TARGET:
            lo = mid
        else:
            hi = mid
    params["tonic_w"] = 0.5 * (lo + hi)
    log(f"  tonic_w = {params['tonic_w']:.3f}, DN rest median {dn_rest_median(A, params):.3f}")
    return params


def kc_fraction(A, params):
    S = Sim(A, params)
    fr = []
    for ch in ["vinegar", "geosmin", "fruit", "cva"]:
        v = S.stim_vector({ch: 1.0})
        res = S.run(3.0, lambda t: v, seed=1)
        fr.append(float(res["kc_frac"][-25:].mean()))
    base = S.run(3.0, None, seed=1)["kc_frac"][-25:].mean()
    return fr, float(base)


def kc_sparsify(A, params, log=print):
    """APL>KC の倍率を対数二分法で。目標: 匂い 4 種の平均が 7.5 %。"""
    params = dict(params)
    params["pair_gain"] = dict(params.get("pair_gain", {}))
    lo, hi = np.log(0.1), np.log(30.0)
    best = None
    for it in range(10):
        mid = 0.5 * (lo + hi)
        params["pair_gain"]["MB_APL>MB_KC"] = float(np.exp(mid))
        fr, base = kc_fraction(A, params)
        m = float(np.mean(fr))
        log(f"  kc {it}: APL>KC {np.exp(mid):.2f} frac {m:.3f} {np.round(fr,3)} base {base:.3f}")
        best = (abs(np.log((m + 1e-4) / 0.075)), dict(params["pair_gain"]), m, fr, base) if best is None or abs(np.log((m + 1e-4) / 0.075)) < best[0] else best
        if m > 0.075:
            lo = mid
        else:
            hi = mid
    params["pair_gain"] = best[1]
    return params, {"kc_frac_by_odor": best[3], "kc_frac_mean": best[2], "kc_frac_baseline": best[4]}


def main(log=print):
    t0 = time.time()
    A = Assembly()
    p = load_params()
    p["class_gain"], p["pair_gain"], p["tuned_gain"], p["tonic_w"] = {}, {}, {}, 0.0
    p = homeostasis(A, p, log=log)
    p, kc = kc_sparsify(A, p, log=log)
    if R2:      # 不採用の実験（docs/consult/004）。r1 は恒常性と KC 疎化だけ
        p = tonic_calibrate(A, p, log=log)
        p = homeostasis(A, p, iters=6, log=log, classes=[c for c in TUNE_CLASSES if c != "DN"])   # DN は静止時の目標で決めた
    else:
        p = homeostasis(A, p, iters=6, log=log)
    p, kc = kc_sparsify(A, p, log=log)
    if R2:
        p = tonic_calibrate(A, p, log=log)
    save_params(p)
    S = Sim(A, p)
    rate, rmax = standard_run(S)
    info = {"class_gain": p["class_gain"], "pair_gain": p["pair_gain"], **({"tonic_w": p["tonic_w"], "dn_rest_median": dn_rest_median(A, p)} if R2 else {}), "kc": kc, "class_mean_rate": class_means(A, rate),
            "rmax_standard_run": rmax, "seconds": time.time() - t0}
    (CDIR / "calib_info.json").write_text(json.dumps(info, indent=1))
    log(json.dumps({k: info[k] for k in ("kc", "rmax_standard_run", "seconds")}))
    return info


if __name__ == "__main__":
    main()
