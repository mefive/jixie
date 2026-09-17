# 从回测报告部署

部署冻结成功回测的配置、代码哈希和因子依赖，后续修改 Strategy 草稿不改变它。这里不运行策略，也不生成交易日信号。

[manage.ts](manage.ts) 的 `deployBacktestReport(userId, reportId, locale)` 供 deployment 路由调用：检查本人 done 报告及 payload，复用该报告已有的活动部署，解析冻结配置并检查 TS 策略元数据；Python 与声明期货的策略不能部署。随后以 deployment 场景调用 [Strategy 因子准备](../../strategy/factor-inputs/README.md)，核对报告依赖，冻结配置及哈希后 upsert。并发唯一键冲突会查询胜者返回。不同报告可以同时存在活动部署。

依赖准备及比较在写入前完成，没有包成包含编译的总事务。旧报告缺少依赖时，若当前准备出自定义因子则返回 dependencies_changed；冻结依赖的比较规则见 [factor-inputs](../factor-inputs/README.md)。

同文件 `pauseDeployment` 检查所有者，已暂停时直接返回，否则置 paused、清空 activeReportId 并写 stoppedAt；保留信号和账户历史。之后重新部署同一报告会建立新部署实例。[read.ts](read.ts) 的 `listStrategyDeployments` 读取本人部署，`deploymentWire` 仅做响应映射。

改部署准入、重复部署或暂停语义看 [路由集成测试](../routes/index.integration.test.ts)；历史模型关系看 [migration.test.ts](migration.test.ts)；下一步是 [runs](../runs/README.md)。

[返回 Signals 总览](../README.md)
