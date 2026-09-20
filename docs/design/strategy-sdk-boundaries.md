# Strategy SDK 与 Engine 职责分离

本项是 [业务 SDK 与运行时统一组织计划](business-sdk-organization.md) 的第一个提交；Factor / Research 的后续整理见整体计划。

提交信息：`refactor(strategy): separate SDK contracts from engine internals`。

## 目标与边界

Strategy 管理和执行决策程序，Engine 管理模拟环境。公开 SDK 定义用户如何声明和表达决策；
Engine 定义时间、PIT 数据、因子准备、订单和账户如何演进。保留一套 TS Engine 服务 TS/Python
回测、扫描与 Signals，不引入新的 package、服务或交易执行系统。

## 交付

- 将 `packages/shared/src/sdk-reference.ts` 移至 `sdk/strategy/reference.ts`，保留根级现有具名导出。
  复用既有 `buildSdkDts` 的签名渲染器生成 `contract.ts`，不再手写第二份 StrategyCtx。
  使用现有 `setup:sandbox` 写入/检查第四份生成物，生成过程不依赖 Engine、数据库或 shared dist。
- 编译契约从 shared 的 `./sdk/*` 子路径做类型导入，不改变 npm workspace 依赖或 TS 构建顺序。
  contract 的 FactorKey 为运行时可解析字符串；Monaco 仍按用户可见因子生成收敛的 key union。
- SDK 辅助实现与测试归 `strategy/sdk`。Universe / TimeframeSeries 实现公开接口；`enrich` 的返回值
  检查基础方法及 helper 的完整签名。只有通过 defineProperty 增加的 params 属性需要局部断言。
- Engine 内部类型改名 `EngineStrategy`、`EngineContext`、`EngineAccounts`，同步所有消费者。
  SDK 公开类型不继承这些内部类型；内部行情附加字段仍留在 Engine，避免把实现细节升为用户契约。
- Python `Strategy`、`Context`、Universe 与指标实现移到 `strategy/sdk/python.py`；
  `strategy/runtime/python/runner.py` 负责加载用户代码、元数据、每个 bar 的请求编号、帧协议及请求期间暂停超时。
  sandboxd 的通用 runner 保留帧、日志、计时和业务分派；容器按仓库相对目录显式复制两个业务模块，
  本地与容器通过同一 namespace package 路径导入，Python 仍由沙箱执行。

SDK 辅助逻辑、公开签名、HTTP、数据库、撮合与因子数值算法、语言产品准入均保持现有语义。
Factor / Research 的契约来源和生成物保持原样。没有新增可部署 workspace；沙箱镜像新增 Strategy Python 源码输入，因此构建上下文改为仓库根，
根 `.dockerignore` 只允许明确的 Python 文件、依赖清单和 Dockerfile。同步 component-impact 清单，
部署分类支持同一路径匹配多个组件；这两个业务 Python 文件同时选择 API/sandboxd，其余 Strategy TS
文件仍只选择 API。bootstrap 及部署计划测试一起更新。

## 验收

状态：修订版已获人工代码审查批准；2026-09-20 完成下列行为验证，随本提交交付。

审查前：全仓 typecheck（包含只读 SDK 生成物检查与后端边界扫描）、改动 TS 的 ESLint/Prettier、
Python AST 语法检查、路径引用与 diff 检查。生成文件由渲染器控制格式，禁止格式化后与生成器分叉。

审查后：SDK、共享 bridge、TS/Python runtime、相关 Engine、源码/编译 Worker 与 sandbox bundle
回归；新增 Python 打包测试只复制 Dockerfile 中实际发布的模块，用 `-I` runner 执行策略、数据请求和订单。
运行 setup / deployment plan / bootstrap 脚本回归及相关构建，验收 sdk-hover / strategy-python E2E，展示截图并清理临时服务。

静态检查与实际验证结果在执行后补充，未执行项不记为通过。

### 修订版审查前静态结果

- `pnpm typecheck` 通过：shared、api、docs、sandboxd、web 全部通过；生成物一致性通过。
- 后端静态边界扫描通过：781 个文件，0 违规；沿用 3 条已登记的纯契约例外，无新增循环例外。
- 所有改动 TS/TSX 文件（含新生成契约）的 ESLint 通过，手工维护的改动 TS/JSON 的 Prettier 检查通过。
- 三份改动 Python 文件仅做 AST 语法解析，全部通过；没有执行应用模块。
- 修改的部署脚本和回归用例通过 ESLint / Prettier；`bash -n scripts/bootstrap.sh` 通过。
- Dockerfile 全部 COPY 源文件存在，且文件与每层父目录均被根 `.dockerignore` 显式允许；只做路径静态检查，尚未构建镜像。
- `git diff --check` 通过；生产源码中旧 SDK 路径引用已清理。
- 没有执行测试、构建、E2E 或数据库操作，没有启动临时服务；上述行为验收全部待人工 review 后执行。

### 人工审查后验证结果（2026-09-20）

- `pnpm build` 通过：shared、API、sandboxd、Web、Docs 全部构建成功。Web/Docs 提示既有大 chunk，
  Web 另提示 embedded-analysis 同时被静态和动态导入；均未阻断构建，不在本次 SDK 改造范围。
- Strategy SDK/runtime 与 Engine simulation/factors：22 个测试文件通过，158 项通过。
  另有性能 benchmark 文件按原有开关跳过 2 项，未把性能基准计为本次验收。
  覆盖源码 Worker、沙箱 bundle 的宿主依赖隔离、Python 超时/指标/成交一致性、打包后的 Python 启动与订单协议。
- setup、deployment plan、bootstrap：31 项通过，覆盖新增生成物、跨组件路径及仓库根镜像构建上下文。
- 编译后的 TS Backtest Worker 使用独立临时 SQLite 数据库执行：65 个合成交易日、1 笔成交，成功加载编译后的 SDK/sandbox bundle。
- `pnpm e2e sdk-hover` 通过，检查 TypeScript 签名、本地化说明及文档链接；截图 `apps/web/acceptance/7r-sdk-hover.png`。
- `pnpm e2e strategy-python` 通过，经真实页面、API、编译后的 Backtest Worker 和本地 Python 子进程完成回测，
  验证 history 兼容字段、源码/语言持久化、1 笔成交及报告展示；截图 `apps/web/acceptance/python-history-e2e.png`。
  使用临时数据库及合成行情，不加载开发数据、不调用外部模型；首次因夹具缺少基准行情失败，补齐后重跑通过，产品代码未修改。
- 两张截图已人工视觉检查。临时 Web/API 已关闭，3307/5277 端口释放，临时 SQLite 目录已删除。
- 本次通过 Dockerfile COPY 清单组装隔离目录执行 Python，尚未构建真实容器镜像；真实镜像构建与三个业务的容器启动验收
  按整体计划在提交 3 完成，此处不宣称容器验收通过。
