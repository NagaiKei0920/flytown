

## 2026-10-29 M1 回路抽出・較正・応答表（pipeline.build）
- 内容: N=18681、E=404518、調整前 2/12、調整後 5/12（ゲート 9: 不合格）、学習効果 +0.1486（dA - dB、20 シード）、numpy 2.16 ms/ステップ。
- 詳細: docs/reports/m1.md、m1_response_table.md。未検証: MBON 価値の割り当て、摂食 MN と MN9 の対応、JS 実装との一致（M2）。

## 2026-10-30 M1 回路抽出・較正・応答表（pipeline.build）
- 内容: N=18681、E=404518、調整前 2/12、調整後 5/12（ゲート 9: 不合格）、学習効果 +0.1486（dA - dB、20 シード）、numpy 2.16 ms/ステップ。
- 詳細: docs/reports/m1.md、m1_response_table.md。未検証: MBON 価値の割り当て、摂食 MN と MN9 の対応、JS 実装との一致（M2）。

## 2026-10-30 M4 場・置く・注射器・脳パネル
- 内容: 実 Field（TownField）で中立地点の無刺激応答（check-brain 4x4 地点・向き）turn 平均 -0.018（最大 |0.056|）、groom 平均 0.032（最大 0.042）、forward 0.497。M2 の StubField では turn -0.38、groom 0.37。`npm run check:sim` の場の試験（バナナ・風向・ヒーター・氷・加湿器・送風機・コーン・噴水・殺虫器 4.00 s・ハエ取り紙 6.02 s・cVA 自己除外）全合格、場の更新 約 1 ms / 0.1 s。verify:parity 合格（誤差 2e-11）。build 合格。
- 詳細: docs/reports/m4.md。未検証: 学習の基準（匂い A + ご褒美 3 回 -> 接近率 +20 点）のゲーム内計測、実機ブラウザ長時間の fps、教室 PC。

## 2026-10-30 M5 お題・言語・行動計測
- 内容: `npm run check:behavior`（20 シード、回路 sha256 先頭 12 桁 dc58423c3a0f）。バナナ接近 15%（対照 15%）否、ジオスミン回避 15%（対照 15%）否、ヒーター滞在 7.8 s（対照 6.2 s）否、車への羽ばたき 90%（対照 35%）合、学習 +0 点（基準 +20）否。build / check:sim / verify:parity（2.1e-11）合格。
- 詳細: docs/reports/m5_behavior.md、m5.md。未検証: 実際の脳での各お題の達成可能性、Pages 実配信、教室 PC。

## 2026-10-30 M1 ラウンド 2 回路抽出・較正・応答表（pipeline.build）
- 内容: N=18697（TONIC 1 細胞を含む）、E=405893、調整前 2/12、調整後 3/12（ゲート 9: 不合格）、学習効果 +0.2125（dA - dB、20 シード）、numpy 1.31 ms/ステップ。
- 詳細: docs/reports/m1.md、m1_response_table.md。未検証: MBON 価値の割り当て、摂食 MN と MN9 の対応、DNa01 の同定、P9 = DNp09、停止 DN。一致: verify:parity 最大誤差 7.3e-12、verify_export 6.7e-16、check-brain PASS。ラウンド 1（5/12）より悪化。
