# -*- coding: utf-8 -*-
"""账本契约测试：真 data/ 全管线跑通 + 结构不变量 + 幂等。

锁定的是「页面唯一数据契约」——改 schema 或键序前先来这里看会不会破。
"""
import json

import pytest

from radar.config import VERSION
from radar.ledger import build_ledger
from radar.tables import load_scores


@pytest.fixture(scope="module")
def ledger():
    return build_ledger()


def test_top_level_key_order(ledger):
    assert list(ledger) == ["meta", "dimensions", "scenarios", "models", "evidence"]


def test_meta_key_order(ledger):
    assert list(ledger["meta"])[:9] == ["title", "version", "built", "sources",
                                        "disclaimer", "noteMissing", "scopeSources",
                                        "scopeNote", "infNote"]
    assert ledger["meta"]["version"] == VERSION
    assert list(ledger["meta"])[-1] == "models"   # models 计数串最后追加


def test_counts_match_scores_csv(ledger):
    scores = load_scores()
    assert len(ledger["evidence"]) == len(scores)
    assert len(ledger["models"]) == scores["模型"].nunique() + 1   # + 待定 Space-Bunny


def test_all_scores_in_range(ledger):
    for m in ledger["models"]:
        for field in ("scores", "scoresTp", "scoresInf"):
            for v in (m.get(field) or {}).values():
                assert 0 <= v <= 100, (m["name"], field, v)


def test_scenario_weights_sum_100(ledger):
    assert ledger["scenarios"], "场景表为空"
    for sc in ledger["scenarios"]:
        assert sum(sc["weights"].values()) == pytest.approx(100.0), sc["name"]
        assert len(sc["weights"]) == len(ledger["dimensions"])


def test_evidence_contract_fields(ledger):
    for e in ledger["evidence"]:
        assert list(e)[:8] == ["m", "d", "src", "cat", "raw", "scale", "date", "val"]
        if "fam" in e:  # 族行必带 famN 与 w，且 w 与 fam_weight 公式一致
            assert "famN" in e and "w" in e
            from radar.config import fam_weight
            assert e["w"] == fam_weight(e["famN"])


def test_deterministic_serialization(ledger):
    """同一次进程内组装两次 → JSON 字节一致（emit 幂等的根据）。"""
    again = build_ledger()
    a = json.dumps(ledger, ensure_ascii=False, separators=(",", ":"))
    b = json.dumps(again, ensure_ascii=False, separators=(",", ":"))
    assert a == b
