"""POST /v1/responses — OpenAI Responses API.

Streaming SSE by default; pass {"stream": false} for one-shot JSON.
Cowork extensions: project (name) + attachment_ids fields on the request.
The returned `response.created` event carries the conversation_id the
frontend uses as its task id.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from anton_api.models import (
    Message,
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
    ResponsesRequest,
)
from harnesses.registry import active_harness_id
from runtime.service import runtime_service
from .attachments import attachment_context


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1", tags=["responses"])


def _resolve_input(req: ResponsesRequest) -> str:
    if isinstance(req.input, str):
        return req.input
    user_messages = [m for m in req.input if isinstance(m, Message) and m.role == "user"]
    if not user_messages:
        raise HTTPException(status_code=400, detail="No user message in input")
    content = user_messages[-1].content
    if not isinstance(content, str):
        raise HTTPException(status_code=400, detail="Only string user content is supported")
    return content


def _assembled_user_input(content: str, project_name: str | None, session_id: str | None, attachment_ids: list[str]) -> str:
    context = attachment_context(project_name, session_id, attachment_ids)
    if not context:
        return content
    return f"{content}\n\n{context}"


@router.post("/responses")
async def create_response(req: ResponsesRequest):
    user_text = _resolve_input(req)
    final_input = _assembled_user_input(
        user_text,
        req.project,
        req.conversation,
        req.attachment_ids,
    )
    dc_payload = None
    if req.disabled_connections is not None:
        dc_payload = [d.model_dump() for d in req.disabled_connections]
    
    if req.stream:
        return StreamingResponse(
            runtime_service.stream_response(
                user_input=final_input,
                conversation_id=req.conversation,
                project=req.project,
                model=req.model,
                disabled_connections=dc_payload,
                attachment_ids=req.attachment_ids,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
            },
        )

    # Non-streaming: collect text and return a single ResponseObject.
    try:
        text, _cid = await runtime_service.complete_text(
            user_input=final_input,
            conversation_id=req.conversation,
            project=req.project,
            model=req.model,
            disabled_connections=dc_payload,
        )
    except RuntimeError as exc:
        logger.error("Cowork runtime error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc) or "An unexpected error occurred")

    return ResponseObject(
        model=req.model or active_harness_id(),
        status=ResponseStatus.completed,
        output=[ResponseOutput(
            status=ResponseStatus.completed,
            content=[ResponseOutputContent(text=text)],
        )],
    )
