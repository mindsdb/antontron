"""In-memory live approval coordination.

The durable approval ledger lives in the Cowork conversation JSON. This module
only coordinates active streams waiting for a user decision.
"""

from __future__ import annotations

import asyncio


class ApprovalCoordinator:
    def __init__(self) -> None:
        self._pending: dict[str, asyncio.Future[str]] = {}

    def register(self, approval_id: str) -> None:
        loop = asyncio.get_running_loop()
        self._pending[approval_id] = loop.create_future()

    async def wait(self, approval_id: str, timeout: float = 900.0) -> str:
        future = self._pending.get(approval_id)
        if future is None:
            return "expired"
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            return "expired"
        finally:
            self._pending.pop(approval_id, None)

    def decide(self, approval_id: str, decision: str) -> bool:
        future = self._pending.get(approval_id)
        if future is None or future.done():
            return False
        future.set_result("approved" if decision == "approved" else "denied")
        return True

    def pending_ids(self) -> set[str]:
        return set(self._pending.keys())


approval_coordinator = ApprovalCoordinator()
