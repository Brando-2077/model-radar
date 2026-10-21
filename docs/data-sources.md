# 数据来源

本项目只使用公开可访问的榜单、模型卡与厂商发布材料。每条 raw 证据都带 `来源`、`类别`、`原始分`、`量纲`、`数据日期` 与 `URL`，可以回到原始页面复核。

数据日期以来源页面标注的日期为准，不是本机抓取日期。页面不是实时榜单；更新靠人工采集与 PR。

## 当前来源

下表按 2026-10-21 的 `data/raw_*.csv` 统计，行数会随更新变化。

| 来源 | 用途 | raw 行数 | 更新 | 注意 |
|---|---|---:|---|---|
| [Artificial Analysis](https://artificialanalysis.ai) | 单模型页的分项基准：GPQA / HLE / CritPt / SciCode / Terminal-Bench / AA-LCR / IFBench / MMMU-Pro / AutomationBench / Omniscience 等 | 306 | 持续 | 部分字段为 `null`；总分/综合指数不直接映射，只用分项 |
| [LiveBench 2.0](https://livebench.ai) | 七个套件：Reasoning / Coding / Long Agentic / Browser / Data Analysis / Research / Design | 133 | 官方 release | 与 LiveBench 1.x **分族**；当前 release `20261014` |
| [LiveBench](https://livebench.ai) | v1 分类别：Reasoning / Math / Coding / Language / Data Analysis / Instruction Following 等 | 119 | 月更 | 与 LiveBench 2.0 **分族**；只取官方表 |
| [SuperCLUE](https://www.superclueai.com) | 中文通用榜、长上下文、Terminal、Writing 等 | 96 | 月更 | 只收精确同款版本；Writing 当前仅少量模型，族内 n=4 |
| [LMArena](https://lmarena.ai) | 人评 Elo：总榜与分类目 | 34 | 持续 | 部分页面受 Cloudflare 限制；只用可复核的总榜/类目 Elo |
| [Design Arena](https://openrouter.ai/rankings#benchmarks) | `models-website` 人评 Elo：网页/视觉产出 | 15 | 持续 | 经 OpenRouter 公开接口；只取 `models-website` 一个类目 → 图片与制图 |
| [AIWB — AI Writing Benchmark](https://aiwritingbenchmark.com/leaderboard) | 英文写作盲评：盲测对战 + AI 裁判，Bradley–Terry 定分 | 17 | 周更 | 英文口径，50 = 平均模型；与中文写作不并族 |
| [AI产品狙击手](https://www.techgogogo.com/llm-benchmark/) | 中文多约束指令遵循 Q1（10 分制） | 16 | 不定期 | 单人主观判分、单题；只作一个独立族，不等价于 IFBench |
| 厂商官方材料：DeepSeek | 官方模型卡/发布页 | 19 | 随发版 | 厂商自报渠道；只收该厂商自己的模型 |
| 厂商官方材料：腾讯 | 腾讯混元官方页/附录 | 17 | 随发版 | 厂商自报渠道 |
| 厂商官方材料：小红书 dots | dots 官方模型卡 | 14 | 随发版 | 厂商自报渠道 |
| 厂商官方材料：Z.ai / 智谱 | GLM 官方博客/技术报告 | 13 | 随发版 | 厂商自报渠道 |
| [酥悠沫](https://suyoumo.github.io/) | 聚合榜补缺 | 5（第三方 1 + 官方转录 4） | 不定期 | 只补“该格没有任何实测”的位置；官方转录单独标为厂商渠道 |

合计约 **804 条 raw 行**；经同族去重、TB 回退、未映射行剔除后，当前账本为 **729 条证据**（含 13 条推理补全）。

## 各来源的口径与局限

### Artificial Analysis

- 使用单模型页的分项值，不把 Intelligence Index 当成一个“总能力分”。
- 页面字段会随 AA 改版变化；抓取脚本按字段名取值，字段缺失时该行不入账。
- AA 的 Terminal-Bench 同时有 2.1 与 4.0 两版，项目只取一版（优先 4.0）。
- AA 的 `AA-Omniscience Index` 用于可靠性维；指数类先做池内 min–max，再进入族内位次分。

### LiveBench 1.x 与 LiveBench 2.0

- 两者题目集、套件定义与 release 不同，**不并族**。
- LiveBench 1.x 使用官方分类别表；LiveBench 2.0 使用官方 release 的 `table.csv`。
- 只收本项目模型池内的模型；非池内模型不为了“凑人数”而入账。

### SuperCLUE

- 月度/不定期更新，模型命名与版本很多；只收**精确同款**。
- 版本对不上的一律不收，不做“同系列近似”。
- Writing 总榜是中文写作的重要来源，但当前只有少量精确同款模型；不要把它当成完整的中文写作评测。

### LMArena

- Elo 是相对分，换一批对比模型数值会变；项目在池内做 min–max 后进入族内位次。
- 总榜与分类目可能包含不同模型集合；只使用能明确对应到模型与类目的行。
- 页面受 Cloudflare 限制时，使用公开镜像/存档并保留 URL；不绕过访问控制。

### Design Arena

- 只取 `models-website` 一个类目，映射到“图片与制图”。
- 该维同时包含图片理解与前端/页面设计，不能当成单纯的“图片识别”分数。
- 数据经 OpenRouter 公开接口转发；每条行保留接口说明与日期。

### AIWB

- 英文写作盲评，AI 裁判 + Bradley–Terry；0–100 刻度中 50 = 与平均模型五五开。
- 与 SuperCLUE-Writing 不并族：语言、题目、评委都不同。
- 写作偏好主观，分数只作起步参考。

### AI产品狙击手 Q1

- 中文多约束指令遵循题：输出 10 个满足格式与语义约束的句子，每句 1 分。
- 单人主观判分、单题、不同模型接入渠道与思考档不同；只作为 `TGG·Q1指令遵循` 一个独立族。
- 它不能替代 IFBench 等标准化指令遵循基准，也不适合单独用来判断“指令遵循强弱”。

### 厂商官方材料

- 厂商自报可能有选择偏差；项目把`Z.ai官方 / dots官方 / 腾讯官方 / NVIDIA官方 / DeepSeek官方 / 酥悠沫-官方`整体标为厂商渠道。
- “仅第三方榜单”口径按**渠道**排除，不按“是不是自家模型”排除。
- 只收该厂商自己模型的分；竞品列不抄。
- 官方材料里没有明确设置/版本的分数，宁可不收。

### 酥悠沫

- 作为补缺源，只补“该（模型, 维度）一条实测都没有”的格子，不抢已有证据的票。
- 转录自厂商表的行标为 `酥悠沫-官方`，进入厂商渠道；第三方聚合行标为 `酥悠沫`。
- 不把聚合站的二次加工当成一手来源；能回到原厂/原榜的，优先原来源。

## 评估过但未接入

| 来源 | 原因 |
|---|---|
| OpenCompass CompassRank | 数据接口需要 openxlab SSO 登录；匿名访问 401。为保证可复核性，未接入。 |
| HuggingFace Open LLM Leaderboard | 已归档停更，不能反映当前模型。 |
| Scale Labs 指令遵循榜 | 访问返回 403；无稳定公开入口。 |
| arena.ai / LMArena 部分页面 | Cloudflare 全站阻断；只在有公开镜像/存档且能核对时使用。 |
| NVIDIA 官方模型卡 | 历史版本使用过；当前名册没有仅由 NVIDIA 官方卡覆盖的证据，故当前 raw 表为空，不随公开仓库发布。 |

## 数据更新原则

1. **先有来源，再有分数。** 没有 URL 或数据日期的行不入账。
2. **精确版本。** 模型名、版本号、日期、设置至少有一项能锁定同一版本；对不上就不收。
3. **同一基准一票。** 同（模型 × 族）多来源时，第三方优先、日期新者优先。
4. **不静默补值。** 缺失保持空白；推理值只进 `raw_inferred.csv`，默认不计分。
5. **不改上游原值。** `raw_*.csv` 保留原始分与量纲；折算在 `build_scores.py` 中完成。
6. **可回滚。** 删模型/删来源时，同时清理 raw、canon、mapping 中的残留，避免“幻影模型”。

## 上游许可与署名

上游榜单与模型卡的数据版权归原发布方所有。本仓库只对本项目完成的整理、映射、归一化和位次分计算主张 CC BY 4.0 许可，不重新许可上游数据。

使用或再分发时，请：

- 保留每条证据的 `URL` 与 `数据日期`；
- 阅读并遵守原发布方的使用条款；
- 引用时注明 “Model Radar（模型雷达图），HanGu007 与贡献者，CC BY 4.0”，并说明是否修改。

完整许可见 [DATA_LICENSE.md](../DATA_LICENSE.md)。
