"""Cowork-owned canonical conversation store for new runtime conversations."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from anton_api import projects_store

from .inference import profile_for_storage
from .events import cowork_event_to_legacy_sse, iter_sse_payloads
from .schemas import (
    CoworkApprovalRequest,
    CoworkConversation,
    CoworkEvent,
    CoworkMessage,
    CoworkTurn,
    ResolvedInferenceProfile,
    new_id,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _store_dir(project_name: str | None) -> Path:
    projects_store.ensure_general_project()
    try:
        name, base = projects_store.resolve_project(project_name)
    except FileNotFoundError:
        name, base = projects_store.resolve_project(None)
    del name
    path = base / ".cowork" / "conversations"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _all_store_dirs(project: str | None = None) -> list[tuple[str, Path]]:
    projects_store.ensure_projects_dir()
    if project and project != "all":
        try:
            name, base = projects_store.resolve_project(project)
        except FileNotFoundError:
            return []
        path = base / ".cowork" / "conversations"
        return [(name, path)] if path.is_dir() else []
    if project == "all":
        out: list[tuple[str, Path]] = []
        for proj in projects_store.list_projects():
            path = Path(proj["path"]) / ".cowork" / "conversations"
            if path.is_dir():
                out.append((proj["name"], path))
        return out
    name, base = projects_store.resolve_project(None)
    path = base / ".cowork" / "conversations"
    return [(name, path)] if path.is_dir() else []


def _atomic_write(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _path_for(project_name: str | None, conversation_id: str) -> Path:
    return _store_dir(project_name) / f"{conversation_id}.json"


def _find_path(conversation_id: str) -> tuple[str, Path] | None:
    for project_name, store in _all_store_dirs("all"):
        path = store / f"{conversation_id}.json"
        if path.is_file():
            return project_name, path
    return None


class CoworkConversationStore:
    def create(
        self,
        *,
        project: str | None,
        harness: str,
        inference: ResolvedInferenceProfile,
        conversation_id: str | None = None,
        title: str = "",
        disabled_connections: list[dict[str, Any]] | None = None,
    ) -> CoworkConversation:
        project_name, _base = projects_store.resolve_project(project)
        now = utc_now_iso()
        cid = conversation_id or new_id("conv")
        conv = CoworkConversation(
            id=cid,
            project_id=project_name,
            harness=harness,
            inference_profile=profile_for_storage(inference),
            title=title or "New task",
            preview=title[:80] if title else "",
            disabled_connections=disabled_connections or [],
            created_at=now,
            updated_at=now,
        )
        self.save(conv)
        return conv

    def save(self, conv: CoworkConversation) -> None:
        _atomic_write(_path_for(conv.project_id, conv.id), conv.model_dump())

    def get(self, conversation_id: str) -> CoworkConversation | None:
        found = _find_path(conversation_id)
        if not found:
            return None
        _project, path = found
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return CoworkConversation.model_validate(data)
        except Exception:
            return None

    def list(self, *, limit: int = 200, project: str | None = None) -> list[dict[str, Any]]:
        out: list[CoworkConversation] = []
        for _project_name, store in _all_store_dirs(project):
            for path in store.glob("*.json"):
                try:
                    out.append(CoworkConversation.model_validate_json(path.read_text(encoding="utf-8")))
                except Exception:
                    continue
        out.sort(key=lambda item: item.updated_at or item.created_at, reverse=True)
        return [self.meta(item) for item in out[:limit]]

    def meta(self, conv: CoworkConversation) -> dict[str, Any]:
        return {
            "id": conv.id,
            "title": conv.title or "Untitled task",
            "turns": len([m for m in conv.messages if m.role == "user"]),
            "preview": conv.preview,
            "created_at": conv.created_at,
            "updated_at": conv.updated_at,
            "project": conv.project_id,
            "harness": conv.harness,
            "inferenceProfile": conv.inference_profile,
            "disabled_connections": conv.disabled_connections,
        }

    def append_message(self, conv: CoworkConversation, message: CoworkMessage) -> CoworkConversation:
        now = utc_now_iso()
        message.created_at = message.created_at or now
        message.updated_at = now
        conv.messages.append(message)
        if message.role == "user":
            text = message.content.strip()
            if text:
                if not conv.preview:
                    conv.preview = text[:80]
                if not conv.title or conv.title == "New task":
                    conv.title = text[:80]
        conv.updated_at = now
        self.save(conv)
        return conv

    def start_turn(self, conv: CoworkConversation, user_message_id: str) -> tuple[CoworkConversation, CoworkTurn, CoworkMessage]:
        now = utc_now_iso()
        assistant = CoworkMessage(role="assistant", content="", created_at=now, updated_at=now)
        turn = CoworkTurn(
            user_message_id=user_message_id,
            assistant_message_id=assistant.id,
            started_at=now,
        )
        assistant.turn_id = turn.id
        for msg in conv.messages:
            if msg.id == user_message_id:
                msg.turn_id = turn.id
                break
        conv.messages.append(assistant)
        conv.turns.append(turn)
        conv.updated_at = now
        self.save(conv)
        return conv, turn, assistant

    def append_event(self, conv: CoworkConversation, turn_id: str, event: CoworkEvent) -> CoworkConversation:
        for turn in conv.turns:
            if turn.id == turn_id:
                turn.events.append(event)
                break
        if event.type == "response.delta":
            delta = str(event.payload.get("delta") or "")
            if delta:
                self.append_assistant_delta(conv, turn_id, delta, save=False)
        elif event.type == "response.failed":
            legacy = event.payload.get("legacy")
            text = (
                str(event.payload.get("message") or event.payload.get("error") or "")
                or (str(legacy.get("error") or "") if isinstance(legacy, dict) else "")
            )
            if text:
                self.append_assistant_delta(conv, turn_id, text, save=False)
        elif event.type == "artifact.created":
            artifact = event.payload.get("artifact")
            if isinstance(artifact, dict):
                conv.artifacts.append(artifact)
        conv.updated_at = utc_now_iso()
        self.save(conv)
        return conv

    def add_approval(self, conv: CoworkConversation, turn_id: str, approval: CoworkApprovalRequest) -> CoworkConversation:
        for turn in conv.turns:
            if turn.id == turn_id:
                if not any(existing.id == approval.id for existing in turn.approvals):
                    turn.approvals.append(approval)
                break
        conv.updated_at = utc_now_iso()
        self.save(conv)
        return conv

    def find_approval(self, approval_id: str) -> tuple[CoworkConversation, CoworkApprovalRequest] | None:
        for _project_name, store_dir in _all_store_dirs("all"):
            for path in store_dir.glob("*.json"):
                try:
                    conv = CoworkConversation.model_validate_json(path.read_text(encoding="utf-8"))
                except Exception:
                    continue
                for turn in conv.turns:
                    for approval in turn.approvals:
                        if approval.id == approval_id:
                            return conv, approval
        return None

    def update_approval(self, approval_id: str, status: str) -> tuple[CoworkConversation, CoworkApprovalRequest] | None:
        found = self.find_approval(approval_id)
        if not found:
            return None
        conv, _approval = found
        for turn in conv.turns:
            for approval in turn.approvals:
                if approval.id == approval_id:
                    if status in {"pending", "approved", "denied", "expired", "bypassed"}:
                        approval.status = status  # type: ignore[assignment]
                    approval.decided_at = utc_now_iso()
                    conv.updated_at = utc_now_iso()
                    self.save(conv)
                    return conv, approval
        return None

    def append_assistant_delta(self, conv: CoworkConversation, turn_id: str, delta: str, *, save: bool = True) -> None:
        now = utc_now_iso()
        for msg in conv.messages:
            if msg.role == "assistant" and msg.turn_id == turn_id:
                msg.content += delta
                msg.updated_at = now
                break
        if save:
            conv.updated_at = now
            self.save(conv)

    def finish_turn(self, conv: CoworkConversation, turn_id: str, status: str, error: str | None = None) -> CoworkConversation:
        now = utc_now_iso()
        for turn in conv.turns:
            if turn.id == turn_id:
                if status in {"completed", "failed", "cancelled", "partial"}:
                    turn.status = status  # type: ignore[assignment]
                turn.completed_at = now
                turn.error = error
                break
        conv.updated_at = now
        self.save(conv)
        return conv

    def display_messages(self, conv: CoworkConversation) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        events_by_turn = {turn.id: turn.events for turn in conv.turns}
        started_by_turn = {turn.id: turn.started_at for turn in conv.turns}
        for msg in conv.messages:
            entry: dict[str, Any] = {
                "role": msg.role,
                "content": msg.content,
            }
            if msg.role == "assistant" and msg.turn_id:
                legacy_events = []
                for event in events_by_turn.get(msg.turn_id, []):
                    legacy = event.payload.get("legacy")
                    if not isinstance(legacy, dict):
                        payloads = iter_sse_payloads(cowork_event_to_legacy_sse(event))
                        legacy = payloads[0][1] if payloads else None
                    if isinstance(legacy, dict) and legacy.get("type") != "response.output_text.delta":
                        legacy_events.append(legacy)
                if legacy_events:
                    entry["events"] = legacy_events
                approvals = [
                    approval.model_dump()
                    for turn in conv.turns
                    if turn.id == msg.turn_id
                    for approval in turn.approvals
                ]
                if approvals:
                    entry["approvals"] = approvals
                started = started_by_turn.get(msg.turn_id)
                if started:
                    entry["startedAt"] = started
            messages.append(entry)
        return messages

    def update(self, conversation_id: str, **patch: Any) -> dict[str, Any] | None:
        conv = self.get(conversation_id)
        if not conv:
            return None
        if "title" in patch and patch["title"] is not None:
            conv.title = str(patch["title"]).strip() or conv.title
        if "disabled_connections" in patch and patch["disabled_connections"] is not None:
            conv.disabled_connections = patch["disabled_connections"]
        conv.updated_at = utc_now_iso()
        self.save(conv)
        return self.meta(conv)

    def move(self, conversation_id: str, target_project: str) -> dict[str, Any] | None:
        conv = self.get(conversation_id)
        found = _find_path(conversation_id)
        if not conv or not found:
            return None
        _old_project, old_path = found
        target_name, _target_base = projects_store.resolve_project(target_project)
        conv.project_id = target_name
        conv.updated_at = utc_now_iso()
        self.save(conv)
        try:
            old_path.unlink()
        except FileNotFoundError:
            pass
        return self.meta(conv)

    def delete(self, conversation_id: str) -> bool:
        found = _find_path(conversation_id)
        if not found:
            return False
        _project, path = found
        path.unlink()
        return True

    def delete_turn(self, conversation_id: str, assistant_index: int) -> dict[str, Any] | None:
        conv = self.get(conversation_id)
        if not conv:
            return None
        assistant_messages = [m for m in conv.messages if m.role == "assistant"]
        if assistant_index < 0 or assistant_index >= len(assistant_messages):
            return None
        target = assistant_messages[assistant_index]
        turn_id = target.turn_id
        conv.messages = [m for m in conv.messages if m.turn_id != turn_id]
        conv.turns = [t for t in conv.turns if t.id != turn_id]
        conv.updated_at = utc_now_iso()
        self.save(conv)
        return {"status": "deleted", "id": conversation_id, "turn_index": assistant_index}


store = CoworkConversationStore()
