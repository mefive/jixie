from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from .capabilities import CrossSectionalFactorCapabilities, AssetFactorCapabilities


# 将字段映射提供为属性访问，供公开因子对象兼容读取。
# English: Expose mapping fields as attributes for public factor objects.
class _AttrDict(dict[str, Any]):
    def __getattr__(self, name: str) -> Any:
        try:
            return self[name]
        except KeyError as error:
            raise AttributeError(name, name=name, obj=self) from error


# 公开单证券行情的属性接口，供作者因子读取。
# English: Expose one instrument's bar attributes to authored factors.
class FactorBar(_AttrDict):
    pass


# 包装截面原始能力为公开上下文，执行字段访问校验。
# English: Wrap cross-sectional primitives in a validated public author context.
class CrossSectionalFactorContext:
    def __init__(self, capabilities: CrossSectionalFactorCapabilities) -> None:
        self._capabilities = capabilities

    # 读取声明字段的历史窗口，供作者因子计算。
    # English: Read a bounded history of a declared field for authored computation.
    def history(self, periods: int, field: str = "close") -> list[Any]:
        if not self._capabilities.has_history:
            raise RuntimeError(
                "Factor must declare window before using ctx.history(periods, field)"
            )
        if isinstance(periods, bool) or not isinstance(periods, int) or periods <= 0:
            raise ValueError("history periods must be a positive integer")
        values = self._capabilities.history_values(field)
        if values is None:
            raise ValueError(f"unsupported Factor history field: {field}")
        if len(values) < periods:
            return []
        return values[-periods:]


# 包装资产历史原始能力为公开上下文。
# English: Wrap asset-history primitives in the public author context.
class AssetFactorContext:
    def __init__(self, capabilities: AssetFactorCapabilities) -> None:
        self._capabilities = capabilities

    def value(self, field: str) -> float | None:
        return self.lag(field, 0)

    # 读取指定滞后位置，保留历史不足时的缺失语义。
    # English: Read a lagged value while preserving insufficient-history missing semantics.
    def lag(self, field: str, periods: int) -> float | None:
        if not self._capabilities.declares_input(field):
            raise ValueError(f"Factor code accessed undeclared input {field}")
        if isinstance(periods, bool) or not isinstance(periods, int) or periods < 0:
            raise ValueError("ctx.lag periods must be a non-negative integer")
        value = self._capabilities.value_at(field, periods)

        return value if isinstance(value, (int, float)) and math.isfinite(value) else None


# 保存规范化作者定义与协议元数据，供运行器加载。
# English: Retain a normalized authored definition and protocol metadata for the runner.
class _FactorDefinition:
    # 校验因子声明参数并保存类型与回调，供运行器元数据读取。
    # English: Validate declaration arguments and retain kind and callbacks for runner metadata.
    def __init__(
        self,
        analysis_kind: str,
        *,
        name: str,
        window: int | None = None,
        min_coverage: float | None = None,
        inputs: list[str] | None = None,
        target_asset_classes: list[str] | None = None,
    ) -> None:
        self.analysis_kind = analysis_kind
        self.name = name
        self.window = window
        self.min_coverage = min_coverage
        self.inputs = list(inputs or [])
        self.target_asset_classes = list(target_asset_classes or [])
        self._callback: Callable[..., float | int | None] | None = None

    # 声明或绑定因子计算回调，检查声明一致性。
    # English: Declare or bind a factor compute callback under definition consistency checks.
    def compute(self, callback: Callable[..., float | int | None]) -> Callable[..., float | int | None]:
        if self._callback is not None:
            raise ValueError("Factor supports exactly one @factor.compute callback")
        self._callback = callback
        return callback


# 提供 Python 因子声明入口并约束种类及元数据。
# English: Expose Python factor declaration with kind and metadata validation.
class Factor:
    # 构造截面协议定义并传递名称、历史窗口和最低覆盖要求。
    # English: Construct a cross-sectional definition with name, history window and coverage requirements.
    @classmethod
    def cross_sectional(
        cls,
        *,
        name: str,
        window: int | None = None,
        min_coverage: float | None = None,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "cross_sectional",
            name=name,
            window=window,
            min_coverage=min_coverage,
        )

    # 创建单资产时间序列因子声明并保留输入元数据。
    # English: Declare a time-series factor and retain input metadata.
    @classmethod
    def time_series(
        cls,
        *,
        name: str,
        inputs: list[str],
        target_asset_classes: list[str],
        window: int,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "time_series",
            name=name,
            window=window,
            inputs=inputs,
            target_asset_classes=target_asset_classes,
        )

    # 创建跨资产 Panel 因子声明并保留协议约束。
    # English: Declare a panel factor with its protocol constraints.
    @classmethod
    def panel(
        cls,
        *,
        name: str,
        inputs: list[str],
        target_asset_classes: list[str],
        window: int,
    ) -> _FactorDefinition:
        return _FactorDefinition(
            "panel",
            name=name,
            window=window,
            inputs=inputs,
            target_asset_classes=target_asset_classes,
        )
