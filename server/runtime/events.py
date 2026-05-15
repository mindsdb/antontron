"""Conversion between legacy Responses SSE and normalized Cowork events."""

from __future__ import annotations

import json
import re
from pathlib import Path
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
    events = normalize_legacy_payloads(payload, turn_id)
    return events[0]


def normalize_legacy_payloads(
    payload: dict[str, Any],
    turn_id: str,
    *,
    project_root: str | None = None,
) -> list[CoworkEvent]:
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
    elif legacy_type in {
        "tool.requested",
        "tool.started",
        "tool.completed",
        "tool.failed",
        "file.accessed",
        "source.used",
        "approval.required",
        "approval.granted",
        "approval.denied",
        "approval.bypassed",
        "access.denied",
        "artifact.ignored",
    }:
        event_type = legacy_type
        event_payload.update({
            key: value
            for key, value in payload.items()
            if key not in {"type", "at_ms"}
        })

    base = CoworkEvent(type=event_type, turn_id=turn_id, at_ms=at_ms, payload=event_payload)
    extras = _typed_events_from_payload(payload, turn_id, at_ms, project_root=project_root)
    return [base, *extras]


_APP_INTERNAL_PARTS = {".cowork", ".anton"}


def _project_path_mentions(payload: dict[str, Any], project_root: str | None) -> list[str]:
    if not project_root:
        return []
    try:
        raw_root = Path(project_root).expanduser()
        resolved_root = raw_root.resolve(strict=False)
    except Exception:
        return []
    text_parts: list[str] = []
    for key in ("message", "content", "path", "file_path", "stdout", "stderr", "command"):
        value = payload.get(key)
        if isinstance(value, str):
            text_parts.append(value)
    text = "\n".join(text_parts)
    if not text:
        return []
    roots = [resolved_root]
    if str(raw_root) != str(resolved_root):
        roots.append(raw_root)
    out: list[str] = []
    seen: set[str] = set()
    for root in roots:
        pattern = re.compile(re.escape(str(root)) + r"[^\s'\"),;]+")
        for match in pattern.finditer(text):
            raw = match.group(0).rstrip(".,:;")
            try:
                path = Path(raw).resolve(strict=False)
                rel = path.relative_to(resolved_root)
            except Exception:
                continue
            if not rel.parts:
                continue
            if rel.parts[0] in _APP_INTERNAL_PARTS or rel.parts[0] == "artifacts":
                continue
            key = str(path)
            if key in seen:
                continue
            seen.add(key)
            out.append(key)
    return out


def _approval_required(payload: dict[str, Any]) -> str:
    text = "\n".join(
        str(value)
        for key in ("message", "content", "error")
        for value in (payload.get(key),)
        if isinstance(value, str)
    )
    if not text:
        return ""
    lowered = text.lower()
    if "approval required" not in lowered and "requires approval" not in lowered:
        return ""
    return text.strip()[:2048]


def _typed_events_from_payload(
    payload: dict[str, Any],
    turn_id: str,
    at_ms: int,
    *,
    project_root: str | None,
) -> list[CoworkEvent]:
    if payload.get("type") != "response.in_progress":
        return []
    phase = str(payload.get("phase") or "")
    status = str(payload.get("progress_status") or "completed")
    tool_name = str(payload.get("tool_name") or payload.get("tool") or "")
    typed: list[CoworkEvent] = []

    paths = _project_path_mentions(payload, project_root)
    file_tool = any(token in tool_name.lower() for token in ("file", "read", "write", "edit", "search", "grep", "rg"))
    if paths and (phase == "tool" or file_tool):
        for path in paths:
            typed.append(CoworkEvent(
                type="file.accessed",
                turn_id=turn_id,
                at_ms=at_ms,
                payload={
                    "path": path,
                    "label": Path(path).name,
                    "status": status,
                    "tool_name": tool_name,
                    "mode": "write" if any(token in tool_name.lower() for token in ("write", "edit")) else "read",
                },
            ))
            typed.append(CoworkEvent(
                type="source.used",
                turn_id=turn_id,
                at_ms=at_ms,
                payload={
                    "source_path": path,
                    "label": Path(path).name,
                    "status": status,
                    "tool_name": tool_name,
                },
            ))

    approval_message = _approval_required(payload)
    if approval_message:
        typed.append(CoworkEvent(
            type="approval.required",
            turn_id=turn_id,
            at_ms=at_ms,
            payload={
                "label": "Approval required",
                "status": "started",
                "message": approval_message,
                "tool_name": tool_name,
            },
        ))

    return typed


def _legacy_progress_payload(event: CoworkEvent) -> dict[str, Any] | None:
    status = str(event.payload.get("status") or "completed")
    label = str(event.payload.get("label") or event.payload.get("message") or event.type)
    base = {
        "type": "response.in_progress",
        "at_ms": event.at_ms,
        "thought_role": "thought.progress",
        "progress_status": status,
        "message": label,
        "content": str(event.payload.get("message") or label),
    }
    if event.type.startswith("tool."):
        return {
            **base,
            "phase": "tool",
            "tool_name": event.payload.get("tool_name") or label,
            "error": event.payload.get("error") or None,
        }
    if event.type == "artifact.created":
        artifact = event.payload.get("artifact") if isinstance(event.payload.get("artifact"), dict) else event.payload
        return {
            **base,
            "phase": "artifact",
            "message": label or f"Created artifact: {artifact.get('title') or artifact.get('name') or 'Artifact'}",
            "artifact": artifact,
        }
    if event.type == "progress.reasoning":
        return {**base, "phase": event.payload.get("phase") or "reasoning"}
    if event.type == "file.accessed":
        return {
            **base,
            "phase": "file",
            "file_path": event.payload.get("path") or "",
            "tool_name": event.payload.get("tool_name") or "",
            "mode": event.payload.get("mode") or "",
        }
    if event.type == "source.used":
        return {
            **base,
            "phase": "source",
            "source_path": event.payload.get("source_path") or "",
            "tool_name": event.payload.get("tool_name") or "",
        }
    if event.type == "approval.required":
        return {
            **base,
            "phase": "approval",
            "progress_status": "started",
            "tool_name": event.payload.get("tool_name") or "",
            "approval_id": event.payload.get("approval_id") or "",
            "approval_status": event.payload.get("approval_status") or "pending",
            "resource": event.payload.get("resource") or None,
        }
    if event.type in {"approval.granted", "approval.denied", "approval.bypassed"}:
        failed = event.type == "approval.denied"
        return {
            **base,
            "phase": "approval",
            "progress_status": "failed" if failed else "completed",
            "tool_name": event.payload.get("tool_name") or "",
            "approval_id": event.payload.get("approval_id") or "",
            "approval_status": event.payload.get("approval_status") or ("denied" if failed else "approved"),
            "resource": event.payload.get("resource") or None,
        }
    if event.type == "access.denied":
        return {
            **base,
            "phase": "access",
            "progress_status": "failed",
            "resource": event.payload.get("resource") or None,
            "error": event.payload.get("message") or event.payload.get("error") or "Access denied",
        }
    if event.type == "artifact.ignored":
        return {
            **base,
            "phase": "artifact",
            "progress_status": "failed",
            "path": event.payload.get("path") or "",
            "error": event.payload.get("message") or "Artifact ignored",
        }
    return None


def cowork_event_to_legacy_sse(event: CoworkEvent) -> str:
    legacy = event.payload.get("legacy")
    if isinstance(legacy, dict):
        event_name = str(legacy.get("type") or event.type)
        return f"event: {event_name}\ndata: {json.dumps(legacy)}\n\n"

    progress = _legacy_progress_payload(event)
    if progress is not None:
        return f"event: response.in_progress\ndata: {json.dumps(progress)}\n\n"

    payload = {
        "type": event.type,
        "at_ms": event.at_ms,
        **event.payload,
    }
    return f"event: {event.type}\ndata: {json.dumps(payload)}\n\n"
