"""再現コマンド: ../flybot/.venv/bin/python -m pipeline.build
extract -> calibrate -> 調整前の応答表 -> 調整 -> 調整後の応答表 -> 学習 -> export。数値を docs/reports/ に書く。
"""
import datetime
import json
import sys
import time

import numpy as np

from . import calibrate, export, extract, tune
from .assemble import CDIR, Assembly, load_params, save_params
from .common import REPORTS
from .variant import R2, VARIANT
from .response_table import (escape_dose, evaluate, lateral_controls, learning_test, stability, table_md, timing)

SKIP = set(a[2:] for a in sys.argv[1:] if a.startswith("--"))   # --skip-extract / --skip-calibrate / --skip-tune で段階を飛ばす


def log(*a):
    print(*a, flush=True)


def main():
    t0 = time.time()
    rep = {}
    if "reports-only" in SKIP:
        rep = json.loads((CDIR / "build_report.json").read_text())
        write_reports(rep, table_md(rep["rows0"], "調整前（pre-tuning）")[0], table_md(rep["rows1"], "調整後（post-tuning）")[0])
        return
    if "skip-extract" not in SKIP:
        info, fd = extract.main([])
        rep["extract"] = info
        rep["feeding"] = fd
    else:
        rep["extract"] = json.loads((CDIR / "selection.json").read_text())
        rep["feeding"] = json.loads((CDIR / "feeding.json").read_text())
    if "skip-calibrate" not in SKIP:
        rep["calib"] = calibrate.main(log)
    else:
        rep["calib"] = json.loads((CDIR / "calib_info.json").read_text())
    A = Assembly()
    p0 = load_params()
    p0["tuned_gain"] = {}
    save_params(p0)
    (CDIR / "params_pretune.json").write_text(json.dumps(p0, indent=1, ensure_ascii=False))
    log("調整前の応答表")
    rows0, stats0 = evaluate(A, p0, 10)
    lt0 = learning_test(A, p0, 20)
    md0, n0 = table_md(rows0, "調整前（pre-tuning）")
    log(md0)
    if "skip-tune" not in SKIP:
        tuned = tune.main(log)
    else:
        tuned = json.loads((CDIR / "tuned.json").read_text())
    p1 = load_params()
    p1["tuned_gain"] = tuned
    save_params(p1)
    log("調整後の応答表")
    rows1, stats1 = evaluate(A, p1, 10)
    lt1 = learning_test(A, p1, 20)
    md1, n1 = table_md(rows1, "調整後（post-tuning）")
    log(md1)
    ctl0, ctl1 = lateral_controls(A, p0), lateral_controls(A, p1)
    st0, st1 = stability(A, p0), stability(A, p1)
    ms = timing(A, p1)
    from .calibrate import kc_fraction
    kc1 = kc_fraction(A, p1)
    dose0, dose1 = escape_dose(A, p0), escape_dose(A, p1)
    ex = export.main(log, out=(CDIR / "pub") if R2 else None)      # r2 は web/public/circuit を上書きしない
    from collections import Counter
    from .model import CLASSES
    rep.update({"fb_gain_n": int(A.fb_gain_n), "class_counts": dict(Counter(CLASSES[c] for c in A.cls)), "params": p1})
    rep.update({"rows0": rows0, "rows1": rows1, "n0": n0, "n1": n1, "learn0": lt0, "learn1": lt1, "dose0": dose0, "dose1": dose1, "ctl0": ctl0, "ctl1": ctl1,
                "stab0": st0, "stab1": st1, "ms_per_step": ms, "tuned": tuned, "kc_after_tuning": kc1, "export": ex,
                "seconds": time.time() - t0})
    (CDIR / "build_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=float))
    write_reports(rep, md0, md1)


def dose_lines(rep):
    L = ["| 刺激 | 調整前 Δ発火率 | 調整前 Δescape | 調整後 Δ発火率 | 調整後 Δescape |", "|---|---|---|---|---|"]
    for k in rep["dose0"]["doses"]:
        a, b = rep["dose0"]["doses"][k], rep["dose1"]["doses"][k]
        L.append(f"| {k} | {a['delta_rate']:+.3f} | {a['delta_escape_cmd']:+.3f} | {b['delta_rate']:+.3f} | {b['delta_escape_cmd']:+.3f} |")
    return L


def lt_line(lt):
    return (f"dA {lt['dA_mean']:+.4f}、dB {lt['dB_mean']:+.4f}、効果（dA - dB）{lt['effect_mean']:+.4f}（SD {lt['effect_sd']:.4f}、"
            f"Cohen d {lt['cohen_d']:.1f}、正の割合 {lt['frac_positive']*100:.0f}%、{lt['n_seeds']} シード）")


def write_reports(rep, md0, md1):
    d = datetime.date.today().isoformat()
    pre = np.mean([abs(np.mean(lt["pre_A"])) for lt in [rep["learn1"]]])
    L = [f"# M1 刺激応答表（{d}）", "", "固定シード、10 シード（入力ノイズ）。判定の定義は `pipeline/response_table.py` の冒頭。", "",
         md0, "", md1, "",
         "## 学習（項目 13）", "",
         f"- 調整前: {lt_line(rep['learn0'])}", f"- 調整後: {lt_line(rep['learn1'])}",
         "- 手順: 匂い A（ORN_DL1）4 s、後半 2 s に PAM 全細胞へ電流 3.0 を 3 回。匂い B（ORN_DM3）は PAM なしで 3 回。前後で匂い単独 2 s の「接近駆動」を測る。",
         "- 接近駆動 = MBON の発火率の和（コリン作動性 +1、グルタミン酸作動性 -1、他 0）。接近促進/忌避促進の割り当ては Aso+ 2014、Owald+ 2015 の一般則を記憶から当てたもので、未検証。",
         "- シード間の差は入力ノイズだけなので SD は極小（Cohen d は大きく出る。意味があるのは符号と dA - dB の大きさ）。", "",
         "## 片側刺激の対照（turn の変化。左強 / 右強 / 左右同じ）", ""]
    L += ["| # | 調整前 | 調整後 |", "|---|---|---|"]
    for k in rep["ctl0"]:
        a, b = rep["ctl0"][k], rep["ctl1"][k]
        f = lambda x: f"{x['left_strong']:+.3f} / {x['right_strong']:+.3f} / {x['equal']:+.3f}"
        L.append(f"| {k} | {f(a)} | {f(b)} |")
    open(REPORTS / f"m1_{VARIANT}_auto_table.md", "w").write("\n".join(L) + "\n")
    e = rep["extract"]
    M = [f"# M1 記録（{d}）", "", "再現: `../flybot/.venv/bin/python -m pipeline.build`（約 30 分）。", "",
         "## 回路の抽出",
         f"- N = {e['n']}、E = {e['edges']}。種 {e['n_seed']}（入力 {e['seed_counts']['in']}、出力 {e['seed_counts']['out']}、DAN {e['seed_counts']['dan']}、"
         f"MB {e['seed_counts']['mb']}、LH {e['seed_counts']['lh']}、flybot 回路 {e['seed_counts']['flybot']}）。",
         f"- 中間ニューロン: 入力から {e['k']} 段以内 かつ 出力へ {e['k']} 段以内、対のシナプス数 >= {e['tpath']}（和は神経絨をまたいで合算）。候補 {e['n_cand']}、採用 {e['n_taken']}。",
         "  視葉（optic）と、種に無い感覚・視覚投射は除外。",
         "- 選んだ理由: k=2・閾値 10 で候補が全て予算内（N <= 20,000、E <= 600,000）に入り、順位付けによる切り捨てが要らない。k=2・閾値 5 は候補 9,795 で N 上限を超え、k=3 は 20 でも上限超過。",
         f"- 結線の下限は 5 シナプス（flybot と同じ）。E 調整のための追加の間引きは {'なし' if e['min_syn_extra'] == 5 else e['min_syn_extra']}。",
         "- 符号: top_nt（ACh・DA・5HT・OA は興奮、GABA・Glu は抑制）。ただし入力細胞（感覚）は全て興奮に固定（注釈の予測が 5HT/GABA/Glu に散るため。感覚細胞はコリン作動性）。", "",
         "## 摂食（口吻）運動ニューロン", "",
         f"- nerve=MxLbN の運動ニューロン 26 個のうち、糖 GRN（LB3c、LB3b）から 1〜2 段の入力比が最大のタイプ: **{rep['feeding']['type']}**（root_id {', '.join(rep['feeding']['root_ids'])}、左右 1 個ずつ）。",
         "- 入力比 = 対のシナプス数 / 後細胞の全入力シナプス数（全脳、対 5 以上）。1 段 + 2 段の和。タイプ別の上位:", ""]
    M += ["| タイプ | 個数 | 糖(1+2 段) | 苦味(1+2 段) |", "|---|---|---|---|"]
    for r in rep["feeding"]["by_type"][:5]:
        M.append(f"| {r['type']} | {r['n']} | {r['sugar_total']:.4f} | {r['bitter_total']:.4f} |")
    M += ["", "- 糖から直接の入力（1 段）を受ける MxLbN は無く、全て 2 段。入力比は 1 % 未満で、決定的とは言えない（未検証: MN9 との対応は文献で確認していない）。", "",
          "## 較正（行動を狙わない）", "",
          f"- 恒常性ゲイン（後シナプス側クラス、標準刺激列での平均発火率を 0.1 に）: " + ", ".join(f"{k} x{v:.2f}" for k, v in rep["calib"]["class_gain"].items()),
          f"- KC 疎化: APL>KC x{rep['calib']['pair_gain'].get('MB_APL>MB_KC', 1):.2f}。匂い 4 種の KC 発火割合 {np.round(rep['calib']['kc']['kc_frac_by_odor'], 3).tolist()}（平均 {rep['calib']['kc']['kc_frac_mean']*100:.1f}%）、無刺激 {rep['calib']['kc']['kc_frac_baseline']*100:.2f}%。",
          f"- flybot のタイプ対ゲイン（gains.npz、MB 17 対 + CX 43 対のうち重なるもの）を掛けた結線: {rep['fb_gain_n']} 本。",
          "- クラス別ニューロン数: " + ", ".join(f"{k} {v}" for k, v in rep["class_counts"].items()),
          f"- 全体の重みの大きさ rho = {rep['params']['rho']}、感覚の自発入力 {rep['params']['b_sens']}、脳内の自発入力 {rep['params']['b_brain']}、刺激の電流 amp {rep['params']['amp']}、入力ノイズ SD {rep['params']['noise_sd']}。",
          f"- 調整後の KC 発火割合 {np.round(rep['kc_after_tuning'][0], 3).tolist()}、無刺激 {rep['kc_after_tuning'][1]*100:.2f}%。", "",
          "## 安定性", "",
          f"- 調整前: {json.dumps(rep['stab0'])}", f"- 調整後: {json.dumps(rep['stab1'])}",
          f"- numpy 1 ステップ（20 ms、2 サブステップ + 可塑性更新）: {rep['ms_per_step']:.2f} ms（M1 Mac、scipy CSR）。", "",
          "## DNp01 用量反応（接近刺激の強さ 0.1 / 0.3 / 1.0）", ""] + dose_lines(rep) + ["",
          "## 刺激応答表", "",
          f"- 調整前 {rep['n0']} / 12、調整後 {rep['n1']} / 12（ゲート 9）: **{'合格' if rep['n1'] >= 9 else '不合格'}**。詳細は `docs/reports/m1_response_table.md`。", "",
          "## 調整したゲイン（最大 20、0.1〜10 倍）", ""]
    M += ["| キー | 倍率 |", "|---|---|"] + [f"| {k} | x{v} |" for k, v in rep["tuned"].items()]
    M += ["", "## 書き出し", "", f"- {json.dumps(rep['export'])}", "",
          "## 未検証・注意", "",
          "- 構造の修正を調整前の記録より前に 1 回入れた: 最初の版（脳内ニューロンの自発入力なし）は 6 / 12、自発入力 0.05 を全脳内ニューロンに入れた版（以降の調整前）は 4 / 12。後者に固定した理由は、自発活動が無いと「低下」が測れず項目 2・4・10・12 の前進低下が原理的に表現できないため。",
          "- 学習則の定数 ETA_D（1.0 /s）は flybot の 0.3 /s から対提示 3 回で効果が見える値に置き直した（50 Hz、秒単位の提示）。",
          "- 入力ノイズの SD 0.05 は設計値。シード間のばらつきは小さく、z は大きく出やすい。判定は効果量の下限（0.05）と符号一致 80 % も課している。",
          "- 左右の項目（1・2・3・6・7）の採点は「左強 - 右強」の turn 差と、左右同じ強さのときの turn（bias、|bias| < 0.1 が必要）。"
          "旧採点（左強だけ）では 5 項目が合格したが、左右同じ強さでも同じ turn が出ており（bias）、側の判別になっていなかったので改めた。",
          "- bias の原因: 読み出しの正規化ではなく配線。DNa02 は左右 1 細胞ずつで、左 DNa02 は左右どちらの嗅覚入力でも上がり（酢 右強でも +0.10）、右 DNa02 はほとんど動かない。"
          "自発活動の水準も左右で違う（DNa02 左 0.13、右 0.30）。読み出しは細胞群ごとに自発活動の平均・SD で z 化済みで、さらに下限を平均の 50 % に変えて（SD_REL = 0.5）水準差の影響を減らした。それでも bias は残る。配線を直すことは許されないので、そのまま報告する。",
          "- escape の +0.99（z 約 49）: 旧読み出しは z の分母の下限が 0.02 で、DNp01 の発火率が 0.2 上がると命令が 1 にクリップされていた。DNp01 自体は飽和していない（用量反応は escape_dose、報告書の表）。下限を平均の 50 % にしたあとの用量反応は線形に近い。",
          "- 無刺激 60 s の最大発火率は調整前 7.7、調整後 10.0（上限に張り付く細胞がある。有界だが、調整後・20 s 時点で発火率 5 超の細胞は 28 / 18,681（SENS 7、CX_compass 10、OTHER 10、MB_PN 1））。",
          "- 調整は感覚チャネルや出力群ごとのゲインを使っているので、「配線を変えずに行動を作った」のではなく、各出力の感度を合わせた面がある。項目 11 は入力 305 細胞のうち口吻系の BM_Hau・BM_Taste を含み、docs/consult/001 に記した。",
          "- MBON の接近/忌避割り当てと、摂食 MN の同定（MN9 との対応）は文献未確認。",
          f"- 所要時間 {rep['seconds']/60:.1f} 分。"]
    open(REPORTS / f"m1_{VARIANT}_auto_record.md", "w").write("\n".join(M) + "\n")
    if not R2:      # r1 の再実行は検証ログを書き換えない（出荷時の記録が正）
        return
    vl = REPORTS.parent / "VERIFICATION_LOG.md"
    entry = (f"\n## {d} M1 回路抽出・較正・応答表（pipeline.build）\n"
             f"- 内容: N={e['n']}、E={e['edges']}、調整前 {rep['n0']}/12、調整後 {rep['n1']}/12（ゲート 9: {'合格' if rep['n1'] >= 9 else '不合格'}）、"
             f"学習効果 {rep['learn1']['effect_mean']:+.4f}（dA - dB、20 シード）、numpy {rep['ms_per_step']:.2f} ms/ステップ。\n"
             f"- 詳細: docs/reports/m1.md、m1_response_table.md。未検証: MBON 価値の割り当て、摂食 MN と MN9 の対応、JS 実装との一致（M2）。\n")
    old = vl.read_text() if vl.exists() else "# 検証ログ\n"
    marker = f"## {d} M1 ラウンド 2 回路抽出"
    entry = entry.replace(f"## {d} M1 回路抽出・較正・応答表", f"## {d} M1 ラウンド 2 回路抽出・較正・応答表")
    if marker in old:
        i = old.index(marker)
        j = old.find("\n## ", i + 1)
        old = old[:i].rstrip() + ("\n" + old[j:] if j >= 0 else "\n")
    vl.write_text(old.rstrip() + "\n" + entry)


if __name__ == "__main__":
    main()
