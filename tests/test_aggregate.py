# -*- coding: utf-8 -*-
"""聚合层单测：加权均值、三口径、sf 单基准标记、缺维让位。"""
import pandas as pd

from radar.aggregate import model_scores


def _row(model, dim, val, fam, fam_n, *, vend=False, inf=False, scored=True):
    return {"模型": model, "维度": dim, "榜单分": val, "备注": f"{'推理补全' if inf else '测试'}·X 原始{val}(0-1) @2026-01-01",
            "_src": "推理补全" if inf else ("厂商官方" if vend else "测试"),
            "_vend": vend, "_inf": inf, "_fam": fam, "_famN": fam_n, "_scored": scored}


def _models(rows):
    return {m["name"]: m for m in model_scores(pd.DataFrame(rows))}


def test_weighted_mean_mixed_confidence():
    """n≥4 全权 ×1.0、n=3 ×0.67、n=2 ×0.33 的加权均值。"""
    rows = [
        _row("M", "代码", 80.0, "Big", 6),
        _row("M", "代码", 60.0, "Mid", 3),
        _row("M", "代码", 40.0, "Duo", 2),
    ]
    got = _models(rows)["M"]["scores"]["代码"]
    expected = (80 * 1.0 + 60 * 0.67 + 40 * 0.33) / (1.0 + 0.67 + 0.33)
    assert got == round(expected, 1)  # 67.0


def test_vendor_scope_excluded_in_tp():
    rows = [
        _row("M", "代码", 80.0, "Third", 4),
        _row("M", "代码", 20.0, "VendorOnly", 4, vend=True),
    ]
    m = _models(rows)["M"]
    assert m["scores"]["代码"] == 50.0            # 全量 = (80+20)/2
    assert m["scoresTp"]["代码"] == 80.0          # 仅第三方 = 第三方那条
    rows2 = [_row("M", "代码", 30.0, "VendorOnly", 4, vend=True)]
    m2 = _models(rows2)["M"]                      # 只剩厂商自报 → tp 无此维
    assert "代码" not in m2.get("scoresTp", {})


def test_inferred_fills_only_unscored_cells():
    rows = [
        _row("M", "代码", 70.0, "F", 4),
        _row("M", "长文本", 42.0, "", "", inf=True, scored=False),
    ]
    m = _models(rows)["M"]
    assert m["scores"]["代码"] == 70.0
    assert "长文本" not in m["scores"]            # 推理值不进默认口径
    assert m["scoresInf"]["代码"] == 70.0         # 有实测：inf 口径用实测
    assert m["scoresInf"]["长文本"] == 42.0       # 无实测：inf 口径落推理值


def test_sf_single_family_flag():
    rows = [
        _row("M", "代码", 70.0, "Only", 4),
        _row("M", "图片与制图", 50.0, "A", 5),
        _row("M", "图片与制图", 60.0, "B", 5),
    ]
    m = _models(rows)["M"]
    assert m["sf"] == {"代码": "Only"}            # 单族 → 标记；双族维不标


def test_n1_rows_not_scored():
    rows = [_row("M", "代码", 55.5, "Solo", 1, scored=False)]
    m = _models(rows)["M"]
    assert m["scores"] == {}                      # n=1 不进维度分（面值仅留账本）
