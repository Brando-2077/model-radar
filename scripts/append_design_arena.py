# -*- coding: utf-8 -*-
"""Design Arena 榜（经 OpenRouter 公开接口转发）→ data/raw_design_arena.csv。

取数链路（2026-10-17 实测可用，无需登录/key/Cookie）：
  https://openrouter.ai/api/frontend/v1/rankings/benchmarks  →  data['daData']['models-website']
  （由 OpenRouter 转发的 Design Arena 人评对战数据：score=Elo、win_rate=胜率）
快照：data/archive/or_rankings_2026-10-17/benchmarks.json（抓取脚本 scripts/fetch_or_rankings.py）

为什么只取 models-website 一个类目：
  ①它是「图片与制图」维「前端美化/复刻」子能力的直接对应项（网页生成人评对战），
    与已接入的 LMArena·WebDev-Elo 同族但平台不同、模型池互补；
  ②「图片与制图」= 图片理解 + 图片理解细节 + 前端美化/复刻 三项合并。
    该维现有证据：MMMU-Pro 17 + Vision-Elo 7（图片理解侧）vs WebDev-Elo 17（前端侧）。
    只加 models-website → 前端侧 17+14=31，图片理解侧 24，两侧基本均衡；
    若再加 uicomponent/dataviz/svg，前端侧会涨到 59，会把该维整体拽向"前端"，故不入账。
    其余类目（uicomponent / dataviz / svg / codecategories / agents-*）快照里都有，
    想追加只需在此加类目名 + data/mapping.csv 加一行（映射即数据，2026-10-17 起）。
  ③codecategories 属代码能力、agents-* 属 Agent 能力，映射进本维会与「代码」「Agent与工具调用」双重计权。

口径：
  - 量纲 Elo → build_scores.py 在**本类目池内**做 min-max 映射到 60~100（与 LMArena 同规则）；
  - 同一模型在 Design Arena 可能有多行（不同推理档位，如 (xhigh) / Max）——本脚本每个模型只取
    最高分一行（与项目"每模型每基准只取一版"的同族去重口径一致），被丢弃的行不落盘；
  - 胜率 win_rate 不单独入账（与 Elo 同源，同时计入会重复计权）；
  - 数据日期取 OpenRouter 榜单页标注的最新数据日（页面 dateModified），非本机抓取日。

用法：python append_design_arena.py   （幂等：已有行会跳过）
"""
import csv
import glob
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SNAPSHOT = DATA / "archive" / "or_rankings_2026-10-17" / "benchmarks.json"
OUT = DATA / "raw_design_arena.csv"

SRC = "Design-Arena"
CAT = "Website-Elo"          # Design Arena 的 models-website 类目
SCALE = "Elo"
SNAPSHOT_DATE = "2026-10-15"  # OpenRouter 榜单页标注的最新数据日
URL = "https://openrouter.ai/rankings#benchmarks（Design Arena models-website，经 OpenRouter 公开接口转发）"

# 账本名 → OpenRouter 名（改过名/带厂商前缀对不上的兜底）
ALIAS = {"Hunyuan-Hy3": "tencent/hy3"}
# 账本里没有公司信息的型号
COMPANY_FALLBACK = {}


def norm(s):
    """模型名归一：去厂商前缀、去版本日期后缀、去免费档标记、只留字母数字。"""
    s = s.split("/")[-1]
    s = re.sub(r"-\d{8}$", "", s)
    return re.sub(r"[^a-z0-9]", "", s.replace(":free", "").lower())


def main():
    ledger = sorted({r["模型"] for r in csv.DictReader(
        io.open(DATA / "scores.csv", encoding="utf-8-sig"))})
    by_norm = {norm(ALIAS.get(m, m)): m for m in ledger}

    company = {}
    for f in glob.glob(str(DATA / "raw_*.csv")):
        for r in csv.DictReader(io.open(f, encoding="utf-8-sig")):
            company.setdefault(r["模型"], r["公司"])

    da = json.load(io.open(SNAPSHOT, encoding="utf-8"))["data"]["daData"]
    if "models-website" not in da:
        raise SystemExit(f"快照里没有 models-website 类目：{list(da)}")

    # 每模型只留最高分一行（同模型不同推理档位会重复出现）
    best = {}
    for r in da["models-website"]:
        n = norm(ALIAS.get(r["permaslug"], r["permaslug"]))
        if n not in by_norm:
            continue
        m = by_norm[n]
        if m not in best or r["score"] > best[m]["score"]:
            if m in best:
                print(f"[去重] {m}: 丢弃 {best[m]['display_name']}({best[m]['score']})，"
                      f"保留 {r['display_name']}({r['score']})")
            best[m] = r

    have = set()
    if OUT.exists():
        have = {(r["模型"], r["来源"], r["类别"])
                for r in csv.DictReader(io.open(OUT, encoding="utf-8-sig"))}
    header = ["模型", "公司", "来源", "类别", "原始分", "量纲", "数据日期", "URL"]
    new_rows = []
    for m, r in sorted(best.items()):
        if (m, SRC, CAT) in have:
            print(f"[跳过] {m} 已有 {SRC}|{CAT}")
            continue
        new_rows.append([m, company.get(m) or COMPANY_FALLBACK.get(m, ""), SRC, CAT,
                         r["score"], SCALE, SNAPSHOT_DATE, URL])

    mode = "a" if OUT.exists() else "w"
    with io.open(OUT, mode, encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        if mode == "w":
            w.writerow(header)
        w.writerows(new_rows)
    print(f"\n[完成] {OUT.name} 追加 {len(new_rows)} 行（{SRC}·{CAT}，Elo 池内 {len(best)} 模型）")
    for row in new_rows:
        print(f"  {row[0]:20s} {row[1]:12s} Elo={row[4]}")


if __name__ == "__main__":
    main()
