# -*- coding: utf-8 -*-
"""输出层：scores.csv 落盘 + ledger 写入 model-radar.html 数据区。"""
from __future__ import annotations

import json

import pandas as pd

from radar.config import REGION_BEGIN, REGION_END, REGION_RE, SCORES_CSV, SHELL


def write_scores(rows: list[dict]) -> pd.DataFrame:
    """证据行 → data/scores.csv（UTF-8-sig；「族/族内n」两列随行）。"""
    out = pd.DataFrame(rows)[["模型", "维度", "榜单分", "备注", "族", "族内n"]]
    out = out.sort_values(["模型", "维度"]).reset_index(drop=True)
    out.to_csv(SCORES_CSV, index=False, encoding="utf-8-sig")
    return out


def coverage_report(scores: pd.DataFrame) -> None:
    """打印 模型 × 维度 的每格证据条数矩阵（构建日志的人读摘要）。"""
    cov = scores.pivot_table(index="模型", columns="维度", values="榜单分", aggfunc="count")
    print("\n覆盖情况（每格=证据条数）：")
    print(cov.fillna(0).astype(int).to_string())


def write_shell(ledger: dict) -> None:
    """ledger JSON → 原地覆写 model-radar.html 的「数据区」（其余壳不动）。

    `</` 转义防 </script> 提前闭合；标记缺失即报错，绝不盲写。
    """
    payload = ("<script>window.RADAR_LEDGER = "
               + json.dumps(ledger, ensure_ascii=False, separators=(",", ":"))
               .replace("</", "<\\/")
               + ";</script>\n")
    shell = SHELL.read_text(encoding="utf-8")
    if not REGION_RE.search(shell):
        raise SystemExit(
            f"model-radar.html 里找不到「数据区」标记（{REGION_BEGIN} … / {REGION_END}），"
            "请核对展示壳是否被改坏。")
    SHELL.write_text(REGION_RE.sub(lambda m: m.group(1) + payload + m.group(3),
                                   shell, count=1), encoding="utf-8")

    n_pending = sum(1 for m in ledger["models"] if not m["scores"])
    n_tp = sum(1 for m in ledger["models"] if "scoresTp" in m)
    n_vend = sum(1 for e in ledger["evidence"] if e.get("vend"))
    n_inf = sum(1 for e in ledger["evidence"] if e.get("inf"))
    print(f"已更新 {SHELL.name} 数据区：{len(ledger['models'])} 个模型"
          f"（待定 {n_pending} 个）· {len(ledger['evidence'])} 条证据"
          f"（其中厂商自报 {n_vend} 条 / {n_tp} 个模型的第三方口径与全量口径不同"
          f" / 推理补全 {n_inf} 条）· "
          f"{len(payload) / 1024:.1f} KB 内联数据 · 构建于 {ledger['meta']['built']}")
