"""入力チャネル・出力群の定義（docs/M0_inputs.md に対応）。extract / export / response_table が共有する。"""
import re

import numpy as np

from .variant import R2

# チャネル名 -> 選択規則（cell_type の完全一致リスト / cell_type 正規表現 / cell_sub_class）
INPUT_CHANNELS = {
    "vinegar": {"cell_type": ["ORN_DM1", "ORN_DM4", "ORN_DP1m", "ORN_DM2"]},
    "geosmin": {"cell_type": ["ORN_DA2"]},
    "co2": {"cell_type": ["ORN_V"]},
    "cva": {"cell_type": ["ORN_DA1", "ORN_VA1v"]},
    "fruit": {"cell_type": ["ORN_DL1", "ORN_DM3"]},
    "sugar": {"cell_type": ["LB3c", "LB3b"]},
    "bitter": {"cell_type_regex": r"^LB1[a-d]$"},
    "water": {"cell_type": ["LB3a"]},
    "heat": {"cell_type": ["TRN_VP2"]},
    "cold": {"cell_type": ["TRN_VP3a", "TRN_VP3b"]},
    "humid": {"cell_type": ["HRN_VP5", "TRN_VP1m"]},
    "dry": {"cell_type": ["HRN_VP4"]},
    "wind": {"cell_sub_class": ["wind_gravity"]},
    "bristle": {"cell_sub_class": ["head bristle"]},
    "ocellar": {"cell_sub_class": ["ocellar"]},
    "lplc2": {"cell_type": ["LPLC2"]},
    "lc4": {"cell_type": ["LC4"]},
    "lplc1": {"cell_type": ["LPLC1"]},
    "lc16": {"cell_type": ["LC16"]},
}

# 出力群。cell_type 正規表現（完全一致）。
OUTPUT_GROUPS = {
    "DNp09": r"DNp09",
    # r1: DNa01 のみ。r2（不採用の実験、docs/consult/004）: FlyWire の名前が 2 つあるので DNae001 も合算
    "DNa01": r"DNa01|DNae001" if R2 else r"DNa01",
    "DNa02": r"DNa02",
    "MDN": r"MDN",
    "DNp01": r"DNp01",
    "DNg02": r"DNg02_[a-h]",
    "DNg11": r"DNg11",
    "DNg12": r"DNg12_[a-e]",
}
MOTOR_NERVES = ["MxLbN", "PhN"]


def select(a, rule):
    ct = a["cell_type"].fillna("")
    m = np.zeros(len(a), bool)
    if "cell_type" in rule:
        m |= ct.isin(rule["cell_type"]).to_numpy()
    if "cell_type_regex" in rule:
        m |= ct.str.match(rule["cell_type_regex"] + "$").to_numpy()
    if "cell_sub_class" in rule:
        m |= a["cell_sub_class"].isin(rule["cell_sub_class"]).to_numpy()
    return m


def select_output(a, pat):
    return a["cell_type"].fillna("").str.fullmatch(pat).to_numpy()
