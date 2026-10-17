from __future__ import annotations

from typing import Protocol, TypeVar


Input = TypeVar("Input", contravariant=True)
Capabilities = TypeVar("Capabilities", covariant=True)


class SdkAdapter(Protocol[Input, Capabilities]):
    """Bind an execution environment to the primitives required by an author SDK."""

    def bind(self, input: Input) -> Capabilities: ...
