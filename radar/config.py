# -*- coding: utf-8 -*-
"""项目口径常量 —— 全项目唯一单点（口径即数据，代码与文档不另抄一份）。

v0.27 重写时从 build_scores.py / build_html.py 合并归一。凡是要改口径的地方，
只改这个文件（或它指向的 data/ 表），下游全部自动跟随。
"""
from __future__ import annotations

import re
from pathlib import Path

# ── 路径 ────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SHELL = ROOT / "model-radar.html"
SCORES_CSV = DATA / "scores.csv"
ROSTER_CSV = DATA / "models.csv"
INFERRED_CSV = DATA / "raw_inferred.csv"

# ── 版本 ────────────────────────────────────────────────────────────
VERSION = "v0.27.2"

# ── 基准族计分（v0.26 分级入分；v0.27 公式化）───────────────────────
# 入分门槛：族内至少 2 个模型才有排名（n=1 单模型无对手，位次分恒为 50、零信息量）。
FAMILY_MIN_N = 2


def fam_weight(n: int) -> float:
    """族内模型数 → 该族证据在维度均值里的权重。

    v0.27 公式：w(n) = min(1, (n−1)/3)，保留 2 位小数——
    「话语权 ∝ 可比对手数，3 个对手（族内 4 人）为满权」。
    w(2)=0.33、w(3)=0.67、w(n≥4)=1.0、w(1)=0（不计分）。
    聚合与展示用同一个（舍入后的）值，保证抽屉里的权重与页面计算可对账。
    """
    if n < FAMILY_MIN_N:
        return 0.0
    return round(min(1.0, (n - 1) / 3), 2)


# ── 厂商自报渠道（「仅第三方榜单」口径整体排除）────────────────────
# 判定按来源渠道、不按「是不是自家模型」：NVIDIA 官方页给非自家模型报的分也排除。
VENDOR_SRC = frozenset({
    "Z.ai官方", "dots官方", "腾讯官方", "NVIDIA官方", "DeepSeek官方",
    "酥悠沫-官方", "Kimi官方",
})
# 渠道 → 官方地址（只服务展示：页脚/抽屉写明「排除了什么」，避免口径变黑箱）
VENDOR_SRC_PAGES = {
    "Z.ai官方": "z.ai/blog", "dots官方": "github.com/dots-studio",
    "腾讯官方": "hunyuan.tencent.com / 发布页 appendix", "NVIDIA官方": "build.nvidia.com",
    "DeepSeek官方": "huggingface.co/deepseek-ai / api-docs.deepseek.com",
    "酥悠沫-官方": "酥悠沫转录的厂商自报表（news.qq.com / stepfun.com / text-arena.com 等）",
    "Kimi官方": "kimi.ai/blog（技术博客，只收自家型号）",
}

# ── 开源判定兜底 ────────────────────────────────────────────────────
# models.csv 的「开源」列已逐模型订正；这套公司级判定只对名册漏标的新模型兜底。
# 判断偏保守：没把握的公司不进集合（百度/字节因旗舰权重不公开而未列入）。
OPEN_COMPANIES = frozenset({
    "智谱", "Z.AI", "DeepSeek", "阿里", "月之暗面", "MiniMax", "NVIDIA",
    "腾讯", "小红书", "阶跃星辰", "Google",
})
COMPANY_FALLBACK: dict[str, str] = {}

# ── Terminal-Bench 版本去重（只作用于 AA 渠道）─────────────────────
# AA 同时报 2.1 与 4.0（难度差很大），同一模型只取一版：有 4.0 用 4.0，缺则回退 2.1。
TB_PREFER = "Terminal-Bench 4.0"
TB_FALLBACK = "Terminal-Bench 2.1"

# ── 推理补全通道 ────────────────────────────────────────────────────
INF_SRC = "推理补全"
INF_PAGES = "scripts/infer_gaps.py · data/raw_inferred.csv（每条都带方法 / 依据 / 留一MAE）"

# ── HTML 数据区标记 ─────────────────────────────────────────────────
# 数据区夹在两个标记之间，由 emit.write_shell() 整体覆盖；标记之外是手改的展示壳。
REGION_BEGIN = "<!-- ==== 数据区 BEGIN"
REGION_END = "<!-- ==== 数据区 END ==== -->"
REGION_RE = re.compile(
    r"(<!-- ==== 数据区 BEGIN[^\n]*-->\n)(.*?)(<!-- ==== 数据区 END ==== -->)", re.S)
