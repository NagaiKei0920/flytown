"""パイプラインの版 (--variant r1|r2)。既定は r1（出荷した版）。

r1: 出荷した M1 ラウンド 1。TONIC 細胞なし、DNa01 は `DNa01` のみ、読み出しに W_P9 項なし。
r2: 不採用の実験（docs/consult/004）。TONIC 細胞、DNa01 に DNae001 を合算、W_P9 = 0.5。コードは再現用に残す。
`python -m pipeline.<module> --variant r2` か環境変数 FLYTOWN_VARIANT で選ぶ。import 時に決まる。
"""
import os
import sys


def _pick():
    v = os.environ.get("FLYTOWN_VARIANT", "r1")
    a = sys.argv
    for i, x in enumerate(a):
        if x == "--variant" and i + 1 < len(a):
            v = a[i + 1]
        elif x.startswith("--variant="):
            v = x.split("=", 1)[1]
    if v not in ("r1", "r2"):
        raise SystemExit(f"--variant は r1 か r2: {v}")
    return v


VARIANT = _pick()
R2 = VARIANT == "r2"
