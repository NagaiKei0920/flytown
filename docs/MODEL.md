# MODEL — 発火率モデルの仕様（JS 実装者向け）

Python 実装は `pipeline/model.py`（`Net.step`）。この文書だけで JS に移せるように、式・定数・順序を全て書く。
数値の実体は `web/public/circuit/circuit.bin` と `meta.json`。誤差目標は Python との最大差 1e-6（float64 計算）。

## 1. データ
- `circuit.bin`（little-endian）: `"FTC1"`(4 バイト) / `u32 N` / `u32 E` / `int32 indptr[N+1]` / `int32 indices[E]` / `float32 weights[E]`。
  CSR で、行 = 後シナプス、`indices` = 前シナプスの番号。重み `w` は符号・較正ゲイン込み（興奮 +、抑制 -）。
  `E` 本の重みは float32 のまま保持し、計算時に float64 へ広げる（float32 -> float64 は厳密）。
- `meta.json`: 以降で「meta.○○」と書くものの置き場。ニューロン番号は全て 0 始まりで、`circuit.bin` の行と同じ。

## 2. 状態と時間
- 状態: `r[N]`（float64、発火率、初期値 0）、`d[ne]`（float64、可塑的結線の変化分、初期値 0。ハエ人ごとに別）。
- 1 ステップ = 20 ms（50 Hz）= 2 サブステップ × 10 ms（meta.dt = 0.02、meta.substeps = 2、サブステップ幅 `h = dt / substeps = 0.01`）。
- 入力電流 `I[N]` はステップ内で一定（サブステップ間で同じ値）。

## 3. 更新式
```
phi(x)   = RMAX * tanh(max(x, 0) / RMAX)          RMAX = 10  (meta.rmax)
alpha[i] = 1 - exp(-h / tau[cls[i]])               tau は下表(ms)を秒にして使う。meta.alpha_by_class に float64 で入れてある
bias[i]  = 0.3  (cls[i] が SENS)  / 0.05 (それ以外)  (meta.bias.sens, meta.bias.brain)

1 ステップ(r, d, I):
  repeat substeps(2) 回:
      drive[i] = sum_{k in row i} w[k] * r[indices[k]]  +  bias[i]  +  I[i]
      drive[post[e]] += w[edge[e]] * d[e] * r[pre[e]]      (e = 可塑的結線 0..ne-1、w[edge[e]] は float32 を広げた値)
      r[i] = r[i] + alpha[i] * (phi(drive[i]) - r[i])       (全 i を drive から同時に更新)
  学習するとき(ステップ末、r は更新後):
      g[m]   = sum_j D[m][j] * r[dan[j]]                      (m = MBON 番号 0..n_mbon-1、D は疎: meta.plastic.D_rows/D_cols/D_vals)
      gate_e = g[mbon_of_edge[e]] * r[pre[e]]
      d[e]   = max(-1, d[e] + dt * ( -eta_d * gate_e * (1 + d[e]) - eta_r * d[e] ))        (dt = 0.02)
```
- 和の順序は問わない（float64 で 1e-12 以下の差）。`drive` の可塑項は同じサブステップの更新前の `r` を使う。
- 入力ノイズは外部入力として `I` に加える（モデル内に乱数は無い）。

### 時定数（ms）— meta.classes と meta.tau_ms、`meta.neuron_class[i]` がクラス番号
| クラス | tau | クラス | tau |
|---|---|---|---|
| SENS 感覚入力 | 20 | CX_ring / CX_compass / CX_PFN | 50 |
| MB_KC / MB_PN | 20 | CX_FB | 100 |
| MB_APL | 30 | CX_goal | 300 |
| MB_MBON | 50 | LAL / DN / MN / LH | 30 |
| MB_DAN | 200 | OTHER（上記以外の中間ニューロン） | 20 |
根拠: Shiu+ 2024 の全脳モデルが 20 ms、MB と CX は flybot `brain/rate.py` の設計値（測定値ではない）。

## 4. 入力の注入
- 入力チャネル（meta.input.channels）: チャネル名 → `{left:[…], right:[…], mid:[…]}`（ニューロン番号）。
  刺激量 `s_L, s_R`（0〜1 程度）に対し `I[i] += amp * s`（amp = 3.0、meta.input.amp）。`left` は `s_L`、`right` は `s_R`、`mid`（左右不明）は `(s_L + s_R) / 2`。
- チャネル: vinegar, geosmin, co2, cva, fruit, sugar, bitter, water, heat, cold, humid, dry, wind, bristle, ocellar, lplc2, lc4, lplc1, lc16（`docs/M0_inputs.md` の表）。
- 雑音: ゲームは感覚ニューロンの各々に毎ステップ `N(0, 0.05²)`（meta.input.noise_sd）を `I` に加えてよい（Python の応答表は加えている。一致試験は加えない）。
- ドーパミン: 「ご褒美」は PAM 全細胞（meta.dan.pam）、「お仕置き」は PPL1 全細胞（meta.dan.ppl1）の `I` に定数電流（応答表・学習試験では 3.0）を加える。
- 匂い A/B のように細胞タイプ単位で入れたいときは、`meta.neuron_type` から cell_type が一致する細胞に `amp * s` を加える（学習試験は ORN_DL1 と ORN_DM3）。

## 5. 可塑性（KC -> MBON、ドーパミン依存の 3 要素則）
flybot `brain/plasticity.py` と同じ形（Hige+ 2015、Aso & Rubin 2016）。KC_j の活動と、その MBON の区画の DAN の活動が同時のときだけ KC_j -> MBON_i の結合が弱まる。
- 可塑的結線 `e`: 前 = KC、後 = MBON の全結線（meta.plastic.edge は `indices`/`weights` 配列上の位置、pre/post はニューロン番号）。
- 実効重み = `w * (1 + d)`。式 3 の可塑項は `w * d * r_pre` を後 MBON に加えている（基本の `w r` と合わせて `w(1+d) r`）。
- `D[m][j]` = DAN_j -> MBON_m のシナプス数を MBON ごとに行和 1 に正規化したもの（DAN の入力が無い MBON は行が空 = g = 0）。
- 定数: `eta_d = 1.0 /s`、`eta_r = 0.05 /s`（回復の時定数 20 s）、`d >= -1`（meta.plastic）。`eta_d` は flybot の 0.3 /s から、対提示 3 回で効果が見えるよう置き直した設計値。
- ハエ人ごとに `d` を別に持つ。`w`（共有）と `d`（個別）で実効重みが決まる。

## 6. 読み出し（DN -> 体の命令）
`pipeline/readout.py`。出力群の平均発火率（meta.output、`DNa01` など。DNp09/DNa01/DNa02/DNp01 は左右別）を使う。
meta.readout.rec_names の順に、自発活動（刺激なし、入力ノイズあり、暖機 3 s 後 12 s × 5 シード）の平均 `mu` と標準偏差 `sd`（meta.readout.mu / sd）を使って z 化する。
```
z_x      = (x - mu_x) / max(sd_x, 0.02, 0.5 * mu_x)      左右・群ごとに自分の自発活動で正規化
forward  = clip(0.5 + 0.1 * (z_DNp09 - z_MDN), 0, 1)       z_DNp09 = (z_L + z_R) / 2
backward = clip(0.1 * z_MDN, 0, 1)
turn     = clip(0.1 * ((z_DNa02_L - z_DNa02_R) + 0.5 * (z_DNa01_L - z_DNa01_R)), -1, 1)    正 = 左旋回
escape   = clip(0.1 * (z_DNp01_L + z_DNp01_R) / 2, 0, 1)    DNp01（巨大線維）
flap     = clip(0.1 * z_DNg02, 0, 1)                         DNg02_a〜h 全細胞の平均
groom    = clip(0.1 * (z_DNg11 + z_DNg12) / 2, 0, 1)         DNg11 と DNg12_a〜e
feed     = clip(0.1 * z_FEED, 0, 1)                          摂食運動ニューロン（meta.feeding、MxLbN の CB0789 左右）
```
係数（K = 0.1, V0 = 0.5, DNa01 重み 0.5, SD_FLOOR = 0.02, SD_REL = 0.5）は固定で、較正後も変えない。DNa02 を高ゲイン・DNa01 を低ゲインにしたのは Rayshubskiy+ 2024 の記述に合わせたもの。
`mu, sd` は最終の回路で測り直した値で、回路を作り直したら同時に出力される。命令を体の速度・角速度へ写す係数は体側（M3）で決める。

## 7. 一致試験（M2）
`pipeline/out/parity_rates.bin`, `parity_state.bin`, `parity_schedule.json`（形式は `docs/PARITY.md`）。300 ステップ、雑音なし、学習あり。
JS で同じ台本を実行し、全ステップの出力群の平均発火率と、ステップ 0・100・300 の全状態が 1e-6 以内で一致すること。

## 8. ゲームの感覚量 -> 入力チャネル
実装は `web/src/brain/connectome/encode.ts`（`encodeSensors`）。`SensorFrame`（`web/src/sim/sensors.ts`）の値を、チャネルごとの左右の刺激量 `s_L, s_R`（0〜1）にする。定数は `ENCODE`。
`sat01(x)` = 0〜1 に切る。`sat(x, L0)` = `1 - exp(-x / L0)`（x <= 0 で 0）。左右はハエ人から見た左右（左目・左触角 -> `left` の細胞）。

| チャネル | s_L / s_R | 元の量と式 |
|---|---|---|
| vinegar | 左/右 | 触角位置の `odor.fermentation`（0〜1） |
| geosmin | 左/右 | `odor.geosmin` |
| co2 | 左/右 | `odor.co2` |
| cva | 左/右 | `odor.cva` |
| fruit | 左/右 | `odor.sweet`（果実エステル。ORN_DL1・DM3） |
| sugar | 左/右 | `taste.sugar` |
| bitter | 左/右 | `taste.bitter` |
| water | 左/右 | `taste.water`（噴水の縁から 0.6 m 以内の接触のみ） |
| heat | 左/右 | `warm` |
| cold | 左/右 | `cold` |
| humid | 左/右 | `sat01((humidity - 0.5) / 0.5)`（中立 0.5 より湿った分） |
| dry | 左/右 | `sat01((0.5 - humidity) / 0.5)`（中立より乾いた分） |
| wind | 左/右 | 左右の触角の風ベクトルの平均 w = (x, z)、速さ `m = sat01(|w| / 5 m/s)`、`a = (w_x cos yaw - w_z sin yaw) / |w|`（-1 = 左から吹く、+1 = 右から）として `s_L = m (0.5 - 0.5 a)`, `s_R = m (0.5 + 0.5 a)`。真横から来ると風上側だけ、正面・背面なら左右同じ |
| bristle | 左/右 | `dust`（粉じん -> 頭の剛毛） |
| ocellar | 左/右 | 順応した明るさの差 `sat01(max(0, light_側 - avg_側))`。`avg_側` は左右それぞれの `light` の移動平均（時定数 5 s、ハエ人ごと、`EncodeState`）。一定の明るさは 0 に落ち、変化と接近だけが入る |
| lplc2 | 左/右 | `sat(loomingMax, 1.0)`（左目・右目それぞれの 12 本の looming の最大、単位 1/s） |
| lc4 | 左/右 | `sat(loomingMax, 2.0)`（LC4 は小さく速い拡大に敏感として半飽和を 2 倍に置いた設計値） |
| lplc1 | 左/右 | `(obstacle.left + obstacle.front) / 2`、右は `(obstacle.right + obstacle.front) / 2` |
| lc16 | 左/右 | lplc1 と同じ |

- 対応する量が無いもの: `odor.smoke`（煙）はチャネルに対応する細胞が無いので入れない（M4 でも未割り当て。焼き鳥屋の煙は heat + co2 少量で表す）。`mid` の細胞（左右不明）には `(s_L + s_R) / 2` が入る（4 章）。
- 湿度は中立 0.5 で humid = dry = 0（M4 で StubField・TownField とも中立 0.5 を返す）。Field の実装は `web/src/sim/field.ts`（docs/reports/m4.md）。
- 雑音: 感覚ニューロン（クラス SENS、2,521 個）の各々に毎ステップ `N(0, noise_sd²)`（4 章）。エージェントごとに独立なシード付き乱数（mulberry32 + Box-Muller）。`web/src/brain/connectome/batch.ts`。
- ドーパミン注入: `inject(kind, dose, durationMs)`。dose 1/2/3 -> 定数電流 1.5/3.0/4.5。reward = `meta.dan.pam`、punish = `meta.dan.ppl1`、all = `meta.dan.all`。時間はシミュレーション時間。学習はゲーム中は常に有効。
- 読み出しの合成（BodyCommand への写像）: `forward_body = forward - backward`（MDN が上がると前進が下がり後退が上がる）、`flap_body = max(flap, escape)`（SPEC 5.3: DNp01 + DNg02 系 -> 羽ばたき）。`turn`, `groom`, `feed` は 6 章のまま。
- 好みの探り: 約 2 秒ごとに、その時点の `r, d` の複製に各匂いチャネル（vinegar, geosmin, co2, cva, fruit）を左右とも s = 1 で 8 ステップ（学習・雑音なし）与え、後半 4 ステップの MBON 接近駆動 `sum(r_mbon * valence)`（meta.plastic.mbon_valence、ACh +1・Glu -1）の平均を、刺激なしの複製との差にして `tanh(差 / 1.0)` にする（-1〜1）。
