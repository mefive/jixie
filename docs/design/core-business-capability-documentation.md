# 核心业务能力文档整理

2026-09-17 方案已确认。本次仅整理文档；基线为 `e9129bef`，拟提交标题：

`docs(api): document core business capability boundaries`

完整文档 diff 已通过人工 review，必要文档复核已通过，按已确认标题提交，不推送。上一轮全量测试、构建及运行入口验收是历史结果，本次不重复执行，也不将其计为本次验证。

## 阅读层次与维护位置

模块根 README 维护职责、对外关系、主要协作流程、子能力索引与模块共同约束。子能力 README 维护当前实现的具名入口、直接调用方、重要输入输出、副作用、状态／事务／收尾和修改定位。设计文档维护取舍、迁移和历史验收。

入口说明只选择消费者实际需要的函数，不把全部 export 称为公开业务 API，不复制完整类型签名。README 中的当前契约以实现为依据；总览及跨模块架构文档用摘要和链接引用，不另行复制局部规则。新增能力有独立职责和使用规则才增加 README，数量不是目标。

## 已确认布局

新增 63 份子能力 README，改写 5 份总览。下表是此次范围记录，当前业务导航以各总览为准。

| 模块总览 | 新增能力说明 | 深层目录的理由 |
| --- | --- | --- |
| [Factor](../../apps/api/src/factor/README.md) | definitions、definitions/templates、composition、publication、observations、evaluations、execution、execution/cross-sectional、correlations、sources、jobs、runtime、runtime/typescript、runtime/python、weather、agent、questions（17） | 模板有独立身份／资产政策；横截面数据与序列还供相关性使用；两种语言各有资源与协议，共用 runtime 本身也有消费者 |
| [Strategy](../../apps/api/src/strategy/README.md) | definitions、backtests、scans、factor-inputs、risk、agent、runtime/typescript、runtime/python（8） | 两种语言有独立调用／收尾契约；runtime 中间层只组织文件，由总览链接覆盖 |
| [Research](../../apps/api/src/research/README.md) | documents、dependencies、document-runs、runtime、embedded、evidence、proposals、datasets、datasets/results、sdk、catalog、language、templates、templates/fcff、handoff、agent、curator（17） | results 有私有报告授权和独立字段投影；FCFF 有分类证据与案例语义，不能只用通用模板说明 |
| [Market](../../apps/api/src/market/README.md) | registry、instruments、providers/tushare、calendar、stocks、etfs、indices、futures、cross-market、queries、state、valuation、fundamentals、rates、macro、commodity（16） | Tushare 是实际通道能力，providers 只组织目录；fundamentals/fixtures 由父能力说明覆盖 |
| [Signals](../../apps/api/src/signals/README.md) | deployments、runs、accounting、factor-inputs、daily（5） | 按业务状态与协作划分；accounting 内初始化、结算、人工成交及纯重放在同一说明内对照事务范围 |

routes 由各根 README 描述组装、HTTP 责任并链接业务能力及路由设计，不新增目录 README。CLI 用法继续集中在 [API 命令索引](../../apps/api/scripts/README.md)，业务编排在所属能力说明；没有逐文件套模板，也没有为文档增加代码出口。

## 内容迁移去向

| 原内容 | 主要维护位置 |
| --- | --- |
| 五个根 README 的局部文件／函数说明、权限、执行与事务细节 | 对应子能力 README；根保留业务索引、流程摘要和共同约束 |
| Factor / Strategy 2026-09-10 路由实施、静态与行为验收细节；Research 2026-09-11 路由详细验收 | [API 路由设计](api-route-naming.md) 的对应日期记录；明确旧 Factor Job kind 是当时状态 |
| Strategy 旧开发演示清理、Research 六个一次性迁移退役 | [架构重构历史退役记录](backend-architecture-refactor.md#后续退役记录)，保留旧备份不能直接用当前 bootstrap 升级的限制 |
| Commit 6/7/8/9、Factor 内部结构及服务边界整理结果 | 已有 [架构重构](backend-architecture-refactor.md)、[内部结构](core-business-internal-structure.md)、[服务边界](core-business-service-boundaries.md) 记录；根只链接 |
| 嵌入分析规划、实施、接续和旧工具退出验收 | 已有 [嵌入分析设计](embedded-python-analysis.md)；当前契约下沉 embedded、sdk 等能力说明 |
| 跨模块阅读路径、部分重复的 Factor 内部／Research 交接细节 | [后端架构地图](../backend-architecture.md) 保留协作概述并链接能力说明 |

本次没有修改已有范围外问题清单，也不修复代码。特别核对当前详情补建、因子运行场景、封存日志、输入重放、共享身份与同步、逐日记账事务等容易误写的边界；详细约束只在对应能力文档维护。

## 文档验收

验收只读文档与源码，不执行产品入口：

1. 检查所有改动文档的本地相对链接、锚点和目标文件，并确认外部文档指向被改写 README 的锚点没有失效。
2. 检查约定的 63 个能力均在根索引内、每份子 README 可返回总览，纯组织目录由约定上层覆盖。
3. 将具名入口、导入文件和主要调用方对照现有实现；重点核对授权、状态、事务、执行顺序、副作用和资源收尾。
4. 对照旧根 README 确认有效事实已下沉或链接已有记录；详细历史移入设计，避免空模板、重复维护和把历史状态写成当前保证。
5. 执行 `git diff --check`，额外检查新增未跟踪 Markdown 的空白；核对全部变更都在约定文档集合。

本次不运行业务测试、构建、数据库操作、服务、运行探针或类型／依赖生成流程。人工 review 后继续沿用这一文档验收范围。

### Review 前复核结果

- 72 个约定 Markdown 文件：5 份总览、63 份新增能力 README、4 份架构／设计文档；其中 8 个已跟踪文件修改、64 个新增文件。未修改产品代码、测试、配置、依赖、数据库或公开契约。
- 939 个本地相对链接／锚点检查通过；目标文件存在，外部 Markdown 指向五份被改写总览的锚点未失效。63 项新增能力的精确路径、根索引与返回总览链接全部匹配方案。
- 486 次具名标识引用在当前源码中可定位，表格中的 225 组入口／文件关联检查通过；另对照关键实现与直接调用方复核权限、事务、执行和收尾。这些文本检查不能替代语义 review。
- 旧根文档的路由验收与退役记录已迁入上述设计位置；已有完整记录仅保留链接。五模块 README 未发现重复的长段落，未新增空模板。
- `git diff --check` 及新增 Markdown 空白检查通过。未运行测试、构建、数据库操作、服务或运行探针；此时尚未提交，交付完整文档 diff 供人工 review。

### Review 后复核结果

2026-09-17 人工 review 已通过。再次复核 939 个本地相对链接／锚点、63 项能力索引及返回总览链接，结果全部通过；`git diff --check` 及 64 份新增 Markdown 的空白检查通过。最终范围仍为上述 72 个 Markdown 文件，没有产品代码或其他类型变更；继续遵守本次仅文档验收、不推送的约定。
