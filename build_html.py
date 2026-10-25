# -*- coding: utf-8 -*-
"""单文件网页生成：从 data/*.csv 算出账本，写进 model-radar.html 的「数据区」。

用法：
  python build_html.py

架构约定（单文件交付，2026-10-17 起）：
  model-radar.html 是**唯一交付物**，自包含（展示壳 + 内联数据），双击即开、零依赖：
    · 展示壳（HTML / CSS / JS）是手改的源码；
    · 「数据区」夹在 <!-- ==== 数据区 BEGIN … ==== --> 与 <!-- ==== 数据区 END ==== -->
      之间，由本脚本整体覆盖，**勿手改**（改了下次生成会被覆盖）。
  所以更新数据的标准动作只有一个：改 data/ 下的表 → 跑本脚本。
  （旧的双文件版 model-radar-data.js 与 model-radar-standalone.html、以及页面上的
    「加模型表单 / 导入导出 / localStorage 本机模型」已于 2026-10-17 一并移除：
    数据显示与更新都交给管线与数据表，页面不再承担编辑入口。）

主链输入（就是主交付链的全部输入）：
  data/dimensions.csv  8 维定义（名称 + 一句话定义 + 通俗解释 / 典型任务 / 适用建议 + 口径说明）
  data/weights.csv     5 套场景 × 8 维权重
  data/scores.csv      证据账本（只有「榜单分」一列）
  data/mapping.csv     来源×类别 → 维度 的映射（口径真值）
  data/canon.csv       榜单名 → 统一名（口径真值）
  data/raw_*.csv       各来源原始分（含来源 URL 与数据日期）
  data/models.csv      模型名册：可选的「公司 / 开源 / 数据日期 / 备注」覆盖项，
                       以及尚未进账本的**待定模型**占位（8 维全「待定」）
维度分口径（v0.26 起，修订 v0.12）：维度分 = 该维度**计分行**（族内n ≥ 2）位次分的**加权均值**，
权重按族内模型数分级：n≥4 ×1.0、n=3 ×0.6、n=2 ×0.35（低置信证据按可信度贡献，不再一刀切排除）。
        分数已由 build_scores.py 换算成「基准族内位次分」，本脚本只做过滤与均值，**不重算位次**；
        族内 =1 的族不计分（单模型无对手）；「单基准」标记：某模型某维的计分行
        只来自 1 个基准族时写 sf / sfTp，页面加小标提示"证据宽度有限"。
双口径：厂商自报渠道（VENDOR_SRC）整体剔除后重算 = 「仅第三方榜单」口径，随每模型写 scoresTp
        （只在两种口径不同时才写；页面约定"有 scoresTp 就用它，没有就与 scores 相同"）。
⚠ 池内相对分（v0.12 起全员适用）：位次分在**当期模型池内**计算，增减模型会整体移动该维分数。
"""
import json
import math
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

from build_scores import CANON, FAMILY_MIN_N, VENDOR_SRC, fam_weight  # 复用统一命名 / 门槛与降权档位 / 厂商渠道

ROOT = Path(__file__).parent
DATA = ROOT / "data"
SHELL = ROOT / "model-radar.html"
ROSTER = DATA / "models.csv"

BEGIN = "<!-- ==== 数据区 BEGIN"
END = "<!-- ==== 数据区 END ==== -->"
REGION = re.compile(
    r"(<!-- ==== 数据区 BEGIN[^\n]*-->\n)(.*?)(<!-- ==== 数据区 END ==== -->)", re.S)

COMPANY_FALLBACK = {}

# 开源 weights 家族（**兜底**用：models.csv 的「开源」列现已逐模型订正，33 个模型全部显式标注，
# 所以下面这套公司级判定只对新加入、尚未订正的模型生效）。判断偏保守：没把握的公司不进这个集合。
# 2026-10-17 逐模型订正时移除了「百度 / 字节」——其旗舰（ERNIE-5.1 / Doubao-Seed-2.1-Pro）权重不公开。
OPEN_COMPANIES = {"智谱", "Z.AI", "DeepSeek", "阿里", "月之暗面", "MiniMax", "NVIDIA",
                  "腾讯", "小红书", "阶跃星辰",
                  "Google"}

# 「仅第三方榜单」口径要整体排除的**厂商自报渠道** —— 定义已归一到 build_scores.py 的 VENDOR_SRC
# （单点维护：族去重也要用"是否厂商自报"，故集合归构建账本的一侧管，本文件 import 复用）。
# 判定按来源渠道、不按"是不是自家模型"：如 NVIDIA 官方页给非自家模型报的分也一并排除。
# VENDOR_SRC_PAGES 只服务展示（页脚/抽屉写明"排除了什么"，避免口径变黑箱），仍留在本文件。
VENDOR_SRC_PAGES = {
    "Z.ai官方": "z.ai/blog", "dots官方": "github.com/dots-studio",
    "腾讯官方": "hunyuan.tencent.com / 发布页 appendix", "NVIDIA官方": "build.nvidia.com",
    "DeepSeek官方": "huggingface.co/deepseek-ai / api-docs.deepseek.com",
    "酥悠沫-官方": "酥悠沫转录的厂商自报表（news.qq.com / stepfun.com / text-arena.com 等）",
    "Kimi官方": "kimi.ai/blog（技术博客，只收自家型号）",
}
# 推理补全通道的来源标签（默认不计入维度分；页面切「含推理补全」才纳入）
INF_SRC = "推理补全"
INF_PAGES = "scripts/infer_gaps.py · data/raw_inferred.csv（每条都带方法 / 依据 / 留一MAE）"


def _txt(v):
    s = "" if v is None or pd.isna(v) else str(v).strip()
    return "" if s.lower() == "nan" else s


def load_dimensions():
    df = pd.read_csv(DATA / "dimensions.csv")
    out = []
    for _, r in df.iterrows():
        d = {"name": r["维度"].strip(), "desc": r["一句话定义"].strip()}
        for col, key in (("白话", "alias"), ("通俗解释", "plain"), ("典型任务", "tasks"),
                         ("适用建议", "advice"), ("典型公开数据源（榜单分）", "sources"),
                         ("口径说明", "note")):
            if col in df.columns and _txt(r.get(col)):
                d[key] = _txt(r.get(col))
        out.append(d)
    return out


def dim_stats():
    """每维的「计分证据构成」：计分行共有多少个基准族、覆盖多少个模型、共几条。
    供抽屉的维度详解展示；口径「仅第三方」用排除厂商自报后的计分行单独重算（v0.14）。"""
    scores = load_scores()
    scores["模型"] = scores["模型"].astype(str).str.strip()
    scores["维度"] = scores["维度"].astype(str).str.strip()

    def pack(x):
        fams = sorted({f for f in x["_fam"] if f})
        return {"fams": len(fams), "models": int(x["模型"].nunique()),
                "n": int(len(x)), "names": fams}

    out = {}
    for dim, g in scores.groupby("维度"):
        sc = g[g["_scored"] & g["榜单分"].notna()]
        out[dim] = {"all": pack(sc), "tp": pack(sc[~sc["_vend"]])}
    return out


def load_scores():
    """读证据账本，标出「厂商自报渠道」「推理补全」与「计分行（族内n ≥ 2，v0.26 分级入分）」。
    备注格式固定：'{来源}·{类别} 原始{原始分}({量纲}) @{数据日期}'，来源即第一个 · 之前的部分。"""
    df = pd.read_csv(DATA / "scores.csv")
    df["榜单分"] = pd.to_numeric(df["榜单分"], errors="coerce")
    df["_src"] = df["备注"].astype(str).str.extract(r"^([^·]+)·", expand=False).fillna("")
    df["_vend"] = df["_src"].isin(VENDOR_SRC)
    df["_inf"] = df["_src"] == INF_SRC
    df["_fam"] = (df["族"].fillna("") if "族" in df.columns else "").astype(str).str.strip()
    df["_famN"] = (pd.to_numeric(df["族内n"], errors="coerce") if "族内n" in df.columns
                   else pd.Series(float("nan"), index=df.index))
    df["_scored"] = (~df["_inf"]) & (df["_famN"] >= FAMILY_MIN_N)
    return df


def load_evidence():
    """把 scores.csv 的证据行展开成结构化明细（悬停说明的数据源）。
    厂商自报行带 vend=1 标记：页面在「仅第三方榜单」口径下按它剔除。\n    推理补全行带 inf=1 标记：只在「含推理补全」口径下才进入维度分。"""
    scores = load_scores()
    for col in ["模型", "维度"]:
        scores[col] = scores[col].astype(str).str.strip()
    pat = re.compile(r"^(?P<src>[^·]+)·(?P<cat>.+?) 原始(?P<raw>-?[0-9.eE+]+)\((?P<scale>[^)]+)\) @(?P<date>.+)$")
    out = []
    for _, r in scores.iterrows():
        m = pat.match(str(r["备注"]))
        val = r.get("榜单分")
        val = None if val is None or pd.isna(val) else round(float(val), 1)
        if m:
            item = {"m": r["模型"], "d": r["维度"],
                    "src": m.group("src"), "cat": m.group("cat"),
                    "raw": float(m.group("raw")), "scale": m.group("scale"),
                    "date": m.group("date"), "val": val}
        else:
            item = {"m": r["模型"], "d": r["维度"], "src": "", "cat": "",
                    "raw": None, "scale": "", "date": "", "val": val}
        if bool(r["_vend"]):
            item["vend"] = 1
        if bool(r["_inf"]):
            item["inf"] = 1
        if r["_fam"]:                     # 基准族与池大小（抽屉展示：位次分 / 降权 / 无对手不计分）
            item["fam"] = r["_fam"]
            item["famN"] = int(r["_famN"])
            item["w"] = fam_weight(int(r["_famN"]))
        out.append(item)
    # 把推理补全的明细（依据 / 留一MAE / URL）挂到对应证据行上，供抽屉展示
    ip = DATA / "raw_inferred.csv"
    if ip.exists():
        try:
            inf_df = pd.read_csv(ip)
            inf_map = {}
            for _, r2 in inf_df.iterrows():
                key = (str(r2["模型"]).strip(), str(r2["维度"]).strip())
                inf_map[key] = (str(r2.get("推理方法", "")), str(r2.get("依据", "")),
                                str(r2.get("留一MAE", "")), str(r2.get("URL", "")))
            for it in out:
                if it.get("inf"):
                    k = (it["m"], it["d"])
                    if k in inf_map:
                        it["method"], it["basis"], it["loeoMAE"], it["url"] = inf_map[k]
        except Exception as e:
            print(f"[warn] 读 raw_inferred.csv 失败：{e}")
    return out


def load_scenarios():
    df = pd.read_csv(DATA / "weights.csv")
    df["场景"] = df["场景"].str.strip()
    df["维度"] = df["维度"].str.strip()
    out = []
    for scene, grp in df.groupby("场景", sort=False):
        total = grp["权重"].sum()
        # 最大余数法（v0.13.1）：权重按总量归一后取 1 位小数，但用「先向下取整、
        # 余量补给小数部分最大者」保证每套场景合计恰好 100.0（此前四舍五入偶发 99.9 / 100.1）
        exact = [(r["维度"], float(r["权重"]) * 100 / total) for _, r in grp.iterrows()]
        floors = [math.floor(v * 10) for _, v in exact]
        remain = 1000 - sum(floors)
        order = sorted(range(len(exact)), key=lambda i: exact[i][1] * 10 - floors[i], reverse=True)
        for i in order[:remain]:
            floors[i] += 1
        weights = {d: floors[i] / 10 for i, (d, _) in enumerate(exact)}
        out.append({"name": scene, "weights": weights})
    return out


def load_companies():
    """从 raw_*.csv 的公司列反查每个统一名的厂商（取首个非空值）。"""
    comp = {}
    for f in sorted(DATA.glob("raw_*.csv")):
        df = pd.read_csv(f)
        for _, r in df.iterrows():
            name = CANON.get(str(r["模型"]).strip(), str(r["模型"]).strip())
            c = _txt(r.get("公司", ""))
            if c and name not in comp:
                comp[name] = c
    return comp


def load_roster():
    """data/models.csv：模型名册（表头 模型,公司,开源,数据日期,备注）。
    只列「需要覆盖」或「待定」的模型；账本里没有的，作为待定模型占位。
    开源列取 是/否/1/0，留空 = 按公司自动判定，未确认/未知 = 明确「查不到证据」（页面显示「未确认」）。"""
    if not ROSTER.exists():
        return {}
    df = pd.read_csv(ROSTER).fillna("")
    out = {}
    for _, r in df.iterrows():
        name = _txt(r.get("模型"))
        if not name:
            continue
        item = {}
        co = _txt(r.get("公司"))
        if co:
            item["company"] = co
        op = _txt(r.get("开源")).lower()
        if op in {"是", "1", "true", "yes", "开"}:
            item["open"] = True
        elif op in {"否", "0", "false", "no", "闭"}:
            item["open"] = False
        elif op in {"未确认", "未知", "?", "unk"}:
            item["open"] = None
        for col, key in (("数据日期", "date"), ("备注", "note")):
            if _txt(r.get(col)):
                item[key] = _txt(r.get(col))
        out[name] = item
    return out


def blend_models():
    """维度分 = 该维度**计分行**（族内n ≥ 2、非推理）位次分的加权均值，权重 = fam_weight(族内n)
    （n≥4 ×1.0 / n=3 ×0.6 / n=2 ×0.35，v0.26 分级入分）。
    同时算一遍「仅第三方榜单」口径（再剔除厂商自报渠道）；两种口径一致时**不写** scoresTp，
    页面约定：有 scoresTp 就用它，没有就与 scores 相同。
    「单基准」（sf / sfTp）：某维的计分行只来自 1 个基准族时记 {维度: 族名}，页面加小标。"""
    scores = load_scores()
    for col in ["模型", "维度"]:
        scores[col] = scores[col].astype(str).str.strip()
    models = []
    for name, grp in scores.groupby("模型", sort=True):
        dims, dims_tp, dims_inf, sf, sf_tp = {}, {}, {}, {}, {}
        for dim, g2 in grp.groupby("维度"):
            vals = g2.loc[g2["_scored"], ["榜单分", "_famN"]].dropna()
            if len(vals):
                w = vals["_famN"].map(fam_weight)
                dims[dim] = round(float((vals["榜单分"] * w).sum() / w.sum()), 1)
            # 第三方口径 = 计分行里再剔除厂商自报渠道
            tp = g2.loc[g2["_scored"] & ~g2["_vend"], ["榜单分", "_famN"]].dropna()
            if len(tp):
                wtp = tp["_famN"].map(fam_weight)
                dims_tp[dim] = round(float((tp["榜单分"] * wtp).sum() / wtp.sum()), 1)
            # 「含推理补全」口径 = 计分实测优先；没有任何计分实测时才落推理值
            real_all = g2.loc[g2["_scored"], ["榜单分", "_famN"]].dropna()
            infv = g2.loc[g2["_inf"], "榜单分"].dropna()
            if len(real_all):
                wr = real_all["_famN"].map(fam_weight)
                dims_inf[dim] = round(float((real_all["榜单分"] * wr).sum() / wr.sum()), 1)
            elif len(infv):
                dims_inf[dim] = round(float(infv.iloc[0]), 1)
            # 「单基准」：本维计分行只来自 1 个基准族 → 记「维度: 族名」
            fams_all = set(g2.loc[g2["_scored"], "_fam"]) - {""}
            if dim in dims and len(fams_all) == 1:
                sf[dim] = list(fams_all)[0]
            fams_tp = set(g2.loc[g2["_scored"] & ~g2["_vend"], "_fam"]) - {""}
            if dim in dims_tp and len(fams_tp) == 1:
                sf_tp[dim] = list(fams_tp)[0]
        item = {"name": name, "scores": dims}
        if sf:
            item["sf"] = sf
        if dims_tp != dims:
            item["scoresTp"] = dims_tp
            if sf_tp:
                item["sfTp"] = sf_tp
        if dims_inf != dims:
            item["scoresInf"] = dims_inf
        models.append(item)
    return models


def build_ledger():
    companies = load_companies()
    roster = load_roster()
    models = blend_models()
    seen = set()
    for m in models:
        seen.add(m["name"])
        item = dict(roster.get(m["name"], {}))
        co = item.pop("company", "")
        m["company"] = co or companies.get(m["name"], COMPANY_FALLBACK.get(m["name"], ""))
        m.update(item)
        if m.get("company"):
            m.setdefault("open", m["company"] in OPEN_COMPANIES)
        else:
            m.pop("company", None)
    # 名册里还没进账本的 → 待定占位（scores 为空，页面按「待定」渲染）
    for name, item in roster.items():
        if name in seen:
            continue
        m = {"name": name, "scores": {}}
        m.update(item)
        if m.get("company"):
            m.setdefault("open", m["company"] in OPEN_COMPANIES)
        else:
            m.pop("company", None)
        models.append(m)
    models.sort(key=lambda x: x["name"])

    dims = load_dimensions()
    dstat = dim_stats()
    for d in dims:
        s = dstat.get(d["name"])
        if s:
            d["stats"] = s

    lb = pd.read_csv(DATA / "raw_livebench.csv")["数据日期"].astype(str)
    aa = pd.read_csv(DATA / "raw_aa_lmarena.csv")["数据日期"].astype(str)
    n_evidence = int(pd.read_csv(DATA / "scores.csv")["榜单分"].notna().sum())
    n_pending = sum(1 for m in models if not m["scores"])
    ledger = {
        "meta": {
            "title": "模型雷达图",
            "version": "v0.26",
            "built": date.today().isoformat(),
            "sources": (f"LiveBench {lb.min()}（{lb.max()} 快照） · SuperCLUE 2026-07/09 · "
                        f"Artificial Analysis {aa.min()}~{aa.max()} · LMArena 榜单 · SUYOUUMO 综合全球榜（2026-10-17） · "
                        f"厂商官方渠道（含 DeepSeek官方） · 酥悠沫聚合（第三方） · 共 {n_evidence} 条证据"),
            "disclaimer": ("数据来自公开榜单，仅供选型参考，请以个人体感为准。"
                           "⚠ 维度分不是绝对刻度：全部来源都已归并为「基准族内位次分」——"
                           "你在该基准的模型池里赢过的对手比例（0-100）。同一基准跨来源只算一票；"
                           "族内 2–3 个模型的基准为低置信证据，按 ×0.6 / ×0.35 降权计入；仅 1 个模型的基准不计分（单模型无对手，面值保留可查）。"
                           "位次分是池内相对分：增减模型会让全池该维分数整体移动，跨期看图只比相对位次。"),
            "noteMissing": "缺数据的维度不参与绘制、也不计入维度分（雷达上画成断口、条形上留空位——不是 0 分）；计算综合分时该维权重自动让位。",
            "scopeSources": [s for s in ["Z.ai官方", "dots官方", "腾讯官方", "NVIDIA官方", "DeepSeek官方", "酥悠沫-官方"] if s in VENDOR_SRC],
            "scopeNote": ("顶栏的数据口径开关（三个按钮）："
                          "「全部来源」= 所有实测证据（含厂商自报，不含推理补全）；"
                          "「仅第三方榜单」= 把厂商自报渠道（Z.ai / dots / 腾讯 / NVIDIA / DeepSeek官方 / "
                          "酥悠沫-官方转录的厂商表）的证据整体排除，仅用第三方榜单重算；"
                          "「含推理补全」= 在「全部来源」基础上，再把公开榜抽不到的格子补上推理值（不丢实测、只补空）。"
                          "判断依据是来源渠道而非是否自家模型：NVIDIA 官方页给非自家模型报的分也排除。"
                          "位次分按全池只算一次，三种口径只决定哪些证据进入维度均值。"),
            "infNote": ("「含推理补全」口径下的实线格＝实测，虚线格＝推理值（见单元格左上小点"
                        "·悬停证据）。方法：M1 同族前版直推 —— 仅 DeepSeek-V4.1-Flash-1017，"
                        "官方同表 11 项里 6 项可位次化，平均 +14.9 位次分（MAE 20.2）；"
                        "M2 池内k近邻 —— Pearson剖面相似度、k=5，留一验证 214 个已知格总体 MAE 21.5 "
                        "位次分（逐维见明细）。结构性不适用的格子"
                        "（纯文本模型的多模态维，零-coverage 模型）仍标「待定」，宁缺勿假。"),
        },
        "dimensions": dims,
        "scenarios": load_scenarios(),
        "models": models,
        "evidence": load_evidence(),
    }
    ledger["meta"]["models"] = f"{len(models)} 个模型（待定 {n_pending} 个）"
    return ledger


def main():
    if "--single" in sys.argv:
        print("[提示] --single 已废弃：model-radar.html 现在本身就是单文件，无需再另打一份。")
    ledger = build_ledger()
    payload = ("<script>window.RADAR_LEDGER = "
               + json.dumps(ledger, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
               + ";</script>\n")

    shell = SHELL.read_text(encoding="utf-8")
    if not REGION.search(shell):
        raise SystemExit("model-radar.html 里找不到「数据区」标记"
                         f"（{BEGIN} … / {END}），请核对展示壳是否被改坏。")
    shell = REGION.sub(lambda m: m.group(1) + payload + m.group(3), shell, count=1)
    SHELL.write_text(shell, encoding="utf-8")

    n_pending = sum(1 for m in ledger["models"] if not m["scores"])
    n_tp = sum(1 for m in ledger["models"] if "scoresTp" in m)
    n_vend = sum(1 for e in ledger["evidence"] if e.get("vend"))
    n_inf = sum(1 for e in ledger["evidence"] if e.get("inf"))
    print(f"已更新 {SHELL.name} 数据区：{len(ledger['models'])} 个模型"
          f"（待定 {n_pending} 个）· {len(ledger['evidence'])} 条证据"
          f"（其中厂商自报 {n_vend} 条 / {n_tp} 个模型的第三方口径与全量口径不同"
          f" / 推理补全 {n_inf} 条）· "
          f"{len(payload) / 1024:.1f} KB 内联数据 · 构建于 {ledger['meta']['built']}")


if __name__ == "__main__":
    main()
