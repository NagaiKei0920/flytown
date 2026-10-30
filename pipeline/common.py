"""共通パス・定数・注釈とペア表の読み込み。"""
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa

ROOT = Path(__file__).resolve().parent.parent
FLYBOT = ROOT.parent / "flybot"
RAW = FLYBOT / "data" / "flywire"
DATA = ROOT / "data"
OUT = ROOT / "pipeline" / "out"
PUB = ROOT / "web" / "public" / "circuit"
REPORTS = ROOT / "docs" / "reports"
ANN_COLS = ["root_id", "super_class", "cell_class", "cell_sub_class", "cell_type", "top_nt", "top_nt_conf", "side", "nerve"]
SIGN = {"acetylcholine": 1, "gaba": -1, "glutamate": -1, "dopamine": 1, "serotonin": 1, "octopamine": 1}


def load_annotations():
    a = pd.read_csv(RAW / "Supplemental_file1_neuron_annotations.tsv", sep="\t", usecols=ANN_COLS, low_memory=False)
    return a.drop_duplicates("root_id").reset_index(drop=True)


def load_pairs(min_syn=5):
    """全脳の (pre, post) -> syn（神経絨ごとの行を合算、min_syn 未満は捨てる）。キャッシュ data/pairs.npz。"""
    cache = DATA / "pairs.npz"
    if cache.exists():
        z = np.load(cache)
        return z["pre"], z["post"], z["syn"]
    rd = pa.ipc.open_file(pa.memory_map(str(RAW / "proofread_connections_783.feather")))
    acc = None
    for i in range(rd.num_record_batches):
        b = rd.get_batch(i)
        d = pd.DataFrame({"pre": b["pre_pt_root_id"].to_numpy(), "post": b["post_pt_root_id"].to_numpy(),
                          "syn": b["syn_count"].to_numpy().astype(np.int32)})
        d = d.groupby(["pre", "post"], as_index=False)["syn"].sum()
        acc = d if acc is None else pd.concat([acc, d]).groupby(["pre", "post"], as_index=False)["syn"].sum()
    acc = acc[acc.syn >= min_syn]
    np.savez(cache, pre=acc.pre.to_numpy(np.int64), post=acc.post.to_numpy(np.int64), syn=acc.syn.to_numpy(np.int32))
    return acc.pre.to_numpy(np.int64), acc.post.to_numpy(np.int64), acc.syn.to_numpy(np.int32)
