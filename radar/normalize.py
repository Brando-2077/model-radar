# -*- coding: utf-8 -*-
"""量纲归一化：原始分 → 0-100（第一步；第二步的族内位次分见 families.py）。"""
from __future__ import annotations


def normalize(v: float, scale: str, pool: list[float]) -> float:
    """原始分 → 0-100。规则见 docs/methodology.md。

    · 0-100 / 百分制：原值直用
    · 0-1 ×100、10 分制 ×10、5 分制 ×20
    · Elo / 指数：**同（来源,类别）池内** min-max 线性映射到 60-100。
      位次分只看名次，这一步不改名次，作用是把「面值」拉进可读区间（n=1 行留面值展示）。
    """
    v = float(v)
    if scale in ("0-100", "百分制"):
        return v
    if scale == "0-1":
        return v * 100
    if scale == "10分制":
        return v * 10
    if scale == "5分制":
        return v * 20
    if scale in ("Elo", "指数"):
        lo, hi = min(pool), max(pool)
        return 60 + (v - lo) / (hi - lo) * 40 if hi > lo else 80
    raise ValueError(f"未知量纲: {scale}")
