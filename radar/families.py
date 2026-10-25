# -*- coding: utf-8 -*-
"""基准族计分：TB 版本去重 → 维度映射与归一化 →（模型×族）去重 → 族内位次分。

位次分（v0.12 起，全站唯一分值口径）：
    族内 (升序名次 − 0.5) / n × 100，tie 取名次均值 ——
    语义 = 「在该基准的当期模型池里赢过多少比例对手」（同族最强约 97、垫底约 3）。
v0.26 分级入分：族内 ≥2 即计位次分（n=2/3 低置信，下游按 config.fam_weight 降权）；
    族内 =1 不计分（单模型无对手，位次分恒 50、零信息量），行保留面值。
"""
from __future__ import annotations

import pandas as pd

from radar.config import FAMILY_MIN_N, TB_FALLBACK, TB_PREFER, VENDOR_SRC, fam_weight
from radar.normalize import normalize
from radar.tables import MappingTable

AA_SRC = "Artificial-Analysis"


def tb_dedup(df: pd.DataFrame) -> pd.DataFrame:
    """AA 渠道的 Terminal-Bench 版本去重：同一模型有 TB4.0 就丢弃其 TB2.1（留档 raw）。"""
    has_tb40 = set(df.loc[(df["来源"] == AA_SRC) & (df["类别"] == TB_PREFER), "模型"])
    drop = ((df["来源"] == AA_SRC) & (df["类别"] == TB_FALLBACK)
            & df["模型"].isin(has_tb40))
    if drop.any():
        names = ", ".join(sorted(set(df.loc[drop, "模型"])))
        print(f"[口径] Terminal-Bench 同族去重：{int(drop.sum())} 条 TB2.1 因该模型已有 TB4.0"
              f" 而不计入维度（留档 raw）：{names}")
    return df[~drop].copy()


def evidence_rows(raw: pd.DataFrame, mapping: MappingTable) -> tuple[list[dict], list[str]]:
    """raw（已 canon 统一）→ 证据行 dict 列表（含备注串）+ 未声明类别提示列表。

    每行 = {模型, 维度, 榜单分, 备注, _fam, _vend, _date}：
    备注格式固定 '{来源}·{类别} 原始{原始分}({量纲}) @{数据日期}'，抽屉靠它解析。
    """
    rows: list[dict] = []
    skipped: list[str] = []
    for (src, cat), grp in raw.groupby(["来源", "类别"]):
        dim = mapping.lookup(src, cat)
        if dim is None:
            skipped.append(f"{src}|{cat}")
            continue
        if dim == "":  # 有意不映射：总分/综合指数/越低越好类，仅留档 raw
            continue
        pool = grp["原始分"].tolist()
        fam = mapping.fam.get((src, cat), "")
        for _, r in grp.iterrows():
            rows.append({
                "模型": r["模型"],
                "维度": dim,
                "榜单分": round(normalize(r["原始分"], r["量纲"], pool), 1),
                "备注": f'{r["来源"]}·{r["类别"]} 原始{r["原始分"]:g}({r["量纲"]}) @{r["数据日期"]}',
                "_fam": fam,
                "_vend": src in VENDOR_SRC,
                "_date": str(r["数据日期"]).strip() or "0000-00-00",
            })
    return rows, skipped


def family_scores(rows: list[dict]) -> tuple[list[dict], dict]:
    """（模型×族）去重 + 族内位次分 + 「族/族内n」两列。

    去重优先级：第三方来源优先，其次数据日期新者优先；被淘汰的行不进 scores.csv
    （仍留档 raw 可溯源）。族内 ≥ FAMILY_MIN_N 的行写位次分；否则保留面值。
    返回 (新行列表, 统计 dict)。
    """
    stats = {"families": 0, "scored_families": 0, "off_families": 0,
             "scored_rows": 0, "off_rows": 0, "dropped": 0, "low_rows": 0}
    df = pd.DataFrame(rows)
    if df.empty:
        return rows, stats
    df["_fam"] = df["_fam"].fillna("").astype(str)
    fam_rows = df[df["_fam"] != ""]
    if fam_rows.empty:
        for r in rows:
            r["族"], r["族内n"] = "", ""
        return rows, stats

    ordered = fam_rows.sort_values(["_vend", "_date"], ascending=[True, False])
    kept = ordered.drop_duplicates(subset=["模型", "_fam"], keep="first")
    dropped_idx = ordered.index.difference(kept.index)
    stats["dropped"] = int(len(dropped_idx))
    if len(dropped_idx):
        print(f"[口径] 基准族去重：{stats['dropped']} 条同（模型×族）多来源证据只留一票"
              f"（第三方优先、日期新者优先；其余留档 raw）：")
        for i in dropped_idx:
            r = df.loc[i]
            print(f"  - {r['模型']} × {r['_fam']} ← {str(r['备注']).split(' 原始')[0]}")

    kept = kept.copy()
    kept["_n"] = kept.groupby("_fam")["模型"].transform("nunique")
    # 升序名次（低分记第 1 名）→ (名次 − 0.5)/n×100；tie 取名次均值
    kept["_pct"] = kept.groupby("_fam")["榜单分"].transform(
        lambda s: (s.rank(method="average") - 0.5) / len(s) * 100)

    n_by_idx, pct_by_idx = kept["_n"].to_dict(), kept["_pct"].to_dict()
    out: list[dict] = []
    keep_set = set(kept.index)
    for i, s in df.iterrows():
        r = dict(s)
        fam = r.get("_fam", "")
        if not fam:
            r["族"], r["族内n"] = "", ""
        elif i in keep_set:
            n = int(n_by_idx[i])
            r["族"], r["族内n"] = fam, n
            if n >= FAMILY_MIN_N:
                r["榜单分"] = round(float(pct_by_idx[i]), 1)
        else:
            continue  # 去重被淘汰的行不进账本（留档 raw）
        out.append(r)

    fam_n = kept.groupby("_fam")["_n"].first()
    stats["families"] = int(len(fam_n))
    stats["scored_families"] = int((fam_n >= FAMILY_MIN_N).sum())
    stats["off_families"] = stats["families"] - stats["scored_families"]
    stats["scored_rows"] = int((kept["_n"] >= FAMILY_MIN_N).sum())
    stats["off_rows"] = int(len(kept)) - stats["scored_rows"]
    stats["low_rows"] = int(((kept["_n"] >= FAMILY_MIN_N) & (kept["_n"] < 4)).sum())
    return out, stats


def inferred_rows(inf: pd.DataFrame | None) -> list[dict]:
    """raw_inferred.csv → 推理补全行（来源固定「推理补全」，族为空、默认不计分）。"""
    if inf is None or inf.empty:
        return []
    out = []
    for _, r in inf.iterrows():
        score = float(r["推理分"])
        out.append({
            "模型": str(r["模型"]).strip(),
            "维度": str(r["维度"]).strip(),
            "榜单分": round(score, 1),
            "备注": f'推理补全·{r["推理方法"]} 原始{score:g}(推理值) @{r["数据日期"]}',
            "族": "",
            "族内n": "",
        })
    return out


def report(stats: dict) -> None:
    print(f"[口径] 基准族位次分（分级入分 w(n)=min(1,(n−1)/3)）：{stats['families']} 个基准族 —— "
          f"{stats['scored_families']} 族入分（{stats['scored_rows']} 条，其中低置信降权 "
          f"{stats['low_rows']} 条），{stats['off_families']} 族因池内 =1 人不计分"
          f"（{stats['off_rows']} 条留面值，单模型无对手）")
