# -*- coding: utf-8 -*-
"""OpenRouter 公开榜单（/rankings 前端 API）抓取 —— 可用性核实脚本。

2026-10-17 实测结论：**无需登录、无需 key、无需 Cookie**，直接 GET 即得 JSON。
端点前缀 https://openrouter.ai/api/frontend/v1/rankings/
  models?view=day|week|month   按 token 量的**逐模型**用量表（week 650 行 / month 707 行，
                               字段 total_prompt_tokens、total_completion_tokens、count(请求数)、
                               change(环比%)、variant(standard/free 分开计)、tool_calls、media 等）
  apps                         按 token 量的应用榜 + 应用分类（personal-agent/cli-agent…）
  benchmarks                   aaData(AA 镜像：intelligence/coding/agentic + percentilesBySlug)
                               daData(**Design Arena** 12 个类目：website/3d/dataviz/svg/
                               uicomponent/… 含 agents-fullstack 等，score+win_rate)
                               valsIndex(Vals AI)、weightedInputPrices、costPerRequest
  market-share / task-spend / session-cost / context-length / tools / images / open-closed
                              图表数据（task-spend 只给 code/data/agent/general 四类宏观占比）

⚠️ OpenRouter 官方方法论页明说：这些榜**按 token 量排名，不衡量质量**——
"higher token total shows how much a model is used, not which model is best for a task.
They do not rank models by accuracy, reasoning ability, or benchmark performance."
且「同一模型的 free 变体单独排名」「用户/应用设为私有的请求不计入」。
→ 因此只可用作**图外的"热度/认可度"信号**，不得并入雷达轴（本项目设计红线）。

用法：
  python fetch_or_rankings.py                # 抓取并快照到 data/archive/or_rankings_<日期>/
  python fetch_or_rankings.py --summary       # 只打印可读摘要（模型覆盖 / Top 用量 / 四类占比）
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "data" / "archive"
BASE = "https://openrouter.ai/api/frontend/v1/rankings/"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

TARGETS = [
    "models?view=day",
    "models?view=week",
    "models?view=month",
    "apps",
    "benchmarks",
    "market-share",
    "task-spend",
    "session-cost",
    "context-length",
    "tools",
    "images",
    "open-closed",
]

# 账本名 → OpenRouter 名（改过名/带厂商前缀对不上的，手工兜底）
ALIASES = {
    "Hunyuan-Hy3": "tencent/hy3",
}


def get(path, timeout=60):
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch(snapshot_dir):
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    for t in TARGETS:
        name = t.replace("?", "_").replace("=", "-").replace("/", "_") + ".json"
        try:
            body = get(t)
            (snapshot_dir / name).write_bytes(body)
            print(f"[完成] {t:28s} {len(body):>8d} bytes -> {name}")
        except Exception as e:  # 端点下线/改名时不中断
            print(f"[失败] {t:28s} {type(e).__name__}: {e}")


def summary(snapshot_dir):
    """打印可读摘要：本项目账本模型的用量覆盖率 + 全场 Top 用量 + 四类宏观占比。"""
    import csv
    import re

    def norm(s):
        s = s.split("/")[-1]
        s = re.sub(r"-\d{8}$", "", s)
        return re.sub(r"[^a-z0-9]", "", s.replace(":free", "").lower())

    def total(r):
        return r["total_prompt_tokens"] + r["total_completion_tokens"]

    def load(p):
        return json.loads((snapshot_dir / p).read_text(encoding="utf-8"))["data"]

    with open(ROOT / "data" / "scores.csv", encoding="utf-8-sig", newline="") as f:
        ledger = sorted({r["模型"] for r in csv.DictReader(f)})

    for view in ("day", "week", "month"):
        fn = f"models_view-{view}.json"
        if not (snapshot_dir / fn).exists():
            continue
        data = load(fn)
        print(f"\n=== models view={view}  行数 {len(data)}  用量桶日期 {data[0]['date']}")
        top = sorted(data, key=lambda r: -total(r))[:15]
        for r in top:
            chg = r.get("change")
            chg = f"{chg*100:+.1f}%" if isinstance(chg, (int, float)) else "—"
            print(f"  {r['model_permaslug']:52s} {r['variant']:9s} "
                  f"{total(r)/1e12:8.2f}T tok  {r['count']:>13,} req  环比 {chg}")

        by_norm = {}
        for r in data:
            k = norm(r["model_permaslug"])
            # 同模型多变体时优先 standard（free 变体 OR 单独排名）
            if k not in by_norm or (by_norm[k]["variant"] != "standard" and r["variant"] == "standard"):
                by_norm[k] = r

        def match(name):
            """先精确匹配；再退化为"OR 名以账本名开头且唯一"（处理 gemma-4-31b-it / nemotron-3-ultra-550b 这类后缀）。
            注意不能用任意子串匹配：'glm53' 会误命中 'glm53flash'。"""
            n = norm(ALIASES.get(name, name))
            if n in by_norm:
                return by_norm[n]
            cands = [k for k in by_norm if k.startswith(n)]
            if len(cands) == 1:
                return by_norm[cands[0]]
            return None

        hit = {m: r for m in ledger if (r := match(m))}
        print(f"  --- 账本覆盖 {len(hit)}/{len(ledger)} 模型；未覆盖："
              f"{[m for m in ledger if m not in hit]}")

    tf = snapshot_dir / "task-spend.json"
    if tf.exists():
        d = json.loads(tf.read_text(encoding="utf-8"))["data"]
        print(f"\n=== task-spend（近 {d['tokens']['windowDays']} 天宏观占比）")
        for mc in d["tokens"]["macroCategories"]:
            print(f"  {mc['key']:8s} {mc['label']:10s} token 占比 {mc['spendShare']*100:5.1f}%")


if __name__ == "__main__":
    date = "2026-10-17"
    snap = ARCHIVE / f"or_rankings_{date}"
    if "--summary" in sys.argv:
        summary(snap)
    else:
        fetch(snap)
        summary(snap)
