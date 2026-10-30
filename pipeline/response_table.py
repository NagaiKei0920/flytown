"""刺激応答表（12 項目 + 学習 13）。

各刺激: 暖機 3 s（記録せず）-> ベースライン 2 s -> 刺激 2 s。10 シード（入力ノイズのシード）。片側刺激は 左 1.0 / 右 0.2。
判定: 期待方向の命令の変化 delta（刺激窓の平均 - ベースライン窓の平均）が MIN_EFFECT 以上、
      z = delta / max(ベースライン窓の命令の SD, 0.02) が 2 以上、かつシードの 80 % 以上で符号一致。
左右の項目（1・2・3・6・7）の turn は「左強 - 右強」の差で採点し、左右同じ強さの turn（bias）の絶対値が 0.1 未満であることも要る
（項目 2 は前進低下でも可）。
"""
import argparse
import json
import time

import numpy as np

from . import readout as RO
from .assemble import Assembly, load_params
from .common import REPORTS
from .sim import Sim

BASE_S, STIM_S, WARM_S = 2.0, 2.0, 3.0
MIN_EFFECT = 0.05
Z_MIN = 2.0
BIAS_MAX = 0.1
LATERAL_ITEMS = [1, 2, 3, 6, 7]
SIDE_WEAK = 0.2
N_SEEDS = 10

# id, 名前, 刺激, 判定（(命令, 期待符号) のリスト、mode any/all）, 説明
ITEMS = [
    (1, "酢（DM1/DM4/DP1m/DM2）左", {"vinegar": (1.0, SIDE_WEAK)}, "any", [("turn", +1)], "左旋回（近づく）"),
    (2, "ジオスミン DA2 左", {"geosmin": (1.0, SIDE_WEAK)}, "any", [("turn", -1), ("forward", -1)], "右旋回（避ける）または前進低下"),
    (3, "CO2 V 左", {"co2": (1.0, SIDE_WEAK)}, "any", [("turn", -1)], "右旋回（避ける）"),
    (4, "糖 GRN", {"sugar": 1.0}, "all", [("feed", +1), ("forward", -1)], "摂食 MN 上昇かつ前進低下"),
    (5, "苦味 + 糖", {"sugar": 1.0, "bitter": 1.0}, "special", [("feed", -1)], "摂食が糖単独より低い"),
    (6, "暑さ TRN_VP2 左", {"heat": (1.0, SIDE_WEAK)}, "any", [("turn", -1)], "右旋回（避ける）"),
    (7, "寒さ TRN_VP3 左", {"cold": (1.0, SIDE_WEAK)}, "any", [("turn", -1)], "右旋回（避ける）"),
    (8, "接近 LPLC2", {"lplc2": 1.0}, "any", [("escape", +1)], "DNp01 上昇"),
    (9, "接近 LC4", {"lc4": 1.0}, "any", [("escape", +1), ("flap", +1)], "DNp01 または DNg02 上昇"),
    (10, "風 wind_gravity", {"wind": 1.0}, "any", [("forward", -1)], "前進低下"),
    (11, "頭部剛毛", {"bristle": 1.0}, "any", [("groom", +1)], "身繕い上昇"),
    (12, "障害物 LC16/LPLC1 両側", {"lc16": 1.0, "lplc1": 1.0}, "any", [("backward", +1), ("forward", -1)], "後退上昇または前進低下"),
]


def baseline_stats(S, seeds=(100, 101, 102, 103, 104), T=12.0):
    recs = []
    for sd in seeds:
        r = S.run(WARM_S + T, None, seed=sd)["rec"]
        recs.append(r[int(WARM_S * 50):])
    rec = np.concatenate(recs)
    return RO.baseline_stats(rec)


def trial(S, stim, seed, warm_state):
    v = S.stim_vector(stim)
    base = S.run(BASE_S, None, seed=seed + 1000, state=warm_state)
    res = S.run(STIM_S, lambda t: v, seed=seed + 2000, state=base["state"])
    return base["rec"], res["rec"]


def evaluate(A, params, n_seeds=N_SEEDS, log=print, item_ids=None, bseeds=(100, 101, 102, 103, 104)):
    S = Sim(A, params)
    mu, sd = baseline_stats(S, bseeds)
    names = S.rec_names
    warms = [S.run(WARM_S, None, seed=s)["state"] for s in range(n_seeds)]
    stats = {}
    todo = [it for it in ITEMS if item_ids is None or it[0] in item_ids or (it[0] == 5 and 4 in (item_ids or []))]
    todo_ids = {it[0] for it in todo} | ({4} if 5 in {it[0] for it in todo} else set())
    for item in ITEMS:
        iid, name, stim = item[0], item[1], item[2]
        if iid not in todo_ids:
            continue
        dl = {c: [] for c in RO.COMMANDS}
        bsd = {c: [] for c in RO.COMMANDS}
        for s in range(n_seeds):
            b, st = trial(S, stim, s, warms[s])
            cb, cs = RO.commands(b, names, mu, sd), RO.commands(st, names, mu, sd)
            for c in RO.COMMANDS:
                dl[c].append(cs[c].mean() - cb[c].mean())
                bsd[c].append(cb[c].std())
        stats[iid] = {c: (np.array(dl[c]), float(np.mean(bsd[c]))) for c in RO.COMMANDS}
        if iid in LATERAL_ITEMS:
            ch = list(stim)[0]
            ex = {}
            for lab, vals in (("R", (SIDE_WEAK, 1.0)), ("B", (1.0, 1.0))):
                ds = []
                for s_ in range(n_seeds):
                    b, st_ = trial(S, {ch: vals}, s_, warms[s_])
                    ds.append(RO.commands(st_, names, mu, sd)["turn"].mean() - RO.commands(b, names, mu, sd)["turn"].mean())
                ex[lab] = np.array(ds)
            stats[iid]["_lat"] = ex
    rows = []
    for item in ITEMS:
        iid, name, stim, mode, conds, desc = item
        if iid not in todo_ids:
            continue
        st = stats[iid]
        parts = []
        if mode == "special":
            d = st["feed"][0] - stats[4]["feed"][0]          # 苦味 + 糖 - 糖単独（同シード対）
            sdv = max(np.mean([stats[4]["feed"][1], st["feed"][1]]), RO.SD_FLOOR)
            ok = (-d.mean() >= MIN_EFFECT) and (-d.mean() / sdv >= Z_MIN) and ((d < 0).mean() >= 0.8)
            rows.append({"id": iid, "item": name, "expect": desc, "measure": f"feed(苦味+糖) - feed(糖) = {d.mean():+.3f}",
                         "delta": float(d.mean()), "z": float(d.mean() / sdv), "pass": bool(ok), "score": float(-d.mean() / sdv), "detail": {"feed_diff": float(d.mean())}})
            continue
        oks = []
        lat = st.get("_lat")
        for c, sg in conds:
            if lat is not None and c == "turn":
                diff = st["turn"][0] - lat["R"]               # 左強 - 右強（シードごと）
                bias = float(lat["B"].mean())
                sdv = max(float(diff.std()), RO.SD_FLOOR)
                ok_dir = (sg * diff.mean() >= MIN_EFFECT) and (sg * diff.mean() / sdv >= Z_MIN) and ((sg * diff > 0).mean() >= 0.8)
                ok = ok_dir and abs(bias) < BIAS_MAX
                oks.append(ok)
                parts.append(("turn(L-R)", float(diff.mean()), float(diff.mean() / sdv), bool(ok), bias, float(sg * diff.mean() / sdv)))
                continue
            d, sdv = st[c]
            sdv = max(sdv, RO.SD_FLOOR)
            ok = (sg * d.mean() >= MIN_EFFECT) and (sg * d.mean() / sdv >= Z_MIN) and ((sg * d > 0).mean() >= 0.8)
            oks.append(ok)
            parts.append((c, float(d.mean()), float(d.mean() / sdv), bool(ok), None, float(sg * d.mean() / sdv)))
        ok = all(oks) if mode == "all" else any(oks)
        best = max(parts, key=lambda x: x[5])
        zs = [p_[5] if p_[4] is None or abs(p_[4]) < BIAS_MAX else min(p_[5], 0.0) - abs(p_[4]) / BIAS_MAX for p_ in parts]
        score = min(zs) if mode == "all" else max(zs)
        rows.append({"id": iid, "item": name, "expect": desc, "score": float(score),
                     "measure": "; ".join((f"{c} {dv:+.3f} (z {z:+.1f}), bias {b_:+.3f}" if b_ is not None else f"{c} {dv:+.3f} (z {z:+.1f})") for c, dv, z, o, b_, _ in parts),
                     "delta": best[1], "z": best[2], "pass": bool(ok), "detail": {c: [dv, z, o, b_] for c, dv, z, o, b_, _ in parts}})
    return rows, {"mu": mu.tolist(), "sd": sd.tolist(), "names": names}


# ------------------------------------------------------------------ 学習 13
LEARN_TRIALS = 3
ODOR_S, PAIR_S = 4.0, 2.0
TEST_S = 2.0
PAM_AMP = 3.0


def approach_drive(S, rec_mbon, valence):
    return float((rec_mbon * valence).sum(1).mean())


def mbon_valence(A):
    """MBON の価値の向き: コリン作動性 = +1（接近促進）、グルタミン酸作動性 = -1（忌避促進）、GABA ほか = 0。
    Aso+ 2014 eLife, Owald+ 2015 Neuron の一般則（記憶による訂正: 当初 glu=+1 としたが文献と逆だった。未検証の仮定）。"""
    nt = A.nr["top_nt"].to_numpy()[A.mbon]
    return np.where(nt == "acetylcholine", 1.0, np.where(nt == "glutamate", -1.0, 0.0))


def learning_test(A, params, n_seeds=20, log=print, eta_d=None):
    p = dict(params)
    if eta_d is not None:
        p["eta_d"] = eta_d
    S = Sim(A, p)
    val = mbon_valence(A)
    pam = np.where(A.nr["cell_type"].fillna("").str.match(r"^PAM").to_numpy())[0]
    odorA = S.stim_vector({"fruit_a": 1.0}) if False else None
    chA = A.channels["fruit"]
    # 匂い A = ORN_DL1、匂い B = ORN_DM3（fruit チャネルの細胞タイプで分ける）
    ct = A.nr["cell_type"].to_numpy()
    ixA = np.where(ct == "ORN_DL1")[0]
    ixB = np.where(ct == "ORN_DM3")[0]
    vA = np.zeros(A.n); vA[ixA] = p["amp"]
    vB = np.zeros(A.n); vB[ixB] = p["amp"]
    vPAM = np.zeros(A.n); vPAM[pam] = PAM_AMP
    out = []
    for s in range(n_seeds):
        state = S.run(WARM_S, None, seed=s)["state"]
        pre = {}
        for nm, v in (("A", vA), ("B", vB)):
            res = S.run(TEST_S, lambda t: v, seed=s + 500, state=state, learn=False)
            pre[nm] = approach_drive(S, res["mbon"], val)
        for k in range(LEARN_TRIALS):
            # A + PAM（後半 PAIR_S 秒）
            res = S.run(ODOR_S, lambda t: vA + (vPAM if t >= ODOR_S - PAIR_S else 0), seed=s + 600 + k, state=state, learn=True)
            state = res["state"]
            res = S.run(2.0, None, seed=s + 700 + k, state=state, learn=True); state = res["state"]
            # B のみ（PAM なし）
            res = S.run(ODOR_S, lambda t: vB, seed=s + 800 + k, state=state, learn=True); state = res["state"]
            res = S.run(2.0, None, seed=s + 900 + k, state=state, learn=True); state = res["state"]
        post = {}
        for nm, v in (("A", vA), ("B", vB)):
            res = S.run(TEST_S, lambda t: v, seed=s + 500, state=state, learn=False)
            post[nm] = approach_drive(S, res["mbon"], val)
        # 対照: 同じ手順で PAM を与えないエージェントとの比較は別実行（下）
        out.append((pre["A"], pre["B"], post["A"], post["B"]))
    o = np.array(out)
    dA, dB = o[:, 2] - o[:, 0], o[:, 3] - o[:, 1]
    eff = dA - dB
    return {"pre_A": o[:, 0].tolist(), "pre_B": o[:, 1].tolist(), "post_A": o[:, 2].tolist(), "post_B": o[:, 3].tolist(),
            "dA_mean": float(dA.mean()), "dB_mean": float(dB.mean()), "effect_mean": float(eff.mean()), "effect_sd": float(eff.std()),
            "cohen_d": float(eff.mean() / (eff.std() + 1e-12)), "frac_positive": float((eff > 0).mean()), "n_seeds": n_seeds,
            "mbon_valence_counts": {"approach(ACh)": int((val > 0).sum()), "avoid(Glu)": int((val < 0).sum()), "neutral": int((val == 0).sum())}}


def table_md(rows, title):
    npass = sum(r["pass"] for r in rows)
    L = [f"### {title}（{npass} / 12 一致）", "", "| # | 項目 | 期待 | 測定（delta、z） | 合否 |", "|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['id']} | {r['item']} | {r['expect']} | {r['measure']} | {'合' if r['pass'] else '否'} |")
    return "\n".join(L), npass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", type=int, default=N_SEEDS)
    a = ap.parse_args()
    t0 = time.time()
    A = Assembly()
    p = load_params()
    rows, _ = evaluate(A, p, a.seeds)
    md, n = table_md(rows, "現在のパラメータ")
    print(md)
    print("seconds", time.time() - t0)
    lt = learning_test(A, p, 20)
    print(json.dumps({k: v for k, v in lt.items() if not k.startswith(("pre", "post"))}, ensure_ascii=False))


if __name__ == "__main__":
    main()


# ------------------------------------------------------------------ 対照・安定性

def lateral_controls(A, params, n_seeds=5):
    """片側刺激の特異性: 左強 / 右強 / 左右同じ のときの turn の変化。左右反転で符号が反転し、同じなら 0 付近が期待。"""
    S = Sim(A, params)
    mu, sd = baseline_stats(S)
    names = S.rec_names
    warms = [S.run(WARM_S, None, seed=s)["state"] for s in range(n_seeds)]
    out = {}
    for item in ITEMS:
        if item[0] not in LATERAL_ITEMS:
            continue
        ch = list(item[2])[0]
        res = {}
        for lab, vals in (("left_strong", (1.0, SIDE_WEAK)), ("right_strong", (SIDE_WEAK, 1.0)), ("equal", (1.0, 1.0))):
            ds = []
            for s in range(n_seeds):
                b, st = trial(S, {ch: vals}, s, warms[s])
                ds.append(RO.commands(st, names, mu, sd)["turn"].mean() - RO.commands(b, names, mu, sd)["turn"].mean())
            res[lab] = float(np.mean(ds))
        out[item[0]] = res
    return out


def stability(A, params):
    from .calibrate import CHANNELS
    S = Sim(A, params)
    res = S.run(60.0, None, seed=0)
    allv = S.stim_vector({c: 1.0 for c in CHANNELS})
    res2 = S.run(10.0, lambda t: allv, seed=0, state=res["state"])
    r, _ = res2["state"]
    return {"baseline_60s_rmax": res["rmax"], "all_channels_10s_rmax": res2["rmax"], "finite": bool(np.isfinite(r).all()),
            "frac_gt5_all_channels": float((r > 5).mean()), "kc_frac_baseline": float(res["kc_frac"][-100:].mean()),
            "kc_frac_all_channels": float(res2["kc_frac"][-100:].mean())}


def timing(A, params, n=300):
    import time
    net = A.net(params)
    r, d = net.init_state()
    I = np.zeros(A.n)
    for _ in range(20):
        r, d = net.step(r, d, I)
    t = time.perf_counter()
    for _ in range(n):
        r, d = net.step(r, d, I)
    return (time.perf_counter() - t) / n * 1000


def escape_dose(A, params, doses=(0.1, 0.3, 1.0), n_seeds=3):
    """接近刺激の強さを 3 段階にして DNp01 の生の発火率と escape 命令の変化を見る（飽和の確認）。"""
    S = Sim(A, params)
    mu, sd = baseline_stats(S, (100, 101))
    names = S.rec_names
    j = [names.index("DNp01_L"), names.index("DNp01_R")]
    warms = [S.run(WARM_S, None, seed=s)["state"] for s in range(n_seeds)]
    out = {"baseline_rate": [float(mu[j[0]]), float(mu[j[1]])], "doses": {}}
    for ch in ("lplc2", "lc4"):
        for dz in doses:
            raw, cmd = [], []
            for s in range(n_seeds):
                b, st = trial(S, {ch: dz}, s, warms[s])
                raw.append(float(st[:, j].mean() - b[:, j].mean()))
                cmd.append(float(RO.commands(st, names, mu, sd)["escape"].mean() - RO.commands(b, names, mu, sd)["escape"].mean()))
            out["doses"][f"{ch}@{dz}"] = {"delta_rate": float(np.mean(raw)), "delta_escape_cmd": float(np.mean(cmd))}
    return out
