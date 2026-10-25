# -*- coding: utf-8 -*-
"""CSV 表读取层 —— data/*.csv → 内存结构。全部显式 load_*()，无模块级读表副作用。

列名契约（8 列原始证据表，所有 raw_*.csv 共用）：
    模型, 公司, 来源, 类别, 原始分, 量纲, 数据日期, URL
scores.csv（生成物）：
    模型, 维度, 榜单分, 备注, 族, 族内n
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from radar.config import DATA, FAMILY_MIN_N, INFERRED_CSV, ROSTER_CSV, VENDOR_SRC, INF_SRC


def _read(path: Path) -> pd.DataFrame:
    """统一读表：UTF-8(-sig)、字符串列不转 NaN。"""
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")


# ── 口径真值表 ──────────────────────────────────────────────────────

def load_canon() -> dict[str, str]:
    """canon.csv → {榜单模型名: 统一名}。"""
    df = _read(DATA / "canon.csv")
    return {r["榜单名"].strip(): r["统一名"].strip() for _, r in df.iterrows()}


@dataclass(frozen=True)
class MappingTable:
    """mapping.csv 的三类口径：(来源,类别) → 维度 / 基准族 / 有意不映射。"""
    dim: dict[tuple[str, str], str]
    fam: dict[tuple[str, str], str]
    unmapped: set[tuple[str, str]]

    def lookup(self, src: str, cat: str) -> str | None:
        """→ 维度；空串表示「有意不映射」；None 表示未声明（构建时报提示）。"""
        key = (src, cat)
        if key in self.dim:
            return self.dim[key]
        if key in self.unmapped:
            return ""
        return None


def load_mapping() -> MappingTable:
    df = _read(DATA / "mapping.csv")
    dim: dict[tuple[str, str], str] = {}
    fam: dict[tuple[str, str], str] = {}
    unmapped: set[tuple[str, str]] = set()
    for _, r in df.iterrows():
        key = (r["来源"].strip(), r["类别"].strip())
        d = r["维度"].strip()
        if d:
            dim[key] = d
            fam[key] = r["族"].strip() if "族" in df.columns else ""
        else:
            unmapped.add(key)
    return MappingTable(dim=dim, fam=fam, unmapped=unmapped)


# ── 原始证据 ────────────────────────────────────────────────────────

def load_raw(canon: dict[str, str] | None = None) -> pd.DataFrame:
    """全部 raw_*.csv（排除 raw_inferred.csv）合并；「模型」列经 canon 统一。"""
    canon = canon if canon is not None else load_canon()
    files = [f for f in sorted(DATA.glob("raw_*.csv")) if f.name != INFERRED_CSV.name]
    if not files:
        raise SystemExit("data/ 下没有任何 raw_*.csv 原始数据")
    df = pd.concat([_read(f) for f in files], ignore_index=True)
    df["原始分"] = df["原始分"].astype(float)
    df["模型"] = df["模型"].str.strip().map(lambda m: canon.get(m, m))
    return df


def load_inferred_raw() -> pd.DataFrame | None:
    """raw_inferred.csv（推理补全，列结构与 raw_* 不同：推理方法/依据/留一MAE）。"""
    if not INFERRED_CSV.exists() or INFERRED_CSV.stat().st_size == 0:
        return None
    return pd.read_csv(INFERRED_CSV, dtype=str, keep_default_na=False, encoding="utf-8-sig")


# ── 证据账本（生成物，构建时读回）──────────────────────────────────

def load_scores() -> pd.DataFrame:
    """scores.csv + 派生标记列（_src/_vend/_inf/_fam/_famN/_scored）。

    备注格式固定：'{来源}·{类别} 原始{原始分}({量纲}) @{数据日期}'；
    来源即第一个 · 之前的部分 —— 抽屉与口径过滤都靠它，不要改格式。
    _scored = 非推理 且 族内n ≥ FAMILY_MIN_N（v0.26 起族内 ≥2 即计，n=2/3 降权）。
    """
    df = _read(DATA / "scores.csv")
    df["榜单分"] = pd.to_numeric(df["榜单分"], errors="coerce")
    df["_src"] = df["备注"].astype(str).str.extract(r"^([^·]+)·", expand=False).fillna("")
    df["_vend"] = df["_src"].isin(VENDOR_SRC)
    df["_inf"] = df["_src"] == INF_SRC
    df["_fam"] = df["族"].astype(str).str.strip() if "族" in df.columns else ""
    df["_famN"] = (pd.to_numeric(df["族内n"], errors="coerce")
                   if "族内n" in df.columns else float("nan"))
    df["_scored"] = (~df["_inf"]) & (df["_famN"] >= FAMILY_MIN_N)
    return df


# ── 展示元数据 ──────────────────────────────────────────────────────

def load_dimensions() -> list[dict]:
    """dimensions.csv → 维度定义数组（抽屉「维度详解」的数据源）。"""
    df = _read(DATA / "dimensions.csv")
    cols = (("白话", "alias"), ("通俗解释", "plain"), ("典型任务", "tasks"),
            ("适用建议", "advice"), ("典型公开数据源（榜单分）", "sources"), ("口径说明", "note"))
    out = []
    for _, r in df.iterrows():
        d = {"name": r["维度"].strip(), "desc": r["一句话定义"].strip()}
        for col, key in cols:
            if col in df.columns and r.get(col, "").strip():
                d[key] = r[col].strip()
        out.append(d)
    return out


def load_scenarios() -> list[dict]:
    """weights.csv → 5 套场景 × 8 维权重（最大余数法归一到合计恰好 100.0）。"""
    df = _read(DATA / "weights.csv")
    df["场景"] = df["场景"].str.strip()
    df["维度"] = df["维度"].str.strip()
    out = []
    for scene, grp in df.groupby("场景", sort=False):
        total = grp["权重"].astype(float).sum()
        exact = [(r["维度"], float(r["权重"]) * 100 / total) for _, r in grp.iterrows()]
        # 先向下取整到 0.1，余量补给小数部分最大者 —— 保证合计恰 100.0（v0.13.1）
        floors = [math.floor(v * 10) for _, v in exact]
        remain = 1000 - sum(floors)
        order = sorted(range(len(exact)),
                       key=lambda i: exact[i][1] * 10 - floors[i], reverse=True)
        for i in order[:remain]:
            floors[i] += 1
        out.append({"name": scene,
                    "weights": {d: floors[i] / 10 for i, (d, _) in enumerate(exact)}})
    return out


class _Unset:
    """「开源」列留空的哨兵 —— 语义见 RosterItem。"""
    def __repr__(self) -> str:  # pragma: no cover
        return "UNSET"


UNSET = _Unset()


@dataclass
class RosterItem:
    """models.csv 一行：逐模型展示元数据（公司/开源/日期/备注）与待定占位。

    open_ 的三态：True/False = 显式开源闭源；None = 「未确认」（页面灰章，不走兜底）；
    UNSET = 名册留空 → 由公司级 OPEN_COMPANIES 兜底判定。
    """
    company: str = ""
    open_: object = UNSET
    date: str = ""
    note: str = ""

    def as_dict(self) -> dict:
        """→ ledger 的模型条目字段（只写有值键，键序 = company/open/date/note）。"""
        out = {}
        if self.company:
            out["company"] = self.company
        if self.open_ is not UNSET:
            out["open"] = self.open_
        if self.date:
            out["date"] = self.date
        if self.note:
            out["note"] = self.note
        return out


_OPEN_TRUE = {"是", "1", "true", "yes", "开"}
_OPEN_FALSE = {"否", "0", "false", "no", "闭"}
_OPEN_UNKNOWN = {"未确认", "未知", "?", "unk"}


def _parse_open(raw: str) -> object:
    """「开源」列 → True / False / None（未确认）/ UNSET（留空 → 公司兜底）。"""
    s = raw.strip().lower()
    if s in _OPEN_TRUE:
        return True
    if s in _OPEN_FALSE:
        return False
    if s in _OPEN_UNKNOWN:
        return None
    return UNSET


def load_roster() -> dict[str, RosterItem]:
    """models.csv → {统一名: RosterItem}。名册里没进账本的模型 = 待定占位。"""
    if not ROSTER_CSV.exists():
        return {}
    out: dict[str, RosterItem] = {}
    for _, r in _read(ROSTER_CSV).iterrows():
        name = r.get("模型", "").strip()
        if not name:
            continue
        out[name] = RosterItem(
            company=r.get("公司", "").strip(),
            open_=_parse_open(r.get("开源", "")),
            date=r.get("数据日期", "").strip(),
            note=r.get("备注", "").strip(),
        )
    return out


def load_companies(canon: dict[str, str] | None = None) -> dict[str, str]:
    """从 raw_*.csv 的公司列反查每个统一名的厂商（取首个非空值）。"""
    canon = canon if canon is not None else load_canon()
    comp: dict[str, str] = {}
    for f in sorted(DATA.glob("raw_*.csv")):
        for _, r in _read(f).iterrows():
            name = canon.get(r["模型"].strip(), r["模型"].strip())
            c = r.get("公司", "").strip()
            if c and name not in comp:
                comp[name] = c
    return comp
