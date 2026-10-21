# -*- coding: utf-8 -*-
"""扫描 AA models 页面 RSC payload，找指定 slug 的完整 JSON 记录。

⚠ 2026-10-17：本地 AA 页面存档（aa_page.html + model_*.html，共约 53MB）已删除以精简项目。
   用前先重抓（存到 scripts/ 下即可，用法不变）：
     cd scripts
     curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ..." -o aa_page.html https://artificialanalysis.ai/models
"""
import json, re, sys

html = open('aa_page.html', encoding='utf-8').read()

# 1) 拼接所有 push payload 里的字符串片段
parts = []
for m in re.finditer(r'self\.__next_f\.push\(\[(.*?)\]\);', html, re.S):
    body = m.group(1)
    for sm in re.finditer(r'"((?:[^"\\]|\\.)*)"', body):
        parts.append(sm.group(1))

text = "\n".join(parts)

slugs = sys.argv[1:] if len(sys.argv) > 1 else ['hy3', 'doubao-seed-2-1-pro', 'ernie-5-1']
for slug in slugs:
    i = text.find(slug)
    print(f"=== slug={slug!r} found_at={i}")
    if i < 0:
        continue
    print(text[max(0, i - 200):i + 1800])
    print("----")