# -*- coding: utf-8 -*-
"""账本组装：管线各层的结果 → window.RADAR_LEDGER 的 dict（页面唯一数据契约）。

键序即契约：meta(title,version,built,sources,disclaimer,noteMissing,scopeSources,
scopeNote,infNote,…,models) / dimensions / scenarios / models / evidence —— JSON 按
插入序序列化，页面与 emit 的字节级对账都依赖这个顺序，调整前先跑 tests。
"""
from __future__ import annotations

import re
from datetime import date

import pandas as pd

from radar import aggregate, tables
from radar.config import (COMPANY_FALLBACK, OPEN_COMPANIES, VENDOR_SRC,
                          VENDOR_SRC_PAGES, VERSION, DATA, fam_weight)

_NOTE_RE = re.compile(
    r"^(?P<src>[^·]+)·(?P<cat>.+?) 原始(?P<raw>-?[0-9.eE+]+)\((?P<scale>[^)]+)\) @(?P<date>.+)$")


def _evidence_items(scores: pd.DataFrame) -> list[dict]:
    """scores.csv 逐行 → 抽屉证据明细（备注串解析回结构化字段）。"""
    inf_map: dict[tuple[str, str], tuple] = {}
    inf_raw = tables.load_inferred_raw()
    if inf_raw is not None:
        for _, r in inf_raw.iterrows():
            inf_map[(r["模型"].strip(), r["维度"].strip())] = (
                r.get("推理方法", ""), r.get("依据", ""),
                r.get("留一MAE", ""), r.get("URL", ""))

    out: list[dict] = []
    for _, r in scores.iterrows():
        val = r["榜单分"]
        val = None if val is None or pd.isna(val) else round(float(val), 1)
        m = _NOTE_RE.match(str(r["备注"]))
        if m:
            item = {"m": r["模型"], "d": r["维度"],
                    "src": m.group("src"), "cat": m.group("cat"),
                    "raw": float(m.group("raw")), "scale": m.group("scale"),
                    "date": m.group("date"), "val": val}
        else:  # 兜底：备注格式异常也不丢行（validate 会另行报警）
            item = {"m": r["模型"], "d": r["维度"], "src": "", "cat": "",
                    "raw": None, "scale": "", "date": "", "val": val}
        if bool(r["_vend"]):
            item["vend"] = 1
        if bool(r["_inf"]):
            item["inf"] = 1
        if r["_fam"]:
            item["fam"] = r["_fam"]
            item["famN"] = int(r["_famN"])
            item["w"] = fam_weight(int(r["_famN"]))
        if item.get("inf"):
            detail = inf_map.get((item["m"], item["d"]))
            if detail:
                item["method"], item["basis"], item["loeoMAE"], item["url"] = detail
        out.append(item)
    return out


def build_ledger() -> dict:
    """全量组装。输入 = data/*.csv，输出 = 页面数据契约（见模块 docstring 的键序）。"""
    scores = tables.load_scores()
    roster = tables.load_roster()
    companies = tables.load_companies()

    # 模型条目：账本模型 + 名册覆盖（公司/开源/日期/备注）+ 名册独有的待定占位
    models = aggregate.model_scores(scores)
    seen = {m["name"] for m in models}
    for m in models:
        item = roster.pop(m["name"], None)
        fields = item.as_dict() if item else {}
        company = fields.pop("company", "") or companies.get(
            m["name"], COMPANY_FALLBACK.get(m["name"], ""))
        if company:
            m["company"] = company
            if "open" not in fields:  # 名册留空 → 公司级兜底
                m["open"] = company in OPEN_COMPANIES
        m.update(fields)
    for name, item in roster.items():  # 剩下的 = 没进账本的待定模型
        m: dict = {"name": name, "scores": {}}
        fields = item.as_dict()
        company = fields.pop("company", "") or companies.get(name, "")
        if company:
            m["company"] = company
            if "open" not in fields:
                m["open"] = company in OPEN_COMPANIES
        m.update(fields)
        models.append(m)
    models.sort(key=lambda x: x["name"])

    # 维度定义 + 计分统计
    dims = tables.load_dimensions()
    dstat = aggregate.dim_stats(scores)
    for d in dims:
        s = dstat.get(d["name"])
        if s:
            d["stats"] = s

    # meta（sources 的日期区间取自两张最活跃的 raw 表）
    lb = pd.read_csv(DATA / "raw_livebench.csv", dtype=str)["数据日期"]
    aa = pd.read_csv(DATA / "raw_aa_lmarena.csv", dtype=str)["数据日期"]
    n_evidence = int(scores["榜单分"].notna().sum())
    n_pending = sum(1 for m in models if not m["scores"])
    scope_pages = [s for s in VENDOR_SRC_PAGES if s in VENDOR_SRC]

    ledger = {
        "meta": {
            "title": "模型雷达图",
            "version": VERSION,
            "built": date.today().isoformat(),
            "sources": (
                f"LiveBench {lb.min()}（{lb.max()} 快照） · SuperCLUE 2026-07/09 · "
                f"Artificial Analysis {aa.min()}~{aa.max()} · LMArena 榜单 · "
                f"SUYOUUMO 综合全球榜（2026-10-17） · 厂商官方渠道（含 DeepSeek官方） · "
                f"酥悠沫聚合（第三方） · 共 {n_evidence} 条证据"),
            "disclaimer": (
                "数据来自公开榜单，仅供选型参考，请以个人体感为准。"
                "⚠ 维度分不是绝对刻度：全部来源都已归并为「基准族内位次分」——"
                "你在该基准的模型池里赢过的对手比例（0-100）。同一基准跨来源只算一票；"
                "族内 2–3 个模型的基准为低置信证据，按 w=(n−1)/3 降权计入"
                "（×0.67 / ×0.33）；仅 1 个模型的基准不计分（单模型无对手，面值保留可查）。"
                "位次分是池内相对分：增减模型会让全池该维分数整体移动，跨期看图只比相对位次。"),
            "noteMissing": ("缺数据的维度不参与绘制、也不计入维度分"
                            "（雷达上画成断口、条形上留空位——不是 0 分）；"
                            "计算综合分时该维权重自动让位。"),
            "scopeSources": scope_pages,
            "scopeNote": (
                "顶栏的数据口径开关（三个按钮）："
                "「全部来源」= 所有实测证据（含厂商自报，不含推理补全）；"
                "「仅第三方榜单」= 把厂商自报渠道（Z.ai / dots / 腾讯 / NVIDIA / DeepSeek / Kimi官方"
                " / 酥悠沫-官方转录的厂商表）的证据整体排除，仅用第三方榜单重算；"
                "「含推理补全」= 在「全部来源」基础上，再把公开榜抽不到的格子补上推理值"
                "（不丢实测、只补空）。判断依据是来源渠道而非是否自家模型："
                "NVIDIA 官方页给非自家模型报的分也排除。"
                "位次分按全池只算一次，三种口径只决定哪些证据进入维度均值。"),
            "infNote": (
                "「含推理补全」口径下的实线格＝实测，虚线格＝推理值（见单元格左上小点"
                "·悬停证据）。方法：M1 同族前版直推 —— 仅 DeepSeek-V4.1-Flash-1017，"
                "官方同表 11 项里 6 项可位次化，平均 +14.9 位次分（MAE 20.2）；"
                "M2 池内k近邻 —— Pearson剖面相似度、k=5，留一验证 214 个已知格总体 MAE 21.5 "
                "位次分（逐维见明细）。结构性不适用的格子"
                "（纯文本模型的多模态维，零-coverage 模型）仍标「待定」，宁缺勿假。"),
        },
        "dimensions": dims,
        "scenarios": tables.load_scenarios(),
        "models": models,
        "evidence": _evidence_items(scores),
    }
    ledger["meta"]["models"] = f"{len(models)} 个模型（待定 {n_pending} 个）"
    return ledger
