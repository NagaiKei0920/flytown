# PARITY — Python と JS の一致試験データ（M2 用）

生成: `../flybot/.venv/bin/python -m pipeline.export`（`pipeline.build` の最後でも作る）。置き場: `pipeline/out/`。

## 台本 `parity_schedule.json`
300 ステップ（50 Hz、6 s）。ステップ t（0 始まり）で、`start <= t < end` の項目の入力を `I` に加える。雑音なし、学習あり（`learn = true`）。
- `type = channel`: `meta.input.channels[name]` の左/右/正中の細胞へ `amp * (left | right | (left+right)/2)`。
- `type = celltype`: `celltype_idx[name]` の細胞へ `amp * value_amp`。
- `type = group` (name = PAM): `pam_idx` の細胞へ `value`（定数電流）。
`rec_names` は出力群の並び（下の `parity_rates.bin` の列）。`amp` は 3.0。

## `parity_rates.bin`
`"FTP1"`(4) / `u32 steps(=300)` / `u32 n_rec` / `u32 0` / `float64[steps][n_rec]`（行優先）。
各ステップを実行した直後の、出力群ごとの平均発火率（`rec_names` の順。群の細胞番号は `meta.output`、DNp09・DNa01・DNa02・DNp01 は `_L`/`_R` に左右を分ける。FEED は `meta.output.FEED`）。

## `parity_state.bin`
`"FTS1"`(4) / `u32 n_states(=3)` / `u32 N` / `u32 ne` / `u32 0`、続いて 3 回繰り返し:
`u32 step` / `float64 r[N]` / `float64 d[ne]`。
- step 0: 初期状態（全て 0）。
- step 100: 100 ステップ（t = 0〜99）を実行した直後。
- step 300: 300 ステップを全て実行した直後。
`d` の並びは `meta.plastic.edge` の順。

## 合格条件
JS 実装（Float64Array で `r`, `d`、重みは `Float32Array` から読む）で同じ台本を回し、`parity_rates.bin` の全値と状態 3 点の `r`, `d` の最大絶対誤差が 1e-6 以下。
