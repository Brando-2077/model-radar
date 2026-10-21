# 贡献指南

感谢你愿意一起把这个项目做得更可靠。无论是纠一个分数、补一条来源、改一处文案，还是提一个可复现的 bug，都比“看起来不错”更有价值。

## 1. 可以贡献什么

- **数据纠错**：分数抄错、版本对不上、来源失效、基准族归并错误、模型名残留。
- **补证据**：新模型、新版本、新榜单、新类目；只要能回到公开来源并锁定版本。
- **页面与交互**：可读性、可访问性、移动端、图表表达、性能。
- **文档**：错别字、口径解释不清、示例过期、链接失效。
- **工具**：抓取脚本、校验脚本、数据可视化实验（先开 Issue 讨论）。

## 2. 先读这三份

1. [项目立意与初心](docs/vision.md) —— 项目的边界与取舍。
2. [方法论](docs/methodology.md) —— 位次分、基准族、三档口径、缺失处理。
3. [加模型指南](docs/adding-models.md) —— 如果你要动数据表。

## 3. 数据纪律（硬规则）

这些规则不是风格偏好，是项目可信度的基础：

1. **没有来源不入账。** 每行必须有 URL 与数据日期。
2. **不伪造分数。** 不把竞品分抄给新模型，不用“看起来差不多”补空格。
3. **精确同款版本。** 模型名、版本号、日期、设置至少有一项能锁定；对不上就不收。
4. **缺数据 ≠ 0。** 缺失维保持空白；页面显示“待定”，不按 0 计分。
5. **同一基准一票。** 同（模型 × 族）多来源时，第三方优先、日期新者优先。
6. **厂商自报只用于该厂商自己的模型。** 且必须能通过“仅第三方榜单”整体排除。
7. **族内 <4 不计分。** 不为凑人数硬并不同基准。
8. **推理值默认不计分。** 只放 `raw_inferred.csv`，写清方法、依据与 LOO 误差。
9. **价格 / 套餐不进雷达轴。** 雷达只画能力；这类信息变动太快，放进图里会立刻过期。
10. **删模型要清干净。** `models.csv`、raw、`canon.csv` 一起清理，避免幻影模型。

## 4. 本地环境

要求 Python 3.10+。

```bash
git clone https://github.com/HanGu007/model-radar.git
cd model-radar
python -m pip install -r requirements.txt
python build_scores.py
python build_html.py
python scripts/validate.py
```

打开 `model-radar.html` 检查页面。

### 常用命令

| 命令 | 作用 |
|---|---|
| `python build_scores.py` | 从 `data/raw_*.csv` 重建 `data/scores.csv` |
| `python build_html.py` | 把账本写进 `model-radar.html` 数据区 |
| `python scripts/validate.py` | 检查数据、映射、账本与 HTML 一致性 |
| `python scripts/infer_gaps.py` | 重跑推理补全（通常不需要） |
| `python -m http.server 8765` | 本地起静态服务器，浏览器打开 `http://127.0.0.1:8765/model-radar.html` |

## 5. 贡献流程

### 5.1 先开 Issue（推荐）

对于以下改动，建议先开 Issue 对齐，避免白做：

- 新增来源/新增基准族；
- 调整场景权重或维度定义；
- 大规模删模型/改映射；
- 改变计分口径或页面信息架构；
- 新增抓取脚本或第三方依赖。

小修（错别字、单条数据纠错、样式 bug）可以直接提 PR。

### 5.2 Fork / 分支

```bash
git checkout -b data/add-example-model
```

分支名建议：

- `data/...`：数据新增或纠错；
- `fix/...`：bug；
- `docs/...`：文档；
- `ui/...`：页面/交互；
- `chore/...`：构建、CI、依赖。

### 5.3 提交前跑完整检查

```bash
python build_scores.py
python build_html.py
python scripts/validate.py
```

确认：

- `build_scores.py` 没有“未映射”警告；
- `data/scores.csv` 已随 raw/mapping/canon 的变化重建；
- `model-radar.html` 已随账本重建；
- 页面能选中新模型，证据抽屉正确；
- 缺失维仍是“待定”，没有变成 0；
- `git diff` 里没有意外文件（备份、缓存、内部笔记）。

### 5.4 提交信息

建议使用 Conventional Commits 风格：

```text
feat(data): add Example-Model-1.0 with AA and LiveBench evidence
fix(data): correct GLM-5.3 Terminal-Bench score
docs: clarify family-relative percentile formula
ui: improve mobile matrix scrolling
chore(ci): add data validation workflow
```

中文也可以，只要说清“改了什么、为什么”。

### 5.5 PR 描述

PR 模板会要求：

- 改动类型；
- 数据来源与日期；
- 影响的模型/维度/族；
- 已运行的命令；
- 页面截图（UI 改动）；
- 已知缺口或取舍。

## 6. 数据纠错模板

请在 Issue 中尽量给全：

```text
模型：
维度：
当前账本/页面值：
建议值：
来源名称：
来源 URL：
数据日期：
版本/设置：
原文或截图：
补充说明：
```

如果只是“这个分看起来不对”，维护者很难处理；有原始链接和版本信息，通常很快能定位。

## 7. 代码与页面贡献

- 保持单文件交付：`model-radar.html` 不引入 CDN、后端或构建时依赖。
- 不把数据写死在 JS 里；数据只从 `window.RADAR_LEDGER` 读取。
- 不手改数据区（`<!-- ==== 数据区 BEGIN/END ==== -->` 之间），改 `data/` 后重建。
- 新增交互要能用键盘操作，并有可见焦点。
- 颜色/字号改动请检查对比度；主要读数不要低于 4.5:1。
- 修改壳后跑一次 `build_html.py`，确认数据区仍能正常写入。
- 如果改了图表逻辑，请附桌面与窄屏截图，并说明缺失维如何显示。

## 8. 评审与合并

- 维护者会优先看：证据是否可复核、版本是否精确、是否违反数据纪律、是否破坏单文件交付。
- 数据 PR 可能被要求补来源、拆族、删残留行；这不是针对贡献者，而是口径要求。
- 涉及计分口径、维度定义、权重的大改，需要先有设计说明与影响评估。
- 合并后由维护者统一发版；贡献者不必自己改版本号。

## 9. 行为准则

参与本项目即表示同意遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。请对事不对人，尤其不要在数据纠错中揣测动机。

## 10. 许可

提交贡献即表示你同意：

- 代码贡献按 [MIT](LICENSE) 许可；
- 数据与文档贡献按 [CC BY 4.0](DATA_LICENSE.md) 许可；
- 你提交的内容不侵犯第三方权利，且允许项目在公开仓库中分发。

上游榜单/模型卡的数据版权归原发布方；请勿把无权再分发的内容（例如付费报告全文、受限页面截图）提交到仓库。
