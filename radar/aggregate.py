# -*- coding: utf-8 -*-
"""聚合层：维度分（三口径）、单基准标记、维度统计。

维度分（v0.26 分级入分）= 该维**计分行**（族内n ≥ 2、非推理）位次分的
**加权均值**，权重 = config.fam_weight(族内n)（n≥4 ×1.0 / n=3 ×0.67 / n=2 ×0.33）。
三口径只决定哪些证据进入均值，位次分本身按全池只算一次：
    全部来源     全部计分行（含厂商自报）
    仅第三方     再剔除 VENDOR_SRC 渠道 → scoresTp（与全量不同才写）
    含推理补全   计分实测优先，无实测的格落推理值 → scoresInf
"""
from __future__ import annotations

import pandas as pd

from radar.config import fam_weight


def _weighted(g: pd.DataFrame) -> float | None:
    """计分行的加权均值（权重按族内人数）；空 → None。"""
    if g.empty:
        return None
    w = g["_famN"].map(fam_weight)
    return round(float((g["榜单分"] * w).sum() / w.sum()), 1)


def model_scores(scores: pd.DataFrame) -> list[dict]:
    """scores（tables.load_scores 的产物）→ 每模型的维度分 + 可选 sf/scoresTp/scoresInf。"""
    for col in ("模型", "维度"):
        scores[col] = scores[col].astype(str).str.strip()
    models: list[dict] = []
    for name, grp in scores.groupby("模型", sort=True):
        dims: dict[str, float] = {}
        dims_tp: dict[str, float] = {}
        dims_inf: dict[str, float] = {}
        sf: dict[str, str] = {}
        sf_tp: dict[str, str] = {}
        for dim, g2 in grp.groupby("维度"):
            scored = g2[g2["_scored"] & g2["榜单分"].notna()]
            v = _weighted(scored)
            if v is not None:
                dims[dim] = v
            # 「仅第三方」= 计分行里再剔除厂商自报渠道
            tp = scored[~scored["_vend"]]
            v_tp = _weighted(tp)
            if v_tp is not None:
                dims_tp[dim] = v_tp
            # 「含推理补全」= 计分实测优先；无任何计分实测才落推理值
            if v is not None:
                dims_inf[dim] = v
            else:
                infv = g2.loc[g2["_inf"], "榜单分"].dropna()
                if len(infv):
                    dims_inf[dim] = round(float(infv.iloc[0]), 1)
            # 「单基准 †」：本维计分行只来自 1 个基准族
            fams_all = set(scored["_fam"]) - {""}
            if dim in dims and len(fams_all) == 1:
                sf[dim] = next(iter(fams_all))
            fams_tp = set(tp["_fam"]) - {""}
            if dim in dims_tp and len(fams_tp) == 1:
                sf_tp[dim] = next(iter(fams_tp))
        item: dict = {"name": name, "scores": dims}
        if sf:
            item["sf"] = sf
        if dims_tp != dims:  # 页面约定：有 scoresTp 就用它，没有就与 scores 相同
            item["scoresTp"] = dims_tp
            if sf_tp:
                item["sfTp"] = sf_tp
        if dims_inf != dims:
            item["scoresInf"] = dims_inf
        models.append(item)
    return models


def dim_stats(scores: pd.DataFrame) -> dict[str, dict]:
    """每维的计分证据构成（抽屉「维度详解」用）：

    {维度: {all: {fams, models, n, names}, tp: 同构（仅第三方口径）}}
    """
    for col in ("模型", "维度"):
        scores[col] = scores[col].astype(str).str.strip()

    def pack(g: pd.DataFrame) -> dict:
        fams = sorted({f for f in g["_fam"] if f})
        return {"fams": len(fams), "models": int(g["模型"].nunique()),
                "n": int(len(g)), "names": fams}

    out: dict[str, dict] = {}
    scored = scores[scores["_scored"] & scores["榜单分"].notna()]
    for dim, g in scored.groupby("维度"):
        out[dim] = {"all": pack(g), "tp": pack(g[~g["_vend"]])}
    return out
