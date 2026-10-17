from __future__ import annotations

from typing import Protocol, TypeVar


Input = TypeVar("Input", contravariant=True)
Capabilities = TypeVar("Capabilities", covariant=True)


# 约束适配器输入绑定为作者能力的公共协议。
# English: Define the common protocol for binding execution input to author capabilities.
class SdkAdapter(Protocol[Input, Capabilities]):
    """Bind an execution environment to the primitives required by an author SDK."""

    def bind(self, input: Input) -> Capabilities: ...
