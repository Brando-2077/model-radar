# -*- coding: utf-8 -*-
"""小红书小工具分支构建：从 model-radar.html（GitHub 主版）生成符合容器规范的离线 zip。

产物（dist-xhs/）：
  index.html   入口（样式内联 <style>——容器允许；脚本必须外置）
  data.js      window.RADAR_LEDGER = {...}（原数据区）
  app.js       应用 IIFE（原内联脚本）+ flex-gap 探针

小红书版差异（相对 GitHub 主版）：
  - 内联 <script> 拆分为外链 .js（容器 CSP 禁止内联脚本）
  - 移除 GitHub star / 外链元素（容器禁 target="_blank" 与站外跳转）
  - CSS Chrome 61 兼容层：inset→物理属性、min()→等效写法、grid-gap 旧别名、
    flex gap 基线 margin（JS 探针检测支持时启用 gap）、env() 安全区旧值在前
  - viewport 增 viewport-fit=cover；lang=zh-CN

用法：python scripts/build_xhs.py
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "model-radar.html"
DIST = ROOT / "dist-xhs"
ZIP_PATH = ROOT / "model-radar-xhs.zip"

# ── flex gap 的 Chrome 61 基线（html:not(.fg) 下用相邻 margin 兜底）──────────
# (选择器, 水平间距 px)；竖排/换行的 row-gap 不兜底（影响小，保持简洁）
FLEX_GAP_FALLBACKS = [
    (".topbar > * + *", 18), (".topbar .tools > * + *", 18),
    (".topbar .ctl > * + *", 9), (".deck > * + *", 20),
    (".deck .ctl-t > * + *", 6), (".ctl-t > * + *", 6), (".ctl > * + *", 9),
    (".seg > * + *", 20), (".kicker > * + *", 14), (".vd > * + *", 9),
    (".legend > * + *", 16), (".cap-opt > * + *", 7), (".wbar > * + *", 2),
    (".sel > * + *", 8), (".chip > * + *", 8), (".sp-h > * + *", 10),
    (".mname > * + *", 8), (".rname > * + *", 8), (".micro > * + *", 2),
    (".rank-tools > * + *", 14), (".cval > * + *", 10), (".howto .ht > * + *", 9),
    (".ev .r1 > * + *", 10), (".ev .meta > * + *", 8), (".dist > * + *", 9),
    (".dh > * + *", 12), (".prow > * + *", 9), (".mx-tools > * + *", 14),
    (".chk > * + *", 6),
]


def flex_gap_css() -> str:
    rules = "\n".join(
        f"  html:not(.fg) {sel}{{margin-left:{px}px}}" for sel, px in FLEX_GAP_FALLBACKS)
    return ("\n  /* ── 小红书容器适配 · Chrome 61 基线层（build_xhs.py 注入）────────────\n"
            "     flex gap 在 WebView 61 不可用：基线用相邻 margin，JS 探针检测到支持时\n"
            "     给 <html> 加 .fg 启用原生 gap 并由下一条规则清除 margin */\n"
            + rules
            + "\n  html.fg " + ",\n  html.fg ".join(s.split(" ", 1)[1] if False else sel for sel, _ in FLEX_GAP_FALLBACKS)
            + "{margin-left:0}\n")


def transform_shell(shell: str, n_models: int, n_dims: int) -> str:
    # 语言与 viewport（容器规范）
    shell = shell.replace('<html lang="zh">', '<html lang="zh-CN">', 1)
    shell = shell.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">', 1)

    # 移除 GitHub 外链元素（容器禁 target=_blank / 站外跳转；小红书版不带 GitHub 引导）
    shell = re.sub(r'\n *<a class="gh-top"[^>]*>.*?</a>', "", shell, flags=re.S)
    shell = re.sub(r'\n *<div class="star-bar">.*?</div>\n(?= *<details class="afford")', "\n", shell, flags=re.S)
    shell = re.sub(r'\n *<div class="star-cta">.*?\n *</div>(?=\n)', "\n", shell, flags=re.S)

    # 页脚 GitHub 链接 → 纯文本
    shell = shell.replace(
        '<p>源码与数据：<a href="https://github.com/Brando-2077/model-radar" target="_blank" rel="noopener">github.com/Brando-2077/model-radar</a>',
        '<p>源码与数据：github.com/Brando-2077/model-radar（GitHub 开源版）', 1)

    # CSS Chrome 61 兼容
    shell = shell.replace("inset:4px", "top:4px;right:4px;bottom:4px;left:4px")
    shell = shell.replace("inset:0", "top:0;right:0;bottom:0;left:0")
    shell = shell.replace("width:min(470px,96vw)", "width:96vw;max-width:470px")
    # grid gap 旧别名（Chrome 61 只认 grid-*；新内核两者等价，旧值在前）
    for old, new in [
        (".main{display:grid;grid-template-columns:minmax(430px,1.02fr) minmax(420px,.98fr);gap:18px",
         ".main{display:grid;grid-template-columns:minmax(430px,1.02fr) minmax(420px,.98fr);grid-gap:18px;gap:18px"),
        (".vd-lines{flex:1 0 100%;display:grid;gap:4px",
         ".vd-lines{flex:1 0 100%;display:grid;grid-gap:4px;gap:4px"),
        (".dd .rw{display:grid;grid-template-columns:92px 1fr;gap:10px",
         ".dd .rw{display:grid;grid-template-columns:92px 1fr;grid-gap:10px;gap:10px"),
        (".bars .bh,.bars .brow{display:grid;grid-template-columns:104px 1fr 62px;column-gap:10px}",
         ".bars .bh,.bars .brow{display:grid;grid-template-columns:104px 1fr 62px;grid-column-gap:10px;column-gap:10px}"),
        ("row-gap:5px;column-gap:8px;", "grid-row-gap:5px;row-gap:5px;grid-column-gap:8px;column-gap:8px;"),
    ]:
        assert shell.count(old) == 1, f"grid gap 锚点未命中: {old[:40]}"
        shell = shell.replace(old, new)
    # 顶栏 / 页脚安全区（env() 为增强，Chrome 61 走前值）
    shell = shell.replace(
        "min-height:52px;padding:5px 24px;",
        "min-height:52px;padding:5px 24px;padding-top:calc(5px + env(safe-area-inset-top, 0px));")
    shell = shell.replace(
        ".wrap{max-width:1560px;margin:0 auto;padding:26px 24px 64px;",
        ".wrap{max-width:1560px;margin:0 auto;padding:26px 24px 64px;padding-bottom:calc(64px + env(safe-area-inset-bottom, 0px));")

    # flex gap 基线（追加到 </style> 前）
    shell = shell.replace("</style>", flex_gap_css() + "</style>", 1)
    return shell


def main() -> None:
    src = SRC.read_text(encoding="utf-8").replace("\r\n", "\n")  # 统一 LF，正则按 \n 工作

    # 拆出数据区 JSON 与应用 JS
    m = re.search(r"<!-- ==== 数据区 BEGIN[^\n]*-->\n<script>window\.RADAR_LEDGER = (\{.*?\});</script>\n<!-- ==== 数据区 END ==== -->", src, re.S)
    if not m:
        raise SystemExit("主版里找不到数据区（先跑 python build.py）")
    ledger_json = m.group(1)
    ledger = json.loads(ledger_json)  # JSON 里的 <\/ 是合法转义，无需还原

    m2 = re.search(r"\n<script>\n(\(function \(\) \{.*?\}\)\(\);\n)</script>\n</body>", src, re.S)
    if not m2:
        raise SystemExit("主版里找不到应用脚本块")
    app_js = m2.group(1)
    assert "<script" not in app_js, "应用 JS 里不应残留 script 标签"

    # 应用 JS 的小红书适配：容器禁外链（target=_blank / 站外跳转）
    app_js = app_js.replace(
        """'<p>源码与数据：<a href="https://github.com/Brando-2077/model-radar" target="_blank" rel="noopener">github.com/Brando-2077/model-radar</a>'""",
        """'<p>源码与数据：github.com/Brando-2077/model-radar（GitHub 开源版）'""", 1)
    app_js = app_js.replace(
        "a.href = e.url; a.target = '_blank'; a.rel = 'noopener';",
        "/* 小红书容器禁外链：URL 仅作溯源展示 */ a.setAttribute('data-src-url', e.url);", 1)
    assert 'target="_blank"' not in app_js and "a.target" not in app_js, "app.js 仍有外链残留"
    assert "<script" not in app_js, "app.js 仍有 script 标签残留"

    # 壳 = 数据区之前 + 外链脚本注入 + </body> + 尾部（</html>）
    shell = (src[:m.start()]
             + '<script src="./data.js"></script>\n<script src="./app.js"></script>\n</body>\n'
             + src[m2.end():])
    assert shell.count('<script src=') == 2 and '</body>' in shell

    # 移除 GitHub star / 外链元素（标记定位的块删除，不依赖多行正则）
    def cut_block(s: str, start_marker: str, end_marker: str) -> str:
        i = s.find(start_marker)
        assert i >= 0, f"未找到起始标记: {start_marker}"
        j = s.find(end_marker, i + len(start_marker))
        assert j > i, f"未找到结束标记: {end_marker}"
        return s[:i] + s[j:]

    shell = cut_block(shell, '<a class="gh-top"', "</a>")            # 顶栏 star 按钮（内无嵌套 a）
    shell = cut_block(shell, '<div class="star-bar">', '<details class="afford"')
    shell = cut_block(shell, '<div class="star-cta">', '<details class="foot">')
    assert 'target="_blank"' not in shell, "壳仍有外链残留"

    shell = transform_shell(shell, len(ledger["models"]), len(ledger["dimensions"]))

    # flex-gap 探针（支持时 <html> 加 .fg；探测方法来自 skill css-compatibility.md）
    probe = ("/* 小红书容器适配：flex gap 行为探针（Chrome 61 语法检测不能证明 flex gap 生效） */\n"
             "(function(){try{var d=document.createElement('div');"
             "d.style.display='flex';d.style.flexDirection='column';d.style.rowGap='1px';"
             "d.style.position='absolute';d.style.visibility='hidden';"
             "d.appendChild(document.createElement('div'));d.appendChild(document.createElement('div'));"
             "document.body.appendChild(d);"
             "if(d.scrollHeight===1){document.documentElement.classList.add('fg');}"
             "document.body.removeChild(d);}catch(e){}})();\n")
    app_out = probe + app_js

    # 产物
    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_bytes(shell.encode("utf-8"))
    (DIST / "data.js").write_bytes(("window.RADAR_LEDGER = " + ledger_json + ";\n").encode("utf-8"))
    (DIST / "app.js").write_bytes(app_out.encode("utf-8"))

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as z:
        for f in ("index.html", "data.js", "app.js"):
            z.write(DIST / f, f)

    total = sum((DIST / f).stat().st_size for f in ("index.html", "data.js", "app.js"))
    print(f"已生成 {DIST.name}/：index.html / data.js / app.js，源码合计 {total:,} 字节；"
          f"zip → {ZIP_PATH.name}（{ZIP_PATH.stat().st_size:,} 字节）")
    print("模型", len(ledger["models"]), "· 证据", len(ledger["evidence"]),
          "· 版本", ledger["meta"]["version"])


if __name__ == "__main__":
    sys.exit(main())
