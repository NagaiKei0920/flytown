"""行動を狙った調整（最大 20 個のゲイン、各 0.1〜10 倍、配線は変えない）。

貪欲な座標探索: 候補ゲインを順に、倍率 {0.2, 0.5, 2, 5} の中で 12 項目の目的関数が最も上がるものを採用（上がらなければ 1.0 のまま）。
目的関数 = sum_i clip(score_i, -5, 8) + 2 * (合格項目数)。score_i は期待方向の効果の z（response_table.evaluate の score）。
"""
import json
import time

import numpy as np

from .assemble import CDIR, Assembly, load_params, save_params
from .response_table import evaluate

CANDIDATES = ["ch:sugar", "inh:out:FEED", "exc:out:FEED", "ch:bitter", "ch:bristle", "out:DNg11", "out:DNg12", "ch:wind",
              "out:DNp09", "inh:out:DNp09", "out:MDN", "exc:out:MDN", "ch:lc16", "ch:lplc1", "ch:geosmin", "ch:co2", "ch:cold",
              "out:DNa02", "out:DNa01", "ch:vinegar", "ch:heat"]
GRID = [0.2, 0.5, 2.0, 5.0]
MAX_GAINS = 20
SEEDS = 2
BSEEDS = (100, 101)


def objective(rows):
    return sum(float(np.clip(r["score"], -5, 8)) + (2.0 if r["pass"] else 0.0) for r in rows)


def main(log=print, resume=False):
    t0 = time.time()
    A = Assembly()
    p = load_params()
    p["tuned_gain"] = json.loads((CDIR / "tuned.json").read_text()) if resume else {}
    rows, _ = evaluate(A, p, SEEDS, bseeds=BSEEDS)
    best = objective(rows)
    log(f"start objective {best:.2f} pass {sum(r['pass'] for r in rows)}")
    for key in CANDIDATES:
        if resume and key in CANDIDATES[:20]:
            continue
        if len(p["tuned_gain"]) >= MAX_GAINS:
            break
        cand = None
        for g in GRID:
            q = dict(p)
            q["tuned_gain"] = dict(p["tuned_gain"])
            q["tuned_gain"][key] = g
            rows, _ = evaluate(A, q, SEEDS, bseeds=BSEEDS)
            o = objective(rows)
            if o > best + 0.05:
                best, cand = o, g
                log(f"  {key} x{g}: objective {o:.2f} pass {sum(r['pass'] for r in rows)}")
        if cand is not None:
            p["tuned_gain"][key] = cand
        log(f"{key}: {'x' + str(cand) if cand else 'unchanged'} (best {best:.2f}, {time.time()-t0:.0f}s)")
    assert len(p["tuned_gain"]) <= 20 and all(0.1 <= v <= 10 for v in p["tuned_gain"].values())
    save_params(p)
    (CDIR / "tuned.json").write_text(json.dumps(p["tuned_gain"], indent=1))
    return p["tuned_gain"]


if __name__ == "__main__":
    import sys
    main(resume="--resume" in sys.argv)
