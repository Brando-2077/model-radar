# Model Radar

**Pick a model for the task at hand — not for a single leaderboard.**

Model Radar turns public benchmark results into an 8-dimension capability profile, weights it by real-world scenarios, and leaves missing evidence explicitly blank instead of pretending it is zero.

[Live demo](https://Brando-2077.github.io/model-radar/) · [Methodology](docs/methodology.md) · [Data sources](docs/data-sources.md) · [Contributing](CONTRIBUTING.md) · [中文 README](README.md)

![Model Radar UI](docs/assets/screenshot.png)

## Why this exists

Benchmarks answer “which model is stronger on this particular test set,” not “which model is better for my task.” Averaging raw scores across different benchmarks mixes incompatible scales and hides missing evidence.

Model Radar is built around three principles:

1. **Separate capabilities before aggregating.** Reasoning, coding, instruction following, tool use, long context, reliability, writing, and visual/design work are not interchangeable.
2. **Compare within a benchmark family.** Every score is converted to a family-relative percentile: how many models in the same benchmark pool does this model beat?
3. **Never turn missing data into zero.** Missing dimensions are shown as gaps and excluded from the weighted score; the page says “pending,” not “0.”

The project is independent, ad-free, and has no price, subscription, or vendor-referral layer.

## What you get

- **8 capability dimensions** and **5 scenario presets** (content operations, agents/workflows, coding, RAG, everyday use).
- **Three evidence scopes**: all sources / third-party only / with inferred values.
- **Evidence drawer** for every data point: source name, date, raw score, benchmark family, family size, percentile formula; raw URLs live in `data/raw_*.csv`.
- **Single-file HTML**: `model-radar.html` contains the app and the data; open it offline with no runtime dependencies.
- **Reproducible pipeline**: raw CSVs → `build_scores.py` → `build_html.py`.

## Quick start

```bash
python -m pip install -r requirements.txt
python build_scores.py
python build_html.py
python scripts/validate.py
```

Then open `model-radar.html` in a browser.

## Documentation

- [Methodology](docs/methodology.md) — normalization, benchmark families, scopes, inference, limitations.
- [Architecture](docs/architecture.md) — repository layout and data flow.
- [Data sources](docs/data-sources.md) — sources, URLs, dates, and caveats.
- [Adding models](docs/adding-models.md) — the six-table workflow.
- [FAQ](docs/faq.md) — common questions and misinterpretations.

## License

Code is MIT-licensed. The original data compilation and documentation are CC BY 4.0. Upstream benchmark data remains subject to the original publishers’ terms; see [DATA_LICENSE.md](DATA_LICENSE.md).

## Disclaimer

Scores are pool-relative, not absolute capability measurements. Adding or removing models shifts the whole pool. This project is not affiliated with any model vendor or benchmark publisher and is not a procurement recommendation.
