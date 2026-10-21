#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Model Radar data and HTML consistency checks.

Run from the repository root:

    python scripts/validate.py

The script uses only pandas (see requirements.txt) and exits non-zero when a
hard invariant is broken. Warnings are printed but do not fail the build.
"""

from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HTML = ROOT / "model-radar.html"
RAW_COLUMNS = ["模型", "公司", "来源", "类别", "原始分", "量纲", "数据日期", "URL"]
INF_COLUMNS = ["模型", "维度", "推理分", "推理方法", "依据", "留一MAE", "数据日期", "URL"]
KNOWN_UNITS = {"0-100", "0-1", "百分制", "10分制", "5分制", "Elo", "指数", "0-1越低越好"}

# Single source of truth for the family threshold and vendor channel list.
sys.path.insert(0, str(ROOT))
try:
    from build_scores import FAMILY_MIN_N, VENDOR_SRC  # noqa: E402
except Exception as exc:  # pragma: no cover - only hit when the repo is broken
    print(f"[FAIL] 无法从 build_scores.py 读取口径常量：{exc}")
    raise SystemExit(1)


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def show(self) -> None:
        for message in self.errors:
            print(f"[FAIL] {message}")
        for message in self.warnings:
            print(f"[WARN] {message}")
        if self.errors:
            print(f"\n校验失败：{len(self.errors)} 个错误，{len(self.warnings)} 个警告。")
        else:
            print(f"\n校验通过：0 个错误，{len(self.warnings)} 个警告。")


def read_csv(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")


def require_columns(report: Report, df: pd.DataFrame, name: str, columns: list[str]) -> None:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        report.error(f"{name} 缺少列：{', '.join(missing)}")


def numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def main() -> int:
    report = Report()

    required_files = [
        DATA / "dimensions.csv",
        DATA / "weights.csv",
        DATA / "mapping.csv",
        DATA / "canon.csv",
        DATA / "models.csv",
        DATA / "scores.csv",
        DATA / "raw_inferred.csv",
        HTML,
    ]
    for path in required_files:
        if not path.exists():
            report.error(f"缺少文件：{path.relative_to(ROOT)}")
    if report.errors:
        report.show()
        return 1

    dims = read_csv(DATA / "dimensions.csv")
    weights = read_csv(DATA / "weights.csv")
    mapping = read_csv(DATA / "mapping.csv")
    canon = read_csv(DATA / "canon.csv")
    models = read_csv(DATA / "models.csv")
    scores = read_csv(DATA / "scores.csv")
    inferred = read_csv(DATA / "raw_inferred.csv")

    require_columns(report, dims, "dimensions.csv", ["维度"])
    require_columns(report, weights, "weights.csv", ["场景", "维度", "权重"])
    require_columns(report, mapping, "mapping.csv", ["来源", "类别", "维度", "族", "备注"])
    require_columns(report, canon, "canon.csv", ["榜单名", "统一名", "备注"])
    require_columns(report, models, "models.csv", ["模型", "公司", "开源", "数据日期", "备注"])
    require_columns(report, scores, "scores.csv", ["模型", "维度", "榜单分", "备注", "族", "族内n"])
    require_columns(report, inferred, "raw_inferred.csv", INF_COLUMNS)

    if report.errors:
        report.show()
        return 1

    dim_names = [str(x).strip() for x in dims["维度"]]
    model_names = [str(x).strip() for x in models["模型"]]

    # Dimensions
    if len(dims) != 8:
        report.error(f"dimensions.csv 应为 8 行，实际 {len(dims)} 行")
    if len(set(dim_names)) != len(dim_names):
        report.error("dimensions.csv 的维度名有重复")
    if any(not x for x in dim_names):
        report.error("dimensions.csv 存在空维度名")

    # Models
    if len(set(model_names)) != len(model_names):
        report.error("models.csv 的模型名有重复")
    if any(not x for x in model_names):
        report.error("models.csv 存在空模型名")
    bad_open = set(models["开源"].str.strip()) - {"是", "否", "未确认", ""}
    if bad_open:
        report.error(f"models.csv 的「开源」列有非法值：{sorted(bad_open)}")
    blank_open = models["开源"].str.strip() == ""
    if blank_open.any():
        report.warn(f"models.csv 有 {int(blank_open.sum())} 行未显式标注开源/闭源；构建会按公司兜底")

    # Weights
    scene_count = weights["场景"].nunique()
    if scene_count != 5:
        report.error(f"weights.csv 应有 5 套场景，实际 {scene_count} 套")
    for scene, grp in weights.groupby("场景", sort=False):
        if len(grp) != 8:
            report.error(f"场景「{scene}」应有 8 个维度，实际 {len(grp)} 行")
        if grp["维度"].duplicated().any():
            report.error(f"场景「{scene}」有重复维度")
        unknown = set(grp["维度"]) - set(dim_names)
        if unknown:
            report.error(f"场景「{scene}」含未知维度：{sorted(unknown)}")
        vals = numeric(grp["权重"])
        if vals.isna().any():
            report.error(f"场景「{scene}」有权重不是数字")
        elif (vals < 0).any():
            report.error(f"场景「{scene}」有负权重")
        elif math.isclose(float(vals.sum()), 0.0, abs_tol=1e-9):
            report.error(f"场景「{scene}」权重总和为 0")
        else:
            normalized = vals * 100.0 / vals.sum()
            if not math.isclose(float(normalized.sum()), 100.0, abs_tol=1e-6):
                report.error(f"场景「{scene}」权重无法归一化到 100.0")

    # Mapping
    if mapping.duplicated(["来源", "类别"]).any():
        dup = mapping[mapping.duplicated(["来源", "类别"], keep=False)][["来源", "类别"]]
        report.error(f"mapping.csv 有重复（来源, 类别）：\n{dup.to_string(index=False)}")
    for _, row in mapping.iterrows():
        dim = str(row["维度"]).strip()
        fam = str(row["族"]).strip()
        if dim and dim not in dim_names:
            report.error(f"mapping.csv 未知维度：{row['来源']} / {row['类别']} → {dim}")
        if bool(dim) != bool(fam):
            report.error(f"mapping.csv 维度与族必须同时为空或同时非空：{row['来源']} / {row['类别']}")
    fam_dims = mapping[mapping["族"].str.strip() != ""].groupby("族")["维度"].nunique()
    multi = fam_dims[fam_dims > 1]
    if len(multi):
        report.error(f"同一基准族映射到多个维度：{multi.to_dict()}")

    # Canon
    if canon["榜单名"].duplicated().any():
        dup = canon[canon["榜单名"].duplicated(keep=False)]["榜单名"].tolist()
        report.error(f"canon.csv 的榜单名有重复：{dup}")
    canon_names = set(canon["榜单名"].str.strip())
    canon_targets = set(canon["统一名"].str.strip())
    bad_targets = sorted(canon_targets - set(model_names))
    if bad_targets:
        report.error(f"canon.csv 指向了名册中不存在的模型：{bad_targets}")

    # Raw files and mapping coverage
    raw_frames: dict[str, pd.DataFrame] = {}
    mapping_keys = set(zip(mapping["来源"].str.strip(), mapping["类别"].str.strip()))
    for path in sorted(DATA.glob("raw_*.csv")):
        if path.name == "raw_inferred.csv":
            continue
        df = read_csv(path)
        raw_frames[path.name] = df
        require_columns(report, df, path.name, RAW_COLUMNS)
        if report.errors:
            continue
        for idx, row in df.iterrows():
            model = str(row["模型"]).strip()
            source = str(row["来源"]).strip()
            category = str(row["类别"]).strip()
            unit = str(row["量纲"]).strip()
            raw_date = str(row["数据日期"]).strip()
            url = str(row["URL"]).strip()
            where = f"{path.name} 第 {idx + 2} 行"
            if not model:
                report.error(f"{where}：空模型名")
            if not source or not category:
                report.error(f"{where}：空来源或空类别")
            if (source, category) not in mapping_keys:
                report.error(f"{where}：未在 mapping.csv 声明（{source} / {category}）")
            if numeric(pd.Series([row["原始分"]])).isna().iloc[0]:
                report.error(f"{where}：原始分不是数字（{row['原始分']!r}）")
            if unit not in KNOWN_UNITS:
                report.error(f"{where}：未知量纲「{unit}」")
            if not re.match(r"^\d{4}(-\d{2}(-\d{2})?)?", raw_date):
                report.error(f"{where}：数据日期格式异常（{raw_date!r}）")
            if not url.startswith(("http://", "https://")):
                report.error(f"{where}：URL 不是 http(s)（{url!r}）")
            if model not in canon_names and model not in set(model_names):
                report.error(f"{where}：模型名既不在 canon.csv，也不在 models.csv（{model}）")

    # Inferred values
    if inferred.duplicated(["模型", "维度"]).any():
        report.error("raw_inferred.csv 有重复（模型, 维度）")
    inferred_keys = set(zip(inferred["模型"].str.strip(), inferred["维度"].str.strip()))
    for idx, row in inferred.iterrows():
        where = f"raw_inferred.csv 第 {idx + 2} 行"
        model = str(row["模型"]).strip()
        dim = str(row["维度"]).strip()
        if model not in set(model_names):
            report.error(f"{where}：模型不在名册（{model}）")
        if dim not in set(dim_names):
            report.error(f"{where}：未知维度（{dim}）")
        value = numeric(pd.Series([row["推理分"]])).iloc[0]
        if pd.isna(value) or not (0 <= float(value) <= 100):
            report.error(f"{where}：推理分应在 0–100（{row['推理分']!r}）")
        if not str(row["推理方法"]).strip() or not str(row["依据"]).strip():
            report.error(f"{where}：推理方法/依据不能为空")
        if not str(row["URL"]).strip().startswith(("http://", "https://")):
            report.error(f"{where}：URL 不是 http(s)")
        if not str(row["数据日期"]).strip():
            report.error(f"{where}：缺少数据日期")

    # Scores
    score_models = set(scores["模型"].str.strip())
    unknown_models = sorted(score_models - set(model_names))
    if unknown_models:
        report.error(f"scores.csv 含名册外模型：{unknown_models}")
    unknown_dims = sorted(set(scores["维度"].str.strip()) - set(dim_names))
    if unknown_dims:
        report.error(f"scores.csv 含未知维度：{unknown_dims}")
    score_values = numeric(scores["榜单分"])
    if score_values.isna().any():
        report.error("scores.csv 有非数字榜单分")
    elif ((score_values < 0) | (score_values > 100)).any():
        report.error("scores.csv 的榜单分不在 0–100")

    fam_n = numeric(scores["族内n"])
    family_rows = scores[scores["族"].str.strip() != ""].copy()
    inferred_rows = scores[scores["族"].str.strip() == ""].copy()
    if len(inferred_rows) != len(inferred):
        report.error(f"推理行数不一致：scores.csv {len(inferred_rows)} 行，raw_inferred.csv {len(inferred)} 行")
    bad_blank = inferred_rows[~inferred_rows["备注"].str.startswith("推理补全")]
    if len(bad_blank):
        report.error(f"scores.csv 有 {len(bad_blank)} 行族为空但不是推理补全")
    if inferred_rows["族内n"].str.strip().ne("").any():
        report.error("scores.csv 的推理行不应填写族内n")

    if family_rows.duplicated(["模型", "族"]).any():
        dup = family_rows[family_rows.duplicated(["模型", "族"], keep=False)][["模型", "族"]]
        report.error(f"scores.csv 有重复（模型, 族）：\n{dup.to_string(index=False)}")
    bad_fam_n = family_rows[fam_n.loc[family_rows.index].isna()]
    if len(bad_fam_n):
        report.error(f"scores.csv 有 {len(bad_fam_n)} 个族行的族内n不是数字")
    bad_fam_n_zero = family_rows[fam_n.loc[family_rows.index] < 1]
    if len(bad_fam_n_zero):
        report.error(f"scores.csv 有 {len(bad_fam_n_zero)} 个族行的族内n < 1")
    bad_fam_dim = family_rows[
        family_rows.apply(
            lambda r: str(r["族"]).strip() not in set(mapping.loc[mapping["族"].str.strip() != "", "族"].str.strip())
            or str(r["维度"]).strip()
            != str(
                mapping.loc[mapping["族"].str.strip() == str(r["族"]).strip(), "维度"].iloc[0]
            ).strip(),
            axis=1,
        )
    ]
    if len(bad_fam_dim):
        report.error(f"scores.csv 有 {len(bad_fam_dim)} 行的族/维度与 mapping.csv 不一致")

    scored = family_rows[fam_n.loc[family_rows.index] >= FAMILY_MIN_N]
    unscored = family_rows[fam_n.loc[family_rows.index] < FAMILY_MIN_N]
    scored_families = sorted(set(scored["族"].str.strip()))
    covered_cells = scored.groupby(["模型", "维度"]).ngroups
    pending_models = sorted(set(model_names) - set(scored["模型"].str.strip()))
    scored_keys = set(zip(scored["模型"].str.strip(), scored["维度"].str.strip()))
    overlap_inf = inferred_keys & scored_keys
    if overlap_inf:
        report.error(
            "raw_inferred.csv 有推理值覆盖了已有计分实测的格子："
            f"{sorted(overlap_inf)}；请删除这些推理行，实测优先"
        )

    # Compare inferred keys with score rows
    score_inf_keys = set(zip(inferred_rows["模型"].str.strip(), inferred_rows["维度"].str.strip()))
    if score_inf_keys != inferred_keys:
        report.error(
            "raw_inferred.csv 与 scores.csv 的推理（模型, 维度）不一致："
            f"raw 独有 {sorted(inferred_keys - score_inf_keys)}；scores 独有 {sorted(score_inf_keys - inferred_keys)}"
        )

    # HTML
    html_text = HTML.read_text(encoding="utf-8")
    region_match = re.search(
        r"<!-- ==== 数据区 BEGIN[^\n]*-->\n(.*?)<!-- ==== 数据区 END ==== -->",
        html_text,
        re.S,
    )
    if not region_match:
        report.error("model-radar.html 找不到数据区 BEGIN/END 标记")
        ledger = None
    else:
        payload_match = re.search(
            r"window\.RADAR_LEDGER\s*=\s*(\{.*\});\s*</script>",
            region_match.group(1),
            re.S,
        )
        if not payload_match:
            report.error("model-radar.html 数据区找不到 window.RADAR_LEDGER")
            ledger = None
        else:
            try:
                ledger = json.loads(payload_match.group(1))
            except json.JSONDecodeError as exc:
                report.error(f"model-radar.html 数据区 JSON 解析失败：{exc}")
                ledger = None

    if ledger is not None:
        for key in ["meta", "dimensions", "scenarios", "models", "evidence"]:
            if key not in ledger:
                report.error(f"数据区缺少字段：{key}")
        if all(k in ledger for k in ["meta", "dimensions", "scenarios", "models", "evidence"]):
            meta = ledger["meta"]
            if not str(meta.get("version", "")).startswith("v"):
                report.error("数据区 meta.version 格式异常")
            built = str(meta.get("built", ""))
            try:
                date.fromisoformat(built)
            except ValueError:
                report.error(f"数据区 meta.built 不是 YYYY-MM-DD：{built!r}")
            if len(ledger["dimensions"]) != 8:
                report.error(f"数据区维度数应为 8，实际 {len(ledger['dimensions'])}")
            if len(ledger["scenarios"]) != 5:
                report.error(f"数据区场景数应为 5，实际 {len(ledger['scenarios'])}")
            ledger_models = {m.get("name") for m in ledger["models"]}
            if ledger_models != set(model_names):
                report.error(
                    "数据区模型名册与 models.csv 不一致："
                    f"仅 HTML {sorted(ledger_models - set(model_names))}；"
                    f"仅 CSV {sorted(set(model_names) - ledger_models)}"
                )
            if len(ledger["evidence"]) != len(scores):
                report.error(
                    f"数据区证据数 {len(ledger['evidence'])} 与 scores.csv {len(scores)} 不一致"
                )
            ledger_dims = {d.get("name") for d in ledger["dimensions"]}
            if ledger_dims != set(dim_names):
                report.error(
                    "数据区维度与 dimensions.csv 不一致："
                    f"仅 HTML {sorted(ledger_dims - set(dim_names))}；"
                    f"仅 CSV {sorted(set(dim_names) - ledger_dims)}"
                )
            # Multiset comparison catches stale or duplicated evidence rows.
            expected = Counter(
                (str(r["模型"]).strip(), str(r["维度"]).strip(), round(float(v), 1))
                for (_, r), v in zip(scores.iterrows(), score_values)
            )
            actual = Counter(
                (str(e.get("m", "")).strip(), str(e.get("d", "")).strip(), round(float(e["val"]), 1))
                for e in ledger["evidence"]
                if e.get("val") is not None
            )
            if expected != actual:
                only_exp = expected - actual
                only_act = actual - expected
                report.error(
                    "数据区证据与 scores.csv 不一致："
                    f"账本独有 {sum(only_exp.values())} 条，HTML 独有 {sum(only_act.values())} 条"
                )
            inf_count = sum(1 for e in ledger["evidence"] if e.get("inf"))
            if inf_count != len(inferred):
                report.error(f"数据区推理标记数 {inf_count} 与 raw_inferred.csv {len(inferred)} 不一致")
            # Family metadata should match scores.csv for measured rows.
            score_fam = Counter(
                (
                    str(r["模型"]).strip(),
                    str(r["维度"]).strip(),
                    str(r["族"]).strip(),
                    str(r["族内n"]).strip(),
                )
                for _, r in family_rows.iterrows()
            )
            ledger_fam = Counter(
                (
                    str(e.get("m", "")).strip(),
                    str(e.get("d", "")).strip(),
                    str(e.get("fam", "")).strip(),
                    str(e.get("famN", "")).strip(),
                )
                for e in ledger["evidence"]
                if not e.get("inf")
            )
            if score_fam != ledger_fam:
                report.error(
                    "数据区族信息与 scores.csv 不一致："
                    f"账本独有 {sum((score_fam - ledger_fam).values())} 条，"
                    f"HTML 独有 {sum((ledger_fam - score_fam).values())} 条"
                )
            # Vendor flags
            vendor_expected = sum(
                1
                for _, r in scores.iterrows()
                if str(r["备注"]).split("·", 1)[0].strip() in VENDOR_SRC
            )
            vendor_actual = sum(1 for e in ledger["evidence"] if e.get("vend"))
            if vendor_expected != vendor_actual:
                report.error(
                    f"数据区厂商标记数 {vendor_actual} 与账本来源 {vendor_expected} 不一致"
                )
            for scene in ledger["scenarios"]:
                if abs(sum(float(v) for v in scene.get("weights", {}).values()) - 100.0) > 1e-6:
                    report.error(f"数据区场景「{scene.get('name')}」权重合计不是 100.0")
                if set(scene.get("weights", {})) != set(dim_names):
                    report.error(f"数据区场景「{scene.get('name')}」维度集合不完整")
            # Pending models should have no dimension scores in the ledger.
            for m in ledger["models"]:
                if m.get("name") in pending_models and m.get("scores"):
                    report.error(f"待定模型 {m.get('name')} 不应有维度分")

    # Raw inferred rows must have a matching score row; checked above.
    # Summary
    print("=== Model Radar 校验 ===")
    print(f"模型：{len(model_names)} 个（有计分 {len(set(scored['模型'].str.strip()))} 个，待定 {len(pending_models)} 个）")
    print(f"证据：{len(scores)} 条（实测/族行 {len(family_rows)}，推理 {len(inferred_rows)}）")
    print(f"计分：{len(scored)} 条；未计分族行 {len(unscored)} 条；族 {len(scored_families)} 个；覆盖 {covered_cells} 格")
    print(f"场景：{scene_count} 套；权重归一化检查已完成")
    print(f"HTML：{HTML.name} · {HTML.stat().st_size:,} 字节")
    if pending_models:
        print(f"待定模型：{', '.join(pending_models)}")

    report.show()
    return 1 if report.errors else 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
