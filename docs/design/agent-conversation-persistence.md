# 设计：Agent 主导开发的会话、消息与执行轨迹

> 2026-07-11 方案稿，落地前评审用。本文由产品定位变化触发：Strategy / Factor / Screen
> 不再只是“业务页面附带一个聊天框”，而是由 Agent 主导研究与开发的三个 surface。本文一旦实施，
> 将取代 `docs/design/unified-agent.md` 中“消息挂宿主 JSON”“工具观察不持久化”“toolTrace 仅用于
> 临时展示”的旧边界；统一 Agent 的 profile / tool / artifact 分层仍然保留。

## 一句话

建立公共的 `AgentConversation → AgentMessage / AgentTurn` 持久化层：三个 surface 共用会话生命周期、
消息分页、turn 状态和 trace 回放，但继续使用各自独立的 profile、工具集和 artifact 处理；每次模型调用的
推理、工具参数、工具返回、代码校验与最终输出都按真实执行顺序记录。

## 背景与问题

当前会话是宿主实体上的一个 JSON 数组：

- `Strategy.messages Json?`
- `Factor.messages Json?`
- `ScreenConversation.messages Json`

`ChatMessage` 只有 `role + parts`；`parts` 可包含文字、查询卡片和图表。每轮 turn 开始前，服务端读取
整个数组、追加 user message 后整体覆盖；turn 完成后再追加 assistant message 并整体覆盖。

这套设计适合轻量聊天，但不再符合 Agent 主导开发：

1. 消息上限 60 条，不能分页；每次写入都覆盖完整数组，并发与长期增长都不友好。
2. message 没有稳定 ID，无法精确重试、分支、引用、关联代码版本或关联执行过程。
3. `turnId` 不进持久化消息，回答与产生它的 turn 无法在刷新后关联。
4. 工具完整参数和 `observation` 只活在本轮 LLM 上下文；完成后丢失。
5. 当前 `toolTrace` 只保存截断参数、成功状态、行数和耗时，并只经 SSE 到前端；刷新后丢失。
6. 没有持久化 reasoning、模型调用边界、repair、validation、错误与取消状态。
7. in-memory turn bus 支持断线重订阅，但 API 进程重启后无法恢复 turn 状态或解释未完成原因。
8. Screen 已有 `ScreenConversation`，Strategy / Factor 则把消息挂在业务实体上，同一概念存在两种存法。

## 目标

- 一条消息一行，支持稳定 ID、游标分页、长期增长和精确关联。
- 一次 Agent 执行对应一个持久化 turn，状态可查询、刷新后可回放。
- 持久化模型实际返回的 reasoning（provider 支持时），不伪造“思考过程”。
- 持久化模型调用、工具调用、完整工具返回、代码验证、repair 和终态，保持真实顺序。
- Strategy / Factor / Screen 共用基础设施，但业务 Agent 行为保持独立。
- 用户可从 assistant message 打开产生该回答的 trace。
- 保留现有卡片/图表 part 的行为；查询卡片仍存 spec，不存每次重跑后的结果。
- 支持从现有 JSON messages 无损迁移，并可分阶段切换、回滚。

## 非目标

- 本期不实现完整的 Git 式代码版本树；只预留 message / turn 与未来 code version 的关联位置。
- 本期不实现多用户共同编辑同一会话。
- 本期不让 Agent 获得新的写工具；工具权限边界维持现状。
- 本期不把 `MessagePart` 拆成表。parts 是一条消息的原子渲染载荷，继续存 JSON。
- 本期不为 trace 建逐事件子表。trace 通常按 turn 整体读取，先以有序 JSON 保存。
- 不承诺所有模型都能提供 reasoning；没有 provider 原始字段时只展示执行 trace。

## 核心边界：公共持久化，独立 Agent 行为

公共层负责：

- Conversation 创建、改名、列表、归档和权限；
- Message 排序、分页和持久化；
- Turn 状态、SSE、取消、错误和 trace；
- 上下文装配、消息截取与未来压缩；
- trace 查询、过滤和回放。

surface 层继续负责：

| Surface | Profile / 工具 | Artifact | turn 完成后的业务动作 |
|---|---|---|---|
| Strategy | `strategyProfile` + 只读数据工具 | 策略 TS 代码 + 编译验证 | 更新编辑器工作态；运行时再提交 config |
| Factor | `factorProfile` + 只读数据工具 | 因子 TS 代码 + 编译验证 | 刷新 factor metadata |
| Screen | `screenProfile` + 查询/图表工具 | 无代码 artifact | 生成查询卡片、图表和研究回答 |

统一的是“如何记录和回放”，不是“如何思考和工作”。

## 数据模型

### AgentConversation

Conversation 是公共模型。Screen 的会话本身就是工作空间；Strategy / Factor 会话关联各自业务实体。

```prisma
enum AgentSurface {
  STRATEGY
  FACTOR
  SCREEN
}

model AgentConversation {
  id         String       @id // ULID
  userId     String
  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  surface    AgentSurface
  title      String?

  strategyId String?
  strategy   Strategy?    @relation(fields: [strategyId], references: [id], onDelete: Cascade)

  factorId   String?
  factor     Factor?      @relation(fields: [factorId], references: [id], onDelete: Cascade)

  messages   AgentMessage[]
  turns      AgentTurn[]

  archivedAt DateTime?
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  @@index([userId, updatedAt])
  @@index([userId, surface, updatedAt])
  @@index([strategyId])
  @@index([factorId])
}
```

约束由应用层在创建时保证：

- `STRATEGY`：必须有 `strategyId`，不得有 `factorId`；
- `FACTOR`：必须有 `factorId`，不得有 `strategyId`；
- `SCREEN`：两个外键都为空；
- 关联实体必须属于同一个 `userId`；内置 factor 的临时 Q&A 见后文。

不在 `strategyId` / `factorId` 上加 `@unique`。Agent 主导开发需要容纳“新开一段讨论”“换一条思路”
和未来的分支；一个 Strategy / Factor 可以拥有多个 conversation。默认打开最近更新且未归档的会话。

### AgentMessage

```prisma
enum AgentMessageRole {
  USER
  ASSISTANT
  SYSTEM
}

model AgentMessage {
  id             String           @id // ULID
  conversationId String
  conversation   AgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           AgentMessageRole
  parts          Json             // MessagePart[]; text/card/chart
  sequence       Int

  turnId         String?
  turn           AgentTurn?       @relation(fields: [turnId], references: [id], onDelete: SetNull)

  createdAt      DateTime         @default(now())

  @@unique([conversationId, sequence])
  @@index([conversationId, createdAt])
  @@index([turnId])
}
```

说明：

- `sequence` 是 conversation 内的稳定顺序，不依赖时间戳排序。
- user message 和 assistant message 都关联同一个 `turnId`，便于从任一侧打开执行记录。
- `SYSTEM` 只用于产品可见的系统事件（例如“API 重启导致 turn 中断”），不是把完整 system prompt
  混进聊天历史。首期若无 UI 需求可不创建 SYSTEM message，但枚举保留会导致提前抽象，因此实施时也可
  先只定义 USER / ASSISTANT，真实需求出现再扩。
- `parts` 继续使用 shared 的 `MessagePart[]`。不把 text/card/chart 拆表。
- assistant 最终回答只保存用户可见内容，不复制 reasoning 和工具结果。

### AgentTurn

```prisma
enum AgentTurnStatus {
  RUNNING
  DONE
  ERROR
  CANCELLED
  INTERRUPTED
}

model AgentTurn {
  id                 String            @id // existing turnId (ULID)
  conversationId     String
  conversation       AgentConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  status             AgentTurnStatus
  model              String
  trace              Json              // AgentTraceStep[], ordered and immutable after finish
  error              String?
  inputMessageId     String?           @unique
  outputMessageId    String?           @unique
  startedAt          DateTime          @default(now())
  finishedAt         DateTime?

  messages           AgentMessage[]

  @@index([conversationId, startedAt])
  @@index([status, startedAt])
}
```

Prisma 对 `AgentMessage.turnId` 加 `AgentTurn.inputMessageId/outputMessageId` 会形成冗余和关系定义复杂度。
实施时二选一：

1. **推荐首期**：仅保留 `AgentMessage.turnId`，通过 role 找输入/输出消息；
2. 若未来一个 turn 会产生多个 assistant/system message，再在 `AgentTurn` 增加显式 message ID。

首期不应同时维护两套关联真相。

### Strategy / Factor / Screen 的变化

- `Strategy.messages` 与 `Factor.messages` 在迁移完成后删除，改为 `conversations` relation。
- 现有 `ScreenConversation` 被 `AgentConversation(surface=SCREEN)` 取代，不再保留平行会话表。
- `SavedScreen` 继续独立；保存的查询卡片不强制关联 conversation，删除会话不删除已保存查询。
- Strategy config、Factor code 仍在各自业务表；消息只记录当时的回答，不复制当前代码。

## Trace 协议

### 设计原则

- trace 只记录真实发生的事件，不从最终回答反推 reasoning。
- provider 返回 `reasoning_content` 才记录 reasoning；否则 trace 从 model call / tool call 开始。
- 工具参数与工具返回保存“实际送入工具”和“实际回灌模型”的内容。
- 每个 step 有稳定 ID、序号、模型调用轮次和时间信息。
- reasoning 流在内存中按 model call 聚合，避免逐 token 写数据库。
- turn 完成后 trace 视为不可变审计记录；只允许补写脱敏/保留策略元数据，不原地改语义。

### Shared 类型草案

```ts
interface AgentTurnTrace {
  version: 1;
  steps: AgentTraceStep[];
  truncated: boolean;
}

type AgentTraceStep =
  | {
      id: string;
      sequence: number;
      type: 'model_start';
      modelCall: number;
      model: string;
      toolsEnabled: string[];
      startedAt: string;
    }
  | {
      id: string;
      sequence: number;
      type: 'reasoning';
      modelCall: number;
      content: string;
      startedAt: string;
      finishedAt: string;
      truncated?: boolean;
    }
  | {
      id: string;
      sequence: number;
      type: 'tool';
      modelCall: number;
      toolCallId: string;
      name: string;
      arguments: unknown;
      observation: string;
      ok: boolean;
      rows?: number;
      durationMs: number;
      startedAt: string;
      finishedAt: string;
      truncated?: { arguments?: boolean; observation?: boolean };
    }
  | {
      id: string;
      sequence: number;
      type: 'assistant_output';
      modelCall: number;
      content: string;
      startedAt: string;
      finishedAt: string;
      truncated?: boolean;
    }
  | {
      id: string;
      sequence: number;
      type: 'validation';
      round: number;
      ok: boolean;
      error?: string;
      durationMs: number;
      createdAt: string;
    }
  | {
      id: string;
      sequence: number;
      type: 'error' | 'cancelled';
      message?: string;
      createdAt: string;
    };
```

工具结果目前是字符串 `observation`，首期原样保存最诚实：它就是模型真正看到的内容。可选的结构化
`resultJson` 等真实需求出现后再加，避免两种结果表示漂移。

### 推理模型兼容

当前默认 `deepseek-chat`，LLM adapter 只读取 `delta.content` 和 `delta.tool_calls`。要记录推理必须：

1. 为 Agent 路径单独配置支持 reasoning 的模型；普通命名和 JSON 提取不必一起切换。
2. adapter 读取 provider 的 `reasoning_content` 流并触发 `onReasoningDelta`。
3. 验证 reasoning model 与 function calling、tool observation 回传、repair round 的兼容格式。
4. 若连续工具轮要求回传上一轮 reasoning，adapter 必须按 provider 协议保存并重放，不能只改 SSE。
5. provider 不返回 reasoning 时，UI 明确显示“该模型未提供推理记录”，不显示空白伪思考。

模型切换和 trace 存储是两个独立能力：可以先落地完整工具/验证 trace，再启用 reasoning model。

## Turn 生命周期与一致性

一次 turn 的事务边界如下：

1. 校验 conversation 所属用户及 surface。
2. 事务内分配下一个 `sequence`，创建 USER message 与 RUNNING AgentTurn，并互相关联。
3. 返回 `turnId`，后台执行；turn bus 负责实时 SSE，数据库是持久化真相源。
4. 每个 model/tool/validation 阶段先积累到内存 trace，并按检查点更新 `AgentTurn.trace`。
5. 成功时，事务内创建 ASSISTANT message、把 turn 更新为 DONE 并写入最终 trace/finishedAt。
6. error/cancel 时更新 turn 终态；不伪造 assistant 回答。
7. API 启动时，把遗留 RUNNING 且不可能继续执行的 turn 标为 INTERRUPTED。

### Trace 写入策略

不能逐 token 更新 SQLite。推荐检查点：

- model call 完成（reasoning + assistant output 聚合后）；
- 每个工具执行完成；
- 每个 validation / repair 完成；
- turn 终态。

SSE 仍实时发 token；刷新重连时：

- turn 仍在当前进程：先发 turn bus snapshot，再继续实时事件；
- turn 已完成或进程重启：从数据库读取 messages + persisted trace；
- 遗留 RUNNING：启动恢复逻辑标记 INTERRUPTED，用户可以重试。

### 顺序与并发

当前“同一实体只允许一个 turn”改为“同一 conversation 只允许一个 RUNNING turn”。不同 conversation
可以并行。创建 message 时的 `sequence` 必须在事务中计算和写入，并依赖
`@@unique([conversationId, sequence])` 防止竞态；冲突时有限次重试。

## 上下文装配

消息改表后不能无限把全部历史发给模型。首期行为保持与现在接近，但把“数据库可保存多少”和“模型每次
吃多少上下文”分离：

- 数据库不设置 60 条硬上限；
- API 以最近 N 条/估算 token budget 装配上下文；
- card/chart 仍通过 `messageText()` 压成短占位，不重发 spec 和结果；
- trace 默认不进入后续 LLM 上下文，除非重试当前 turn 时明确重放必要的 tool messages；
- 达到真实上下文压力后再设计 conversation summary，不在本期提前实现。

## API 草案

公共 conversation API：

```text
POST   /api/app/agent/conversations
GET    /api/app/agent/conversations?surface=&entityId=&cursor=
GET    /api/app/agent/conversations/:id
POST   /api/app/agent/conversations/:id
DELETE /api/app/agent/conversations/:id

GET    /api/app/agent/conversations/:id/messages?before=&limit=
GET    /api/app/agent/turns/:turnId
GET    /api/app/agent/turns/:turnId/trace
GET    /api/app/agent/turns/:turnId/stream
POST   /api/app/agent/turns/:turnId/cancel
```

启动 turn 仍保留 surface 路由，因为各自入参和业务校验不同：

```text
POST /api/app/strategy/agent { conversationId, message, code }
POST /api/app/factor/agent   { conversationId, message, code }
POST /api/app/screen/agent   { conversationId, message }
```

公共路由不负责选择 profile；surface 路由验证 conversation.surface 与业务实体匹配后再 enqueue。

分页建议使用 `(sequence, id)` 游标，默认倒序取最近一页、返回前端后再按 sequence 正序渲染。不要使用
offset 分页长期会话。

## 前端体验

- Trace UI 默认采用 Ant Design X 的原子组件，而不是自建时间线：`ThoughtChain` 负责模型调用、工具、
  validation、repair 与终态的有序调用链，`Think` 负责单段 provider reasoning 的加载、完成和折叠状态。
- 项目只引入 `@ant-design/x` UI 包；不采用 X SDK 的 `useXChat` / Provider 重写现有 MobX、SSE 和
  服务端持久化。数据库 DTO 与 `AgentTraceStep` 是事实来源，通过纯适配层转换成
  `ThoughtChainItemType[]`，组件库类型不得反向进入 shared 或数据库模型。
- reasoning 节点的 `content` 内嵌 `Think`；工具节点把 running/success/error/cancel 映射为
  `loading/success/error/abort`，参数与 observation 仍由项目自己的 JSON/Markdown 详情组件渲染，
  以支持截断提示、复制、脱敏和超长内容控制。
- 现有 `@ant-design/x-markdown` 继续负责 reasoning、observation 和最终回答的 Markdown；不重复引入
  第二套 Markdown renderer。
- 聊天默认只加载最近一页；向上滚动加载更早消息。
- USER / ASSISTANT message 以稳定 `message.id` 为 React key。
- assistant message 有 `turnId` 时显示“执行记录”入口。
- turn 运行期间，现有 pending bubble 展示实时 reasoning / tool / validation；完成后同一 UI 切到数据库 trace。
- Trace 面板默认折叠，按真实 sequence 展示：
  `Model reasoning → Tool arguments → Tool observation → Next reasoning → Validation → Final output`。
- 工具参数与 observation 使用代码块/JSON viewer；超限内容明确标记“已截断”，不能静默省略。
- reasoning 与最终回答在视觉上区分，标注“模型推理记录”；没有 reasoning 时仍可展示完整执行轨迹。
- Strategy / Factor 可显示多个 conversation；首期可只默认打开最近一个，把“新会话/历史会话”入口做小，
  但数据模型不封死一对一。
- Screen 卡片墙继续把 `surface=SCREEN` 的 conversation 当会话卡片展示。

引入前做一个小型 UI spike，验收窄侧栏密度、超长 observation 折叠性能、reasoning streaming 重排、
中英文 locale、墨黑主题和 tree-shaking 后 bundle 增量。若 `ThoughtChain` 在窄面板实测不可用，只替换
view adapter / renderer，不改 trace 协议和持久化层。

## 数据量、截断与安全

### 建议上限

上限是防御性存储预算，不是聊天条数上限：

- 单条 user 输入：沿用 2,000 字符，后续按真实需求调整；
- 单个 message parts JSON：建议 256 KiB；
- 单个工具 arguments：建议 64 KiB；
- 单个工具 observation：建议 256 KiB；
- 单个 turn trace：建议 2 MiB；
- 超限时保存头尾、原始字节数和 `truncated=true`，同时保证模型实际看到的 observation 与 trace 记录一致。

具体数字在实施时用真实 `sqlQuery` / `analyzeData` / chart 工具结果采样后确认，不应未经测量直接定死。

### 脱敏

- 不记录 API key、Cookie、Authorization header、数据库连接串和环境变量。
- trace recorder 只能接收 Agent 层已经定义的工具参数/observation，不允许通用 HTTP logger 整包灌入。
- 工具若未来接触用户私有数据，需要在 tool 定义旁声明 trace policy（完整、字段脱敏或不记录）。
- trace 查询必须校验 `AgentTurn → Conversation.userId`，不能只凭 turnId 返回。
- 删除 conversation 级联删除 message 和 turn；SavedScreen 等独立资产不受影响。

## 内置 Factor Q&A

当前 `/factor/qa` 无宿主、history 随请求传入、完全不持久化。新定位下有两个选择：

1. **推荐统一**：为用户与某个内置 factor 创建 `surface=FACTOR` conversation，但现有 `factorId`
   不能直接外键到用户不拥有的 builtin row；新增可空 `contextKey`（如 `builtin-factor:ep`），或单独设计
   conversation context。
2. 保持 ephemeral：不创建 conversation/message/turn 持久化，只用于一次性问答。

首期迁移可保持 ephemeral，避免让 builtin 所有权模型阻塞主线；但此路径不会拥有可回放 trace，UI 必须明确。
若产品要求所有 Agent 行为均可审计，则实施前必须先拍定统一方案，不能静默例外。

## 迁移方案

迁移必须由 Prisma 生成 migration，历史 migration 不修改。分四阶段，每阶段可独立验证和回滚应用代码。

### 阶段 1：新表 + 类型，不切读写

- 新增 `AgentConversation`、`AgentMessage`、`AgentTurn`。
- 新增 shared message/trace DTO 与 API 校验。
- 现有 JSON 路径继续工作。
- 验证 migration、Prisma client、空表部署和权限查询。

### 阶段 2：历史回填 + 双写

- 为每个有 messages 的 Strategy / Factor 创建一个 conversation。
- 把现有 `ScreenConversation` 一行迁成一个 `surface=SCREEN` conversation。
- 按数组顺序生成 message ULID 与 sequence。
- 历史 assistant message 没有 turnId：保留 `turnId=null`，不伪造 trace。
- 新 turn 同时写新表和旧 JSON；读取仍以旧路径为主，后台对比两边消息数量和内容 hash。
- 回填脚本幂等：以宿主 ID 映射或 migration marker 防重复创建。

### 阶段 3：切读 + trace 落库

- 前端改用 conversation/message 分页 API。
- turn runner 以新表为主写，开始持久化 trace。
- SSE snapshot 与数据库终态对齐；验证刷新、取消、错误、进程重启。
- 保留旧 JSON 双写一个发布周期作为回滚来源。

### 阶段 4：停止双写 + 清理旧结构

- 先停止旧 JSON 写入并观察。
- 备份数据库，运行一致性审计。
- 新 migration 删除 `Strategy.messages`、`Factor.messages` 和 `ScreenConversation`。
- 删除旧 CRUD、normalize legacy 写路径和前端 `as ChatMessage` 注入 toolTrace 的临时代码。

小规模个人数据库也不建议跳过阶段 2/3：这里的风险不是数据量，而是三套 surface 行为与刷新续接容易漏分支。

## 测试与验收

### 数据层

- 三种 surface 创建 conversation 的外键/XOR/owner 校验。
- message sequence 并发冲突与稳定分页。
- conversation 删除级联 message/turn，不删除 SavedScreen。
- 历史 JSON 回填幂等，parts/card/chart 无损。

### Agent 核心

- 一轮无工具问答：USER → model trace → ASSISTANT → DONE。
- 多轮工具：reasoning → tool arguments → observation → reasoning → final output 顺序准确。
- 工具失败、参数校验失败、轮数上限均保留真实 observation。
- 策略/因子 compile 失败和 repair 每轮 validation 可回放。
- cancel/error 不创建伪 assistant message，turn 终态正确。
- provider 不提供 reasoning 时 trace 仍完整且 UI 不伪造。
- trace 截断后模型所见内容与落库 observation 一致。

### 恢复与前端

- SSE 中途刷新可续接；完成后刷新从数据库读取相同 trace。
- API 进程重启后遗留 RUNNING 变 INTERRUPTED。
- 消息游标分页无重复、无缺失，最新消息锚点稳定。
- Strategy / Factor 多 conversation 隔离；Screen 会话卡片列表和改名/删除正常。
- trace 权限越权返回 404/forbidden，不泄露 turn 是否存在。

## 分阶段工作量与顺序

| 阶段 | 内容 | 依赖 | 建议验收点 |
|---|---|---|---|
| A | schema、shared 类型、conversation/message CRUD、历史回填 | 无 | 三类旧消息完整映射 |
| B | turn runner 改新表、trace recorder、终态恢复 | A | 工具与 validation trace 刷新后存在 |
| C | 前端分页会话与 Trace 面板 | B | 三个 surface 端到端回放 |
| D | reasoning model adapter 与真实兼容冒烟 | B，可与 C 并行 | reasoning + tool loop + repair 均正常 |
| E | 停止双写、删除旧 JSON/ScreenConversation | A–D 稳定一个发布周期 | 一致性审计通过 |

不要把 schema 迁移、三个 surface 切换、reasoning 模型切换和旧字段删除塞进同一个不可回滚发布。

## 已定决策

- Conversation / Message / Turn 是公共 Agent 基础设施。
- Strategy / Factor / Screen 的 profile、工具和 artifact 行为继续独立。
- message 拆表；MessagePart 暂不拆表。
- trace 进入独立 AgentTurn；暂不建逐 step 子表。
- Trace UI 默认使用 Ant Design X `ThoughtChain + Think`，但数据流继续由项目的 MobX/SSE 驱动。
- ScreenConversation 最终并入公共 AgentConversation。
- 一个 Strategy / Factor 允许多个 conversation。
- 历史消息没有 trace 就保持没有，不补造。
- reasoning 只记录 provider 原始输出；执行 trace 不等同于 reasoning。
- 数据库保存期限与 LLM 上下文窗口分离，不再用 60 条上限混为一谈。

## 落地前仍需拍定

1. 内置 Factor Q&A 是否也必须持久化、可审计；若是，conversation context 如何表达 builtin factor。
2. trace 保留期限：随 conversation 永久保存，还是允许用户/系统按时间清理。
3. 工具 observation 和 turn trace 的实测大小上限。
4. reasoning 模型与现有 DeepSeek function calling 的真实兼容性；若不兼容，是换 provider/model，还是先只上线执行 trace。
5. 首期 UI 是否暴露“新会话/历史会话”，还是先只提供最近会话但保留多会话数据模型。
