# -*- coding: utf-8 -*-
"""AA 单模型页 ↔ 账本差集：找出每个模型在 AA 有、但 raw_aa_lmarena.csv 还没有的分项基准，
输出报告；--append 时把缺行追加进 raw 文件。

用法：
  python diff_aa.py             # 只看报告
  python diff_aa.py --append    # 追加缺失行

数据来源：scripts/ 下的 aa_page.html（AA 主榜页）+ model_*.html（各模型单页），
两者都含完整模型记录（RSC payload 里的扁平 JSON）。
⚠ 2026-10-17：这些存档已删除（省 53MB）。用前先 `cd scripts && python fetch_model.py <slug...>`
   重抓模型页；aa_page.html 需另抓 https://artificialanalysis.ai/models 。
"""
import glob
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw_aa_lmarena.csv"
HERE = Path(__file__).parent

# 账本统一名 → AA slug（与 releases.slug 对齐）
LEDGER_TO_SLUG = {
    "Claude-Fable-5.1": "claude-fable-5-1",
    "Claude-Opus-5.5": "claude-opus-5-5",
    "Claude-Sonnet-5.5": "claude-sonnet-5-5",
    "GPT-6-Astra": "gpt-6-astra",
    "GPT-6-Sol": "gpt-6-sol",
    "GPT-6-Luna": "gpt-6-luna",
    "GLM-5.3": "glm-5-3",
    "GLM-5.3 Flash": "glm-5-3-flash",
    "DeepSeek-V4-Pro": "deepseek-v4-pro",
    "DeepSeek-V4.1-Flash": "deepseek-v4-1-flash",
    "Qwen3.8-Max": "qwen3-8-max",
    "Qwen3.8-27B": "qwen3-8-27b",
    "Kimi-K3": "kimi-k3",
    "MiniMax-M3": "minimax-m3",
    "MiniMax-M3.1-Flash": "minimax-m3-1-flash",
    "Hunyuan-Hy3": "hy3",
    "Nemotron-3-Ultra": "nvidia-nemotron-3-ultra-550b-a55b",
    "DeepSeek-V4.1-Flash-1017": "deepseek-v4-1-flash-1017",
    "GLM-5.1": "glm-5-1",
    "GLM-5.2": "glm-5-2",
    "MiMo-V2.6-Pro": "mimo-v2-6-pro",
    "Gemini 4 Argon": "gemini-4-argon",
    "Gemini 3.8 Flash": "gemini-3-8-flash",
    "Gemini 3.5 Flash-Lite": "gemini-3-5-flash-lite",
    # 2026-10-17 批次新增模型
    "Kimi-K2.6": "kimi-k2-6",
    "Kimi-K2.7-Code": "kimi-k2-7-code",
    "Step-5-Preview": "step-5",
    "GLM-5v-Turbo": "glm-5v-turbo",
}

# 新模型的厂商（raw 里还没有行，需要显式给）
NEW_COMPANY = {
    "Kimi-K2.6": "月之暗面",
    "Kimi-K2.7-Code": "月之暗面",
    "Step-5-Preview": "阶跃星辰",
    "GLM-5v-Turbo": "智谱",
}

# 本次追加入库的 AA 数据快照日期
SNAPSHOT_DATE = "2026-10-17"

# AA 字段 → (我们的类别名, 量纲)；terminalBench21 只补给指定模型（见 TB21_MODELS）
FIELDS = [
    ("gpqa", "GPQA", "0-1"),
    ("hle", "HLE", "0-1"),
    ("critpt", "CritPt", "0-1"),
    ("scicode", "SciCode", "0-1"),
    ("terminalBench21", "Terminal-Bench 2.1", "0-1"),
    ("terminalBench40", "Terminal-Bench 4.0", "0-1"),
    ("lcr", "AA-LCR", "0-1"),
    ("ifbench", "IFBench", "0-1"),
    ("mmmuPro", "MMMU-Pro", "0-1"),
    ("automationBenchPartialScore", "AutomationBench-AA", "0-1"),
    ("tau2", "τ²-bench", "0-1"),
    ("omniscience", "AA-Omniscience Index", "指数"),
    ("omniscienceHallucinationRate", "AA-Omniscience Hallucination Rate", "0-1越低越好"),
]


def load_pushes(path):
    html = open(path, encoding="utf-8").read()
    texts = []
    for m in re.finditer(r'self\.__next_f\.push\(\[', html):
        start = m.end() - 1
        depth, i, in_str, esc = 0, start, False, False
        while i < len(html):
            c = html[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "[":
                    depth += 1
                elif c == "]":
                    depth -= 1
                    if depth == 0:
                        try:
                            arr = json.loads(html[start:i + 1])
                        except Exception:
                            arr = None
                        if arr:
                            for el in arr[1:]:
                                if isinstance(el, str):
                                    texts.append(el)
                        break
            i += 1
    return "\n".join(texts)


def enclosing(blob, pos, needle):
    starts = [m.start() for m in re.finditer(r"\{", blob[:pos])]
    for st in reversed(starts):
        depth, j, in_str, esc = 0, st, False, False
        while j < len(blob):
            c = blob[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        chunk = blob[st:j + 1]
                        if needle in chunk:
                            try:
                                return json.loads(chunk)
                            except Exception:
                                return None
                        break
            j += 1
    return None


def load_slug_records():
    """扫描所有页面，返回 {slug: record}（同 slug 取字段最全的一条）。"""
    recs = {}
    files = ["aa_page.html"] + sorted(glob.glob(str(HERE / "model_*.html")))
    for path in files:
        if not os.path.exists(path):
            continue
        blob = load_pushes(path)
        for m in re.finditer(r'"gpqa"', blob):
            rec = enclosing(blob, m.start(), '"price1mInputTokens"')
            if not rec:
                continue
            slug = (rec.get("release") or {}).get("slug") or rec.get("slug")
            if not slug:
                continue
            old = recs.get(slug)
            if old is None or len(rec) > len(old):
                recs[slug] = rec
    return recs


def main():
    import pandas as pd
    sys.path.insert(0, str(ROOT))
    from build_scores import CANON  # noqa: E402

    records = load_slug_records()
    print(f"扫描到 {len(records)} 个 slug 记录")
    raw = pd.read_csv(RAW)
    # 用 build_scores 的 CANON 归一化模型名，否则 raw 里的原始名与账本名对不上
    raw["模型"] = raw["模型"].astype(str).str.strip().map(lambda m: CANON.get(m, m))
    raw["类别"] = raw["类别"].astype(str).str.strip()
    raw["来源"] = raw["来源"].astype(str).str.strip()

    # 已进账本的类别（AA 来源），用于去重
    have_aa = {(m, c) for m, c in zip(raw[raw["来源"] == "Artificial-Analysis"]["模型"],
                                      raw[raw["来源"] == "Artificial-Analysis"]["类别"])}
    # 该模型在账本里已有全部类别的视角
    have_by_model = {}
    for m, c in zip(raw["模型"], raw["类别"]):
        have_by_model.setdefault(m, set()).add(c)

    new_rows = []
    for ledger, slug in LEDGER_TO_SLUG.items():
        rec = records.get(slug)
        if not rec:
            print(f"[缺记录] {ledger} (slug={slug})")
            continue
        have = have_by_model.get(ledger, set())
        missing = [(cat, rec[f], scale) for f, cat, scale in FIELDS
                   if rec.get(f) is not None and (ledger, cat) not in have_aa]
        if not missing:
            print(f"[齐全] {ledger}")
            continue
        print(f"\n{ledger} (slug={slug}) 可补 {len(missing)} 项（AA 来源缺）:")
        for cat, v, _ in missing:
            flag = "" if cat in have else "  ← 该模型首次有此维证据"
            print(f"   + {cat:36s} {v}{flag}")
        for cat, v, scale in missing:
            new_rows.append({
                "模型": ledger,
                "公司": NEW_COMPANY.get(ledger, ""),
                "来源": "Artificial-Analysis",
                "类别": cat, "原始分": v, "量纲": scale,
                "数据日期": SNAPSHOT_DATE,
                "URL": f"https://artificialanalysis.ai/models/{slug}",
            })

    if "--append" in sys.argv and new_rows:
        add = pd.DataFrame(new_rows)
        out = pd.concat([raw, add], ignore_index=True)
        out.to_csv(RAW, index=False, encoding="utf-8-sig")
        print(f"\n已追加 {len(add)} 行 → {RAW.name}（现 {len(out)} 行）")
    elif new_rows:
        print(f"\n[试运行] 共 {len(new_rows)} 行待追加，加 --append 生效")


if __name__ == "__main__":
    main()