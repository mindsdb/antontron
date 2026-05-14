"""Conversion between legacy Responses SSE and normalized Cowork events."""

from __future__ import annotations

import json
from typing import Any

from .schemas import CoworkEvent, now_ms


def iter_sse_payloads(chunk: str) -> list[tuple[str, dict[str, Any]]]:
    payloads: list[tuple[str, dict[str, Any]]] = []
    for block in chunk.split("\n\n"):
        if not block.strip():
            continue
        event_type = ""
        data_lines: list[str] = []
        for line in block.splitlines():
            if line.startswith("event:"):
                event_type = line[6:].strip()
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())
        if not data_lines:
            continue
        try:
            payload = json.loads("\n".join(data_lines))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payloads.append((event_type or str(payload.get("type") or ""), payload))
    return payloads


def normalize_legacy_payload(payload: dict[str, Any], turn_id: str) -> CoworkEvent:
    legacy_type = str(payload.get("type") or "")
    at_ms = payload.get("at_ms")
    if not isinstance(at_ms, int):
        at_ms = now_ms()

    event_type = legacy_type or "progress.reasoning"
    event_payload: dict[str, Any] = {
        "legacy": payload,
        "legacy_type": legacy_type,
    }

    if legacy_type == "response.output_text.delta":
        event_type = "response.delta"
        event_payload.update({
            "delta": str(payload.get("delta") or ""),
            "label": "Response",
            "status": "streaming",
        })
    elif legacy_type == "response.completed":
        event_type = "response.completed"
        event_payload.update({"label": "Response complete", "status": "completed"})
    elif legacy_type == "response.failed":
        event_type = "response.failed"
        event_payload.update({
            "label": "Response failed",
            "status": "failed",
            "code": payload.get("code") or "",
            "message": payload.get("error") or payload.get("message") or "Response failed",
        })
    elif legacy_type == "response.created":
        event_type = "response.created"
        event_payload.update({"label": "Response started", "status": "started"})
    elif legacy_type == "response.in_progress":
        phase = str(payload.get("phase") or "")
        status = str(payload.get("progress_status") or "completed")
        if phase == "tool":
            if status == "started":
                event_type = "tool.started"
            elif status == "failed":
                event_type = "tool.failed"
            else:
                event_type = "tool.completed"
            event_payload.update({
                "label": payload.get("message") or payload.get("content") or payload.get("tool_name") or "Tool",
                "status": status,
                "tool_name": payload.get("tool_name") or "",
                "message": payload.get("message") or payload.get("content") or "",
            })
        elif phase == "artifact" or isinstance(payload.get("artifact"), dict):
            event_type = "artifact.created"
            artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
            event_payload.update({
                "label": payload.get("message") or artifact.get("title") or "Artifact",
                "status": status,
                "artifact": artifact,
            })
        else:
            event_type = "progress.reasoning"
            event_payload.update({
                "label": payload.get("message") or payload.get("content") or phase or "Progress",
                "status": status,
                "phase": phase,
                "message": payload.get("message") or payload.get("content") or "",
            })

    return CoworkEvent(type=event_type, turn_id=turn_id, at_ms=at_ms, payload=event_payload)


def cowork_event_to_legacy_sse(event: CoworkEvent) -> str:
    legacy = event.payload.get("legacy")
    if isinstance(legacy, dict):
        event_name = str(legacy.get("type") or event.type)
        return f"event: {event_name}\ndata: {json.dumps(legacy)}\n\n"

    payload = {
        "type": event.type,
        "at_ms": event.at_ms,
        **event.payload,
    }
    return f"event: {event.type}\ndata: {json.dumps(payload)}\n\n"

