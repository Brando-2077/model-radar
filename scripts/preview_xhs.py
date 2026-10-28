# -*- coding: utf-8 -*-
"""小红书版本地预览服务器（带 Cache-Control: no-store）。

裸 `python -m http.server` 不发缓存头，Chromium 会缓存 app.js，
导致改完模板刷新仍跑旧脚本（"改了没生效"）。本脚本强制 no-store。

用法（任意目录均可）：python scripts/preview_xhs.py
然后浏览器打开 http://127.0.0.1:8642/
预览前需先跑 python scripts/build_xhs.py 生成 dist-xhs/。
"""
from __future__ import annotations

import http.server
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist-xhs"
PORT = 8642


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main() -> None:
    if not DIST.exists():
        raise SystemExit("dist-xhs/ 不存在：先跑 python scripts/build_xhs.py")
    print(f"预览：http://127.0.0.1:{PORT}/  （no-store；Ctrl+C 停止）")
    http.server.test(HandlerClass=partial(NoStoreHandler, directory=str(DIST)),
                     port=PORT, bind="127.0.0.1")


if __name__ == "__main__":
    main()
