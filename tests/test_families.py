# -*- coding: utf-8 -*-
"""计分核心单测：量纲归一化、权重公式、族内位次分、去重优先级。"""
import pandas as pd
import pytest

from radar.config import fam_weight
from radar.families import family_scores, tb_dedup
from radar.normalize import normalize


# ── normalize ───────────────────────────────────────────────────────

def test_normalize_scales():
    assert normalize(0.5, "0-1", [0, 1]) == 50
    assert normalize(87.5, "百分制", [0, 100]) == 87.5
    assert normalize(8.0, "10分制", [0, 10]) == 80
    assert normalize(4.0, "5分制", [0, 5]) == 80


def test_normalize_elo_pool_minmax():
    # 池内 min→60、max→100（只影响面值不改名次）
    assert normalize(1000, "Elo", [1000, 2000]) == 60
    assert normalize(2000, "Elo", [1000, 2000]) == 100
    assert normalize(1500, "Elo", [1000, 2000]) == 80
    assert normalize(50, "指数", [50, 50]) == 80  # 平池 → 中值


def test_normalize_unknown_scale():
    with pytest.raises(ValueError):
        normalize(1, "秒", [0, 1])


# ── fam_weight（v0.27 公式 w(n)=min(1,(n−1)/3)）────────────────────

@pytest.mark.parametrize("n,w", [(1, 0.0), (2, 0.33), (3, 0.67), (4, 1.0), (7, 1.0)])
def test_fam_weight_formula(n, w):
    assert fam_weight(n) == w


def test_fam_weight_monotonic():
    assert fam_weight(2) < fam_weight(3) < fam_weight(4)


# ── 族内位次分 ──────────────────────────────────────────────────────

def _rows(scores_by_model, fam="F"):
    return [{"模型": m, "维度": "推理与知识", "榜单分": v, "备注": f"测试·X 原始{v}(0-1) @2026-01-01",
             "_fam": fam, "_vend": False, "_date": "2026-01-01"}
            for m, v in scores_by_model.items()]


def test_percentile_ascending_rank():
    """升序名次：低分记第 1 名 → 最强者约 97、垫底约 3（v0.20 修订后的方向）。"""
    out, _ = family_scores(_rows({"a": 10, "b": 50, "c": 90, "d": 70}))
    got = {r["模型"]: r["榜单分"] for r in out}
    assert got["c"] == pytest.approx(87.5)   # (4−0.5)/4×100
    assert got["b"] == pytest.approx(37.5)
    assert got["d"] == pytest.approx(62.5)
    assert got["a"] == pytest.approx(12.5)


def test_percentile_tie_averages_rank():
    out, _ = family_scores(_rows({"a": 50, "b": 50, "c": 90, "d": 10}))
    got = {r["模型"]: r["榜单分"] for r in out}
    # a、b 并列升序第 2/3 名，名次取均值 2.5 → (2.5−0.5)/4×100 = 50
    assert got["a"] == got["b"] == pytest.approx(50.0)
    assert got["c"] == pytest.approx(87.5) and got["d"] == pytest.approx(12.5)


def test_single_model_family_not_scored():
    """族内 n=1：不计分，面值保留（位次分恒 50 无信息量）。"""
    out, stats = family_scores(_rows({"solo": 88.8}))
    assert out[0]["榜单分"] == 88.8
    assert out[0]["族内n"] == 1
    assert stats["scored_rows"] == 0 and stats["off_rows"] == 1


def test_dedup_prefers_third_party_then_newer_date():
    rows = _rows({"a": 10, "b": 50, "c": 90, "d": 70})
    # d 有两条同族证据：厂商自报（日期更新） vs 第三方（日期更旧）→ 第三方胜
    rows.append({"模型": "d", "维度": "推理与知识", "榜单分": 99, "备注": "厂商官方·X 原始99(0-1) @2026-09-09",
                 "_fam": "F", "_vend": True, "_date": "2026-09-09"})
    # b 的两条都是第三方 → 日期新者胜
    rows.append({"模型": "b", "维度": "推理与知识", "榜单分": 55, "备注": "测试·X2 原始55(0-1) @2026-08-08",
                 "_fam": "F", "_vend": False, "_date": "2026-08-08"})
    out, stats = family_scores(rows)
    assert stats["dropped"] == 2 and len(out) == 4
    by_model = {r["模型"]: r for r in out}
    assert by_model["d"]["备注"].startswith("测试·")          # 第三方优先
    assert "原始55" in by_model["b"]["备注"]                  # 同级比日期，新者胜


def test_tb_dedup_aa_only():
    df = pd.DataFrame([
        {"模型": "M", "来源": "Artificial-Analysis", "类别": "Terminal-Bench 4.0", "原始分": 0.3},
        {"模型": "M", "来源": "Artificial-Analysis", "类别": "Terminal-Bench 2.1", "原始分": 0.9},
        {"模型": "M", "来源": "Z.ai官方", "类别": "Terminal Bench 2.1", "原始分": 0.9},
    ])
    out = tb_dedup(df)
    cats = list(out["类别"])
    assert "Terminal-Bench 2.1" not in cats          # AA 的 TB2.1 被丢弃
    assert "Terminal Bench 2.1" in cats              # 厂商渠道不受影响
