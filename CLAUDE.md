# FLYTOWN — 作業ルール

- 仕様は `docs/SPEC.md`、段階と合格条件は `docs/ROADMAP.md`、入出力細胞は `docs/M0_inputs.md` が正。読んでから作業する。
- Python は `../flybot/.venv/bin/python`（3.12, jax/pandas/pyarrow あり）。追加パッケージが要るなら `pipeline/requirements.txt` に書いて報告する。
- FlyWire 生データは `../flybot/data/flywire/` を読むだけ。flybot のファイルは編集しない（流用はこのリポジトリへ写す）。
- 生成物: `data/`（git 管理外の中間物）、`web/public/circuit/`（配布する回路。CC BY-NC 4.0）。
- 行動を台本で書かない。ハエ人の動きは DN 出力の写像からだけ決める。物理（衝突・転倒）は別。
- 全機能を CLI で再実行できるようにする（乱数シード固定）。結果は数値で `docs/VERIFICATION_LOG.md` に追記（日付・ID・何をして・数値・合否・未検証点）。
- 新しい設計判断はしない。曖昧な点は `docs/consult/NNN-*.md` に書き、既定案で進める。
- マシンは M1 Mac 8 GB。1 プロセス 2 GB 以内。
- git commit はしない（Opus がまとめる）。
- 日本語は簡潔に。UI の日本語はです・ます調で事実をそのまま書く。絵文字は使わない。
