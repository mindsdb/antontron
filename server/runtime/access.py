"""Cowork-owned access policy and approval event helpers."""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from routes.cowork_state import load_state

from .schemas import (
    CoworkAccessDecision,
    CoworkAccessPolicy,
    CoworkApprovalRequest,
    CoworkEvent,
    CoworkResourceRef,
    ProjectContext,
    new_id,
    now_ms,
)


APP_INTERNAL_PARTS = {".cowork", ".anton"}
SECRET_NAMES = {".env", "credentials.json", "secrets.json", "id_rsa", "id_ed25519"}

WRITE_WORDS = re.compile(r"\b(write|edit|modify|update|delete|remove|overwrite|save|create|change|patch)\b", re.I)
FILE_WORDS = re.compile(r"\b(file|folder|directory|project|repo|markdown|md|json|py|js|ts|tsx|jsx|csv|txt|pptx|docx)\b", re.I)
PUBLISH_WORDS = re.compile(r"\b(publish|deploy|share|make public|go live)\b", re.I)
PACKAGE_WORDS = re.compile(r"\b(pip|npm|pnpm|yarn|uv|brew)\s+install\b|\binstall\s+(a\s+)?(package|dependency|library)\b", re.I)
SHELL_WORDS = re.compile(r"\b(run|execute)\s+(a\s+)?(shell|terminal|command)\b|\bterminal\b|\bshell\b", re.I)
CONNECTOR_MUTATION_WORDS = re.compile(r"\b(connect|save|create|update|delete|remove|modify)\s+(a\s+)?(connector|connection|datasource|data source)\b", re.I)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_approvals_mode(value: object) -> str:
    return "require" if str(value or "").strip().lower() == "require" else "off"


def current_approvals_mode() -> str:
    env_value = os.environ.get("COWORK_APPROVALS_MODE")
    if env_value:
        return normalize_approvals_mode(env_value)
    prefs = load_state().get("preferences", {})
    if not isinstance(prefs, dict):
        return "off"
    return normalize_approvals_mode(prefs.get("approvalsMode"))


def _resolve(path: str | Path) -> Path:
    return Path(path).expanduser().resolve(strict=False)


def _disabled_connector_ids(disabled_connections: list[dict[str, Any]] | None) -> list[str]:
    out: list[str] = []
    for item in disabled_connections or []:
        if not isinstance(item, dict):
            continue
        for key in ("id", "connector_id", "name", "label"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                out.append(value.strip())
                break
    return out


def build_access_policy(
    *,
    project_context: ProjectContext,
    artifact_root: str,
    uploads: list[dict[str, Any]] | None = None,
    disabled_connections: list[dict[str, Any]] | None = None,
    approvals_mode: str | None = None,
) -> CoworkAccessPolicy:
    project_root = str(_resolve(project_context.path))
    artifact = str(_resolve(artifact_root))
    upload_roots: list[str] = []
    for upload in uploads or []:
        if not isinstance(upload, dict):
            continue
        raw = upload.get("path") or upload.get("file_path") or upload.get("folder")
        if isinstance(raw, str) and raw.strip():
            upload_roots.append(str(_resolve(raw)))
    return CoworkAccessPolicy(
        approvals_mode=normalize_approvals_mode(approvals_mode),
        project_root=project_root,
        artifact_root=artifact,
        upload_roots=upload_roots,
        allowed_read_roots=[project_root, artifact, *upload_roots],
        allowed_write_roots=[artifact],
        disabled_connectors=_disabled_connector_ids(disabled_connections),
    )


def _inside(path: Path, root: str) -> bool:
    try:
        path.relative_to(_resolve(root))
        return True
    except (OSError, ValueError):
        return False


def _has_internal_or_secret_part(path: Path) -> bool:
    parts = set(path.parts)
    if parts.intersection(APP_INTERNAL_PARTS):
        return True
    return any(part in SECRET_NAMES or part.endswith(".pem") or part.endswith(".key") for part in path.parts)


def classify_resource(policy: CoworkAccessPolicy, resource: CoworkResourceRef) -> CoworkAccessDecision:
    if resource.resource_type == "connector":
        if resource.connector_id and resource.connector_id in set(policy.disabled_connectors):
            return CoworkAccessDecision(status="denied", reason="Connector is disabled for this conversation.", resource=resource)
        if resource.operation in {"mutate", "write"}:
            return CoworkAccessDecision(status="approval_required", reason="Connector changes require approval.", resource=resource)
        return CoworkAccessDecision(status="allowed", reason="Connector read is allowed.", resource=resource)

    if resource.resource_type in {"publish", "package"}:
        return CoworkAccessDecision(
            status="approval_required",
            reason=f"{resource.resource_type.capitalize()} actions require approval.",
            resource=resource,
        )

    if resource.resource_type == "shell":
        return CoworkAccessDecision(status="approval_required", reason="Shell execution requires approval.", resource=resource)

    if resource.resource_type == "browser":
        return CoworkAccessDecision(status="allowed", reason="Browser navigation is allowed.", resource=resource)

    if resource.resource_type == "artifact":
        if resource.operation in {"write", "mutate"}:
            return CoworkAccessDecision(status="allowed", reason="Artifact writes are allowed inside the artifact root.", resource=resource)
        return CoworkAccessDecision(status="allowed", reason="Artifact access is allowed.", resource=resource)

    if resource.resource_type != "file":
        return CoworkAccessDecision(status="denied", reason="Unknown resource type.", resource=resource)

    raw_path = resource.path
    if raw_path:
        path = _resolve(raw_path)
        if _has_internal_or_secret_part(path):
            return CoworkAccessDecision(status="denied", reason="App internals and secret files are not accessible.", resource=resource)
        if not any(_inside(path, root) for root in policy.allowed_read_roots):
            return CoworkAccessDecision(status="denied", reason="Path is outside the active project, uploads, and artifacts.", resource=resource)
        if resource.operation == "read":
            return CoworkAccessDecision(status="allowed", reason="Project reads are allowed.", resource=resource)
        if any(_inside(path, root) for root in policy.allowed_write_roots):
            return CoworkAccessDecision(status="allowed", reason="Artifact writes are allowed.", resource=resource)
        return CoworkAccessDecision(status="approval_required", reason="Project file modifications require approval.", resource=resource)

    if resource.operation in {"write", "mutate"}:
        return CoworkAccessDecision(status="approval_required", reason="Project file modifications require approval.", resource=resource)
    return CoworkAccessDecision(status="allowed", reason="Project reads are allowed.", resource=resource)


def preflight_resources(user_input: str) -> list[CoworkResourceRef]:
    text = user_input or ""
    resources: list[CoworkResourceRef] = []
    if PUBLISH_WORDS.search(text):
        resources.append(CoworkResourceRef(resource_type="publish", operation="publish", scope="publish", label="Publish artifact"))
    if PACKAGE_WORDS.search(text):
        resources.append(CoworkResourceRef(resource_type="package", operation="install", scope="package-install", label="Install package"))
    if CONNECTOR_MUTATION_WORDS.search(text):
        resources.append(CoworkResourceRef(resource_type="connector", operation="mutate", scope="connector", label="Modify connector"))
    if SHELL_WORDS.search(text):
        resources.append(CoworkResourceRef(resource_type="shell", operation="execute", scope="shell", label="Run shell command"))
    if WRITE_WORDS.search(text) and FILE_WORDS.search(text):
        resources.append(CoworkResourceRef(resource_type="file", operation="write", scope="project", label="Modify project files"))
    return resources


def approval_message(decision: CoworkAccessDecision) -> str:
    resource = decision.resource
    label = resource.label or resource.scope or resource.resource_type
    return f"{decision.reason} Approve {resource.operation} access for {label}?"


def make_approval(
    *,
    turn_id: str,
    decision: CoworkAccessDecision,
    status: str = "pending",
    message: str | None = None,
) -> CoworkApprovalRequest:
    now = utc_now_iso()
    return CoworkApprovalRequest(
        turn_id=turn_id,
        decision=decision,
        resource=decision.resource,
        status=status,  # type: ignore[arg-type]
        created_at=now,
        decided_at=now if status in {"approved", "denied", "bypassed", "expired"} else None,
        message=message or approval_message(decision),
    )


def event_for_approval(approval: CoworkApprovalRequest, event_type: str | None = None) -> CoworkEvent:
    kind = event_type or {
        "pending": "approval.required",
        "approved": "approval.granted",
        "denied": "approval.denied",
        "expired": "approval.denied",
        "bypassed": "approval.bypassed",
    }.get(approval.status, "approval.required")
    status = {
        "pending": "started",
        "approved": "completed",
        "denied": "failed",
        "expired": "failed",
        "bypassed": "completed",
    }.get(approval.status, "started")
    return CoworkEvent(
        type=kind,
        turn_id=approval.turn_id,
        at_ms=now_ms(),
        payload={
            "label": approval.message or approval.resource.label or "Approval required",
            "message": approval.message,
            "status": status,
            "approval_id": approval.id,
            "approval_status": approval.status,
            "resource": approval.resource.model_dump(),
            "decision": approval.decision.model_dump(),
        },
    )


def event_for_access_denied(turn_id: str, decision: CoworkAccessDecision) -> CoworkEvent:
    return CoworkEvent(
        type="access.denied",
        turn_id=turn_id,
        at_ms=now_ms(),
        payload={
            "label": "Access denied",
            "message": decision.reason,
            "status": "failed",
            "resource": decision.resource.model_dump(),
            "decision": decision.model_dump(),
        },
    )


def event_for_artifact_ignored(turn_id: str, path: str, reason: str) -> CoworkEvent:
    return CoworkEvent(
        type="artifact.ignored",
        turn_id=turn_id,
        at_ms=now_ms(),
        payload={
            "label": "Artifact ignored",
            "message": reason,
            "status": "failed",
            "path": path,
        },
    )


def file_resource_from_event(event: CoworkEvent) -> CoworkResourceRef | None:
    if event.type != "file.accessed":
        return None
    payload = event.payload
    path = str(payload.get("path") or payload.get("file_path") or "")
    mode = str(payload.get("mode") or "read").lower()
    operation = "write" if mode in {"write", "edit", "mutate"} else "read"
    return CoworkResourceRef(
        resource_type="file",
        operation=operation,  # type: ignore[arg-type]
        path=path,
        scope=path or "project",
        label=Path(path).name if path else "Project file",
        metadata={"tool_name": payload.get("tool_name") or ""},
    )


def event_fingerprint(event: CoworkEvent) -> str:
    payload = event.payload
    resource = payload.get("resource")
    if isinstance(resource, dict):
        return f"{event.type}:{resource.get('resource_type')}:{resource.get('operation')}:{resource.get('scope') or resource.get('path')}"
    return f"{event.type}:{payload.get('approval_id') or payload.get('path') or payload.get('label') or new_id('event')}"
