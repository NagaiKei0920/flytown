"""構造の確認（行動は見ない）。docs/consult/004 の事前確認の再現。
  ../flybot/.venv/bin/python -m pipeline.structure_checks   -> data/circuit/structure_checks.json
  (c) ORN -> PN の同側/反対側シナプス数、入力チャネルの左右/正中の細胞数、DN への入力の同側/反対側
  (d) 摂食 MN への入力の符号と top_nt_conf
"""
import json

import numpy as np
import pandas as pd

from .assemble import CDIR
from .common import load_annotations, load_pairs
from .spec import INPUT_CHANNELS, select


def main():
    a = load_annotations()
    A = a.set_index("root_id")
    p, q, s = load_pairs()
    df = pd.DataFrame({"pre": p, "post": q, "s": s})
    for c in ["cell_type", "cell_class", "side"]:
        df["pre_" + c] = A[c].reindex(df.pre).to_numpy()
        df["post_" + c] = A[c].reindex(df.post).to_numpy()
    LR = ["left", "right"]
    out = {"channel_cells": {}, "orn_to_pn": {}, "dn_inputs": {}, "feed_inputs": {}}
    for ch, rule in INPUT_CHANNELS.items():
        m = select(a, rule)
        sd = a["side"][m]
        out["channel_cells"][ch] = {"left": int((sd == "left").sum()), "right": int((sd == "right").sum()), "mid": int((~sd.isin(LR)).sum())}
    for ch in ["vinegar", "geosmin", "co2", "cva", "fruit"]:
        ids = set(a.root_id[select(a, INPUT_CHANNELS[ch])])
        d = df[df.pre.isin(ids) & (df.post_cell_class == "ALPN")]
        r = {}
        for sd in LR:
            x = d[d.pre_side == sd]
            r[sd] = {"ipsi": int(x[x.post_side == sd].s.sum()), "contra": int(x[x.post_side.isin(LR) & (x.post_side != sd)].s.sum())}
        out["orn_to_pn"][ch] = r
    orn = df[df.pre_cell_type.fillna("").str.startswith("ORN_") & (df.post_cell_class == "ALPN") & df.pre_side.isin(LR) & df.post_side.isin(LR)]
    ips, con = int(orn[orn.pre_side == orn.post_side].s.sum()), int(orn[orn.pre_side != orn.post_side].s.sum())
    out["orn_to_pn"]["all_ORN"] = {"ipsi": ips, "contra": con, "ratio": ips / con}
    for t in ["DNa02", "DNa01", "DNae001", "DNp09", "MDN"]:
        for sd in LR:
            x = df[(df.post_cell_type == t) & (df.post_side == sd)]
            out["dn_inputs"][f"{t}_{sd}"] = {"total": int(x.s.sum()), "ipsi": int(x[x.pre_side == sd].s.sum()),
                                              "contra": int(x[x.pre_side.isin(LR) & (x.pre_side != sd)].s.sum())}
    fd = json.loads((CDIR / "feeding.json").read_text())
    ids = [int(v) for v in fd["root_ids"]]
    x = df[df.post.isin(ids)].groupby("pre").s.sum()
    nt, cf = A.top_nt.reindex(x.index), A.top_nt_conf.reindex(x.index)
    for k in ["acetylcholine", "gaba", "glutamate"]:
        m = nt == k
        out["feed_inputs"][k] = {"cells": int(m.sum()), "syn": int(x[m].sum()), "conf_mean": float(cf[m].mean()), "frac_conf_lt_0.5": float((cf[m] < 0.5).mean())}
    out["feed_inputs"]["total_syn"] = int(x.sum())
    out["feed_inputs"]["annotation_conf_median"] = float(a.top_nt_conf.median())
    (CDIR / "structure_checks.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
