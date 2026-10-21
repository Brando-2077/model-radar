# -*- coding: utf-8 -*-
"""
把 data/raw_*.csv（各榜单原始证据）归一化、映射到 8 维，重建 data/scores.csv。
用法：python build_scores.py

口径即数据（2026-10-17 起）：映射与命名统一不写死在代码里，而在 data/ 的两张表——
改榜单只动这两处，文档直接引用它们，从机制上避免"代码/文档各写一遍、靠人记得同步"：
  data/mapping.csv  (来源, 类别) → 维度 + **基准族**，附备注
                    · 维度留空 = **有意不映射**（总分/综合指数等只留档 raw），不再报"未映射"
                    · 族 = 同一基准的多种报法归并（AA 的 HLE 与厂商的 HLE w/o tools 同族等），
                      2026-10-18 v0.12 起；下游与文档都引用这张表，代码不另抄一份
  data/canon.csv    各榜单模型名 → 项目统一命名（scores.csv 以统一名为准）
规则说明见 docs/methodology.md；TB 双版本处理见 TB_PREFER / TB_FALLBACK；
基准族计分规则见 apply_family_scores()，最小池门槛见 FAMILY_MIN_N。

- 每行输出 = 模型 × 维度 × 来源 的一条证据（备注列保留原始分与出处，可溯源）
- **「榜单分」口径（v0.12 起）= 基准族内位次分**：族内 (名次−0.5)/n×100，0-100、池内相对，
  语义 = "在该基准的模型池里赢过多少比例对手"。同一（模型×族）只留一票（第三方优先、
  日期新者优先）；族内模型数 < FAMILY_MIN_N 的族不计分（行保留、写「族内n」与面值，
  页面按「样本不足」标注）。「族 / 族内n」两列随行输出，供 build_html.py 过滤与展示。
- 维度分 = 该维度各计分族位次分的均值（由 build_html.py 计算）
- 只采用可核的跑分与公开榜单
- data/raw_inferred.csv 是**推理补全**通道：公开榜抽不到分时，用
  scripts/infer_gaps.py 在已知格上做留一验证后跑出的估计值。来源标「推理补全」，
  默认不计入维度分；页面可切换「含推理补全」查看（宁缺勿假，不静默混入）。
"""
import glob
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
DATA = ROOT / "data"
OUT = DATA / "scores.csv"


def load_canon() -> dict:
    """data/canon.csv → {榜单模型名: 统一命名}。"""
    df = pd.read_csv(DATA / "canon.csv", dtype=str, keep_default_na=False, encoding="utf-8-sig")
    return {r["榜单名"].strip(): r["统一名"].strip() for _, r in df.iterrows()}


def load_mapping():
    """data/mapping.csv → ({(来源,类别): 维度}, 有意不映射集合, {(来源,类别): 基准族})。"""
    df = pd.read_csv(DATA / "mapping.csv", dtype=str, keep_default_na=False, encoding="utf-8-sig")
    mapping, family, unmapped = {}, {}, set()
    for _, r in df.iterrows():
        key = (r["来源"].strip(), r["类别"].strip())
        dim = r["维度"].strip()
        if dim:
            mapping[key] = dim
            family[key] = r["族"].strip() if "族" in df.columns else ""
        else:
            unmapped.add(key)
    return mapping, unmapped, family


# 命名统一、维度映射与基准族都来自 data/（导入本模块即加载；build_html.py 复用保证同源）
CANON = load_canon()
MAPPING, EXPLICIT_UNMAPPED, FAMILY = load_mapping()

# 基准族最小池（v0.12）：族内模型数 < 4 不进计分——n=3 时"第一名"=83 分、
# n=2 时"第一名"=75 分，位次分辨率失真。证据行保留、页面标「样本不足」，待池子长大后自动入分。
FAMILY_MIN_N = 4

# 「仅第三方榜单」口径要整体排除的**厂商自报渠道**（口径即数据，只在这里维护一处；
# build_html.py 复用本集合）。判定按来源渠道、不按"是不是自家模型"：
# 如 NVIDIA 官方页给非自家模型报的分也一并排除。
# 2026-10-17 增补：DeepSeek官方（1017 官方基准）、酥悠沫-官方（聚合站转录的厂商自报表，
# 数字仍出自厂商页面，按渠道排除才自洽）。酥悠沫本身（第三方聚合）不算厂商渠道。
VENDOR_SRC = {"Z.ai官方", "dots官方", "腾讯官方", "NVIDIA官方", "DeepSeek官方", "酥悠沫-官方"}

# Terminal-Bench 同族口径（2026-10-08 定）：AA 同时有 2.1 与 4.0 两版分数，两版难度差很大
# （4.0 普遍低 30~80 个百分点），同时计入会让"有双版本数据的模型"在取均值时多吃分。
# 规则：每个模型只取一版——优先 TB4.0（版本新、覆盖广），缺则回退 TB2.1。被丢弃的行仍留档 raw。
TB_PREFER = "Terminal-Bench 4.0"
TB_FALLBACK = "Terminal-Bench 2.1"


def normalize(v, scale, pool):
    """原始分 → 0-100。规则见 docs/methodology.md。"""
    v = float(v)
    if scale in ("0-100", "百分制"):
        return v
    if scale == "0-1":
        return v * 100
    if scale == "10分制":
        return v * 10
    if scale == "5分制":
        return v * 20
    if scale in ("Elo", "指数"):  # 池内相对分：min-max 线性映射到 [60,100]
        lo, hi = min(pool), max(pool)
        return 60 + (v - lo) / (hi - lo) * 40 if hi > lo else 80
    raise ValueError(f"未知量纲: {scale}")


def load_inferred():
    """data/raw_inferred.csv → 推理补全行。

    这张表的列与 raw_*.csv 不同（带推理方法/依据/留一MAE），所以单独读、单独出账：
     source 一律记「推理补全」，备注里写清方法与日期，页面据此标成推理值。
    **它绝不混进实测证据的平均值**——默认口径只用实测，是否纳入由页面口径开关决定。"""
    p = DATA / "raw_inferred.csv"
    if not p.exists():
        return None
    df = pd.read_csv(p)
    if df.empty:
        return None
    return df


def apply_family_scores(rows):
    """把「榜单分」从面值换算成基准族内位次分（v0.12 口径）。

    · 去重：同一（模型 × 族）只留一票 —— 第三方来源优先，其次数据日期新者优先
      （与试算脚本完全同式）；被淘汰的行不进 scores.csv（仍留档 raw）。
    · 计分：族内模型数 >= FAMILY_MIN_N 的族 → (族内名次 − 0.5) / n × 100（tie 取名次均值），
      写回「榜单分」（1 位小数），并写「族」「族内n」。
    · 族内 < FAMILY_MIN_N 的族 → 榜单分保留面值，照样写「族」「族内n」，由页面标「样本不足」。
    返回 (新 rows, 统计 dict)。"""
    df = pd.DataFrame(rows)
    stats = {"families": 0, "scored_families": 0, "off_families": 0,
             "scored_rows": 0, "off_rows": 0, "dropped": 0}
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
        print(f"[口径] 基准族去重：{len(dropped_idx)} 条同（模型×族）多来源证据只留一票"
              f"（第三方优先、日期新者优先；其余留档 raw）：")
        for i in dropped_idx:
            r = df.loc[i]
            print(f"  - {r['模型']} × {r['_fam']} ← {str(r['备注']).split(' 原始')[0]}")

    kept = kept.copy()
    kept["_n"] = kept.groupby("_fam")["模型"].transform("nunique")
    kept["_pct"] = kept.groupby("_fam")["榜单分"].transform(
        lambda s: (s.rank(method="average") - 0.5) / len(s) * 100)

    n_by_idx = kept["_n"].to_dict()
    pct_by_idx = kept["_pct"].to_dict()
    out, keep_set = [], set(kept.index)
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
    return out, stats


def main():
    # raw_inferred.csv 虽然也叫 raw_*.csv，但它是推理补全通道、列结构不同，必须排除
    files = [f for f in sorted(glob.glob(str(DATA / "raw_*.csv")))
             if not f.endswith("raw_inferred.csv")]
    if not files:
        raise SystemExit("data/ 下没有任何 raw_*.csv 原始数据")
    df = pd.concat([pd.read_csv(f) for f in files], ignore_index=True)
    df["原始分"] = df["原始分"].astype(float)
    df["模型"] = df["模型"].str.strip().map(lambda m: CANON.get(m, m))

    # Terminal-Bench 同族去重：AA 同时报 2.1 与 4.0 两版分数（难度差很大，4.0 对多数模型
    # 只解出 1~4/198 题），两版都计会让 TB 族在 Agent 维度里双重计权。每个模型只取一版：
    # 有 TB4.0 用 TB4.0，没有才用 TB2.1；被丢弃的行仍留档在 raw 文件里可溯源。
    tb40_models = set(df[(df["来源"] == "Artificial-Analysis") & (df["类别"] == TB_PREFER)]["模型"])
    drop = ((df["来源"] == "Artificial-Analysis") & (df["类别"] == TB_FALLBACK)
            & df["模型"].isin(tb40_models))
    if drop.any():
        print(f"[口径] Terminal-Bench 同族去重：{int(drop.sum())} 条 TB2.1 因该模型已有 TB4.0 而不计入维度"
              f"（留档 raw）：{', '.join(sorted(set(df[drop]['模型'])))}")
    df = df[~drop]

    rows, skipped = [], []
    for (src, cat), grp in df.groupby(["来源", "类别"]):
        dim = MAPPING.get((src, cat))
        if dim is None:
            if (src, cat) not in EXPLICIT_UNMAPPED:
                skipped.append(f"{src}|{cat}")
            continue
        pool = grp["原始分"].tolist()
        fam = FAMILY.get((src, cat), "")
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

    # 基准族内位次分（v0.12）：去重 + 位次换算 + 「族 / 族内n」两列
    rows, fstats = apply_family_scores(rows)
    print(f"[口径] 基准族位次分：{fstats['families']} 个基准族 —— {fstats['scored_families']} 族入分"
          f"（{fstats['scored_rows']} 条证据），{fstats['off_families']} 族因池内 < {FAMILY_MIN_N} 人"
          f"未计分（{fstats['off_rows']} 条留面值，页面标「样本不足」）")

    if skipped:
        print("[提示] 以下类别**既未映射、也未在 data/mapping.csv 里声明「有意不映射」**（请检查该表）：")
        for s in sorted(set(skipped)):
            print(f"  - {s}")

    inf = load_inferred()
    n_inf = 0
    if inf is not None:
        for _, r in inf.iterrows():
            rows.append({
                "模型": str(r["模型"]).strip(),
                "维度": str(r["维度"]).strip(),
                "榜单分": round(float(r["推理分"]), 1),
                "备注": f'推理补全·{r["推理方法"]} 原始{r["推理分"]:g}(推理值) @{r["数据日期"]}',
                "族": "",
                "族内n": "",
            })
            n_inf += 1
        print(f"[推理补全] {n_inf} 条推理值并入 {OUT.name}：来源标「推理补全」，"
              f"默认口径不计入维度分，页面可切「含推理补全」查看")

    out = pd.DataFrame(rows)[["模型", "维度", "榜单分", "备注", "族", "族内n"]]
    out = out.sort_values(["模型", "维度"]).reset_index(drop=True)
    out.to_csv(OUT, index=False, encoding="utf-8-sig")
    scored = out[pd.to_numeric(out["族内n"], errors="coerce") >= FAMILY_MIN_N]
    print(f"\n已重建 {OUT}：{len(out)} 条证据（其中推理补全 {n_inf} 条），"
          f"覆盖 {out['模型'].nunique()} 个模型 × {out['维度'].nunique()} 个维度；"
          f"其中计分（族内 >= {FAMILY_MIN_N}）{len(scored)} 条、"
          f"计分覆盖 {scored.groupby(['模型', '维度']).ngroups} 格")
    cov = out.pivot_table(index="模型", columns="维度", values="榜单分", aggfunc="count")
    print("\n覆盖情况（每格=证据条数）：")
    print(cov.fillna(0).astype(int).to_string())


if __name__ == "__main__":
    main()
