# -*- coding: utf-8 -*-
"""小红书小工具分支构建：xhs_template/ 模板 + 主版账本 → 竖屏手机版离线 zip。

产物（dist-xhs/）：
  index.html  竖屏手机版壳（xhs_template/index.html，样式内联）
  data.js     window.RADAR_LEDGER = {...}（与主版同一份账本）
  app.js      竖屏版应用（xhs_template/app.js）

与 GitHub 主版（model-radar.html）的关系：一鱼两吃、两处分发——
主版是桌面自适应的单文件；本分支是纯手机竖屏的原生 App 式 UI（底部三 Tab：
榜单 / 对比 / 关于），数据契约与计分口径完全同源。dist 与 zip 不入仓库。

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
TPL = ROOT / "xhs_template"
DIST = ROOT / "dist-xhs"
ZIP_PATH = ROOT / "model-radar-xhs.zip"


def main() -> None:
    src = SRC.read_text(encoding="utf-8").replace("\r\n", "\n")

    m = re.search(
        r"<!-- ==== 数据区 BEGIN[^\n]*-->\n<script>window\.RADAR_LEDGER = (\{.*?\});</script>\n<!-- ==== 数据区 END ==== -->",
        src, re.S)
    if not m:
        raise SystemExit("主版里找不到数据区（先跑 python build.py）")
    ledger_json = m.group(1)
    ledger = json.loads(ledger_json)  # <\/ 为合法 JSON 转义，可原生解析

    html = (TPL / "index.html").read_text(encoding="utf-8")
    css = (TPL / "app.css").read_text(encoding="utf-8")
    app = (TPL / "app.js").read_text(encoding="utf-8")

    html = html.replace("{{APP_CSS}}", css)
    assert "{{" not in html, "模板占位符未替换干净"

    DIST.mkdir(exist_ok=True)
    (DIST / "index.html").write_bytes(html.encode("utf-8"))
    (DIST / "data.js").write_bytes(("window.RADAR_LEDGER = " + ledger_json + ";\n").encode("utf-8"))
    (DIST / "app.js").write_bytes(app.encode("utf-8"))

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
