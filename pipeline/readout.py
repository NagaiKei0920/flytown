"""DN -> 体の命令。固定の線形写像 + クリップ。docs/MODEL.md「読み出し」が正。係数は較正後も変えない。

入力: 出力群ごとの平均発火率の時系列 rec (T, n_rec)（sim.Sim.rec_names の順）と、自発活動の統計 (mu, sd)。
  z_x = (x - mu_x) / max(sd_x, SD_FLOOR, SD_REL * mu_x)
  forward  = clip(V0 + K * (z_DNp09 - z_MDN), 0, 1)
  backward = clip(K * z_MDN, 0, 1)
  turn     = clip(K * ((z_DNa02_L - z_DNa02_R) + W_A01 * (z_DNa01_L - z_DNa01_R) + W_P9 * (z_DNp09_L - z_DNp09_R)), -1, 1)    正 = 左旋回（W_P9 項は r2 のみ。r1 は項なし）
  escape   = clip(K * z_DNp01, 0, 1)            DNp01 = 左右の平均
  flap     = clip(K * z_DNg02, 0, 1)
  groom    = clip(K * (z_DNg11 + z_DNg12) / 2, 0, 1)
  feed     = clip(K * z_FEED, 0, 1)
"""
import numpy as np

from .variant import R2

K = 0.1
V0 = 0.5
W_P9 = 0.5 if R2 else 0.0   # DNp09 の左右差の旋回への寄与（Bidaye+ 2020）。r2（不採用の実験）のみ。r1 は項なし
W_A01 = 0.5           # DNa01 は低ゲイン、DNa02 は高ゲイン（Rayshubskiy+ 2024）
SD_FLOOR = 0.02
SD_REL = 0.5          # 各細胞群の自発活動の平均に対する割合の下限（左右それぞれの基準で正規化）
COMMANDS = ["forward", "backward", "turn", "escape", "flap", "groom", "feed"]


def coefficients():
    if R2:
        return {"K": K, "V0": V0, "W_A01": W_A01, "W_P9": W_P9, "SD_FLOOR": SD_FLOOR, "SD_REL": SD_REL}
    return {"K": K, "V0": V0, "W_A01": W_A01, "SD_FLOOR": SD_FLOOR, "SD_REL": SD_REL}


def baseline_stats(rec):
    """rec (T, n_rec) -> (mu, sd)。自発活動（刺激なし）の時間平均と標準偏差。"""
    return rec.mean(0), rec.std(0)


def z_of(rec, names, mu, sd):
    sdv = np.maximum(np.maximum(sd, SD_FLOOR), SD_REL * mu)
    return {nm: (rec[:, i] - mu[i]) / sdv[i] for i, nm in enumerate(names)}


def commands(rec, names, mu, sd):
    z = z_of(rec, names, mu, sd)
    zp9 = 0.5 * (z["DNp09_L"] + z["DNp09_R"])
    zmdn = z["MDN"]
    turn = (z["DNa02_L"] - z["DNa02_R"]) + W_A01 * (z["DNa01_L"] - z["DNa01_R"])
    if R2:
        turn = turn + W_P9 * (z["DNp09_L"] - z["DNp09_R"])
    out = {
        "forward": np.clip(V0 + K * (zp9 - zmdn), 0, 1),
        "backward": np.clip(K * zmdn, 0, 1),
        "turn": np.clip(K * turn, -1, 1),
        "escape": np.clip(K * 0.5 * (z["DNp01_L"] + z["DNp01_R"]), 0, 1),
        "flap": np.clip(K * z["DNg02"], 0, 1),
        "groom": np.clip(K * 0.5 * (z["DNg11"] + z["DNg12"]), 0, 1),
        "feed": np.clip(K * z["FEED"], 0, 1),
    }
    return out
