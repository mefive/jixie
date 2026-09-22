# Research Cell 运行时

[ResearchRuntime.start](research-runtime.ts) 接收 `{ documentId, signal? }`，返回具有 `metadata / execute / close` 的实例；metadata 包含 environment 和 capabilities。输入/输出宿主类型归 [contract.ts](contract.ts)。Research 当前仅支持 Python。

[pool.ts](pool.ts) 的 `ResearchRuntimePool` 及单例 `researchRuntimePool` 按 documentId 复用实例。业务通过 `withRuntime(documentId, runtime => runtime.execute({ cell, parameters? }, options), { signal? })` 借用；依赖分析也借用同一实例调用 analyze。嵌入分析使用自己的内部文档 ID，执行后关闭。

- runtime.analyze(cells) 返回 AST 定义、引用、导入和受控请求，不保存依赖。
- runtime.execute({ cell, parameters? }, { signal?, observer?, captureEnvironment? }) 返回 outputs、definitions/references 和环境哈希；SDK request 交给 [dispatch](host/README.md)。
- pool.reset(documentId) 排队清空现有 namespace，没有实例时直接返回；pool.interrupt 关闭活动执行并标记中断；pool.close 删除条目并关闭连接。文档归档／删除直接调用 pool.close。

具体实例直接继承公共 SandboxRuntime。start 经 startSandboxRuntime 创建 PythonSession、发送 research_start 并等待 ready；start/analyze/execute/reset 全部使用公共 exchange。pool 唯一拥有操作队列、容量和实例身份检查，runtime 不再重复排队。失效实例只按原条目身份移除，旧操作不能误关新实例。

会话获取串行化，每个实例内操作串行执行；最多 4 个活动实例，只淘汰无待处理操作的最久未使用实例，否则报 busy。文档锁另归 document-runs，通信队列不替代修订或权限检查。

启动协商 explicit_parameters；带参数执行时必须检查能力，避免旧沙箱忽略参数。发送源码前交给 captureEnvironment 保存环境。输出传输上限 8 MiB，持久化限制归 evidence。普通 Python 执行错误保留会话；协议、断连或其他非业务异常关闭会话。AbortSignal 由 pool 中止底层阻塞，嵌入分析继续拥有超时策略。

这里不查询文档所有者、不写执行状态、不决定固化。验证入口：[pool.test.ts](pool.test.ts)、[lifecycle.test.ts](lifecycle.test.ts)、[python/capabilities.test.ts](python/capabilities.test.ts)；源码／生产资源路径见 [运行清单](../../../../../docs/backend-runtime-entries.md)。

[返回 Research 总览](../README.md)

## Python 进程内执行

- [python/runner.py](python/runner.py)：组合 SDK、初始化/reset namespace、执行 Cell 及消息循环。
- [python/analysis.py](python/analysis.py)：AST 定义/引用/导入和受控请求提取，保留原依赖判定。
- [python/bridge.py](python/bridge.py)：request/response 帧配对，宿主等待期间暂停执行计时器。
- [python/environment.py](python/environment.py)：加载既有第三方模块与捕获固定运行环境版本。
- [python/outputs.py](python/outputs.py)：SDK 图表结果、有限表格预览、JSON 与 matplotlib 图片转换为输出帧。

用户 API 实现见 [sdk](../sdk/README.md)，宿主协议与请求处理见 [host](host/README.md)。
公共 `jixie_runner.py` 只分派到本业务 runner；以上 Python 文件由 Docker 显式 COPY，TS runtime/pool 留在 API 进程。
