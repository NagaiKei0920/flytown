"""FLYTOWN 回路の抽出。

    ../flybot/.venv/bin/python -m pipeline.extract [--k 2] [--tpath 10] [--nmax 20000] [--emax 600000]

出力: data/circuit/neurons.parquet, edges.npz（pre, post, syn: 回路内の添字）, selection.json
手順: 種（入力・出力・DAN・MB・LH・flybot 回路）+ 入力から k 段以内かつ出力へ k 段以内の中間ニューロン（結線強度で順位付け）。
flybot の extract.py（結線の読み取り・符号規則）を写して作り直した。
"""
import argparse
import json

import numpy as np
import pandas as pd
import scipy.sparse as sp

from .variant import R2
from .common import DATA, FLYBOT, SIGN, load_annotations, load_pairs
from .spec import INPUT_CHANNELS, MOTOR_NERVES, OUTPUT_GROUPS, select, select_output

OUT_DIR = DATA / ("circuit_r2" if R2 else "circuit")


def seed_masks(a):
    ct = a["cell_type"].fillna("")
    cc = a["cell_class"].fillna("")
    m = {}
    m["in"] = np.zeros(len(a), bool)
    for rule in INPUT_CHANNELS.values():
        m["in"] |= select(a, rule)
    m["out_dn"] = np.zeros(len(a), bool)
    for pat in OUTPUT_GROUPS.values():
        m["out_dn"] |= select_output(a, pat)
    m["out_mn"] = ((a["super_class"] == "motor") & a["nerve"].isin(MOTOR_NERVES)).to_numpy()
    m["out"] = m["out_dn"] | m["out_mn"]
    m["dan"] = ct.str.match(r"^(PAM|PPL1)").to_numpy()
    m["mb"] = (cc.isin(["Kenyon_Cell", "MBON", "DAN", "MBIN"]) | ct.isin(["APL", "DPM"])).to_numpy()
    m["lh"] = (cc.isin(["LHLN", "LHCENT"]) | ct.str.match(r"^LH")).to_numpy()
    fb = pd.read_parquet(FLYBOT / "data" / "circuit" / "neurons.parquet", columns=["root_id", "circuit"])
    m["flybot"] = a["root_id"].isin(fb["root_id"]).to_numpy()
    return m, fb


def allowed_mask(a, seeds_in):
    """中間ニューロンとして許す細胞。視葉と、種に無い感覚・視覚投射は除く。"""
    sc = a["super_class"]
    bad = sc.isin(["optic", "visual_centrifugal", "sensory", "sensory_ascending", "visual_projection", "endocrine"]).to_numpy()
    return ~bad | seeds_in


def reach(A, start, allowed, k):
    """A: 行 = 前、列 = 後 の 0/1 疎行列。start から k 段以内の到達集合（allowed のみ通る）。段数を返す。"""
    hop = np.full(A.shape[0], 99, np.int8)
    hop[start] = 0
    front = start.copy()
    for h in range(1, k + 1):
        nxt = (A.T @ front.astype(np.float32)) > 0
        nxt &= allowed & (hop == 99)
        hop[nxt] = h
        front = nxt
    return hop


def build(k=2, tpath=10, nmax=20000, emax=600000, verbose=True):
    a = load_annotations()
    n_all = len(a)
    pre_r, post_r, syn = load_pairs()
    ix = pd.Index(a["root_id"].to_numpy())
    pre, post = ix.get_indexer(pre_r), ix.get_indexer(post_r)
    ok = (pre >= 0) & (post >= 0)
    pre, post, syn = pre[ok], post[ok], syn[ok]
    seeds, fb = seed_masks(a)
    seed_all = seeds["in"] | seeds["out"] | seeds["dan"] | seeds["mb"] | seeds["lh"] | seeds["flybot"]
    allowed = allowed_mask(a, seed_all)
    tot_in = np.bincount(post, weights=syn, minlength=n_all)

    sel = syn >= tpath
    A = sp.csr_matrix((np.ones(sel.sum(), np.float32), (pre[sel], post[sel])), shape=(n_all, n_all))
    hf = reach(A, seeds["in"], allowed, k)
    hb = reach(A.T.tocsr(), seeds["out"], allowed, k)
    cand = (hf <= k) & (hb <= k) & ~seed_all
    # 順位: 入力側の影響 x 出力側の影響（結線強度の比の積。2 段まで）
    Wn = sp.csr_matrix((syn / np.maximum(tot_in[post], 1), (post, pre)), shape=(n_all, n_all))   # post x pre, 入力比
    f = seeds["in"].astype(np.float64)
    fw = Wn @ f
    for _ in range(k - 1):
        fw = fw + Wn @ fw
    # 出力側: syn(x->y)/tot_in(y) を y から x へ遡る
    g = seeds["out"].astype(np.float64)
    bw = Wn.T @ g
    for _ in range(k - 1):
        bw = bw + Wn.T @ bw
    score = np.where(cand, np.sqrt(fw * bw), 0.0)
    n_seed = int(seed_all.sum())
    room = max(nmax - n_seed, 0)
    order = np.argsort(-score)
    take = order[: min(room, int((score > 0).sum()))]
    chosen = seed_all.copy()
    chosen[take] = True
    info = {"k": k, "tpath": tpath, "n_seed": n_seed, "n_cand": int(cand.sum()), "n_taken": int(len(take)),
            "seed_counts": {kk: int(v.sum()) for kk, v in seeds.items()}}
    # 回路内の結線
    nid = -np.ones(n_all, np.int64)
    members = np.where(chosen)[0]
    nid[members] = np.arange(len(members))
    m = (nid[pre] >= 0) & (nid[post] >= 0)
    p, q, s = nid[pre[m]], nid[post[m]], syn[m]
    info["edges_min5"] = int(len(p))
    # 辺数が多ければ最小シナプス数を上げる（flybot 回路どうしの辺は守る）
    fbm = seeds["flybot"][members]
    thr = 5
    while len(p) > emax and thr < 40:
        thr += 1
        keep = (s >= thr) | (fbm[p] & fbm[q])
        p, q, s = p[keep], q[keep], s[keep]
    info["min_syn_extra"] = thr
    info["edges"] = int(len(p))
    sub = a.iloc[members].reset_index(drop=True)
    sub["seed_in"] = seeds["in"][members]
    sub["seed_out"] = seeds["out"][members]
    sub["seed_dan"] = seeds["dan"][members]
    sub["seed_flybot"] = seeds["flybot"][members]
    sub["seed_mb"] = seeds["mb"][members]
    sub["seed_lh"] = seeds["lh"][members]
    fbc = fb.set_index("root_id")["circuit"]
    sub["fb_group"] = sub["root_id"].map(fbc)
    info["n"] = int(len(sub))
    if verbose:
        print(json.dumps(info, ensure_ascii=False))
    return sub, p.astype(np.int32), q.astype(np.int32), s.astype(np.int32), info


def find_feeding(a=None):
    """口吻の摂食運動ニューロン: nerve=MxLbN の運動ニューロンのうち、糖 GRN（LB3c, LB3b）から 1〜2 段で最も強く入力を受ける
    細胞タイプ。強さ = 1 段の入力比 + 2 段の入力比（入力比 = syn / 全入力シナプス、全脳の結合表 syn>=5 の対）。"""
    a = load_annotations() if a is None else a
    p, q, s = load_pairs()
    ix = pd.Index(a["root_id"])
    pi, qi = ix.get_indexer(p), ix.get_indexer(q)
    ok = (pi >= 0) & (qi >= 0)
    pi, qi, s = pi[ok], qi[ok], s[ok]
    n = len(a)
    tot = np.bincount(qi, weights=s, minlength=n)
    Wn = sp.csr_matrix((s / np.maximum(tot[qi], 1), (qi, pi)), shape=(n, n))
    sugar = select(a, INPUT_CHANNELS["sugar"]).astype(float)
    bitter = select(a, INPUT_CHANNELS["bitter"]).astype(float)
    f1 = Wn @ sugar
    f2 = Wn @ f1
    b = Wn @ bitter + Wn @ (Wn @ bitter)
    mn = ((a["super_class"] == "motor") & (a["nerve"] == "MxLbN")).to_numpy()
    r = pd.DataFrame({"root_id": a["root_id"][mn].astype(str), "type": a["cell_type"][mn], "side": a["side"][mn],
                      "nt": a["top_nt"][mn], "sugar_1hop": f1[mn], "sugar_2hop": f2[mn], "sugar_total": (f1 + f2)[mn],
                      "bitter_total": b[mn]}).sort_values("sugar_total", ascending=False)
    ty = r.groupby("type").agg(n=("root_id", "size"), sugar_total=("sugar_total", "sum"), bitter_total=("bitter_total", "sum")).sort_values("sugar_total", ascending=False)
    best = ty.index[0]
    feed = r[r["type"] == best]
    return {"type": best, "root_ids": feed["root_id"].tolist(), "sides": feed["side"].tolist(),
            "by_type": ty.head(6).reset_index().to_dict("records"), "top_cells": r.head(8).to_dict("records")}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=2)
    ap.add_argument("--tpath", type=int, default=10)
    ap.add_argument("--nmax", type=int, default=20000)
    ap.add_argument("--emax", type=int, default=600000)
    ap.add_argument("--variant", default="r1", choices=["r1", "r2"])   # variant.py が読む。ここは受け付けるだけ
    args = ap.parse_args(argv)
    sub, p, q, s, info = build(args.k, args.tpath, args.nmax, args.emax)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sub.to_parquet(OUT_DIR / "neurons_raw.parquet", index=False)
    np.savez(OUT_DIR / "edges_raw.npz", pre=p, post=q, syn=s)
    (OUT_DIR / "selection.json").write_text(json.dumps(info, ensure_ascii=False, indent=1))
    fd = find_feeding()
    (OUT_DIR / "feeding.json").write_text(json.dumps(fd, ensure_ascii=False, indent=1, default=float))
    print("摂食 MN:", fd["type"], fd["root_ids"])
    return info, fd


if __name__ == "__main__":
    main()
