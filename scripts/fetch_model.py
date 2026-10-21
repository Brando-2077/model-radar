# -*- coding: utf-8 -*-
"""抓取 AA 单模型页，把 RSC payload 里的 JSON 片段拼出来另存，供人工/脚本解析。
用法：python fetch_model.py hy3 doubao-seed-2-1-pro
若还需 AA 主榜页（diff_aa.py / scan_aa.py 用的 aa_page.html），另抓
https://artificialanalysis.ai/models 存为 aa_page.html（同一 UA）。
"""
import json, re, sys, urllib.request, os

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

for slug in sys.argv[1:]:
    url = f"https://artificialanalysis.ai/models/{slug}"
    out = f"model_{slug}.html"
    if os.path.exists(out):
        print(f"[跳过] {out} 已存在")
        continue
    req = urllib.request.Request(url, headers=UA)
    try:
        html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        print(f"[跳过] {slug} -> HTTP {e.code}")
        continue
    open(out, "w", encoding="utf-8").write(html)
    print(f"[完成] {slug} -> {out} ({len(html)} bytes)")