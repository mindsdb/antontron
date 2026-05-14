"""Harness catalogue and readiness metadata."""

from __future__ import annotations

from fastapi import APIRouter

from harnesses.registry import active_harness_id, list_harnesses


router = APIRouter(prefix="/v1/harnesses", tags=["harnesses"])


@router.get("")
async def get_harnesses():
    selected = active_harness_id()
    entries: list[dict] = []
    for harness in list_harnesses():
        health = await harness.health()
        caps = harness.capabilities().model_dump()
        entries.append(
            {
                "id": harness.id,
                "label": harness.label,
                "selected": harness.id == selected,
                "health": health,
                "capabilities": caps,
            }
        )
    return {"selected": selected, "harnesses": entries}
