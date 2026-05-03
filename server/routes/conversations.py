"""GET /v1/conversations and friends — persistent conversation records.

Returns Anton-side data only (id, title, turns, preview, timestamps,
project_path, messages). Cowork-side metadata (pinned, attachments) lives
on the cowork-side routes (/v1/pins, /v1/attachments) and is merged
client-side into the UI "task" object.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from anton_api import conversation_manager
from anton_api.models import ConversationPatch


router = APIRouter(prefix="/v1/conversations", tags=["conversations"])


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


@router.get("")
async def list_conversations(limit: int = 200):
    return {"conversations": conversation_manager.list_conversations(limit=limit)}


@router.get("/{conversation_id}")
async def get_conversation(conversation_id: str):
    meta = conversation_manager.get_conversation(conversation_id)
    if not meta:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@router.get("/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    messages = conversation_manager.get_messages(conversation_id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"id": conversation_id, "messages": _parse_for_display(messages)}


@router.patch("/{conversation_id}")
async def update_conversation(conversation_id: str, patch: ConversationPatch):
    updates = patch.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    meta = conversation_manager.update_conversation(conversation_id, **updates)
    if meta is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return meta


@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    found = conversation_manager.delete_conversation(conversation_id)
    if not found:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"status": "deleted", "id": conversation_id}
