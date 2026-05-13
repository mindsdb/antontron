"""NanoClaw harness provider.

NanoClaw exposes a small HTTP gateway (see openclaw/nanoclaw `src/channels/
cowork.ts`) that wraps the standard router/delivery loop. Per-cowork-
conversation isolation comes from threading: cowork passes its conversation
id as `session_id`, which becomes NanoClaw's threadId, which resolves to a
per-thread session inside one synthetic `cowork:local` messaging group.

This module mirrors the shape of ``hermes_provider`` — storage of the
display-side history lives under ``<project>/.cowork/nanoclaw/episodes/``
because NanoClaw doesn't speak Anton's history format either.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator
from urllib import error as url_error
from urllib import request as url_request

from anton_api import projects_store
from anton_api.models import (
    ResponseObject,
    ResponseOutput,
    ResponseOutputContent,
    ResponseStatus,
    Role,
)

from .base import HarnessConfigurationError, HarnessRuntimeError
from .config import nanoclaw_agent_group_id, nanoclaw_api_key, nanoclaw_base_url


logger = logging.getLogger(__name__)

_TITLE_MAX_LEN = 160
_TITLE_WHITESPACE_RE = re.compile(r"\s+")
_ATTACHMENT_MARKER = "\n\nAttached context supplied by the user:"
_MAX_CONTEXT_CHARS = 18_000


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_conversation_id() -> str:
    return (
        datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        + "_"
        + uuid.uuid4().hex[:6]
    )


def _sanitize_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = _TITLE_WHITESPACE_RE.sub(" ", value).strip()
    if _ATTACHMENT_MARKER in cleaned:
        cleaned = cleaned.split(_ATTACHMENT_MARKER, 1)[0].strip()
    if not cleaned:
        return None
    return cleaned[:_TITLE_MAX_LEN].strip()


def _text_for_message(message: dict) -> str:
    content = message.get("content", "")
    if isinstance(content, list):
        return "\n".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return str(content or "")


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


class NanoclawHarnessProvider:
    id = "nanoclaw"
    label = "NanoClaw"

    async def health(self) -> dict:
        try:
            health_payload = await asyncio.to_thread(self._get_json, "/health", 2.0)
            ag_payload = await asyncio.to_thread(self._get_json, "/v1/agent_groups", 2.0)
            agent_groups = ag_payload if isinstance(ag_payload, list) else []
            return {
                "id": self.id,
                "label": self.label,
                "available": True,
                "base_url": self.base_url,
                "status": health_payload.get("status", "ok") if isinstance(health_payload, dict) else "ok",
                "agent_groups": agent_groups,
                "agent_group_id": self.agent_group_id,
            }
        except Exception as exc:
            return {
                "id": self.id,
                "label": self.label,
                "available": False,
                "base_url": self.base_url,
                "error": str(exc),
            }

    @property
    def base_url(self) -> str:
        return nanoclaw_base_url()

    @property
    def api_key(self) -> str:
        return nanoclaw_api_key()

    @property
    def agent_group_id(self) -> str:
        return nanoclaw_agent_group_id()

    def list_live(self) -> list[str]:
        return []

    async def close_all(self) -> None:
        return None

    # ------------------------------------------------------------------
    # Conversation storage — mirrors hermes_provider's layout under a
    # different subdirectory so the two harnesses don't collide.
    # ------------------------------------------------------------------

    def _project_base(self, project: str | None) -> Path:
        projects_store.ensure_general_project()
        try:
            _, base = projects_store.resolve_project(project)
            return base
        except FileNotFoundError:
            if project:
                logger.info(
                    "Project '%s' no longer exists on disk; falling back to active project.",
                    project,
                )
            _, base = projects_store.resolve_project(None)
            return base

    def _episodes_dir(self, project: str | None) -> Path:
        return self._project_base(project) / ".cowork" / "nanoclaw" / "episodes"

    def _ensure_episodes_dir(self, project: str | None) -> Path:
        return _ensure_dir(self._episodes_dir(project))

    def _candidate_episode_dirs(self, project: str | None = None) -> list[tuple[str, Path]]:
        projects_store.ensure_projects_dir()
        if project == "all":
            out: list[tuple[str, Path]] = []
            for proj in projects_store.list_projects():
                ep = Path(proj["path"]) / ".cowork" / "nanoclaw" / "episodes"
                if ep.is_dir():
                    out.append((proj["name"], ep))
            return out
        if project:
            try:
                _, base = projects_store.resolve_project(project)
            except FileNotFoundError:
                return []
            ep = base / ".cowork" / "nanoclaw" / "episodes"
            return [(project, ep)] if ep.is_dir() else []
        project_name, base = projects_store.resolve_project(None)
        ep = base / ".cowork" / "nanoclaw" / "episodes"
        return [(project_name, ep)] if ep.is_dir() else []

    def _find_conversation_dir(self, conversation_id: str) -> tuple[str, Path] | None:
        for project_name, ep_dir in self._candidate_episode_dirs("all"):
            for suffix in ("_meta.json", "_history.json", "_turns.json"):
                if (ep_dir / f"{conversation_id}{suffix}").is_file():
                    return project_name, ep_dir
        return None

    @staticmethod
    def _atomic_write(path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            os.replace(tmp, str(path))
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise

    def _load_json(self, path: Path, fallback: Any) -> Any:
        if not path.is_file():
            return fallback
        try:
            loaded = json.loads(path.read_text(encoding="utf-8"))
            return loaded if loaded is not None else fallback
        except Exception:
            return fallback

    def _meta_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_meta.json"

    def _history_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_history.json"

    def _turns_path(self, project: str | None, conversation_id: str) -> Path:
        return self._episodes_dir(project) / f"{conversation_id}_turns.json"

    def _load_meta(self, project: str | None, conversation_id: str) -> dict | None:
        data = self._load_json(self._meta_path(project, conversation_id), None)
        return data if isinstance(data, dict) else None

    def _load_history(self, project: str | None, conversation_id: str) -> list[dict]:
        data = self._load_json(self._history_path(project, conversation_id), [])
        return data if isinstance(data, list) else []

    def _save_history(self, project: str | None, conversation_id: str, history: list[dict]) -> None:
        self._atomic_write(self._history_path(project, conversation_id), history)

    def _save_meta(self, project: str | None, conversation_id: str, meta: dict) -> None:
        self._atomic_write(self._meta_path(project, conversation_id), meta)

    def _conversation_project(self, conversation_id: str, fallback: str | None = None) -> str | None:
        located = self._find_conversation_dir(conversation_id)
        if located:
            return located[0]
        return fallback

    def _ensure_conversation(
        self,
        *,
        conversation_id: str | None,
        project: str | None,
        first_user_input: str,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None, dict, list[dict]]:
        cid = conversation_id or _new_conversation_id()
        project_name = self._conversation_project(cid, project)
        if project_name is None:
            try:
                project_name, _ = projects_store.resolve_project(project)
            except FileNotFoundError:
                project_name = projects_store.get_active()
        self._ensure_episodes_dir(project_name)

        history = self._load_history(project_name, cid)
        meta = self._load_meta(project_name, cid) or {}
        now = _now_iso()
        preview = _sanitize_title(first_user_input) or cid
        meta.setdefault("id", cid)
        meta.setdefault("title", preview[:80])
        meta.setdefault("created_at", now)
        meta["updated_at"] = now
        meta["project"] = project_name
        meta["harness"] = self.id
        meta["preview"] = meta.get("preview") or preview[:60]
        meta["turns"] = sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user")
        if disabled_connections is not None:
            meta["disabled_connections"] = disabled_connections
        else:
            meta.setdefault("disabled_connections", [])
        self._save_meta(project_name, cid, meta)
        return cid, project_name, meta, history

    def _append_message(self, project: str | None, conversation_id: str, role: str, content: str) -> list[dict]:
        history = self._load_history(project, conversation_id)
        history.append({"role": role, "content": content})
        self._save_history(project, conversation_id, history)

        meta = self._load_meta(project, conversation_id) or {"id": conversation_id}
        now = _now_iso()
        meta["updated_at"] = now
        meta.setdefault("created_at", now)
        meta["project"] = project
        meta["harness"] = self.id
        meta["turns"] = sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user")
        user_preview = next(
            (_sanitize_title(_text_for_message(msg)) for msg in history if isinstance(msg, dict) and msg.get("role") == "user"),
            None,
        )
        if user_preview:
            meta.setdefault("title", user_preview[:80])
            meta["preview"] = user_preview[:60]
        self._save_meta(project, conversation_id, meta)
        return history

    def list_conversations(self, limit: int = 200, project: str | None = None) -> list[dict]:
        out: list[dict] = []
        for project_name, ep_dir in self._candidate_episode_dirs(project):
            for path in ep_dir.iterdir():
                if not path.name.endswith(("_meta.json", "_history.json")):
                    continue
                cid = path.name.removesuffix("_meta.json").removesuffix("_history.json")
                if any(conv["id"] == cid for conv in out):
                    continue
                meta = self._load_json(ep_dir / f"{cid}_meta.json", {})
                if not isinstance(meta, dict):
                    meta = {}
                history = self._load_json(ep_dir / f"{cid}_history.json", [])
                if not isinstance(history, list):
                    history = []
                preview = ""
                for msg in history:
                    if isinstance(msg, dict) and msg.get("role") == "user":
                        preview = (_sanitize_title(_text_for_message(msg)) or "")[:60]
                        break
                meta.setdefault("id", cid)
                meta.setdefault("title", preview[:80] or cid)
                meta.setdefault("preview", preview)
                meta.setdefault("created_at", "")
                meta.setdefault("updated_at", "")
                meta["project"] = meta.get("project") or project_name
                meta["harness"] = self.id
                meta["turns"] = meta.get("turns") or sum(
                    1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user"
                )
                meta.setdefault("disabled_connections", [])
                out.append(meta)
        out.sort(key=lambda r: r.get("updated_at") or r.get("created_at") or "", reverse=True)
        return out[:limit]

    def get_conversation(self, conversation_id: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        project_name, ep = located
        meta = self._load_json(ep / f"{conversation_id}_meta.json", {})
        if not isinstance(meta, dict):
            meta = {}
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        if not isinstance(history, list):
            history = []
        meta.setdefault("id", conversation_id)
        meta.setdefault("project", project_name)
        meta.setdefault("harness", self.id)
        meta.setdefault("turns", sum(1 for msg in history if isinstance(msg, dict) and msg.get("role") == "user"))
        meta.setdefault("disabled_connections", [])
        return meta

    def get_messages(self, conversation_id: str) -> list[dict] | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        return history if isinstance(history, list) else []

    def load_turns(self, conversation_id: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        payload = self._load_json(ep / f"{conversation_id}_turns.json", None)
        return payload if isinstance(payload, dict) else None

    def record_turn_events(self, conversation_id: str, started_at_ms: int | None, events: list[dict]) -> None:
        if not events:
            return
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return
        _, ep = located
        path = ep / f"{conversation_id}_turns.json"
        payload = self._load_json(path, {})
        if not isinstance(payload, dict):
            payload = {}
        by_turn = payload.get("by_assistant_turn")
        if not isinstance(by_turn, dict):
            by_turn = {}
        history = self._load_json(ep / f"{conversation_id}_history.json", [])
        assistant_count = 0
        last_was_assistant = False
        if isinstance(history, list):
            for msg in history:
                if not isinstance(msg, dict) or msg.get("role") not in {"user", "assistant"}:
                    continue
                if msg.get("role") == "assistant":
                    if not last_was_assistant:
                        assistant_count += 1
                    last_was_assistant = True
                else:
                    last_was_assistant = False
        index = max(assistant_count - 1, 0)
        by_turn[str(index)] = {"started_at": started_at_ms, "events": events}
        payload["by_assistant_turn"] = by_turn
        self._atomic_write(path, payload)

    def update_conversation(self, conversation_id: str, **patch) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        project_name, ep = located
        path = ep / f"{conversation_id}_meta.json"
        meta = self._load_json(path, {})
        if not isinstance(meta, dict):
            meta = {}
        for key, value in patch.items():
            if key == "title":
                cleaned = _sanitize_title(value)
                if cleaned:
                    meta["title"] = cleaned
            elif key == "disabled_connections" and value is not None:
                meta["disabled_connections"] = value
        meta["id"] = conversation_id
        meta["project"] = project_name
        meta["harness"] = self.id
        meta["updated_at"] = _now_iso()
        self._atomic_write(path, meta)
        return meta

    def delete_turn(self, conversation_id: str, turn_index: int) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        _, ep = located
        history_path = ep / f"{conversation_id}_history.json"
        history = self._load_json(history_path, [])
        if not isinstance(history, list):
            return None
        user_indices = [
            index for index, msg in enumerate(history)
            if isinstance(msg, dict) and msg.get("role") == "user" and _text_for_message(msg)
        ]
        if turn_index < 0 or turn_index >= len(user_indices):
            return None
        start = user_indices[turn_index]
        end = user_indices[turn_index + 1] if turn_index + 1 < len(user_indices) else len(history)
        new_history = history[:start] + history[end:]
        self._atomic_write(history_path, new_history)

        turns_path = ep / f"{conversation_id}_turns.json"
        turns = self._load_json(turns_path, {})
        if isinstance(turns, dict):
            by_turn = turns.get("by_assistant_turn")
            if isinstance(by_turn, dict):
                shifted: dict[str, Any] = {}
                for key, value in by_turn.items():
                    try:
                        idx = int(key)
                    except (TypeError, ValueError):
                        continue
                    if idx == turn_index:
                        continue
                    if idx > turn_index:
                        idx -= 1
                    shifted[str(idx)] = value
                turns["by_assistant_turn"] = shifted
                self._atomic_write(turns_path, turns)
        return {
            "conversation_id": conversation_id,
            "turn_index": turn_index,
            "removed_count": end - start,
            "remaining_messages": len(new_history),
        }

    def delete_conversation(self, conversation_id: str) -> bool:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return False
        _, ep = located
        found = False
        for suffix in ("_meta.json", "_history.json", "_turns.json"):
            path = ep / f"{conversation_id}{suffix}"
            if path.is_file():
                try:
                    path.unlink()
                    found = True
                except Exception:
                    pass
        return found

    def move_conversation(self, conversation_id: str, target_project: str) -> dict | None:
        located = self._find_conversation_dir(conversation_id)
        if not located:
            return None
        src_project, src_ep = located
        if src_project == target_project:
            return self.get_conversation(conversation_id)
        _, target_base = projects_store.resolve_project(target_project)
        target_ep = target_base / ".cowork" / "nanoclaw" / "episodes"
        target_ep.mkdir(parents=True, exist_ok=True)
        moved = False
        for suffix in ("_meta.json", "_history.json", "_turns.json"):
            src = src_ep / f"{conversation_id}{suffix}"
            if not src.is_file():
                continue
            dst = target_ep / f"{conversation_id}{suffix}"
            try:
                src.replace(dst)
                moved = True
            except Exception:
                logger.debug("Could not move NanoClaw conversation file", exc_info=True)
        if not moved:
            return None
        meta_path = target_ep / f"{conversation_id}_meta.json"
        meta = self._load_json(meta_path, {})
        if not isinstance(meta, dict):
            meta = {"id": conversation_id}
        meta["project"] = target_project
        meta["harness"] = self.id
        meta["updated_at"] = _now_iso()
        self._atomic_write(meta_path, meta)
        return meta

    # ------------------------------------------------------------------
    # Streaming and NanoClaw gateway mapping
    # ------------------------------------------------------------------

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> AsyncIterator[str]:
        cid, project_name, _meta, _history_before = self._ensure_conversation(
            conversation_id=conversation_id,
            project=project,
            first_user_input=user_input,
            disabled_connections=disabled_connections,
        )
        self._append_message(project_name, cid, "user", user_input)

        recorded_events: list[dict] = []
        started_at_ms: int | None = None
        collected_text: list[str] = []
        seq = 0
        resp_id = f"resp-{uuid.uuid4().hex[:12]}"
        msg_id = f"msg-{uuid.uuid4().hex[:12]}"

        def _event(event_type: str, data: dict) -> str:
            nonlocal started_at_ms
            if "at_ms" not in data:
                data["at_ms"] = int(time.time() * 1000)
            if started_at_ms is None:
                started_at_ms = data["at_ms"]
            recorded_events.append({**data})
            return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

        try:
            agent_group_id = self.agent_group_id
            if not agent_group_id:
                raise HarnessConfigurationError(
                    "No NanoClaw agent group selected. Pick one in Settings → Harness."
                )

            health = await self.health()
            if not health.get("available"):
                raise HarnessConfigurationError(
                    f"NanoClaw is not reachable at {self.base_url}: {health.get('error') or 'unknown error'}"
                )

            resp = ResponseObject(id=resp_id, model="nanoclaw", status=ResponseStatus.created)
            seq += 1
            yield _event(
                "response.created",
                {
                    "type": "response.created",
                    "sequence_number": seq,
                    "response": resp.model_dump(),
                    "conversation_id": cid,
                },
            )

            run_id = await self._create_run(
                user_input=user_input,
                session_id=cid,
                agent_group_id=agent_group_id,
            )
            run_failed_error: str | None = None
            async for event in self._iter_run_events(run_id):
                event_name = str(event.get("event") or event.get("type") or "")
                if event_name == "message.delta":
                    delta = str(event.get("delta") or "")
                    if not delta:
                        continue
                    collected_text.append(delta)
                    seq += 1
                    yield _event(
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "sequence_number": seq,
                            "item_id": msg_id,
                            "delta": delta,
                        },
                    )
                elif event_name == "message.structured":
                    # Cards / structured payloads from NanoClaw. Surface them
                    # as a generic in-progress note so cowork's Thinking block
                    # has something to display; the renderer falls back to a
                    # text summary when it doesn't recognize the kind.
                    kind = str(event.get("kind") or "structured")
                    summary = f"Received {kind} payload"
                    seq += 1
                    yield _event(
                        "response.in_progress",
                        {
                            "type": "response.in_progress",
                            "sequence_number": seq,
                            "thought_role": Role.thought_progress.value,
                            "phase": "structured",
                            "progress_status": "completed",
                            "message": summary,
                            "content": summary,
                            "kind": kind,
                            "payload": event.get("content"),
                        },
                    )
                elif event_name == "run.failed":
                    run_failed_error = str(event.get("error") or "NanoClaw run failed")
                    break
                elif event_name == "run.completed":
                    break
                # run.created and any unknown events are ignored — cowork's UI
                # only needs delta/completion to render a turn.

            if run_failed_error:
                raise HarnessRuntimeError(run_failed_error)

            full_text = "".join(collected_text)
            self._append_message(project_name, cid, "assistant", full_text)
            completed = ResponseObject(
                id=resp_id,
                model="nanoclaw",
                status=ResponseStatus.completed,
                output=[
                    ResponseOutput(
                        id=msg_id,
                        status=ResponseStatus.completed,
                        content=[ResponseOutputContent(text=full_text)],
                    )
                ],
            )
            seq += 1
            yield _event(
                "response.completed",
                {
                    "type": "response.completed",
                    "sequence_number": seq,
                    "response": completed.model_dump(),
                },
            )
        except HarnessConfigurationError as exc:
            logger.warning("NanoClaw configuration error: %s", exc)
            yield _event(
                "response.failed",
                {"type": "response.failed", "code": "config_required", "error": str(exc)},
            )
        except Exception as exc:
            logger.exception("NanoClaw response stream failed")
            yield _event(
                "response.failed",
                {"type": "response.failed", "code": "nanoclaw_error", "error": str(exc) or "NanoClaw failed"},
            )
        finally:
            if recorded_events:
                try:
                    self.record_turn_events(cid, started_at_ms, recorded_events)
                except Exception:
                    logger.debug("Could not record NanoClaw turn events", exc_info=True)

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict] | None,
    ) -> tuple[str, str | None]:
        collected: list[str] = []
        seen_conversation_id = conversation_id
        async for chunk in self.stream_response(
            user_input=user_input,
            conversation_id=conversation_id,
            project=project,
            model=model,
            disabled_connections=disabled_connections,
        ):
            for payload in self._payloads_from_sse(chunk):
                if payload.get("type") == "response.created":
                    seen_conversation_id = payload.get("conversation_id") or seen_conversation_id
                elif payload.get("type") == "response.output_text.delta":
                    collected.append(str(payload.get("delta") or ""))
                elif payload.get("type") == "response.failed":
                    raise HarnessRuntimeError(str(payload.get("error") or "NanoClaw failed"))
        return "".join(collected), seen_conversation_id

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _get_json(self, path: str, timeout: float) -> Any:
        url = f"{self.base_url}{path}"
        req = url_request.Request(url, headers=self._headers(), method="GET")
        try:
            with url_request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return json.loads(body) if body else {}
        except url_error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise HarnessRuntimeError(f"{path} returned HTTP {exc.code}: {body[:300]}") from exc
        except url_error.URLError as exc:
            raise HarnessRuntimeError(str(exc.reason)) from exc

    def _post_json(self, path: str, payload: dict, timeout: float) -> dict:
        url = f"{self.base_url}{path}"
        req = url_request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        try:
            with url_request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
                return json.loads(body) if body else {}
        except url_error.HTTPError as exc:
            body = exc.read().decode("utf-8", "replace")
            raise HarnessRuntimeError(f"{path} returned HTTP {exc.code}: {body[:300]}") from exc
        except url_error.URLError as exc:
            raise HarnessRuntimeError(str(exc.reason)) from exc

    async def _create_run(
        self,
        *,
        user_input: str,
        session_id: str,
        agent_group_id: str,
    ) -> str:
        payload: dict[str, Any] = {
            "input": user_input,
            "session_id": session_id,
            "agent_group_id": agent_group_id,
        }
        data = await asyncio.to_thread(self._post_json, "/v1/runs", payload, 20.0)
        run_id = data.get("run_id") or data.get("id")
        if not run_id:
            raise HarnessRuntimeError("NanoClaw did not return a run_id.")
        return str(run_id)

    async def _iter_run_events(self, run_id: str) -> AsyncIterator[dict]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[object] = asyncio.Queue()
        url = f"{self.base_url}/v1/runs/{run_id}/events"

        def push(item: object) -> None:
            asyncio.run_coroutine_threadsafe(queue.put(item), loop)

        def worker() -> None:
            try:
                req = url_request.Request(url, headers=self._headers(), method="GET")
                with url_request.urlopen(req, timeout=600.0) as resp:
                    data_lines: list[str] = []
                    event_name = "message"
                    for raw in resp:
                        line = raw.decode("utf-8", "replace").rstrip("\r\n")
                        if not line:
                            if data_lines:
                                payload = "\n".join(data_lines)
                                data_lines = []
                                if payload.strip() == "[DONE]":
                                    break
                                try:
                                    parsed = json.loads(payload)
                                    if isinstance(parsed, dict):
                                        parsed.setdefault("event", event_name)
                                    else:
                                        parsed = {"event": event_name, "data": parsed}
                                    push(parsed)
                                except Exception:
                                    push({"event": event_name, "raw": payload})
                            event_name = "message"
                            continue
                        if line.startswith("event:"):
                            event_name = line[6:].strip() or "message"
                        elif line.startswith("data:"):
                            data_lines.append(line[5:].lstrip())
            except Exception as exc:
                push(exc)
            finally:
                push(None)

        thread = threading.Thread(target=worker, name="nanoclaw-run-events", daemon=True)
        thread.start()
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise HarnessRuntimeError(str(item)) from item
            if isinstance(item, dict):
                yield item

    @staticmethod
    def _payloads_from_sse(chunk: str) -> list[dict]:
        payloads: list[dict] = []
        for block in chunk.split("\n\n"):
            data_lines = [
                line[5:].lstrip()
                for line in block.splitlines()
                if line.startswith("data:")
            ]
            if not data_lines:
                continue
            try:
                parsed = json.loads("\n".join(data_lines))
                if isinstance(parsed, dict):
                    payloads.append(parsed)
            except Exception:
                continue
        return payloads
