# 因子天气固定与刷新

天气保存用户固定版本及按期观察点，不创建正式 FactorReport 或通用 Job。计算复用 [execution](../execution/README.md)，持久化和进程内并发归本目录。

[pins.ts](pins.ts) 的 `listFactorWeatherPins`、`createFactorWeatherPin`、`requestFactorWeatherRefresh`、`deleteFactorWeatherPin` 供 weather 路由调用。参数带 userId、因子／pin 标识及 locale；创建验证来源和方向，冻结代码、语言、runtimeVersion 与方法哈希。非内置因子要求已发布；取消固定有忙碌状态限制。

**列表读取有副作用**：pending/running pin 会触发后台 `refreshFactorWeatherPin`，返回的列表并不等待这次刷新完成。显式刷新和创建也进入同一刷新能力，不另建并行任务系统。

[refresh.ts](refresh.ts) 的 `refreshFactorWeatherPin` 管理进程内同 pin 复用、计算区间及观察点／状态更新；`resetInterruptedFactorWeatherRefreshes` 供启动恢复，`refreshAllFactorWeatherPins` 供批量刷新消费者。Worker 用 `weather:*` 消息标识，返回后由刷新宿主保存天气点。它不依赖同名正式报告存在，也不共享正式评估的完成事务。

改方法和版本冻结先看 `factorWeatherMethodology` 与 pins；改恢复／并发／观察点先看 refresh 和 [refresh.test.ts](refresh.test.ts)。权限与忙碌拒绝看 [路由集成测试](../routes/index.integration.test.ts)，背景见 [天气设计](../../../../../docs/design/factor-weather.md)。

[返回 Factor 总览](../README.md)
