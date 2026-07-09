# 设计:计算图卡片(analyzeData → echarts)+ 图形态扩展

> 2026-07-09 规划,对应 `ROADMAP.md` **7.8**。承接 7.6(`renderChart` 纯 SQL 图)与
> 7.7(`analyzeData` 沙盒计算、只出文字)的缺口:「算得出、画不出」。本文是实施依据;
> 未实施前不改代码。

## 一句话

让对话里的 chart 卡片既能画 **SQL 直接出的表**,也能画 **SQL 取数 + 沙盒 JS(含
`stats.*`)变换后的行表**;并按量化对话真实问法扩展图形态——模型只映射列 / 写变换,
不产像素或 ECharts option。

## 现状与缺口

| 能力 | 现状 | 缺口 |
|---|---|---|
| `renderChart` | `ChartSpec = { kind: line\|bar\|scatter, sql, x, series }` → `POST /agent/sql` → `ChatChart` | 只有关系代数能表达的图 |
| `analyzeData` | queries + code → 标量 observation(≤8KB)→ 模型文字 | 相关 / 回归 / 滚动统计等**序列画不了** |
| 图形态 | line / bar / scatter | 净值面积、堆叠构成、价量双轴、分布、相关矩阵等常见研究图缺失 |

铁律(与 7.6 / 7.7 一致,不可破):

- **存查询 / 代码,不存点**——重开对话重跑,对应当前库;
- **数据不进 LLM**——取数与计算在服务端内部流转;
- **模型不画图**——只产 spec(列映射或变换代码),前端 / 服务端渲染。

## 分期

### Phase A · 接通代码 → 图(优先)

**目标**:`analyzeData` 算出来的**可画行表**能进对话 chart part,与 `renderChart` 共用
`MessageParts` / `ChatChart` UI。

**契约草案**(扩展 `ChartSpec`,不新开 MessagePart 类型):

```ts
type ChartSpec =
  | {
      source?: 'sql'; // 缺省 = 兼容现有卡片
      kind: ChartKind;
      sql: string;
      x: string;
      series: ChartSeriesSpec[];
    }
  | {
      source: 'compute';
      kind: ChartKind;
      queries: { name: string; sql: string }[]; // 同 analyzeData,≤4
      code: string; // export default ({ data, stats }) => rows | { rows, x?, series? }
      x: string;
      series: ChartSeriesSpec[];
    };
```

**工具形态(二选一,实施时拍板)**:

1. **扩展 `analyzeData`**:可选 `chart: { kind, x, series }`——若 code 返回行数组且带
   mapping,副产 chart part;纯标量模式保持现状(observation 文字)。
2. **新工具 `renderComputedChart`**:与 `renderChart` 对称,args = compute 版
   ChartSpec + title;observation 只回「已渲染 + 行数 + sample」。

倾向(2)更清晰:标量问答 vs 出图两条工具 description 不打架;实施时以 prompt
可教性为准。

**重跑路径**:

- 前端 `ChatChart`:`source === 'compute'` → 新 API(如 `POST /agent/chart/compute`),
  服务端复用 `runReadOnlySql` + `runAnalysisCode`(isolate + `stats`),校验列映射后
  返回 rows → 现有 `buildOption`。
- 行数上限对齐 `CHART_ROW_CAP`(500);code 必须返回**画图用行表**,不是 8KB 聚合
  标量——与 analyzeData 文字模式分流写死在工具 description。

**验收**:

- 「茅台 vs 五粮液近一年滚动 60 日相关」→ 对话出现 line chart,刷新重算一致;
- 「两指数日收益散点」→ scatter,点来自 code 对齐后的行;
- 旧 `source` 缺省 / 纯 sql 卡片行为不变(兼容读)。

**工作量粗估**:1.5–2.5 人日(spec + 重跑端点 + ChatChart 分支 + 工具/prompt + 冒烟)。

### Phase B · 纯 SQL 图形态(不碰 code)

在现有「一行一个 x + 若干 y 列」形状上扩 `ChartKind`(或 `series[].type`),SQL 能表达
的优先走 `renderChart`,不强迫进 compute。

| 形态 | 用途 | 实现要点 |
|---|---|---|
| **area**(或 line + areaStyle) | 净值 / 累计收益 | `buildOption` 几乎零成本 |
| **stackedBar** | 行业权重、多空构成 | `stack: 'total'`,series 即层 |
| **histogram** | PE / 收益分布 | SQL `GROUP BY` 分桶;kind 管柱宽样式 |
| **combo** | 价量、收益+成交额 | `series[].type?: 'line'\|'bar'` |
| **dualAxis** | 不同量纲双 y | 与 combo 一起做;`yAxisIndex` |

**先不做**:饼图(量化对话价值低)、对话内 K 线(个股页已有)、地图。

每加一种 kind:先定「一行长什么样 + 一个 few-shot」,再改 `buildOption` 与工具
description。

### Phase C · 新数据形状(需求拉动)

打破「单 x + 多 y 列」,多半挂 `source: 'compute'`(SQL 痛苦、code 舒服):

| 形态 | 典型问法 | Spec 方向 |
|---|---|---|
| **heatmap** | 因子相关矩阵、月×年收益 | `{ x, y, value }` 三列或宽表 + matrix |
| **boxplot** | 十分位收益分布 | category + 五数概括(code 算) |
| **waterfall** | 收益归因 | `{ label, delta }` |
| **regression overlay** | 散点 + 拟合线 | scatter + `trendline` 或 code 给线段 |

有真实对话用例再开;不预建。

## 定界

- IC / 分层因子检验 → 因子页管道;回测 → lab——**不**用对话 chart 重造。
- 工具轮数仍在每 turn ≤5 总预算内。
- simple-statistics 等仍按 7.7「需求拉动再加」,本设计不顺带扩 stats 库。

## 建议实施顺序

1. Phase A(打通管线,解锁「stats 出图」)
2. Phase B:area → stackedBar → combo+dualAxis → histogram
3. Phase C:heatmap → boxplot → 其余按需

## 与既有文档关系

- `docs/design/agent-code-tool.md` — analyzeData v1(文字);本文件是其图表续篇
- `docs/design/unified-agent.md` — 卡片「存 spec 不存结果」铁律仍适用
- ROADMAP 7.6 / 7.7 — 已完成前置;本条为 7.8
