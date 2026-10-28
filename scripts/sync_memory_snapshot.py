# -*- coding: utf-8 -*-
"""同步 Agent 持久记忆到项目内快照（notes/记忆快照_<日期>/）。

背景：ZCode 的 Agent 记忆存放在用户目录（~/.zcode/cli/memories/...），
**不在项目文件夹里**，换机器/换 Agent 就带不走。本脚本把记忆复制进项目，
让"记忆"跟着文件夹走；快照会随时间漂移，所以每次重要变更后重跑一次。

用法：
  python scripts/sync_memory_snapshot.py                 # 自动定位记忆目录
  python scripts/sync_memory_snapshot.py --src <记忆目录>  # 显式指定
  python scripts/sync_memory_snapshot.py --date 20261028  # 指定快照目录名
"""
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / "notes"
SRC_TAG = NOTES / ".memory-src"          # 记住本项目对应的记忆目录（notes/ 不入库）


def _candidates() -> list[Path]:
    base = Path.home() / ".zcode" / "cli" / "memories" / "projects"
    if not base.is_dir():
        return []
    return [d / "memory" for d in sorted(base.iterdir())
            if (d / "memory" / "MEMORY.md").is_file()]


def locate_memory() -> Path | None:
    """优先读取 notes/.memory-src，其次在唯一候选时自动采用。"""
    if SRC_TAG.is_file():
        p = Path(SRC_TAG.read_text(encoding="utf-8").strip())
        if (p / "MEMORY.md").is_file():
            return p
        print(f"提示：notes/.memory-src 记录的目录已失效（{p}），将重新定位", file=sys.stderr)
    cands = _candidates()
    if len(cands) == 1:
        return cands[0]
    if len(cands) > 1:
        print("发现多个记忆目录，请用 --src 指定其一（选定后会记进 notes/.memory-src）：",
              file=sys.stderr)
        for c in cands:
            print(f"  {c}", file=sys.stderr)
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="Agent 记忆目录（含 MEMORY.md）")
    ap.add_argument("--date", help="快照后缀，默认今天 YYYYMMDD")
    args = ap.parse_args()

    src = Path(args.src).expanduser() if args.src else locate_memory()
    if not src or not (src / "MEMORY.md").is_file():
        print("找不到记忆目录：请用 --src 指定（该目录应含 MEMORY.md）", file=sys.stderr)
        return 1
    if (args.src or not SRC_TAG.is_file()):
        SRC_TAG.parent.mkdir(parents=True, exist_ok=True)
        SRC_TAG.write_text(str(src), encoding="utf-8")

    stamp = args.date or date.today().strftime("%Y%m%d")
    dst = NOTES / f"记忆快照_{stamp}"
    dst.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in src.glob("*.md"))
    changed, added = [], []
    for f in files:
        target = dst / f.name
        if target.exists() and filecmp.cmp(f, target, shallow=False):
            continue
        (changed if target.exists() else added).append(f.name)
        shutil.copy2(f, target)

    print(f"记忆源：{src}")
    print(f"快照：  {dst.relative_to(ROOT)}（{len(files)} 个文件）")
    if added:
        print("  新增：" + "、".join(added))
    if changed:
        print("  更新：" + "、".join(changed))
    if not added and not changed:
        print("  无变化（快照已是最新）")
    print("提醒：快照会随时间漂移；项目事实请同步写进 AGENTS.md / docs/HANDOVER.md，"
          "memory 只放 Agent 的行为偏好。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
