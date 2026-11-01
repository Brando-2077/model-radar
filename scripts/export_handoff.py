# -*- coding: utf-8 -*-
"""交接包导出：共享数据与计分口径 → docs/handoff/（供外部 AI / Agent 重建 UI 用）。

产物（docs/handoff/）：
  top10_data.json      前 10 模型的全量结构化数据（维度分 / 场景分 / 名次 / 证据 / 方法常量）
  top10_evidence.csv   前 10 模型的证据明细表（含来源 URL，人可读）

口径：默认场景（weights.csv 首个场景「自媒体内容运营」）×「全部来源」口径取前 10。
JSON 同时带全部 5 套场景的全池名次 —— 只展示 10 个模型时，名次语义仍是 33 模型全池。
计算走 radar/ 包原代码（ledger.build_ledger），与 model-radar.html / 小红书版逐位一致。

用法：python scripts/export_handoff.py
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import pandas as pd  # noqa: E402

from radar import ledger, tables  # noqa: E402
from radar.config import (  # noqa: E402
    FAMILY_MIN_N, INF_SRC, VENDOR_SRC, VENDOR_SRC_PAGES, VERSION, fam_weight)

OUT = ROOT / "docs" / "handoff"
TOP_N = 10

OPEN_LABEL = {True: "开源", False: "闭源", None: "未确认"}


def composite(scores: dict, weights: dict) -> float:
    """场景加权综合分；缺维让权（只对有分的维度求和）——与页面 composite() 一致。"""
    num = den = 0.0
    for d, w in weights.items():
        v = scores.get(d)
        if isinstance(v, (int, float)):
            num += w * v
            den += w
    return num / den if den else 0.0


def rank_map(cs: dict[str, float]) -> dict[str, int]:
    """全池名次：1 + 严格高于自己的个数（同分并列高位次）——与页面 sceneRank() 一致。"""
    names = list(cs)
    return {n: 1 + sum(1 for o in names if cs[o] > cs[n]) for n in names}


def url_index() -> dict[tuple, str]:
    """raw_*.csv → (统一模型名, 来源, 类别, 原始分%g, 日期) → URL（同键取首条）。"""
    canon = tables.load_canon()
    idx: dict[tuple, str] = {}
    for _, r in tables.load_raw(canon).iterrows():
        key = (str(r["模型"]).strip(), str(r["来源"]).strip(), str(r["类别"]).strip(),
               f'{float(r["原始分"]):g}', str(r["数据日期"]).strip())
        idx.setdefault(key, str(r.get("URL", "")).strip())
    return idx


def main() -> None:
    led = ledger.build_ledger()
    scenes = led["scenarios"]
    dims = [d["name"] for d in led["dimensions"]]
    models = led["models"]                      # 已按名称排序
    evidence = led["evidence"]
    urls = url_index()

    # ── 全池统计（口径：全部来源）────────────────────────────────
    has_score = lambda m: any(isinstance(m["scores"].get(d), (int, float)) for d in dims)  # noqa: E731
    pool = [m for m in models if has_score(m)]
    scene_rank: dict[str, dict[str, int]] = {}
    scene_rows: dict[str, list] = {}
    for sc in scenes:
        cs = {m["name"]: composite(m["scores"], sc["weights"]) for m in pool}
        rk = rank_map(cs)
        scene_rank[sc["name"]] = rk
        scene_rows[sc["name"]] = sorted(
            ({"name": n, "total": round(c, 1), "rank": rk[n]} for n, c in cs.items()),
            key=lambda x: (-x["total"], x["name"]))
    pool_dim: dict[str, dict] = {}
    for d in dims:
        vals = [m["scores"][d] for m in pool if isinstance(m["scores"].get(d), (int, float))]
        if vals:
            pool_dim[d] = {"n": len(vals), "min": min(vals), "max": max(vals)}

    # ── 前 10（默认场景 = scenarios[0]，与页面 state.scene 初值一致）──
    default_scene = scenes[0]["name"]
    cs0 = {m["name"]: composite(m["scores"], scenes[0]["weights"]) for m in pool}
    top_names = sorted(cs0, key=lambda n: (-cs0[n], n))[:TOP_N]
    boundary_tie = (sorted(cs0.values(), reverse=True)[TOP_N - 1]
                    == sorted(cs0.values(), reverse=True)[TOP_N])

    def ev_item(e: dict) -> dict:
        item = {"d": e["d"], "src": e["src"], "cat": e["cat"], "raw": e["raw"],
                "scale": e["scale"], "date": e["date"], "val": e["val"]}
        if e.get("fam"):
            item.update(fam=e["fam"], famN=e["famN"], w=e["w"])
        if e.get("vend"):
            item["vend"] = 1
        if e.get("inf"):
            item["inf"] = 1
            for k in ("method", "basis", "loeoMAE"):
                if e.get(k):
                    item[k] = e[k]
        url = urls.get((e["m"], e["src"], e["cat"], f'{e["raw"]:g}', e["date"]), "") or e.get("url", "")
        if url:
            item["url"] = url
        return item

    out_models = []
    for name in top_names:
        m = next(x for x in models if x["name"] == name)
        item = {
            "name": m["name"],
            "company": m.get("company", ""),
            "open": m.get("open"),
            "open_label": OPEN_LABEL.get(m.get("open"), "未确认"),
            "date": m.get("date", ""),
            "note": m.get("note", ""),
            "coverage": sum(1 for d in dims if isinstance(m["scores"].get(d), (int, float))),
            "scores": m["scores"],
            "scenes": {sc["name"]: {"total": round(composite(m["scores"], sc["weights"]), 1),
                                    "rank": scene_rank[sc["name"]][name]} for sc in scenes},
            "dims_detail": {
                d: {"score": m["scores"][d],
                    "rank": 1 + sum(1 for o in pool
                                    if isinstance(o["scores"].get(d), (int, float))
                                    and o["scores"][d] > m["scores"][d]),
                    "pool_n": pool_dim[d]["n"]}
                for d in dims if isinstance(m["scores"].get(d), (int, float))},
            "evidence": [ev_item(e) for e in evidence if e["m"] == name],
        }
        for k in ("sf", "scoresTp", "sfTp", "scoresInf"):
            if m.get(k):
                item[k] = m[k]
        out_models.append(item)

    n_scored = sum(1 for e in evidence if e.get("famN", 0) >= FAMILY_MIN_N and not e.get("inf"))
    fams_scored = {e["fam"] for e in evidence if e.get("famN", 0) >= FAMILY_MIN_N and not e.get("inf")}
    covered = {(e["m"], e["d"]) for e in evidence
               if e.get("famN", 0) >= FAMILY_MIN_N and not e.get("inf")}
    raw_dates = []
    for f in sorted((DATA := ROOT / "data").glob("raw_*.csv")):
        if f.name != "raw_inferred.csv":
            raw_dates += pd.read_csv(f, dtype=str)["数据日期"].dropna().tolist()

    out = {
        "meta": {
            "project": "模型雷达图",
            "ledger_version": VERSION,
            "generated": date.today().isoformat(),
            "data_date_range": [min(raw_dates), max(raw_dates)],
            "pool": {
                "models_total": len(models),
                "models_scored": len(pool),
                "evidence_total": len(evidence),
                "evidence_scored": n_scored,
                "families_scored": len(fams_scored),
                "cells_covered": len(covered),
            },
            "default_scene": default_scene,
            "default_scope": "全部来源",
            "top10_basis": f"默认场景「{default_scene}」加权综合分 ×「全部来源」口径的前 {TOP_N} 名",
            "top10_boundary_tie": boundary_tie,
            "rank_semantics": ("所有分数与名次都是 33 模型全池的相对值；只展示前 10 不改变名次语义"
                               "（第 1 名=全池第 1，不是 10 个里的第 1）"),
        },
        "methodology": {
            "rank_score": ("族内位次分 = (族内升序名次 − 0.5) / n × 100（低分记第 1 名，tie 取平均名次）"
                           "——语义 = 在该基准的当期模型池里赢过多少比例对手（最强约 97、垫底约 3）"),
            "family_min_n": FAMILY_MIN_N,
            "family_weight": {"formula": "w(n) = min(1, (n−1)/3)，保留 2 位小数",
                              "table": {"n=1": 0.0, "n=2": 0.33, "n=3": 0.67, "n>=4": 1.0}},
            "dimension_score": ("维度分 = 该维全部计分行（族内 n≥2 且非推理）位次分的加权均值，"
                                "权重 = w(族内n)；只有 1 个族支撑时打「单基准 †」标记"),
            "scene_composite": ("场景综合分 = Σ(权重×维度分) / Σ(权重)，只对该维有分的维度求和"
                                "——缺维权重让位，绝不把缺失当 0"),
            "scene_rank_rule": "全池名次 = 1 + 严格更高分的模型数（同分并列高位次）",
            "normalization": {
                "0-100 / 百分制": "原值直用", "0-1": "×100", "10分制": "×10", "5分制": "×20",
                "Elo / 指数": "同(来源,类别)池内 min-max 线性映射到 60~100（不改名次，只拉区间）"},
            "dedup": "同一（模型×基准族）只留一票：第三方来源优先，其次数据日期新者优先",
            "tb_rule": "AA 渠道 Terminal-Bench 同族去重：有 4.0 用 4.0，无则回退 2.1",
            "scopes": {
                "全部来源": "所有实测证据（含厂商自报，不含推理补全）——默认",
                "仅第三方榜单": f"整体剔除 VENDOR_SRC 渠道后重算（{len(VENDOR_SRC)} 个渠道）",
                "含推理补全": "全部来源 + 对无实测的格补推理值（推理值默认不进维度分）"},
            "vendor_src": sorted(VENDOR_SRC),
            "vendor_pages": VENDOR_SRC_PAGES,
            "confidence_band": {
                "status": "可选展示层公式（小红书版现行；主版未用）",
                "dim_sigma": "σ_d = clamp(35/√(1+m_d), 5, 32)，m_d = Σ(该模型该维各计分族 w(n)·(n−1))；缺维或仅推理值按先验 30",
                "scene_sigma": "σ_scene = √(Σ(W_d·σ_d)²) / ΣW",
                "tie_rule": "两模型差距 ≤ 2·√(σa·σb)/σref 视为 ≈平；σref = 该口径满覆盖模型场景 σ 的中位数"},
        },
        "dimensions": led["dimensions"],
        "scenarios": scenes,
        "pool_dim_stats": pool_dim,
        "pool_scene_ranking": scene_rows,
        "models": out_models,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "top10_data.json").write_text(
        json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    with open(OUT / "top10_evidence.csv", "w", newline="", encoding="utf-8-sig") as f:
        wcsv = csv.writer(f)
        wcsv.writerow(["模型", "维度", "来源", "类别", "原始分", "量纲", "数据日期",
                       "位次分", "基准族", "族内n", "族权重", "厂商自报", "推理值", "URL"])
        for m in out_models:
            for e in m["evidence"]:
                wcsv.writerow([m["name"], e["d"], e["src"], e["cat"], e["raw"], e["scale"],
                               e["date"], e["val"], e.get("fam", ""), e.get("famN", ""),
                               e.get("w", ""), "是" if e.get("vend") else "",
                               "是" if e.get("inf") else "", e.get("url", "")])

    print(f"默认场景：{default_scene}（前 10 边界并列：{'是' if boundary_tie else '否'}）")
    for sc in scenes:
        top10 = [r["name"] for r in scene_rows[sc["name"]][:TOP_N]]
        print(f"  Top10[{sc['name']}] = {top10}")
    print(f"\n池：{len(models)} 模型 / {len(evidence)} 证据 / 计分 {n_scored} / "
          f"族 {len(fams_scored)} / 覆盖 {len(covered)} 格")
    print(f"已写出 {OUT / 'top10_data.json'} 与 {OUT / 'top10_evidence.csv'}")
    for m in out_models:
        n_ev = len(m["evidence"])
        n_vend = sum(1 for e in m["evidence"] if e.get("vend"))
        n_inf = sum(1 for e in m["evidence"] if e.get("inf"))
        print(f"  #{scene_rank[default_scene][m['name']]:>2} {m['name']}: "
              f"{m['coverage']}/8 · 综合 {m['scenes'][default_scene]['total']} · "
              f"证据 {n_ev}（厂商 {n_vend} / 推理 {n_inf}）")


if __name__ == "__main__":
    main()
