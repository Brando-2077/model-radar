# -*- coding: utf-8 -*-
"""从已存盘的 AA 单模型页里提取完整模型记录 JSON（含全部分项基准与价格）。
用法：python extract_aa.py model_hy3.html [更多 html...]

⚠ 2026-10-17：页面存档已删除以精简项目（省 53MB）；用前先 `python fetch_model.py <slug>` 重抓到 scripts/ 下。

输出每个模型的关键字段：slug/name/releaseDate/isOpenWeights/contextWindowTokens/
各分项基准（gpqa/hle/critpt/scicode/terminalBench21/terminalBench40/lcr/ifbench/
mmmuPro/automationBenchPartialScore/omniscience/omniscienceHallucinationRate）与价格。
"""
import json
import re
import sys

BENCH_KEYS = [
    "gpqa", "hle", "critpt", "scicode", "terminalBench21", "terminalBench40",
    "terminalBenchScience", "lcr", "ifbench", "mmmuPro", "automationBenchPartialScore",
    "itBenchSre", "tau2", "tauBanking", "apexAgents", "enterpriseOpsGym",
]
PRICE_KEYS = ["price1mInputTokens", "price1mOutputTokens", "price1mBlended0To3To1",
              "cacheHitPrice"]
META_KEYS = ["slug", "name", "releaseDate", "isOpenWeights", "contextWindowTokens",
             "parameters", "inferenceParametersActiveBillions", "licenseName",
             "omniscience", "omniscienceAccuracy", "omniscienceHallucinationRate",
             "intelligenceIndex"]


def bracket_pairs(blob):
    """O(N) 单遍扫描：记录每个 '{' 与 '[' 的闭合位置（返回 (对象对, 数组对)）。
    2026-11-04 重写：旧实现按匹配起点逐字符向前找闭合，AA 页面变大后
    尾部块不闭合就是 O(N×M) 天文数字（33 页提取曾跑 10 分钟不出）。
    字符串内的括号不计（in_str/esc 语义与旧实现一致）。"""
    obj, arr = {}, {}
    ostack, astack = [], []
    in_str = esc = False
    for i, c in enumerate(blob):
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
                ostack.append(i)
            elif c == "}":
                if ostack:
                    obj[ostack.pop()] = i
            elif c == "[":
                astack.append(i)
            elif c == "]":
                if astack:
                    arr[astack.pop()] = i
    return obj, arr


def load_payload(path):
    html = open(path, encoding="utf-8").read()
    _, arr_pairs = bracket_pairs(html)
    texts = []
    for m in re.finditer(r'self\.__next_f\.push\(', html):
        ob = html.find("[", m.end() - 1)
        close = arr_pairs.get(ob)
        if close is None:
            continue
        try:
            arr = json.loads(html[ob:close + 1])
        except Exception:
            continue
        for el in arr[1:]:
            if isinstance(el, str):
                texts.append(el)
    return "\n".join(texts)


def find_all_records(blob):
    """找出 payload 里全部「含 gpqa + 价格字段」的模型记录，按 slug 归并。
    AA 单模型页会内嵌一串对比模型的完整记录，谁排在 payload 最前就看谁——
    所以必须按页面本尊的 slug 归属，不能取第一条（2026-10-31 修复的归属隐患）。
    2026-11-04 改 O(N) 括号配对查表：每个 gpqa 命中 → bisect 找所属 '{' → 直接查闭合位置。"""
    import bisect
    obj_pairs, _ = bracket_pairs(blob)
    braces = sorted(obj_pairs)
    recs = {}
    for m in re.finditer(r'"gpqa"', blob):
        i = m.start()
        k = bisect.bisect_left(braces, i)
        for idx in range(k - 1, -1, -1):
            start = braces[idx]
            close = obj_pairs.get(start)
            if close is None:
                continue
            chunk = blob[start:close + 1]
            if '"price1mInputTokens"' in chunk:
                try:
                    rec = json.loads(chunk)
                    sl = rec.get("slug")
                    if sl and sl not in recs:
                        recs[sl] = rec
                    break  # 该 gpqa 的所属对象已处理，无需再向更早起点找
                except Exception:
                    pass  # 该起点不是合法 JSON，继续向更早的起点找
        if len(recs) >= 60:  # 安全阀：页内对比集不会无限大
            break
    return recs


for path in sys.argv[1:]:
    blob = load_payload(path)
    print(f"===== {path}")
    recs = find_all_records(blob)
    m = re.search(r"model_([a-z0-9.-]+)\.html$", path)
    expected = m.group(1) if m else None
    rec = recs.get(expected)
    if rec is None:
        print(f"  ⚠ payload 中未找到 slug={expected} 的本尊记录（页面可能是轻量 SSR 变体，"
              f"基准数据未内联）。页内记录 slugs: {list(recs)[:10] or '（无）'}")
        rec = next(iter(recs.values())) if recs else None
        if rec:
            print(f"  ⚠ 以下输出属于 slug={rec.get('slug')}（非本尊，仅参考勿入账！）")
    if not rec:
        print("  未找到任何模型记录")
        continue
    if "_parse_error" in rec:
        print(f"  JSON 解析失败: {rec['_parse_error']}")
        continue
    for k in META_KEYS:
        if k in rec and rec[k] is not None:
            print(f"  {k} = {rec[k]}")
    print("  --- 分项基准 ---")
    for k in BENCH_KEYS:
        v = rec.get(k)
        if v is not None:
            print(f"  {k} = {v}")
    print("  --- 价格 ---")
    for k in PRICE_KEYS:
        v = rec.get(k)
        if v is not None:
            print(f"  {k} = {v}")
    print()