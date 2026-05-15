"""Cowork approval decisions."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from runtime.approvals import approval_coordinator
from runtime.access import event_for_approval
from runtime.conversations import store
from runtime.schemas import CoworkApprovalDecision


router = APIRouter(prefix="/v1/approvals", tags=["approvals"])


@router.get("/{approval_id}")
async def get_approval(approval_id: str):
    found = store.find_approval(approval_id)
    if not found:
        raise HTTPException(status_code=404, detail="Approval not found")
    conv, approval = found
    return {
        "conversationId": conv.id,
        "approval": approval.model_dump(),
        "live": approval_id in approval_coordinator.pending_ids(),
    }


@router.post("/{approval_id}/decide")
async def decide_approval(approval_id: str, decision: CoworkApprovalDecision):
    found = store.find_approval(approval_id)
    if not found:
        raise HTTPException(status_code=404, detail="Approval not found")
    status = "approved" if decision.decision == "approved" else "denied"
    was_live = approval_id in approval_coordinator.pending_ids()
    updated = store.update_approval(approval_id, status)
    if not updated:
        raise HTTPException(status_code=404, detail="Approval not found")
    conv, approval = updated
    approval_coordinator.decide(approval_id, status)
    event = event_for_approval(approval, "approval.granted" if status == "approved" else "approval.denied")
    if not was_live:
        store.append_event(conv, approval.turn_id, event)
    return {
        "status": "ok",
        "conversationId": conv.id,
        "approval": approval.model_dump(),
        "event": event.model_dump(),
        "live": was_live,
    }
