"""Nanoclaw placeholder harness provider.

The runtime now knows about Nanoclaw as a selectable harness id, but native
execution is intentionally unsupported until its API contract is defined.
"""

from __future__ import annotations

from typing import AsyncIterator

from runtime.schemas import (
    CoworkEvent,
    HarnessCapabilities,
    HarnessReadiness,
    HarnessTurnRequest,
)


class NanoclawHarnessProvider:
    id = "nanoclaw"
    label = "Nanoclaw"

    def capabilities(self) -> HarnessCapabilities:
        return HarnessCapabilities(
            artifacts=False,
            streaming=False,
            tool_progress=False,
            cancellation=False,
        )

    async def health(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "available": False,
            "error": "Nanoclaw support is not implemented yet.",
        }

    def validate_request(self, request: HarnessTurnRequest) -> HarnessReadiness:
        del request
        return HarnessReadiness.fail(
            "unsupported_harness",
            "Nanoclaw support is not implemented yet.",
        )

    async def start_turn(self, request: HarnessTurnRequest) -> AsyncIterator[CoworkEvent]:
        yield CoworkEvent(
            type="response.failed",
            turn_id=request.turn_id,
            payload={
                "legacy": {
                    "type": "response.failed",
                    "code": "unsupported_harness",
                    "error": "Nanoclaw support is not implemented yet.",
                },
                "legacy_type": "response.failed",
                "code": "unsupported_harness",
                "message": "Nanoclaw support is not implemented yet.",
            },
        )

    async def cancel_turn(self, turn_id: str) -> None:
        del turn_id
        return None

    def list_live(self) -> list[str]:
        return []

    async def close_all(self) -> None:
        return None
