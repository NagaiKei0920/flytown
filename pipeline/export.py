"""web/public/circuit/ への書き出しと、M2 のブラウザ実装との一致試験用データ（pipeline/out/parity_*）。"""
"""
再現（保存済みパラメータから。約 数十秒）:
    ../flybot/.venv/bin/python -m pipeline.export --variant r1 [--out DIR]
既定の入力は pipeline/params_r1/{params,tuned}.json（--params / --tuned で変更）、出力は web/public/circuit と pipeline/out。
中間物 data/circuit/{neurons_raw.parquet,edges_raw.npz,feeding.json}（`python -m pipeline.extract`）が前提。
--out DIR を指定すると circuit.bin・meta.json・LICENSE を DIR に、parity_* を DIR/parity に書き、web/ は触らない。
出荷版の SHA（meta.json + circuit.bin を連結して sha256、先頭 12 桁）は pipeline/params_r1/EXPECTED_SHA と比べて表示する。
"""
import argparse
import gzip
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

from . import readout as RO
from .assemble import DEFAULT_PARAMS, PANEL, Assembly, load_params
from .variant import R2, VARIANT
from .common import OUT, PUB, ROOT
from .model import CLASSES, DT_STEP, ETA_D, ETA_R, RMAX, SUBSTEPS, TAU_MS, alpha_of
from .response_table import baseline_stats
from .sim import Sim

VERSION = "flytown-circuit-1"
PANELS = ["sensory", "MB", "LH", "CX", "DN", "other"]

# 一致試験の入力台本。ステップは 0 始まり、[start, end) の間 I に加える。
# type=channel: amp * (left, right)、type=group: 指定細胞群に value、type=celltype: root の cell_type 一致細胞に value
PARITY_SCHEDULE = [
    {"start": 20, "end": 120, "type": "channel", "name": "vinegar", "left": 1.0, "right": 0.2},
    {"start": 60, "end": 160, "type": "channel", "name": "sugar", "left": 1.0, "right": 1.0},
    {"start": 100, "end": 200, "type": "celltype", "name": "ORN_DL1", "value_amp": 1.0},
    {"start": 140, "end": 200, "type": "group", "name": "PAM", "value": 3.0},
    {"start": 220, "end": 280, "type": "channel", "name": "lplc2", "left": 1.0, "right": 1.0},
    {"start": 240, "end": 300, "type": "channel", "name": "wind", "left": 0.5, "right": 1.0},
]
PARITY_STEPS = 300
PARITY_STATE_STEPS = [0, 100, 300]


def lists(ix, sd):
    return {"left": ix[sd == 0].tolist(), "right": ix[sd == 1].tolist(), "mid": ix[sd == 2].tolist()}


def parity_input(A, params, t):
    I = np.zeros(A.n)
    for ev in PARITY_SCHEDULE:
        if not (ev["start"] <= t < ev["end"]):
            continue
        if ev["type"] == "channel":
            ix, sd = A.channels[ev["name"]]
            val = np.where(sd == 0, ev["left"], np.where(sd == 1, ev["right"], 0.5 * (ev["left"] + ev["right"])))
            I[ix] += params["amp"] * val
        elif ev["type"] == "celltype":
            ix = np.where(A.nr["cell_type"].to_numpy() == ev["name"])[0]
            I[ix] += params["amp"] * ev["value_amp"]
        else:
            I[pam_idx(A)] += ev["value"]
    return I


def pam_idx(A):
    return np.where(A.nr["cell_type"].fillna("").str.match(r"^PAM").to_numpy())[0]


def ppl1_idx(A):
    return np.where(A.nr["cell_type"].fillna("").str.match(r"^PPL1").to_numpy())[0]


def write_parity(A, params, net, S, mu, sd, OUT=OUT):
    OUT.mkdir(parents=True, exist_ok=True)
    r, d = net.init_state()
    steps_rates, states = [], {}
    # 入力ノイズなし（決定的）。学習あり。
    for t in range(PARITY_STEPS):
        if t in PARITY_STATE_STEPS:
            states[t] = (r.copy(), d.copy())
        I = parity_input(A, params, t)
        r, d = net.step(r, d, I, learn=True)
        steps_rates.append([r[ix].mean() for ix in S.rec_idx])
    states[PARITY_STEPS] = (r.copy(), d.copy())
    rates = np.array(steps_rates, np.float64)
    with open(OUT / "parity_rates.bin", "wb") as f:
        f.write(struct.pack("<4sIII", b"FTP1", PARITY_STEPS, len(S.rec_idx), 0))
        f.write(rates.astype("<f8").tobytes())            # (steps, n_rec) 行優先、各ステップ後の出力群の平均発火率
    with open(OUT / "parity_state.bin", "wb") as f:
        keys = [0, 100, 300]
        f.write(struct.pack("<4sIIII", b"FTS1", len(keys), net.n, len(net.pl_edge), 0))
        for k in keys:
            # steps 0 / 100 / 300 は「そのステップを実行する前」の状態。300 は全ステップ実行後。
            rr, dd = states[k] if k != 300 else states[PARITY_STEPS]
            f.write(struct.pack("<I", k))
            f.write(rr.astype("<f8").tobytes())
            f.write(dd.astype("<f8").tobytes())
    (OUT / "parity_schedule.json").write_text(json.dumps({
        "steps": PARITY_STEPS, "state_steps": PARITY_STATE_STEPS, "schedule": PARITY_SCHEDULE,
        "rec_names": S.rec_names, "amp": params["amp"], "pam_idx": pam_idx(A).tolist(),
        "celltype_idx": {"ORN_DL1": np.where(A.nr["cell_type"].to_numpy() == "ORN_DL1")[0].tolist()},
        "learn": True, "noise": 0.0}, ensure_ascii=False))
    return rates


PARAMS_R1 = ROOT / "pipeline" / "params_r1"


def sha_prefix(d):
    return hashlib.sha256((Path(d) / "meta.json").read_bytes() + (Path(d) / "circuit.bin").read_bytes()).hexdigest()[:12]


def main(log=print, params=None, out=None):
    """params: 辞書（tuned_gain 込み）。None なら data/circuit/params.json。out: 出力先（None なら web/public/circuit と pipeline/out）。"""
    pub = PUB if out is None else Path(out)
    POUT = OUT if out is None else Path(out) / "parity"
    A = Assembly()
    params = load_params() if params is None else params
    net = A.net(params)
    S = Sim(A, params, net)
    mu, sd = baseline_stats(S)
    pub.mkdir(parents=True, exist_ok=True)
    N, E = net.n, len(net.indices)
    # circuit.bin: "FTC1" u32 N u32 E | int32 indptr[N+1] | int32 indices[E] | float32 weights[E]（全て little-endian、行 = 後シナプス）
    blob = struct.pack("<4sII", b"FTC1", N, E) + net.indptr.astype("<i4").tobytes() + net.indices.astype("<i4").tobytes() + net.w32.astype("<f4").tobytes()
    (pub / "circuit.bin").write_bytes(blob)
    gz = len(gzip.compress(blob, 9))
    types = sorted(set(A.nr["cell_type"].fillna("").tolist()))
    tix = {t: i for i, t in enumerate(types)}
    panel_idx = np.array([PANELS.index(PANEL[CLASSES[c]]) for c in A.cls], np.int32)
    if R2:
        panel_idx[A.tonic] = PANELS.index("other")
    D = net.D
    nz = np.argwhere(D > 0)
    meta = {
        "version": VERSION, "N": N, "E": E, "dt": DT_STEP, "substeps": SUBSTEPS, "rmax": RMAX,
        "format": "circuit.bin = 'FTC1' u32 N u32 E, int32 indptr[N+1], int32 indices[E], float32 weights[E]; little-endian; row = postsynaptic",
        "classes": CLASSES, "tau_ms": [TAU_MS[c] for c in CLASSES], "alpha_by_class": alpha_of(np.arange(len(CLASSES))).tolist(),
        "neuron_class": A.cls.tolist(),
        "bias": {"sens": params["b_sens"], "brain": params["b_brain"], "sens_class": CLASSES.index("SENS")},
        "input": {"amp": params["amp"], "noise_sd": params["noise_sd"],
                  "channels": {ch: lists(*A.channels[ch]) for ch in A.channels}},
        "output": {g: lists(*A.outputs[g]) for g in A.outputs},
        "feeding": {"type": A.feeding["type"], "root_ids": A.feeding["root_ids"]},
        "dan": {"pam": pam_idx(A).tolist(), "ppl1": ppl1_idx(A).tolist(), "all": net.dan_idx.tolist()},
        "plastic": {"edge": net.pl_edge.tolist(), "pre": net.pl_pre.tolist(), "post": net.pl_post.tolist(),
                    "mbon_of_edge": net.pl_mbon.tolist(), "mbon": net.mbon_idx.tolist(), "dan": net.dan_idx.tolist(),
                    "D_rows": nz[:, 0].tolist(), "D_cols": nz[:, 1].tolist(), "D_vals": D[nz[:, 0], nz[:, 1]].tolist(),
                    "eta_d": net.eta_d, "eta_r": net.eta_r, "d_min": -1.0, "n_mbon": len(net.mbon_idx),
                    "mbon_valence": [float(x) for x in np.where(A.nr["top_nt"].to_numpy()[net.mbon_idx] == "acetylcholine", 1.0,
                                     np.where(A.nr["top_nt"].to_numpy()[net.mbon_idx] == "glutamate", -1.0, 0.0))]},
        "kc": {"indices": np.where(A.cls == CLASSES.index("MB_KC"))[0].tolist(), "active_threshold": 0.05},
        "readout": {**RO.coefficients(), "rec_names": S.rec_names, "mu": mu.tolist(), "sd": sd.tolist(), "commands": RO.COMMANDS},
        "panel": {"names": PANELS, "index": panel_idx.tolist()},
        "neuron_type": {"types": types, "index": [tix[t] for t in A.nr["cell_type"].fillna("")],
                        "side": [{"left": 0, "right": 1}.get(s, 2) for s in A.nr["side"].fillna("")]},
        "root_ids": [str(x) for x in A.nr["root_id"]],
        "source": {"data": "FlyWire v783 (FAFB)", "zenodo_doi": "10.5281/zenodo.10676866", "license": "CC BY-NC 4.0",
                   "note": "modified subset (selected neurons, merged synapse counts, rescaled/gain-adjusted weights)"},
        "parity": {"schedule_file": "pipeline/out/parity_schedule.json"},
    }
    if R2:      # 不採用の実験（docs/consult/004）。r1 の meta.json には tonic キーがない
        t = {"index": int(A.tonic), "w": params.get("tonic_w", 0.0), "targets": A.dn_tonic.tolist(),
                         "note": "constant-output unit (class SENS, bias 0.3) -> DN class (except DNp01); stands in for DN class bias"}
        meta = {k2: v2 for k0, v0 in meta.items() for k2, v2 in (((k0, v0), ("tonic", t)) if k0 == "plastic" else ((k0, v0),))}   # キー順をラウンド 2 の出力に合わせる
    (pub / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
    (pub / "LICENSE").write_text(LICENSE)
    rates = write_parity(A, params, net, S, mu, sd, POUT)
    info = {"N": N, "E": E, "circuit_bin_bytes": len(blob), "circuit_bin_gzip_bytes": gz,
            "meta_json_bytes": (pub / "meta.json").stat().st_size, "parity_rates_max": float(rates.max())}
    info["sha256_12"] = sha_prefix(pub)
    log(json.dumps(info))
    return info


LICENSE = """FLYTOWN circuit data (circuit.bin, meta.json)

License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
https://creativecommons.org/licenses/by-nc/4.0/

This is a modified subset of the FlyWire connectome (FAFB, release v783). Changes: a subset of neurons was selected,
synapse counts of the same neuron pair were summed over neuropils and pairs below 5 synapses were dropped, weights were
rescaled and multiplied by calibration gains, and neurons were assigned to model classes. Neuron signs follow the
predicted neurotransmitter (top_nt).

Source data: FlyWire v783 proofread connections and annotations
Zenodo: https://doi.org/10.5281/zenodo.10676866

Please cite:
- Dorkenwald et al. 2024. Neuronal wiring diagram of an adult brain. Nature.
- Schlegel et al. 2024. Whole-brain annotation and multi-connectome cell typing of Drosophila. Nature.
- Matsliah et al. 2024. Neuronal parts list and wiring diagram for a visual system. Nature.
- Berg et al. 2026 (see docs/M0_inputs.md of the FLYTOWN repository).
- Tastekin et al. 2026 (see docs/M0_inputs.md of the FLYTOWN repository).
- Buhmann et al. 2021. Automatic detection of synaptic partners in a whole-brain Drosophila EM dataset. Nature Methods.
- Eckstein et al. 2024. Neurotransmitter classification from electron microscopy images at synaptic sites in Drosophila melanogaster. Cell.
"""

def cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="r1", choices=["r1", "r2"])
    ap.add_argument("--from-params", dest="params", help="params.json（既定: r1 は pipeline/params_r1/params.json、r2 は data/circuit_r2/params.json）")
    ap.add_argument("--tuned", help="tuned.json（既定: r1 は pipeline/params_r1/tuned.json）")
    ap.add_argument("--out", help="出力先。省略すると web/public/circuit と pipeline/out に書く")
    a = ap.parse_args()
    if VARIANT == "r1":
        pf = Path(a.params or PARAMS_R1 / "params.json")
        tf = Path(a.tuned or PARAMS_R1 / "tuned.json")
        params = json.loads(pf.read_text())
        params["tuned_gain"] = json.loads(tf.read_text())
        base = dict(DEFAULT_PARAMS)
        base.update(params)
        params = base
    else:
        params = None if not a.params else json.loads(Path(a.params).read_text())
    info = main(params=params, out=a.out)
    if VARIANT == "r1":
        exp = (PARAMS_R1 / "EXPECTED_SHA").read_text().strip()
        print(f"sha256_12 {info['sha256_12']} 期待 {exp}: {'一致' if info['sha256_12'] == exp else '不一致'}")


if __name__ == "__main__":
    cli()
