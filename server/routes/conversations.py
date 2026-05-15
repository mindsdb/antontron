"""GET /v1/conversations and friends — Cowork-owned conversation records.

New runtime conversations are loaded from Cowork's canonical store under
each project's `.cowork/conversations` directory. Harness-native episode
logs may still exist as adapter-private working state, but these routes do
not read them as a source of truth.

Conversations are scoped to a project (folder under projects_store):
  GET /v1/conversations                     → active project
  GET /v1/conversations?project=<name>      → that project
  GET /v1/conversations?project=all         → merged across all projects
  GET /v1/projects/{name}/conversations     → convenience alias
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from anton_api import projects_store
from anton_api.models import ConversationPatch
from harnesses.registry import active_harness_id
from runtime.conversations import store as conversation_store
from .cowork_state import load_state


router = APIRouter(tags=["conversations"])


def _schedule_runs_index() -> dict[str, str]:
    """Flat map: conversation_id → schedule_id, built from
    state["schedule_runs"]. Used to backfill `scheduled_id` on each
    listed conversation so the sidebar can group scheduled tasks
    even before /v1/schedules has been refetched."""
    index: dict[str, str] = {}
    try:
        state = load_state() or {}
    except Exception:
        return index
    runs = state.get("schedule_runs")
    if not isinstance(runs, dict):
        return index
    for schedule_id, bucket in runs.items():
        if not isinstance(bucket, list):
            continue
        for record in bucket:
            if not isinstance(record, dict):
                continue
            # Run records use camelCase (`sessionId`) per the writer in
            # routes/schedules.py:_append_run_record. Accept snake_case
            # too so a future writer change can't silently break this.
            sid = record.get("sessionId") or record.get("session_id")
            if sid:
                index[sid] = schedule_id
    return index


def _schedule_prompt_index() -> dict[tuple[str, str], str]:
    """Fallback (title, project) → schedule_id map. Catches the case
    where a schedule run errored before chat_stream returned a real
    conversation_id — the schedule recorded a synthetic `sched_xxxxx`
    in `schedule_runs`, but a real conversation file still exists and
    its title matches the schedule's prompt. Without this fallback the
    UI shows those errored runs as ungrouped duplicates."""
    out: dict[tuple[str, str], str] = {}
    try:
        state = load_state() or {}
    except Exception:
        return out
    schedules = state.get("schedules")
    if not isinstance(schedules, list):
        return out
    for s in schedules:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        prompt = (s.get("prompt") or "").strip()
        if not sid or not prompt:
            continue
        project = (s.get("project") or "").strip() or "general"
        # Anton stores conversation titles from the first 60 chars of
        # the user message, so match on `startswith` of either side to
        # be robust to truncation in either direction.
        out[(prompt[:60], project)] = sid
        out[(prompt, project)] = sid
    return out


def _annotate_with_schedule_id(conversations: list[dict]) -> list[dict]:
    """Tag each conversation entry with `scheduled_id` if it's a known
    schedule run (by registered sessionId, or by matching the
    schedule's prompt and project). Idempotent — preserves any
    existing field."""
    if not conversations:
        return conversations
    by_id = _schedule_runs_index()
    by_prompt = _schedule_prompt_index() if conversations else {}
    if not by_id and not by_prompt:
        return conversations
    for conv in conversations:
        if not isinstance(conv, dict) or conv.get("scheduled_id"):
            continue
        cid = conv.get("id")
        # Primary: the sessionId that the schedule writer recorded.
        if cid and cid in by_id:
            conv["scheduled_id"] = by_id[cid]
            continue
        # Fallback: title + project match against a known schedule's
        # prompt. Covers orphan conversations whose run record holds a
        # synthetic id (errored runs) but whose real conversation file
        # still exists on disk.
        title = (conv.get("title") or "").strip()
        project = (conv.get("project") or "").strip() or "general"
        if not title:
            continue
        match = by_prompt.get((title, project)) or by_prompt.get((title[:60], project))
        if match:
            conv["scheduled_id"] = match
    return conversations


@router.get("/v1/conversations")
async def list_conversations(limit: int = 200, project: str | None = None):
    target = project if project else projects_store.get_active()
    return {
        "project": target,
        "harness": active_harness_id(),
        "conversations": _annotate_with_schedule_id(
            conversation_store.list(limit=limit, project=target)
        ),
    }


@router.get("/v1/projects/{name}/conversations")
async def list_project_conversations(name: str, limit: int = 200):
    return {
        "project": name,
        "harness": active_harness_id(),
        "conversations": _annotate_with_schedule_id(
            conversation_store.list(limit=limit, project=name)
        ),
    }


@router.get("/v1/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    conv = conversation_store.get(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation_store.meta(conv)


@router.get("/v1/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    conv = conversation_store.get(conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {
        "id": conversation_id,
        "messages": conversation_store.display_messages(conv),
    }


@router.patch("/v1/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, patch: ConversationPatch):
    updates = patch.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    # Project move is a different operation from a title update —
    # it physically relocates the conversation between project dirs.
    target_project = updates.pop("project", None)
    meta = None
    if target_project is not None:
        try:
            meta = conversation_store.move(conversation_id, target_project)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        if meta is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    if updates:
        meta = conversation_store.update(conversation_id, **updates)
        if meta is None:
            raise HTTPException(status_code=404, detail="Conversation not found")

    return meta or {"id": conversation_id}


@router.delete("/v1/conversations/{conversation_id}/turns/{turn_index}")
async def delete_conversation_turn(conversation_id: str, turn_index: int):
    """Delete one user→answer cycle from a conversation. The client
    passes the 0-based displayable bubble index of the assistant
    message; the server removes that user input + all assistant
    messages anton produced in response, then reindexes the events
    sidecar so subsequent turns shift down by one.
    """
    if turn_index < 0:
        raise HTTPException(status_code=400, detail="turn_index must be non-negative")
    result = conversation_store.delete_turn(conversation_id, turn_index)
    if result is None:
        raise HTTPException(status_code=404, detail="Turn not found")
    return result


@router.delete("/v1/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    found = conversation_store.delete(conversation_id)
    if not found:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "id": conversation_id}
