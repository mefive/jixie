# Python 编辑器语言服务

[pyright-service.ts](pyright-service.ts) 的单例 `researchPythonLanguageService.request(sessionKey, request)` 供 language 路由调用，提供 diagnostics、completion、hover、signature_help、definition、references 和 rename 系列动作。它分析请求中尚未保存的源码，不执行研究 Cell、不查询文档内容或保存 rename 结果。

路由使用 userId:documentId 作为 sessionKey 隔离虚拟文档；这不是服务内部的数据库所有者检查。[document.ts](document.ts) 的 `buildResearchLanguageDocument` 把多个 Cell 拼成单个 Python 模块，`researchCellPositionToVirtual`／`researchVirtualRangeToCell` 映射位置和范围，避免把其他 Cell 或临时文件位置原样返回编辑器。

Pyright 懒启动，从 API 依赖解析包路径，在临时 workspace 写配置及 stub，经 stdio JSON-RPC 通信。SDK stub 来自 shared render 函数，[stubs.ts](stubs.ts) 只补受支持库的类型信息；它们不代表运行环境中新增了可导入包。最多保留 24 份虚拟文档，淘汰时 didClose；`dispose()` 关闭连接、清理等待器和临时目录。此生命周期独立于 [Research Python 运行会话](../runtime/README.md)。

改坐标和跨 Cell 符号看 [document.test.ts](document.test.ts)；改 Pyright、补全或收尾看 [pyright-service.test.ts](pyright-service.test.ts)；请求 schema 和 HTTP 错误映射看 [路由实现](../routes/language.ts)。

[返回 Research 总览](../README.md)
