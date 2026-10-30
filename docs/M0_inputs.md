# M0 入力・出力細胞の対応表（2026-10-29 確定）

FlyWire v783 注釈 `Supplemental_file1_neuron_annotations.tsv` から実測。列は「注釈の列 = 値」。

## 入力（ゲームが計算した量を入れる細胞）
| 刺激 | 感覚チャネル | 細胞（注釈） | 数 |
|---|---|---|---|
| 発酵臭（ゴミ・果物・酢） | 酢・エタノール | cell_type = ORN_DM1, ORN_DM4, ORN_DP1m, ORN_DM2 | 68+41+32+54 |
| カビ臭 | ジオスミン | ORN_DA2 | 39 |
| 排気・人混み | CO2 | ORN_V | 67 |
| ほかのハエ人 | cVA・集合 | ORN_DA1, ORN_VA1v | 126+94 |
| パン屋の甘い匂い | 果実エステル | ORN_DL1, ORN_DM3 | 69+61 |
| 糖（接触） | 甘味 | cell_type = LB3c（sugar）, LB3b（sugar/low_salt） | 32+25 |
| 苦味（接触） | 苦味 | LB1a〜LB1d（bitter） | 42 |
| 水（噴水に触れる） | 水 | LB3a（water） | 30 |
| 暑い | 温度（暖） | TRN_VP2（heating） | 7 |
| 寒い | 温度（冷） | TRN_VP3a, TRN_VP3b（cold） | 9 |
| 湿度 | 湿・乾 | HRN_VP5（moist）, TRN_VP1m（humid）, HRN_VP4（dry） | 16+13+29 |
| 風 | 機械感覚 | cell_sub_class = wind_gravity | 484 |
| 粉じん | 頭の剛毛 | cell_sub_class = head bristle | 305 |
| 光 | 単眼 | cell_sub_class = ocellar | 273 |
| 迫る物（車・ハエたたき） | 接近 | cell_type = LPLC2, LC4 | 210+(LC4 のみ M1 で数える) |
| 障害物の多さ | 物体・小さな動き | LPLC1, LC16 | 140+151 |

左右: 注釈の side 列で左右に分け、左右の量を別に入れる。

## 出力（体の命令を読む細胞）
| 命令 | 細胞 |
|---|---|
| 前進 | DNp09 |
| 旋回 | DNa01, DNa02 の左右差 |
| 後退 | MDN |
| 跳躍・羽ばたき | DNp01（巨大線維）, DNg02_a〜h |
| 身繕い | DNg11, DNg12_a〜e |
| 摂食（口吻） | MN9 という名前は無い。super_class = motor かつ nerve = MxLbN（26 個）のうち、糖 GRN から 2 段以内で最も強く入力を受けるものを M1 で選ぶ |

## ドーパミン
| ボタン | 細胞 |
|---|---|
| ご褒美 | PAM01〜PAM12（307） |
| お仕置き | PPL1 系（PPL101 ほか 16） |

## ライセンス（2026-10-29 確認）
- Zenodo 10676866: CC BY 4.0。FlyWire 引用ガイド（flywire.ai/guidelines）: 公開データは CC BY-NC 4.0。食い違うため厳しい方に合わせる。
- 注釈リポジトリ flyconnectome/flywire_annotations: LICENSE ファイル無し。
- 方針: コードは MIT。`web/public/circuit/` の回路データは CC BY-NC 4.0 として別扱いし、README と同フォルダの LICENSE に明記。本作は非営利。
- 引用: Dorkenwald 2024, Schlegel 2024, Matsliah 2024, Berg 2026, Tastekin 2026, Buhmann 2021, Eckstein 2024。
