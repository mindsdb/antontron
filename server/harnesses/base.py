"""Common harness provider primitives."""

from __future__ import annotations

from typing import AsyncIterator, Protocol

from runtime.schemas import (
    CoworkEvent,
    HarnessCapabilities,
    HarnessReadiness,
    HarnessTurnRequest,
)


class HarnessConfigurationError(RuntimeError):
    """Raised when the selected harness is missing required configuration."""


class HarnessRuntimeError(RuntimeError):
    """Raised when the selected harness fails while processing a request."""


class HarnessProvider(Protocol):
    id: str
    label: str

    def capabilities(self) -> HarnessCapabilities:
        ...

    async def health(self) -> dict:
        ...

    def validate_request(self, request: HarnessTurnRequest) -> HarnessReadiness:
        ...

    async def start_turn(self, request: HarnessTurnRequest) -> AsyncIterator[CoworkEvent]:
        ...

    async def cancel_turn(self, turn_id: str) -> None:
        ...

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> AsyncIterator[str]:
        ...

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None]:
        ...
