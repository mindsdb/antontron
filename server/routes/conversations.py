"""GET /v1/conversations and friends — persistent conversation records.

Returns Anton-side data only (id, title, turns, preview, timestamps,
project, messages). Cowork-side metadata (pinned, attachments) lives
on the cowork-side routes (/v1/pins, /v1/attachments) and is merged
client-side into the UI "task" object.

Conversations are scoped to a project (folder under projects_store):
  GET /v1/conversations                     → active project
  GET /v1/conversations?project=<name>      → that project
  GET /v1/conversations?project=all         → merged across all projects
  GET /v1/projects/{name}/conversations     → convenience alias
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from anton_api import conversation_manager, projects_store
from anton_api.models import ConversationPatch


router = APIRouter(tags=["conversations"])


_ATTACHMENT_MARKER = "\n\nAttached context supplied by the user:"


def _strip_attachment_context(content: str) -> str:
    if _ATTACHMENT_MARKER in content:
        return content.split(_ATTACHMENT_MARKER, 1)[0].rstrip()
    return content


def _parse_for_display(history: list[dict]) -> list[dict]:
    """Filter raw history into {role, content} pairs the UI can render."""
    out: list[dict] = []
    for msg in history:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content", "")
        if role not in ("user", "assistant") or not content:
            continue
        if isinstance(content, list):
            content = "\n".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        if not content:
            continue
        text = (
            _strip_attachment_context(str(content))
            if role == "user"
            else str(content)
        )
        out.append({"role": role, "content": text})
    return out


@router.get("/v1/conversations")
async def list_conversations(limit: int = 200, project: str | None = None):
    target = project if project else projects_store.get_active()
    return {
        "project": target,
        "conversations": conversation_manager.list_conversations(
            limit=limit, project=target
        ),
    }


@router.get("/v1/projects/{name}/conversations")
async def list_project_conversations(name: str, limit: int = 200):
    return {
        "project": name,
        "conversations": conversation_manager.list_conversations(
            limit=limit, project=name
        ),
    }


@router.get("/v1/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    meta = conversation_manager.get_conversation(conversation_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@router.get("/v1/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    messages = conversation_manager.get_messages(conversation_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"id": conversation_id, "messages": _parse_for_display(messages)}


@router.patch("/v1/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, patch: ConversationPatch):
    updates = patch.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    meta = conversation_manager.update_conversation(conversation_id, **updates)
    if meta is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@router.delete("/v1/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    found = conversation_manager.delete_conversation(conversation_id)
    if not found:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "id": conversation_id}
