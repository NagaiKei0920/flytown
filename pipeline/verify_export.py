"""書き出した circuit.bin + meta.json + parity_* だけから、モデルを独立に再実装して一致を確かめる（JS 実装者の代役）。
Net クラスは使わない（ループは素朴な numpy。重みは float32 から float64 へ）。"""
import json
import struct

import numpy as np

from .common import OUT, PUB


def main():
    meta = json.loads((PUB / "meta.json").read_text())
    b = (PUB / "circuit.bin").read_bytes()
    magic, N, E = struct.unpack_from("<4sII", b, 0)
    assert magic == b"FTC1" and N == meta["N"] and E == meta["E"]
    o = 12
    indptr = np.frombuffer(b, "<i4", N + 1, o); o += 4 * (N + 1)
    indices = np.frombuffer(b, "<i4", E, o); o += 4 * E
    w = np.frombuffer(b, "<f4", E, o).astype(np.float64)
    sched = json.loads((OUT / "parity_schedule.json").read_text())
    alpha = np.array(meta["alpha_by_class"])[np.array(meta["neuron_class"])]
    bias = np.full(N, meta["bias"]["brain"])
    cls = np.array(meta["neuron_class"])
    bias[cls == meta["bias"]["sens_class"]] = meta["bias"]["sens"]
    pl = meta["plastic"]
    pl_edge, pl_pre, pl_post, mb_of = (np.array(pl[k]) for k in ("edge", "pre", "post", "mbon_of_edge"))
    dan = np.array(pl["dan"])
    D = np.zeros((pl["n_mbon"], len(dan)))
    D[pl["D_rows"], pl["D_cols"]] = pl["D_vals"]
    rows = np.repeat(np.arange(N), np.diff(indptr))
    w0 = w[pl_edge]
    amp = meta["input"]["amp"]
    chans = meta["input"]["channels"]
    dt, h, RMAX = meta["dt"], meta["dt"] / meta["substeps"], meta["rmax"]
    r = np.zeros(N); d = np.zeros(len(pl_edge))
    rec = []
    for g in sched["rec_names"]:
        base = g.split("_")[0] if g.rsplit("_", 1)[-1] in ("L", "R") and g not in meta["output"] else g
        if g in meta["output"]:
            rec.append(meta["output"][g]["left"] + meta["output"][g]["right"] + meta["output"][g]["mid"])
        else:
            side = {"L": "left", "R": "right"}[g.rsplit("_", 1)[-1]]
            rec.append(meta["output"][base][side])
    rates, states = [], {0: (r.copy(), d.copy())}
    for t in range(sched["steps"]):
        I = np.zeros(N)
        for ev in sched["schedule"]:
            if not (ev["start"] <= t < ev["end"]):
                continue
            if ev["type"] == "channel":
                c = chans[ev["name"]]
                I[c["left"]] += amp * ev["left"]; I[c["right"]] += amp * ev["right"]
                I[c["mid"]] += amp * 0.5 * (ev["left"] + ev["right"])
            elif ev["type"] == "celltype":
                I[sched["celltype_idx"][ev["name"]]] += amp * ev["value_amp"]
            else:
                I[sched["pam_idx"]] += ev["value"]
        for _ in range(meta["substeps"]):
            drive = np.add.reduceat(w * r[indices], indptr[:-1]) if False else np.bincount(rows, weights=w * r[indices], minlength=N)
            drive = drive + bias + I
            drive += np.bincount(pl_post, weights=w0 * d * r[pl_pre], minlength=N)
            r = r + alpha * (RMAX * np.tanh(np.maximum(drive, 0) / RMAX) - r)
        g = D @ r[dan]
        gate = g[mb_of] * r[pl_pre]
        d = np.maximum(-1.0, d + dt * (-pl["eta_d"] * gate * (1 + d) - pl["eta_r"] * d))
        rates.append([r[ix].mean() for ix in rec])
        if t + 1 in (100, 300):
            states[t + 1] = (r.copy(), d.copy())
    rates = np.array(rates)
    f = (OUT / "parity_rates.bin").read_bytes()
    _, steps, nrec, _ = struct.unpack_from("<4sIII", f, 0)
    ref = np.frombuffer(f, "<f8", steps * nrec, 16).reshape(steps, nrec)
    err_rate = float(np.abs(rates - ref).max())
    s = (OUT / "parity_state.bin").read_bytes()
    _, ns, n, ne, _ = struct.unpack_from("<4sIIII", s, 0)
    o = 20
    err_state = 0.0
    for _ in range(ns):
        (k,) = struct.unpack_from("<I", s, o); o += 4
        rr = np.frombuffer(s, "<f8", n, o); o += 8 * n
        dd = np.frombuffer(s, "<f8", ne, o); o += 8 * ne
        err_state = max(err_state, float(np.abs(states[k][0] - rr).max()), float(np.abs(states[k][1] - dd).max()))
    res = {"max_err_rates": err_rate, "max_err_state": err_state, "rate_range": [float(ref.min()), float(ref.max())], "d_min": float(states[300][1].min())}
    print(json.dumps(res))
    return res


if __name__ == "__main__":
    main()
