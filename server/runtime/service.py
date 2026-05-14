"""Cowork runtime orchestration behind /v1/responses."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import AsyncIterator, Any

from anton_api import projects_store
from harnesses.config import selected_harness_id
from harnesses.registry import get_harness_by_id

from .conversations import store
from .artifacts import ensure_artifact_root, scan_updated_artifacts, snapshot_artifacts
from .events import cowork_event_to_legacy_sse, iter_sse_payloads
from .inference import resolve_inference_profile, validate_inference_profile
from .schemas import (
    CoworkEvent,
    CoworkMessage,
    HarnessReadiness,
    HarnessTurnRequest,
    ProjectContext,
    ResolvedInferenceProfile,
)


logger = logging.getLogger(__name__)


class RuntimeService:
    def _project_context(self, project: str | None) -> ProjectContext:
        projects_store.ensure_general_project()
        try:
            name, base = projects_store.resolve_project(project)
        except FileNotFoundError:
            name, base = projects_store.resolve_project(None)
        return ProjectContext(id=name, name=name, path=str(base))

    def _artifact_root(self, project_name: str) -> str:
        return str(ensure_artifact_root(projects_store.project_path(project_name)))

    def _artifact_key(self, artifact: dict[str, Any]) -> str:
        return str(artifact.get("folder") or artifact.get("path") or artifact.get("file_path") or artifact.get("id") or "")

    def _artifact_event(self, turn_id: str, artifact: dict[str, Any]) -> CoworkEvent:
        title = str(artifact.get("title") or artifact.get("name") or "Artifact")
        legacy = {
            "type": "response.in_progress",
            "thought_role": "thought.progress",
            "phase": "artifact",
            "progress_status": "completed",
            "message": f"Created artifact: {title}",
            "content": title,
            "artifact": artifact,
        }
        return CoworkEvent(
            type="artifact.created",
            turn_id=turn_id,
            payload={
                "legacy": legacy,
                "legacy_type": "response.in_progress",
                "label": title,
                "status": "completed",
                "artifact": artifact,
            },
        )

    def _new_artifact_events(
        self,
        *,
        turn_id: str,
        artifact_root: str,
        before: dict[str, float],
        emitted: set[str],
    ) -> list[CoworkEvent]:
        events: list[CoworkEvent] = []
        for artifact in scan_updated_artifacts(Path(artifact_root), before):
            key = self._artifact_key(artifact)
            if key and key in emitted:
                continue
            if key:
                emitted.add(key)
            events.append(self._artifact_event(turn_id, artifact))
        return events

    def _failed_event(self, turn_id: str, code: str, message: str) -> CoworkEvent:
        legacy = {"type": "response.failed", "code": code, "error": message}
        return CoworkEvent(
            type="response.failed",
            turn_id=turn_id,
            payload={
                "legacy": legacy,
                "legacy_type": "response.failed",
                "code": code,
                "message": message,
                "label": "Response failed",
                "status": "failed",
            },
        )

    async def stream_response(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict[str, Any]] | None,
        attachment_ids: list[str] | None = None,
        harness_override: str | None = None,
        inference_override: dict[str, Any] | None = None,
    ) -> AsyncIterator[str]:
        del model, attachment_ids
        conv = store.get(conversation_id) if conversation_id else None
        if inference_override:
            try:
                inference = ResolvedInferenceProfile.model_validate(inference_override)
            except Exception:
                inference = resolve_inference_profile()
        elif conv is not None and conv.inference_profile:
            try:
                inference = ResolvedInferenceProfile.model_validate(conv.inference_profile)
            except Exception:
                inference = resolve_inference_profile()
        else:
            inference = resolve_inference_profile()
        if conv is None:
            harness_id = harness_override or selected_harness_id()
            project_context = self._project_context(project)
            conv = store.create(
                project=project_context.name,
                harness=harness_id,
                inference=inference,
                conversation_id=conversation_id,
                title=user_input.strip()[:80],
                disabled_connections=disabled_connections,
            )
        else:
            project_context = self._project_context(conv.project_id)
            harness_id = conv.harness

        harness = get_harness_by_id(harness_id)
        inference_ok, inference_error = validate_inference_profile(inference)
        artifact_root = self._artifact_root(project_context.name)
        readiness = harness.validate_request(
            HarnessTurnRequest(
                conversation_id=conv.id,
                turn_id="readiness",
                messages=conv.messages,
                user_input=user_input,
                project_context=project_context,
                disabled_connections=disabled_connections,
                inference=inference,
                artifact_root=artifact_root,
                harness_state=conv.harness_state,
            )
        )
        if not inference_ok:
            readiness = HarnessReadiness.fail("inference_not_ready", inference_error)
        user_message = CoworkMessage(role="user", content=user_input)
        conv = store.append_message(conv, user_message)
        conv, turn, _assistant = store.start_turn(conv, user_message.id)

        if not readiness.ready:
            failed = self._failed_event(turn.id, readiness.code or "not_ready", readiness.message or "Harness is not ready")
            store.append_event(conv, turn.id, failed)
            store.finish_turn(conv, turn.id, "failed", failed.payload.get("message"))
            yield cowork_event_to_legacy_sse(failed)
            return

        request = HarnessTurnRequest(
            conversation_id=conv.id,
            turn_id=turn.id,
            messages=conv.messages,
            user_input=user_input,
            project_context=project_context,
            disabled_connections=disabled_connections,
            inference=inference,
            artifact_root=artifact_root,
            harness_state=conv.harness_state,
            runtime_options={"cowork_canonical": True},
        )
        terminal_seen = False
        artifact_snapshot = snapshot_artifacts(Path(artifact_root))
        emitted_artifacts: set[str] = set()
        try:
            async for event in harness.start_turn(request):
                conv = store.get(conv.id) or conv
                store.append_event(conv, turn.id, event)
                if event.type == "artifact.created":
                    artifact = event.payload.get("artifact")
                    if isinstance(artifact, dict):
                        key = self._artifact_key(artifact)
                        if key:
                            emitted_artifacts.add(key)
                if event.type == "response.completed":
                    for artifact_event in self._new_artifact_events(
                        turn_id=turn.id,
                        artifact_root=artifact_root,
                        before=artifact_snapshot,
                        emitted=emitted_artifacts,
                    ):
                        store.append_event(conv, turn.id, artifact_event)
                        yield cowork_event_to_legacy_sse(artifact_event)
                    terminal_seen = True
                    store.finish_turn(conv, turn.id, "completed")
                elif event.type == "response.failed":
                    for artifact_event in self._new_artifact_events(
                        turn_id=turn.id,
                        artifact_root=artifact_root,
                        before=artifact_snapshot,
                        emitted=emitted_artifacts,
                    ):
                        store.append_event(conv, turn.id, artifact_event)
                        yield cowork_event_to_legacy_sse(artifact_event)
                    terminal_seen = True
                    message = str(event.payload.get("message") or event.payload.get("error") or "Response failed")
                    store.finish_turn(conv, turn.id, "failed", message)
                yield cowork_event_to_legacy_sse(event)
        except GeneratorExit:
            await harness.cancel_turn(turn.id)
            conv = store.get(conv.id) or conv
            store.finish_turn(conv, turn.id, "cancelled")
            raise
        except Exception as exc:
            logger.exception("Cowork runtime turn failed")
            conv = store.get(conv.id) or conv
            for artifact_event in self._new_artifact_events(
                turn_id=turn.id,
                artifact_root=artifact_root,
                before=artifact_snapshot,
                emitted=emitted_artifacts,
            ):
                store.append_event(conv, turn.id, artifact_event)
                yield cowork_event_to_legacy_sse(artifact_event)
            failed = self._failed_event(turn.id, "runtime_error", str(exc) or "Runtime error")
            store.append_event(conv, turn.id, failed)
            store.finish_turn(conv, turn.id, "failed", str(exc))
            terminal_seen = True
            yield cowork_event_to_legacy_sse(failed)
        finally:
            if not terminal_seen:
                conv = store.get(conv.id) or conv
                for artifact_event in self._new_artifact_events(
                    turn_id=turn.id,
                    artifact_root=artifact_root,
                    before=artifact_snapshot,
                    emitted=emitted_artifacts,
                ):
                    store.append_event(conv, turn.id, artifact_event)
                last = next((t for t in conv.turns if t.id == turn.id), None)
                if last and last.status == "running":
                    store.finish_turn(conv, turn.id, "partial")

    async def complete_text(
        self,
        *,
        user_input: str,
        conversation_id: str | None,
        project: str | None,
        model: str | None,
        disabled_connections: list[dict[str, Any]] | None,
        harness_override: str | None = None,
        inference_override: dict[str, Any] | None = None,
    ) -> tuple[str, str | None]:
        text: list[str] = []
        seen_id = conversation_id
        async for chunk in self.stream_response(
            user_input=user_input,
            conversation_id=conversation_id,
            project=project,
            model=model,
            disabled_connections=disabled_connections,
            harness_override=harness_override,
            inference_override=inference_override,
        ):
            for _event_type, payload in iter_sse_payloads(chunk):
                if payload.get("type") == "response.created":
                    seen_id = payload.get("conversation_id") or seen_id
                elif payload.get("type") == "response.output_text.delta":
                    text.append(str(payload.get("delta") or ""))
                elif payload.get("type") == "response.failed":
                    raise RuntimeError(str(payload.get("error") or "Response failed"))
        return "".join(text), seen_id


runtime_service = RuntimeService()
