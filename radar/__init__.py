# -*- coding: utf-8 -*-
"""模型雷达图 —— 构建管线包。

两阶段（python build.py 默认全跑）：
    ① scores  raw_*.csv + mapping.csv + canon.csv → data/scores.csv（证据账本）
    ② html    scores.csv + 展示元数据表 → model-radar.html 数据区（单文件交付物）

分层：config（口径常量单点）→ tables（CSV 读取）→ normalize（量纲归一）
→ families（族去重与位次分）→ aggregate（维度聚合三口径）→ ledger（契约组装）
→ emit（落盘）。每层只依赖下一层的显式函数，无模块级读表副作用。
"""
from radar.config import (FAMILY_MIN_N, TB_FALLBACK, TB_PREFER, VERSION,
                          VENDOR_SRC, fam_weight)

__all__ = ["FAMILY_MIN_N", "TB_FALLBACK", "TB_PREFER", "VERSION",
           "VENDOR_SRC", "fam_weight"]
