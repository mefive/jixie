# 设计:统一 Agent(对话式研究入口)

> 2026-07-06 设计,对应 `ROADMAP.md` 主线七。**2026-07-06 当日四阶段实施完成**,实况见 ROADMAP;本文保留为设计依据。方向:lab / factor / screen 三处共用**一个 agent 核心**,按场景注入 profile(prompt / 产物校验器 / 工具集);agent 获得**只读数据工具**(从「盲写」到「先查再写」),并能回复**查询卡片**;screen 页从「NL 输入框 + 结果表」降级改造为「卡片墙」。

## 一句话

一个 agent、三种目的(写策略 / 写因子 / 筛标的)+ 金融问答;它能查当前库里的数据、能在对话里回可重跑的查询卡片;卡片可钉到 screen 页复用。

## 现状盘点(2026-07-06 核实)

- **两个镜像 agent,95% 重复**:`strategy/code/agent.ts`(`agentTurn`)与 `factor/factor-agent.ts`(`factorAgentTurn`)——同样的「一次 completion → 正则抽围栏 → 编译校验 → 错误回灌修复 ≤2 轮」结构,只差 prompt 和编译器。第三个场景进来就是第三份拷贝。
- **第三个隐性入口**:`routes/factor.ts` 的 `POST /qa`(预置因子纯问答,不写代码)——其实就是「无产物 profile」的 agent。
- **screen 已是雏形**:`screen/nl-to-screen.ts` NL→ScreenSpec(白名单 JSON)→ `runScreen` 执行;`/screen/query` 一框两意图(本地 LIKE 确定性解析优先,miss 才走 LLM)。这就是「agent 回查询卡片」缺了对话外壳的版本。
- **LLM 层无工具调用**:`LlmCall = (messages) => Promise<string>`(`llm/nl-to-structured.ts`),纯文本进出;DeepSeek(openai SDK 兼容端点),支持 function calling 但本项目未用。
- **消息持久化**:`ChatMessage { role, content }`(`packages/shared/src/chat.ts`),按策略/因子存 `Strategy.messages` / `Factor.messages`(Json 列);代码不进消息(存在 strategy config / factor code 上),对话保持轻。
- **SavedScreen 已存 spec**:`model SavedScreen { spec Json }` + upsert-by-name——卡片墙的存储直接骑它,不建新表。

## 定位与边界(为什么这么设计)

- **IR 教训的分野,先说清**:策略 IR 死掉是因为策略是**程序**(图灵完备的逻辑,声明式表达不了)→ code-first 正确;但查询天生是**声明式**的(SQL 就是查询界的 IR),ScreenSpec 白名单 JSON 对卡片不是妥协而是正确形态——安全(无沙箱问题)、可渲染、可编辑、可持久化。两者不是一回事,别把「策略 IR 已删」误读成「IR 处处错」。
- **产物类型决定 profile 形态**:写策略/写因子的产物是代码(编译器把关);筛标的的产物是查询 spec(zod 白名单把关);纯问答无产物。统一核心里这是同一个「产物校验器」插槽的三种实现。
- **工具全部只读 + 白名单**:不让模型自由写 SQL——给白名单化的查询工具(内部是带行数上限的 Prisma 只读查询),沙箱边界思路与 `compileStrategy`/`compileFactor` 一致:能力由我们定义,模型只能在围栏内行动。
  **(2026-07-07 用户拍板放宽:新增 `sqlQuery`/`renderChart` 工具,对 12 张行情/财务数据表开放只读 SQL——统计聚合/时序/财务是 spec 白名单表达不了的;硬只读边界 = worker 线程里 node:sqlite readOnly 连接 + 语句守卫,应用表绝不暴露。见 ROADMAP 7.6。)**
- **问答边界 = prompt 软约束**:「只回答交易/金融相关」写进 system prompt 即可。个人工具、无对抗性用户,不上分类器硬拦截,不过度工程。
- **聊天是差的「结果货架」**:对话流里的卡片会被埋掉,而选股有强「反复看、定期跑」属性 → 生产卡片的能力归 agent,陈列和复用归页面(卡片墙),screen 页不删、改货架。
- **本期不做**:agent 自主跑回测/因子分析(`runQuickBacktest`/`runFactorAnalysis` 工具)——那是 tool loop 兑现最大价值的时刻,但依赖本设计 A/B/C 全部落地 + 长任务(Job)如何进对话流的答案,远期另说(见开放问题)。

## 设计 1:统一 agent 核心 + Profile(阶段 A)

```ts
// apps/api/src/agent/core.ts
interface AgentProfile {
  buildSystem(opts?: ProfileOpts): string; // codegen prompt + 对话模式附加段
  tools: AgentTool[]; // 阶段 A 为空数组,阶段 B 填充
  artifact?: {
    // 无产物 profile(纯问答)不给这个字段
    noun: string; // '策略' | '因子' — 修复回灌文案用
    validate(code: string): Promise<void>; // compileStrategy / compileFactor
  };
}

// agentTurn(history, message, currentArtifact, llm, profile) — 现有循环原样搬入:
// 一次调用 → 抽围栏 → 无围栏纯回答返回 / 有围栏 validate → 失败错误回灌 ≤ maxRepairs
```

- 文件布局:`apps/api/src/agent/{core.ts, tools/, profiles/strategy.ts, profiles/factor.ts, profiles/screen.ts, profiles/qa.ts}`;现有 `agent.ts` / `factor-agent.ts` 删除,路由改指向。
- **行为不变的纯重构**:现有 `agent.test.ts` / `factor-agent.test.ts` 的用例全部迁移后必须原样通过(mock LlmCall 注入,零 API key)。
- `factor /qa` 收编为 `profiles/qa.ts`(无 artifact、无 tools 的最小 profile),消灭第三份手拼 messages 的代码。

## 设计 2:只读工具调用(阶段 B,真正的跃迁)

现在 agent 是盲写:不知道库里有什么数据、覆盖到哪天,只能靠 prompt 里的静态描述。加工具后,「写个高股息策略」之前它能先查股息率覆盖与分布。

### LLM 层扩展

```ts
// llm/ 新增 AgentLlm —— LlmCall 的工具版;LlmCall 保留不动(parseStructured 等继续用)
interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema; // 尽量扁平——DeepSeek FC 不算强,别嵌套
  run(args: unknown): Promise<string>; // 返回给模型的观察结果(JSON 字符串,行数有上限)
}
type AgentLlm = (
  messages: ToolAwareMessage[],
  tools: AgentTool[],
) => Promise<{ text?: string; toolCalls?: ToolCall[] }>;
```

- 核心循环加 tool 分支:模型返回 `toolCalls` → 逐个执行 → 结果以 `role:'tool'` 消息回灌 → 再调模型;**每 turn 工具轮数硬上限 5**,超限强制要求文字收尾(防选错工具来回打转)。
- 温度保持 0;`chatText` 不动,新增 `chatTools`(同一 DeepSeek client)。

### 首批工具(3 个,克制)

| 工具 | 参数 | 内部实现 | 用途 |
|---|---|---|---|
| `searchInstruments` | `query`(名称/代码/拼音片段) | 复用 `screen/resolve.ts` 的确定性解析 | 「宁王是哪只」「有没有这只票」 |
| `dataCoverage` | `table`(白名单枚举) | 各表 min/max tradeDate + 行数(可加缓存) | 写代码前确认数据区间,别再靠 prompt 里写死 |
| `runScreen` | `spec`(ScreenSpec) | `screenSpecSchema` zod 校验 → 现有 `runScreen()` | 快照筛选/查数,也是阶段 C 卡片的生产者 |

- 约束:全只读 Prisma、每工具返回行数上限(如 50)、spec 走既有白名单校验(模型给非法字段=校验错误回灌,同修复环待遇)。
- **agent 没有任何写工具**:保存卡片、保存策略/因子都是用户在 UI 上的点击(走既有 API),不暴露给模型。写权限的边界一刀切在这里,不做"低危写工具"的灰度。
- **参数双重校验**:发给模型的 JSON schema 只是"说明书";每个工具在 `run()` 入口用 zod 再校验一遍 args(校验失败=错误观察回灌,模型自己修参数)。zod schema 与 JSON schema 同文件相邻定义,改一处看得见另一处。
- **规则:工具按需求加,不囤**(同 ROADMAP 4.2 数据扩展原则);候选池 `getFactorList` / `getStockSnapshot` 等,撞到再加。
- **退路(实测后定)**:若 DeepSeek FC 参数幻觉/选择质量不可用,退化为「JSON 协议模拟工具调用」——system prompt 约定输出 `{"tool":"…","args":{…}}`,`parseStructured` 解析执行,循环结构不变。这条退路便宜且基建现成,所以 FC 质量不构成方案风险。

### 工具循环 × 修复环的关系(定死,别让执行时自由发挥)

一个 turn 的完整生命周期,**工具阶段在前、修复阶段在后,互不嵌套**:

1. **工具阶段**:模型可连续请求工具(≤5 轮),观察逐轮回灌;
2. **产出阶段**:模型给出文字(+可选代码围栏);
3. **修复阶段**:若代码编译失败,错误回灌重试 ≤2 轮——**修复轮禁用工具**(修复 prompt 本就要求"只输出代码",给工具只会打转)。

单 turn LLM 调用硬上限 = 1 + 5(工具)+ 2(修复)= 8。工具观察(`role:'tool'` 消息)**只活在 turn 内,不持久化进 messages**——持久化的 assistant 消息只有 parts(text + card)。这保证对话历史不滚雪球,重开会话的上下文成本与今天相同。

### 可观测性:toolTrace

turn 响应里带 `toolTrace: { name, argsSummary, ok, rows?, ms }[]`(每次工具调用一条)。用途:① 前端在回复下方渲染"查了 2 次库"的折叠详情(信任感 + 调试);② 服务端 console 同步打日志。**不进消息持久化、不接策略运行的结构化日志系统**(那是 run-log 的地盘,别混)。

## 设计 3:消息 parts + 查询卡片(阶段 C)

```ts
// packages/shared/src/chat.ts
type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'card'; card: { title: string; spec: ScreenSpec } };
interface ChatMessage {
  role: 'user' | 'assistant';
  parts: MessagePart[];
}
```

- **卡片存 spec 不存结果**:重开会话重跑,数据永远新鲜;spec 可被用户在 UI 上二次编辑(改个阈值不用再跟 agent 说话)。这是卡片协议最重要的一条。
- 生产路径:agent 调 `runScreen` 工具后,该次调用的 spec 自动附为回复的 card part(模型不需要「输出卡片语法」,卡片由工具调用副产,零幻觉面)。
- **兼容迁移**:`Strategy.messages` / `Factor.messages` 是 Json 列,无 Prisma 迁移;读取时旧 `{ content: string }` 包装成 `[{ type:'text', … }]`(shared 里一个 `normalizeMessage`),写入一律新格式。
- 前端(lab/factor 的 Agent 栏已是既定 IDE 布局,改动集中在消息渲染):card part 渲染为紧凑表格(代码/名称/关键指标列),点行进 `/stock` 个股页;卡片右上「保存」→ upsert `SavedScreen`。**卡片在所有 agent 栏通用**——lab 对话里问「股息率>5% 的有哪些」同样回卡片,不是 screen 场景专属。
- **spec 失效降级**:ScreenSpec 未来会演进,持久化在消息/SavedScreen 里的旧 spec 渲染前过 `screenSpecSchema` 校验,不合法就把卡片渲染成「spec 已过期,点击编辑」态,**不崩、不静默丢弃**。
- 代码继续不进消息(现状约定保留);策略/因子代码的展示归编辑器。

### Turn API 契约(2026-07-06 SSE 落地后:两步式,流式 + 刷新续接)

> 初版设计是同步 POST 返回整包响应、前端负责持久化;加 SSE + 刷新续接后契约升级如下(仿 marginalia
> 的 streamBus/streamRun 模式),旧契约作废。

- **两步式**:surface POST(strategy/factor 带 `{id, message, code}`,screen 带 `{conversationId, message}`,
  qa 带 `{history, message}`)只做鉴权 + 注册,**立即返回 `{turnId}`**;turn 在服务端后台跑(`agent/turn-run.ts`),
  与 HTTP 请求解耦。同一实体同时只允许一个 turn(启动端点 409 语义拒绝)。
- **SSE 订阅** `GET /api/app/agent/turns/:turnId/stream`:事件协议见 `packages/shared/src/agent.ts`
  (`AgentStreamEvent`)——`snapshot`(**首帧永远是它**,服务端累计的文本+trace,重订阅者用它覆盖本地)
  → `delta` / `tool_start` / `tool_done` / `repair` → 终态 `done | error | cancelled`。`done` 携带
  parts/code/changed/toolTrace,且**保证在 assistant 消息落库之后**才发出。
- **刷新续接**:`GET /agent/turns/running?entity=strategy:ID|factor:ID|screen:ID` 发现活 turn →
  重新订阅,snapshot 补齐错过的部分。载体是单进程内存注册表(`agent/turn-bus.ts`,done 后留 60s TTL);
  **不需要 heartbeat/sweeper**——进程重启 = 注册表清空 = 发现接口返回空,以已持久化内容为准。
- **持久化职责改为服务端(turn 期间)**:runner 在 LLM 跑之前先把 user 消息 append 到宿主实体
  (刷新时必须能看到),done 前 append assistant 消息。前端不再在 turn 后回存 messages(实体创建
  payload 也不再携带首条消息);改名等非 turn 写仍归前端。qa 无宿主 → 不持久化但同样流式。
- **取消**:`POST /agent/turns/:id/cancel` 幂等触发上游 abort(修复轮间也检查 signal);cancelled 不落
  assistant 消息——只有 user 消息的记录就是诚实的记录。
- **修复轮不发 delta**(输出是纯代码,流给聊天气泡是噪音),改发 `repair` 事件公告重试;前端 pending
  气泡遇到围栏只显示围栏前文本 + 「正在写代码…」。

## 设计 4:screen 页 → 卡片墙(阶段 D)

- **NL 入口收编进 agent**:screen 页的自然语言框去掉,入口统一为 agent 对话(screen profile:无代码产物、带 `runScreen`/`searchInstruments` 工具);`/screen/query` 的**确定性 LIKE 解析保留**(它不依赖 LLM、零幻觉,降级为 agent 前置或 `searchInstruments` 工具内核)。
- **screen 对话的载体(2026-07-06 用户拍定:持久化、多会话)**:筛选对话本身值得回看——筛选思路(怎么一步步收窄条件)是研究过程的一部分,不只卡片是资产。lab/factor 的会话挂宿主实体(Strategy/Factor),筛选对话没有宿主 → 建一张最小会话表 `ScreenConversation`(见 Schema 节),一行=一个会话,messages 与 Strategy.messages 同款 Json(parts 格式)。
  - **页面形态:一面墙、两种卡片(2026-07-06 用户提出,采纳)**。screen 页主体就是卡片墙,墙上混排两类卡片:**查询卡片**(SavedScreen:标题 + spec 摘要,点开=重跑出结果表格、可编辑 spec)和**会话卡片**(ScreenConversation:标题 + 最后一条消息摘要 + 内含卡片数,点开=展开对话面板继续聊)。「新对话」是墙上的常驻入口。不再需要左侧会话列表——墙即列表,一个页面一个心智模型:你产出过的东西都在墙上。
  - **展示统一 ≠ 存储统一(定死)**:两类卡片仍是两张表(SavedScreen 存 spec、ScreenConversation 存 messages)——资产类型和生命周期不同,别为"都叫卡片"合成一张表。卡片只是墙上一格的渲染概念。
  - **视觉必须可区分**:两类卡片点击行为完全不同(重跑结果 vs 继续对话),样式/图标/角标要一眼分清;墙顶给类型筛选(全部 / 查询 / 会话),默认按更新时间混排。
  - 会话标题默认取首条用户消息截断,可手动改名(不上 LLM 起名,够用)。
  - 持久化职责同 lab/factor:**前端 append 后存回**(`PATCH /conversations/:id { messages }`),turn 接口保持无状态。
  - **卡片与会话解耦(定死)**:保存到 SavedScreen 的查询卡片不带会话外键,删会话不影响已保存卡片;消息里的 card part 随会话存亡。查询卡片是独立资产,会话是它的出生地而非户口。
- `screen/nl-to-screen.ts` + `nl-prompt.ts` 的知识(字段白名单/单位约定/lookup 规则)并入 screen profile 的 system prompt 与 `runScreen` 工具描述,旧文件删除。
- screen 页改为**卡片墙**:陈列 `SavedScreen`(名称 + spec 摘要),点开重跑出表格/图,可编辑 spec 再存;agent 对话里保存的卡片落到这里。页面价值 = 「反复看、定期跑」的货架,与对话互补。
- `runScreen` 执行器、`/screen`(POST spec)、个股 series 等确定性 API 全部不动。

## 分阶段落地(每步独立可用、可验收)

| 阶段 | 内容 | 验收 |
|---|---|---|
| A 统一核心 | 合并两 agent + /qa 成 `agent/core.ts` + 4 个 profile;纯重构 | 现有 agent 测试全部迁移后通过;lab/factor 前端零改动、行为无差异 |
| B 工具调用 | `AgentLlm` + tool 循环(轮数 ≤5)+ 首批 3 工具,接入 strategy/factor/qa profile | mock 测试:模型请求工具 → 观察回灌 → 终答;真实冒烟:「库里股息率数据到哪天」能查库答对,而不是编造 |
| C 卡片协议 | MessagePart + card 渲染 + 保存到 SavedScreen;旧消息兼容读 | 对话「筛出 PE<15 高股息」→ 回复带可点击卡片 → 重开会话卡片重跑 → 保存后 SavedScreen 可见;旧会话正常显示 |
| D screen 收编 | screen 页改「一面墙两种卡片」(查询卡片 + 会话卡片),NL 框下线,nl-to-screen 删除,新增 ScreenConversation 表 | 原 NL 用例(选股/点名股票)在 agent 对话中等效完成;查询卡片重跑/编辑/删除跑通;会话卡片回看续聊、改名删除跑通;删会话不影响已保存查询卡片;按前端 e2e 硬规矩截图 |

- A 是零风险纯重构,**随时可做,建议尽早**(第三个 agent 场景出现前完成,止住拷贝增殖)。
- B/C/D 依次依赖;C 依赖 B(卡片由 runScreen 工具调用副产)。
- 每阶段收尾跑 Playwright e2e + 截图(前端硬规矩);vitest 单测全程 mock LlmCall/AgentLlm,不依赖真实 key。B 阶段的 mock 要能脚本化多轮序列(工具请求 → 观察 → 终答),给核心循环的每条分支(轮数超限 / 参数校验失败回灌 / 工具后编译修复)各一个用例。

## 执行纪律(给实施会话)

- **一次认领一个阶段**,以该阶段验收标准收尾,完成后更新 ROADMAP 主线七状态并附一句实况(ROADMAP 使用原则 7:不自行扩 scope,扩出去的部分没人设计过)。
- 本文「定死」的决策(工具阶段在前修复在后、观察不持久化、agent 无写工具、卡片墙"展示统一存储分离"、查询卡片与会话解耦、turn 期间服务端持久化消息 / 非 turn 写归前端)是**边界不是建议**;实现中发现定错了,停下来找用户讨论,不要就地绕。(注:「前端持久化会话」原为定死项,2026-07-06 因 SSE 刷新续接需要 turn 与请求解耦而**由用户升级取代**——先例:定死项的变更走用户拍板,不是执行时自行绕。)
- 改 `packages/shared` 后记得 `pnpm --filter @jixie/shared build`;收尾跑 prettier。
- 与 **ROADMAP 4.4(SDK 单一来源)** 无依赖但同域:profiles 消费 `buildCodegenPrompt` / `buildFactorCodegenPrompt`,4.4 若先落地,prompt 变成生成物,profile 接口不受影响。

## Schema / 类型变更汇总

- **Prisma:仅一张新表**(阶段 D;其余零迁移——messages 本就是 Json,卡片墙骑现有 SavedScreen):

```prisma
/// screen 场景的 agent 会话。lab/factor 的会话挂在宿主实体上(Strategy.messages / Factor.messages),
/// 筛选对话没有宿主,单独成表;卡片(SavedScreen)与会话解耦,删会话不影响已保存卡片。
model ScreenConversation {
  id        String   @id // ULID
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String // 默认首条用户消息截断,可改名
  messages  Json // ChatMessage[](parts 格式)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, updatedAt])
}
```
- shared:`chat.ts` 的 ChatMessage 升级 parts(带 normalize 兼容读);`ScreenSpec` 已在 shared,card 直接引用。
- 改完 shared 记得 `pnpm --filter @jixie/shared build`。

## 开放问题(实现时再定,不阻塞)

- ~~**流式与中间态**~~:✅ 2026-07-06 已落地(SSE + 刷新续接,见「Turn API 契约」节;用户拉动,仿 marginalia)。
- **DeepSeek FC 实测质量**:B 阶段第一件事拿 3 个工具跑真实冒烟,不行走 JSON 协议退路(设计 2 已备)。
- **远期工具**:`runFactorAnalysis` / `runQuickBacktest` 让 agent「写完自己跑、看 IC/回撤、自己改」——依赖长任务(Job/worker)进对话流的形态(轮询?turn 挂起?),届时另出设计,本期只保证 tool 插槽形状容得下异步工具。
- 卡片是否要扩展 chart 类型(如筛选结果的市值分布图)——先只做表格,图表等真实使用拉动。
