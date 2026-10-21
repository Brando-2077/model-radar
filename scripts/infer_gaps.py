# -*- coding: utf-8 -*-
"""推理补全：给「公开榜抽查不到」的维度格跑**推理值**。

铁律：
  · 推理值必须在数据源里标注「这是推理得出的」；
  · 必须注明**怎么推的**（推理方法）与**凭什么推的**（依据）；
  · 精度必须能量化 —— 所以每种方法都先在已知格上做**留一验证（LOO）**，
    把 MAE 一并写进数据源，页面同屏展示。宁缺勿假：算不出锚点的格子一律不推。

口径（2026-10-18 v0.12 起）：scores.csv 的「榜单分」= 基准族内位次分（0-100、池内相对）。
本脚本的实测矩阵与补值都在这个口径上：族内 < 4 人的格不计分，也不参与矩阵与验证。

方法（按优先级）：
  M1 同族前版直推   只在「同型号小版本更新」上成立：官方同表两边都有的基准，
                    在**位次分**上量平均涨幅，加到旧版实测维度分上（有偏置，量得出）。
  M2 池内 k 近邻    在本池实测矩阵上，按「共同实测维的余弦相似度」找最接近的 k 个
                    模型，用它们在该维的实测分做相似度加权平均；k 与相似度函数
                    照旧由留一验证选型。
  不推（结构性）     纯文本模型的多模态维、零覆盖模型、没有共同实测维的 —— 一律
                    留「待定」，不硬填。

用法：python scripts/infer_gaps.py
产出：data/raw_inferred.csv（模型,维度,推理分,推理方法,依据,留一MAE,数据日期,URL）
      —— 该表由 build_scores.py 并入 scores.csv（来源标「推理补全」），页面单独标注。
"""
import math
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "raw_inferred.csv"
TODAY = "2026-10-18"  # 本次推理快照日期；重跑时改为新的数据日期

DIMS = ["推理与知识", "代码", "指令遵循", "Agent与工具调用", "长文本",
        "可靠性与低幻觉", "内容创作", "图片与制图"]

#  DeepSeek-V4.1-Flash-1017 官方同表（HF 模型卡）：1017 vs 0910 的 11 项基准面值
#  （面值留档对照；实际涨幅按下方 FAM_OF 落到「族」，在**位次分**上量）
SAME_TABLE = [
    ("HLE w/o tools",       42.6, 36.8),
    ("Terminal-Bench 4.0",  42.3, 31.2),
    ("DeepSWE v1.1",        77.0, 74.2),
    ("ProgramBench",        29.1, 20.3),
    ("NL2Repo-Bench",       68.2, 65.4),
    ("Automation-Bench",    60.5, 54.8),
    ("Agents' Last Exam",   35.4, 31.8),
    ("Apex Bench v1.1",     72.1, 64.6),
    ("Chartography",        83.0, 78.9),
    ("BabyVision",          92.5, 89.6),
    ("ZeroBench-main",      51.0, 49.0),
]
# 各项对应的基准族（与 data/mapping.csv 的「族」列同源；M1 在位次口径下落位用）
FAM_OF = {
    "HLE w/o tools": "HLE", "Terminal-Bench 4.0": "TB4.0", "DeepSWE v1.1": "DeepSWE",
    "ProgramBench": "ProgramBench", "NL2Repo-Bench": "NL2Repo", "Automation-Bench": "AutomationBench",
    "Agents' Last Exam": "Agents' Last Exam", "Apex Bench v1.1": "Apex Bench v1.1",
    "Chartography": "Chartography", "BabyVision": "BabyVision", "ZeroBench-main": "ZeroBench",
}
NEW_VER, OLD_VER = "DeepSeek-V4.1-Flash-1017", "DeepSeek-V4.1-Flash"

# 结构性「本维不适用」：纯文本模型的多模态维（图片与制图）—— 不是缺数据，是维度不对
TEXT_ONLY = {
    "Nemotron-3-Ultra", "ERNIE-5.1",
}


def load_scored():
    """scores.csv → (mat, fam_pct)：
    mat     = {模型: {维度: 维度分}}  —— 只取**计分行**（族内n >= 4）的均值，与页面口径一致；
    fam_pct = {模型: {族: 位次分}}   —— 计分行本身，M1 量两版涨幅用。"""
    df = pd.read_csv(DATA / "scores.csv", dtype={"族内n": str})
    df = df[~df["备注"].astype(str).str.startswith("推理补全")]
    df["榜单分"] = pd.to_numeric(df["榜单分"], errors="coerce")
    df["_n"] = pd.to_numeric(df["族内n"], errors="coerce")
    df = df[(df["_n"] >= 4) & df["榜单分"].notna()]
    df["模型"] = df["模型"].astype(str).str.strip()
    df["维度"] = df["维度"].astype(str).str.strip()
    g = df.groupby(["模型", "维度"])["榜单分"].mean()
    mat = {}
    for (m, d), v in g.items():
        mat.setdefault(m, {})[d] = float(v)
    fam_pct = {}
    for _, r in df.iterrows():
        fam = str(r["族"]).strip()
        if fam:
            fam_pct.setdefault(r["模型"], {})[fam] = float(r["榜单分"])
    return mat, fam_pct


def sim_cosine(a, b):
    """相似度 ① 原始分余弦：把"整体水平高"也当作相似（先验上合理）"""
    keys = [k for k in a if k in b]
    if len(keys) < 2:
        return None
    va = [a[k] for k in keys]
    vb = [b[k] for k in keys]
    dot = sum(x * y for x, y in zip(va, vb))
    na = math.sqrt(sum(x * x for x in va))
    nb = math.sqrt(sum(y * y for y in vb))
    return dot / (na * nb) if na > 0 and nb > 0 else None


def sim_pearson(a, b):
    """相似度 ② Pearson（共同维 ≥3 才稳）：只看剖面"形状"，不管绝对水平"""
    keys = [k for k in a if k in b]
    if len(keys) < 3:
        return None
    va = [a[k] for k in keys]
    vb = [b[k] for k in keys]
    ma, mb = sum(va) / len(va), sum(vb) / len(vb)
    num = sum((x - ma) * (y - mb) for x, y in zip(va, vb))
    da = math.sqrt(sum((x - ma) ** 2 for x in va))
    db = math.sqrt(sum((y - mb) ** 2 for y in vb))
    return num / (da * db) if da > 0 and db > 0 else None


SIMS = {"余弦相似度": sim_cosine, "Pearson剖面相似度": sim_pearson}


def knn_predict(mat, model, dim, k=3, simfn=None, skip=None):
    """池内 kNN（相似度加权）。skip=(模型,维度) 表示"这一格被藏起来"，用于留一验证：
    藏起来的格子既不能当邻居、也不能参与相似度计算（否则就是泄漏）。"""
    if model not in mat or simfn is None:
        return None
    me = dict(mat[model])
    if skip and skip[0] == model:
        me.pop(skip[1], None)          # 留一：目标维不参与自己的剖面
    cands = []
    for other, sc in mat.items():
        if other == model or dim not in sc:
            continue
        if skip and other == skip[0]:
            continue
        sim = simfn(me, sc)
        if sim is None or sim <= 0:
            continue
        cands.append((sim, sc[dim]))
    if not cands:
        return None
    cands.sort(reverse=True)
    top = cands[:k]
    wsum = sum(s for s, _ in top)
    if wsum <= 0:
        return None
    return sum(s * v for s, v in top) / wsum


def loo_mae(mat, simfn, k):
    """留一验证：把每个已知格依次藏起来、用其余格预测它，返回 MAE 与逐维明细。"""
    rows = [(m, d, v) for m, sc in mat.items() for d, v in sc.items()]
    errs, per_dim = [], {}
    for m, d, v in rows:
        p = knn_predict(mat, m, d, k=k, simfn=simfn, skip=(m, d))
        if p is None:
            continue
        e = abs(p - v)
        errs.append(e)
        per_dim.setdefault(d, []).append(e)
    if not errs:
        return None, 0, {}
    return sum(errs) / len(errs), len(errs), {d: (len(v), round(sum(v) / len(v), 2))
                                              for d, v in per_dim.items()}


def main():
    mat, fam_pct = load_scored()
    n_cells = sum(len(sc) for sc in mat.values())
    print(f"[载入] 实测矩阵（位次口径）：{len(mat)} 个模型 / {n_cells} 个已计分格")

    # 方法选择：两种相似度 × k∈{2,3,5} 都在同一批已知格上做留一验证，取 MAE 最低者。
    # 不用"我觉得哪个像"——用验证结果说话，并把 MAE 一并写进数据源。
    trials = []
    for sname, simfn in SIMS.items():
        for k in (2, 3, 5):
            mae, n, per = loo_mae(mat, simfn, k)
            if mae is not None:
                trials.append((mae, sname, simfn, k, n, per))
    if not trials:
        raise SystemExit("留一验证算不出任何可预测格，终止（宁缺勿假）")
    trials.sort(key=lambda x: x[0])
    mae_knn, sim_name, sim_fn, K, n_loo, per_loo = trials[0]
    print("[选型] 留一验证（同一批已知格）：")
    for mae, sname, _, k, n, _ in trials:
        print(f"       {sname:<12} k={k}  MAE {mae:5.2f} 位次分（n={n}）")
    print(f"       → 采用 {sim_name}，k={K}")

    # M1 涨幅：官方同表 11 项里两边都能在**位次口径**落位的族上量（族内 <4 人无法位次化）
    lift, lifted = [], []
    for bench, *_ in SAME_TABLE:
        fam = FAM_OF.get(bench)
        nv = fam_pct.get(NEW_VER, {}).get(fam)
        ov = fam_pct.get(OLD_VER, {}).get(fam)
        if nv is None or ov is None:
            continue
        lift.append(nv - ov)
        lifted.append(bench)
    if not lift:
        raise SystemExit("M1 找不到可比的计分族，终止（宁缺勿假）")
    lift_mean = sum(lift) / len(lift)
    lift_abs = sum(abs(x) for x in lift) / len(lift)

    rows = []
    m1_done = set()          # M1 已覆盖的格子，M2 不再重复推（一个格子只留一条推理值）
    # M1：同族小版本直推（1017 缺计分证据的维度）
    old = mat.get(OLD_VER, {})
    for d in DIMS:
        if d in old and d not in mat.get(NEW_VER, {}):
            v = round(min(100.0, max(0.0, old[d] + lift_mean)), 1)
            rows.append({
                "模型": NEW_VER, "维度": d, "推理分": v, "推理方法": "M1 同族前版直推",
                "依据": (f"官方模型卡同表 11 项基准里 {len(lift)} 项在本池可位次化"
                        f"（其余族内样本不足），1017 相对 0910 平均 {lift_mean:+.2f} 位次分"
                        f"（MAE {lift_abs:.1f}）；本维 1017 无计分证据、0910 实测 {old[d]:.2f}，"
                        f"按 {lift_mean:+.2f} 上浮（裁到 0-100）；位次分口径"),
                "留一MAE": round(lift_abs, 1), "数据日期": TODAY,
                "URL": "https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash-1017",
            })
            m1_done.add((NEW_VER, d))
    # M2：池内 kNN（其余空格；结构性不适用的不推；M1 已覆盖的跳过）
    for m, sc in sorted(mat.items()):
        for d in DIMS:
            if d in sc or (m, d) in m1_done:
                continue
            if d == "图片与制图" and m in TEXT_ONLY:
                continue
            p = knn_predict(mat, m, d, k=K, simfn=sim_fn)
            if p is None:
                continue
            n_d, dm = per_loo.get(d, (0, mae_knn))
            rows.append({
                "模型": m, "维度": d, "推理分": round(p, 1), "推理方法": f"M2 池内k近邻({sim_name},k={K})",
                "依据": (f"本维公开榜查不到可核分数（宁缺勿假）；改用本池 {n_loo} 个已知格做留一验证、"
                        f"总体 MAE {mae_knn:.1f} 位次分（本维 MAE {dm:.1f}），按 8 维实测剖面的{sim_name}"
                        f"取最接近的 {K} 个模型，对其本维实测位次分做相似度加权平均"),
                "留一MAE": round(dm, 1), "数据日期": TODAY,
                "URL": "https://suyoumo.github.io/llm-leaderboard/",
            })

    cols = ["模型", "维度", "推理分", "推理方法", "依据", "留一MAE", "数据日期", "URL"]
    out = pd.DataFrame(rows)[cols].sort_values(["模型", "维度"]).reset_index(drop=True)
    out.to_csv(OUT, index=False, encoding="utf-8-sig")
    print(f"[LOO] 池内 kNN（{sim_name}，k={K}）在 {n_loo} 个已知格上：总体 MAE {mae_knn:.2f} 位次分")
    for d, (n, e) in sorted(per_loo.items(), key=lambda x: x[1][1]):
        print(f"       {d:<12} n={n:<4} MAE={e}")
    print(f"[LOO] M1 同族前版直推的涨幅依据：官方同表 11 项里 {len(lifted)} 项可位次化，平均 "
          f"{lift_mean:+.2f}（MAE {lift_abs:.2f}）；可比项：{', '.join(lifted)}")
    print(f"\n已写出 {OUT}：{len(out)} 条推理值")
    print(out[["模型", "维度", "推理分", "推理方法", "留一MAE"]].to_string(index=False))
    left = [(m, d) for m, sc in mat.items() for d in DIMS
            if d not in sc and not (d == "图片与制图" and m in TEXT_ONLY)
            and not ((out["模型"] == m) & (out["维度"] == d)).any()]
    print("\n仍未填（留「待定」，宁缺勿假）：")
    for m, d in left:
        why = "零覆盖模型（无任何实测可作锚点）" if not mat.get(m) else (
            "纯文本模型的多模态维（结构性不适用）" if d == "图片与制图" else "共同实测维不足 2 个，找不到可比邻居")
        print(f"  {m:<26} {d:<12} {why}")


if __name__ == "__main__":
    main()
