# -*- coding: utf-8 -*-
"""构建入口：python build.py（默认两阶段全跑；--scores / --html 可单独跑）。

  --scores   只重建 data/scores.csv（改了 raw_*.csv / mapping / canon 后跑这个）
  --html     只刷新 model-radar.html 数据区（改了壳或展示元数据表后跑这个）

同一份输出连跑两次字节一致（幂等；跨天会因 meta.built 日期变化而不同，属正常）。
"""
from __future__ import annotations

import sys

import pandas as pd

from radar import emit, families, ledger, tables
from radar.config import FAMILY_MIN_N, SCORES_CSV


def build_scores() -> None:
    """阶段①：raw → 证据账本 scores.csv。"""
    canon = tables.load_canon()
    mapping = tables.load_mapping()
    raw = families.tb_dedup(tables.load_raw(canon))

    rows, skipped = families.evidence_rows(raw, mapping)
    if skipped:
        print("[提示] 以下类别**既未映射、也未在 data/mapping.csv 里声明「有意不映射」**（请检查该表）：")
        for s in sorted(set(skipped)):
            print(f"  - {s}")

    rows, stats = families.family_scores(rows)
    families.report(stats)

    inferred = tables.load_inferred_raw()
    inf_rows = families.inferred_rows(inferred)
    if inf_rows:
        print(f"[推理补全] {len(inf_rows)} 条推理值并入 scores.csv：来源标「推理补全」，"
              "默认口径不计入维度分，页面可切「含推理补全」查看")
    rows += inf_rows

    out = emit.write_scores(rows)
    scored = out[pd.to_numeric(out["族内n"], errors="coerce") >= FAMILY_MIN_N]
    print(f"\n已重建 {SCORES_CSV}：{len(out)} 条证据（其中推理补全 {len(inf_rows)} 条），"
          f"覆盖 {out['模型'].nunique()} 个模型 × {out['维度'].nunique()} 个维度；"
          f"其中计分（族内 >= {FAMILY_MIN_N}）{len(scored)} 条、"
          f"计分覆盖 {scored.groupby(['模型', '维度']).ngroups} 格")
    emit.coverage_report(out)


def build_html() -> None:
    """阶段②：scores.csv + 展示元数据 → 页面数据区。"""
    emit.write_shell(ledger.build_ledger())


def main() -> None:
    only_scores = "--scores" in sys.argv
    only_html = "--html" in sys.argv
    if "--single" in sys.argv:
        print("[提示] --single 已废弃：model-radar.html 现在本身就是单文件，无需再另打一份。")
    if not only_html:
        build_scores()
    if not only_scores:
        build_html()


if __name__ == "__main__":
    main()
