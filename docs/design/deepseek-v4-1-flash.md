# DeepSeek V4.1 Flash 迁移

状态：迁移及补充工具提示修正均已通过代码审查与验收。基础真实调用、复杂嵌入式案例、数值与图形复核完成。没有部署或修改真实环境配置；既有显式模型覆盖继续优先。

提交信息：`feat(llm): migrate defaults to DeepSeek V4.1 Flash`。

## 目的与依据

嵌入式 Research 分析及旧工具退出已完成开发验收，最后提交为 `3346faf3`。本次独立更新所有默认 DeepSeek
调用到 V4.1 Flash，并保持 Factor / Strategy / Research 的现有产品分工和交互。

- [官方发布公告（2026-09-10）](https://www.deepseek.com/en/news/deepseek-v4-1-flash/)明确 API ID 为 `deepseek-flash`。
- [Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)提供 `thinking.type=enabled/disabled`，默认开启；支持 JSON 输出和工具调用。只换模型名会令原先省略 thinking 的非思考请求进入默认思考模式。
- [思考模式指南](https://api-docs.deepseek.com/guides/thinking_mode/)要求工具调用后的请求传回已有 `reasoning_content`。本项目已有本轮工具循环中的保留与回传，不改成 Responses API。

以上是官方协议依据，不是本账户已接通或模型质量提高的证据；真实接口验证放在代码审查后。

## 实现范围

| 模块 | 改动与结果 |
| --- | --- |
| [LLM 配置](../../apps/api/src/infra/llm/config.ts) | 默认 `deepseek-flash`；普通调用优先 `DEEPSEEK_MODEL`，Agent 优先 `DEEPSEEK_AGENT_MODEL` 再普通配置。保持显式覆盖，不重写旧 ID |
| [适配器](../../apps/api/src/infra/llm/deepseek.ts) | 三种调用共享模型选择；JSON / 命名发送 disabled；Agent 默认 enabled/high，原有 false 开关发送 disabled 且不发送 effort；沿用 OpenAI JS SDK 和 Chat Completions |
| [嵌入式分析工具](../../apps/api/src/agent/tools/run-embedded-analysis.ts) | 修正不存在的 display() 指引，明确文本、最后表达式和 Matplotlib 图的实际输出行为 |
| [Agent 运行](../../apps/api/src/agent/turns/run.ts)、[因子问答](../../apps/api/src/factor/questions/conversations.ts) | 新 turn 与 trace 的模型名使用同一选择函数；不更改旧记录 |
| [因子交接](../../apps/api/src/research/handoff/factor-drafts.ts)、[策略交接](../../apps/api/src/research/handoff/strategy-drafts.ts) | 新草稿的 classifier / codegen 元数据使用共用配置；复用旧草稿时保留原元数据 |
| [.env 示例](../../apps/api/.env.example)、[生产示例](../../apps/api/.env.production.example)、[部署手记](../deployment.md#deepseek-模型配置) | 写明默认值、思考模式与旧环境覆盖的升级步骤；删除失效 Screen/parse 说明 |

未增加依赖、公开 API、数据库迁移、跨包构建依赖或多模态输入；不修改真实 `.env`、部署服务器或用户研究数据。
本次是后端供应商适配，没有新增用户操作，因此中英公开帮助和页面文案不变；双语回答继续由现有 prompt 决定。

模型字段记录的是请求时选择的 API ID，不能声称它是供应商底层权重的永久版本指纹。`deepseek-flash` 为供应商
维护的调用名，未来路由可能改变。Agent 在同一用户提问内的工具循环传回 reasoning；跨用户提问继续采用原有
文本历史，不引入完整供应商会话存档或回填旧 reasoning。

## 验证与验收

交审前仅执行：范围内 Prettier / ESLint、根级 noEmit 类型检查（含后端边界和三项生成契约）、文档链接、
预告 commit message 与 diff 检查。

审查后执行：

1. 真实 OpenAI JS SDK 配合受控 fetch 验证请求体：默认值/覆盖优先级、JSON/命名关闭思考、Agent 开关及 effort、空工具修复轮次。不会发出网络请求。
2. 协议回归：分片 UTF-8 / SSE、交错工具参数、reasoning 和工具结果回传、空正文拒绝、HTTP 错误与取消传播。
3. 隔离数据库核对 Agent 与因子问答创建时及完成后的模型字段、trace；Research 双交接核对模型元数据，继续回归相关 Agent、元数据、命名与 Curator 流程。
4. API 构建；源码与编译模块使用相同模型选择。真实接口验证覆盖 JSON、短文本及思考模式工具调用后回答。初始验收限制为总计 5 次、单次 4,096 输出 token / 60 秒；用户要求优先完整完成复杂例子后，演示脚本改为每次运行最多 10 次请求、单次 65,536 输出 token / 300 秒，无自动重试。仅使用合成任务，不发送私人研究或将密钥写入日志。

若本账户权限、额度或网络阻止真实验证，明确列为未完成；不将受控模型回归当成供应商实测成功。
如果实测需要改变产品实现，先完成静态检查并再次交审，再执行行为验证。

与模型质量、速度、成本的全面评估分开：本次验收证明协议接通和既有契约可用，不承诺所有研究任务质量提高。
原有默认超时、重试及输出预算未整体调整；真实验证脚本有单独限额，不能当作生产调用限额。

工作区中 `maintenance/data-audit.ts` 与 `data-audit.test.ts` 的独立修改不纳入本提交。

## 交审前静态结果（2026-09-14）

- 15 个范围内路径，含 11 个 TypeScript 文件；Prettier、ESLint（无警告）通过。
- 根级 `pnpm typecheck` 通过：全部 workspace noEmit、后端边界 681 文件 / 0 违规、Research runtime / Research SDK / Factor SDK 三项生成契约一致。补充历史模型元数据断言后，受影响格式、ESLint 与 API 类型检查再次通过。
- 11 个相对 Markdown 文件链接、预告 commit message 和 diff 空白检查通过。生产源码中模型环境变量只在配置模块读取，不再有 `deepseek-chat` 默认值。
- 实际 `.env`、依赖锁、数据库、部署和无关 data-audit 文件未改动。日志：`/tmp/jixie-deepseek-typecheck.log`、`/tmp/jixie-deepseek-api-typecheck-final.log`。
- 本轮尚未运行行为测试、构建、服务或真实模型，不能将准备好的用例记为通过。用户批准代码审查后才执行上述验证；全部通过后按预告信息提交。

## 审查后验证记录

- 用户确认代码审查后，API 16 个文件 / 160 项测试全部通过，覆盖供应商协议、Agent/Profile/turn、因子问答、Research 双交接、Curator、元数据和 Strategy 路由。API 构建通过；日志为 `/tmp/jixie-deepseek-tests.log`、`/tmp/jixie-deepseek-build.log`。
- 用户要求增加展示新模型能力的复杂例子。新增手动验收脚本 `apps/api/tests/deepseek-complex-example.mjs`：真实策略 Agent 与嵌入工具、合成指数月价、隔离 SQLite、真实 Python、独立 TypeScript 数值核对；不发送私人研究、不写开发数据库。
- 首轮 3 次真实 Agent 请求中，前两次正常返回工具调用，第 3 次触及 4,096 输出 token 上限（全部为 reasoning），没有生成 Python 或计算结果。不能把这个尝试记为复杂任务成功，也不能由测试上限推断生产调用必然失败。产物及 token 用量保存在 `docs/reports/deepseek-v4-1-flash-example/`；日志 `/tmp/jixie-deepseek-live-example.log`。临时库已清理。
- 发现测试脚本的轨迹 hook 名称错误，改为实际 `onToolDone` 并按每次调用保存；初次格式检查的 8 个 curly 问题已自动修正。均为验收脚本修正，产品实现未变。增加独立输出目录防止覆盖旧失败记录，并提供显式请求/token 限额参数；更高限额尚未运行。
- 原预算剩余 2 次真实调用用于 JSON 与命名，两者均通过，返回模型均为 `deepseek-flash`，明确发送 disabled。实际每次限制 512 输出 token、60 秒、不重试；记录 `basic-requests.json`，日志 `/tmp/jixie-deepseek-basic-smoke.log`。原 5 次预算已用完。
- 用户明确指出验收上限过低，并要求按一般任务需求估算、无需过度考虑费用。演示上限调整为 10 次请求 / 单次 65,536 输出 token / 300 秒，与默认 high 思考模式的官方输出额度对齐。生产适配器仍不显式设置 max_tokens，不能把脚本限额说成产品限制。
- 第二轮模型成功生成完整分析代码（该轮生成 6,736 token），但脚本从仓库根目录启动，而本地 Python 资源按 API 工作目录解析，导致运行时启动失败。9 次模型请求后明确报告无计算结果，没有编造统计数字。保留 attempt-2 的失败与工具记录；脚本改为进入 API 工作目录，并在任何模型请求前执行 Python 协议预检。此为测试入口修正，不改变产品代码。

- 第三轮通过 Python 环境预检，但模型没有提交嵌入式运行，Agent 返回 changed=true，违反“策略代码保持不变”的验收断言。该轮失败已保留在 attempt-3；不能将模型声称“策略代码不动”当成执行事实。后续脚本额外保存完整 Agent 结果，便于核对正文、产物和计算引用。

- 第四轮在一次 Python 报错后修正同一分析并成功执行，3 份 SDK 输入留存、2 张图形产出、策略代码未改变。随后验收脚本的“只能运行一次”断言失败；这与产品允许失败后重试的契约不一致。已修正为同一分析允许失败重试、最终一次成功并冻结，保留所有失败运行；仍严格检查不改策略、输入记录、全部数值和图形。对已留存的第四轮输出独立核对 51 个数值全部一致。
- 第四轮文字解释仍有方法问题：“滚动曲线渐变”不能证明底层相关关系是渐变的，滑动窗口会把突变平滑；稳定分散也不要求相关系数始终同号；基于样本内负相关不能直接建议用作对冲腿。这些解释必须在展示中标明，不能以数值一致代替文字审查。
- 调整脚本为运行产出图形后立即导出，再做最终断言，防止验收断言失败、测试库清理时丢失已生成的图。

- 第五轮按修正后的重试断言执行：第一次因 display 不存在报错，第二次成功运行并生成图，但源代码将价格水平的 diff 当作月收益，遗漏除以前一期价格。独立数值检查正确拒绝了结果，未放宽容差或把错误结果当作有效展示。记录保留在 attempt-5；其中的图与模型结论是失败证据，不能用于展示正确统计结论。
- 进一步追查确认，runEmbeddedAnalysis 的产品工具说明确实写了 “Output with display and charts.*.”，而 Research runtime 的命名空间没有 display，只有最后一个表达式会成为表格/数值/原生图输出，新建未关闭的 Matplotlib figure 在执行末尾自动捕获。因此删除错误指引，并明确 print、最后表达式、Matplotlib 自动捕获及无 display() 的边界。该变化仅修正已有工具提示，不新增运行时能力、依赖或接口；不会自动解决价格差/收益率等模型方法错误。
- 这是审查后发现的产品提示修正，按 review-gated-development 回到 Gate 2：只做静态检查，补充审查通过前不重跑行为验证或提交。原 160 项测试和构建通过记录针对修正前的版本，不能当作该新增修正已通过行为验证。

## 补充审查范围

- 新的产品差异仅为 [runEmbeddedAnalysis 工具说明](../../apps/api/src/agent/tools/run-embedded-analysis.ts)，其余原已审查产品实现保持一致。提交信息仍为 `feat(llm): migrate defaults to DeepSeek V4.1 Flash`。
- 手动验收脚本包含真实模型、隔离库/真实 Python、环境预检、输入与图形留存、允许同一分析失败重试、独立数值核对；所有真实调用尝试均保留，没有只挑选成功记录。
- 补充审查后验证：受影响 Agent/Profile、嵌入式执行及 Python 输出回归；API 构建；同题真实示例复核与图形人工检查。若仍有模型方法错误，保留失败并明确质量限制，不以持续换随机输出代替问题定位。
- 补充交审静态结果：工具说明与手动脚本的 Prettier / ESLint、脚本语法检查、API noEmit、diff 空白与预告提交信息检查通过；28 个相关相对文档链接有效。原审查文件的哈希仅开发记录变化，新增产品差异只有工具说明；两份无关 maintenance 文件哈希保持不变。五次尝试的临时库与 Python 会话清理记录完整，进程检查无残留；额外临时 PNG 已清理。完整证据索引见 [实测报告](../reports/deepseek-v4-1-flash-example/README.md)。

## Token 预算的口径

- 单次输出额度包含思考 token 与最终正文/工具参数；输入是另一部分，多轮累计输入会重复计算之前的上下文，并可能命中缓存。不能把累计输入当作互不重复的数据量。
- 官方当前不传 max_tokens 时，非思考默认 8K、思考默认 64K、max effort 默认 128K；本次保留生产参数行为，手动复杂验收显式给 64K。
- 预算建议是工程估算，不是用量分布：简单命名/分类约数百至 2K 生成；普通思考问答约 2K–8K；查数、生成代码和解释结果整项任务可先准备 20K–60K；复杂多轮研究可准备 50K–150K。应根据实际轨迹修正，不要求模型消耗完预算，也不把 token 多视为质量高。
- 首轮请求上下文约 15K；查询多份 SDK 目录后可增加到 40K–60K 以上。复杂任务的累计输入可能高于生成 token 很多。费用宽松时仍需关注等待时间、无效重复和工具选择错误，不能仅增加额度就宣称问题已解决。

## 最终验收（2026-09-15，补充审查通过后）

- API 重新构建通过，产物包含已审查的工具说明。新增产品修正之外，其余已审查产品文件哈希未变。
- 补充相关验证共 10 个测试文件 / 94 个用例：9 个文件 / 78 项直接通过；Python session 文件在受限执行环境中首次 9 项触及默认 5 秒测试期限，放宽测试总期限后仍有 2 项受内部就绪期限影响。相同代码在与真实示例相同的宿主环境复核，16 项全部通过且无未处理错误。Python 启动从受限环境的约 7–9 秒恢复到约 0.3–0.6 秒，四槽容量用例约 1.45 秒；未修改测试断言、内部等待期限或生产运行时限制。日志：`/tmp/jixie-deepseek-supplemental-tests.log`、`/tmp/jixie-deepseek-python-recheck.log`、`/tmp/jixie-deepseek-python-host-recheck.log`。原迁移 160 项回归已通过，与这 94 项存在重叠，不相加当作独立用例数。
- 第六次真实模型尝试使用修正后的工具说明，同一道问题：6 次模型请求、21,330 生成 token（含 9,927 思考 token）、累计输入 297,539 token（其中缓存命中 249,984）、约 92.225 秒。一次 Python 运行因 84/85 行掩码不一致失败，一次错误的修订参数被工具拒绝；模型随后修复并在同一分析的第二次 Python 执行成功。全部过程保留，不记录为首次执行即成功。
- 成功运行满足：策略代码不变、版本冻结、3 份完整 SDK 响应留存、51 个未舍入数值与独立 TypeScript 参考一致、2 张真实 ResearchArtifact PNG 已导出并目视检查。滚动窗口另做独立数量/首末时间/极值/均值检查，均通过。
- 文字审查没有把统计结果一概当作推断正确。明确限定 Pearson 与 Spearman 差异、尺度不变性及体制预测能力；独立影响诊断发现去掉预先已知的合成冲击月后 A/C Pearson 从 0.45260 降至 0.09588，仅作为审查补充，不冒充模型已执行内容。原模型文字和图保持不变，第二张图的图例遮挡部分补充说明也如实记录。完整展示见 [最终复核](../reports/deepseek-v4-1-flash-example/attempt-6/review.md)。
- 结论：协议迁移与受控复杂示例可以验收；不据此宣称新模型普遍更准确，不把版本冻结当作研究方法已经审核。六次尝试及基础调用的完整记录均保留；不重跑抽样以隐藏失败。
- 临时数据库、Python 会话和测试进程均已清理。真实 `.env` 中未设置模型或思考模式覆盖，服务加载本次代码时会使用默认 deepseek-flash / enabled / high；我们没有代用户部署、重启服务或修改 .env。
