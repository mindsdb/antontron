"""Typed runtime schemas for Cowork-owned conversations and harness turns."""

from __future__ import annotations

import time
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


CoworkEventType = Literal[
    "response.created",
    "response.completed",
    "response.failed",
    "response.cancelled",
    "message.delta",
    "reasoning",
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
    "artifact.created",
    "artifact.ignored",
]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def now_ms() -> int:
    return int(time.time() * 1000)


class ResolvedInferenceProfile(BaseModel):
    id: str = "default"
    provider_type: str = "unknown"
    provider_label: str = "Unknown"
    base_url: str = ""
    api_key_ref: str = ""
    planning_provider_type: str = ""
    planning_provider_label: str = ""
    planning_base_url: str = ""
    planning_api_key_ref: str = ""
    coding_provider_type: str = ""
    coding_provider_label: str = ""
    coding_base_url: str = ""
    coding_api_key_ref: str = ""
    planning_model: str = ""
    coding_model: str = ""
    capabilities: dict[str, bool] = Field(default_factory=dict)

    def safe_dump(self) -> dict[str, Any]:
        return self.model_dump()


class HarnessCapabilities(BaseModel):
    memory: bool = False
    skills: bool = False
    artifacts: bool = True
    streaming: bool = True
    tool_progress: bool = True
    cancellation: bool = False
    sidecar: bool = False
    approval_mode: Literal["none", "preflight", "live_pause", "audit_only"] = "audit_only"
    file_access_reporting: Literal["none", "heuristic", "structured"] = "heuristic"
    tool_event_reporting: Literal["none", "basic", "structured"] = "basic"
    native_memory_mode: str = ""
    native_skills_mode: str = ""
    session_memory_snapshot: bool = False


class HarnessHealth(BaseModel):
    id: str
    label: str
    available: bool
    error: str = ""
    details: dict[str, Any] = Field(default_factory=dict)


class HarnessReadiness(BaseModel):
    ready: bool
    code: str = ""
    message: str = ""

    @classmethod
    def ok(cls) -> "HarnessReadiness":
        return cls(ready=True)

    @classmethod
    def fail(cls, code: str, message: str) -> "HarnessReadiness":
        return cls(ready=False, code=code, message=message)


class CoworkMessage(BaseModel):
    id: str = Field(default_factory=lambda: new_id("msg"))
    role: Literal["user", "assistant", "system"] = "user"
    content: str = ""
    turn_id: str | None = None
    created_at: str = ""
    updated_at: str = ""


class CoworkEvent(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: str = Field(default="cowork.event.v1", alias="schema")
    type: CoworkEventType
    turn_id: str
    at_ms: int = Field(default_factory=now_ms)
    payload: dict[str, Any] = Field(default_factory=dict)


class CoworkResourceRef(BaseModel):
    resource_type: Literal["file", "connector", "publish", "package", "shell", "browser", "artifact"]
    operation: Literal["read", "write", "mutate", "install", "publish", "execute"]
    scope: str = ""
    label: str = ""
    path: str = ""
    connector_id: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class CoworkAccessDecision(BaseModel):
    status: Literal["allowed", "approval_required", "denied"]
    reason: str = ""
    resource: CoworkResourceRef


class CoworkApprovalRequest(BaseModel):
    id: str = Field(default_factory=lambda: new_id("approval"))
    turn_id: str
    resource: CoworkResourceRef
    decision: CoworkAccessDecision
    status: Literal["pending", "approved", "denied", "expired", "bypassed"] = "pending"
    created_at: str = ""
    decided_at: str | None = None
    expires_at: str | None = None
    message: str = ""


class CoworkApprovalDecision(BaseModel):
    decision: Literal["approved", "denied"]


class CoworkAccessPolicy(BaseModel):
    approvals_mode: Literal["off", "require"] = "off"
    project_root: str
    artifact_root: str
    upload_roots: list[str] = Field(default_factory=list)
    allowed_read_roots: list[str] = Field(default_factory=list)
    allowed_write_roots: list[str] = Field(default_factory=list)
    denied_path_parts: list[str] = Field(default_factory=lambda: [".cowork", ".anton"])
    disabled_connectors: list[str] = Field(default_factory=list)


class CoworkTurn(BaseModel):
    id: str = Field(default_factory=lambda: new_id("turn"))
    status: Literal["running", "completed", "failed", "cancelled", "partial"] = "running"
    user_message_id: str
    assistant_message_id: str | None = None
    events: list[CoworkEvent] = Field(default_factory=list)
    approvals: list[CoworkApprovalRequest] = Field(default_factory=list)
    started_at: str = ""
    completed_at: str | None = None
    error: str | None = None


class CoworkConversation(BaseModel):
    id: str
    project_id: str
    harness: str
    inference_profile: dict[str, Any] = Field(default_factory=dict)
    title: str = ""
    preview: str = ""
    messages: list[CoworkMessage] = Field(default_factory=list)
    turns: list[CoworkTurn] = Field(default_factory=list)
    uploads: list[dict[str, Any]] = Field(default_factory=list)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
    harness_state: dict[str, Any] = Field(default_factory=dict)
    disabled_connections: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class ProjectContext(BaseModel):
    id: str
    name: str
    path: str


class HarnessTurnRequest(BaseModel):
    conversation_id: str
    turn_id: str
    messages: list[CoworkMessage]
    user_input: str
    project_context: ProjectContext
    uploads: list[dict[str, Any]] = Field(default_factory=list)
    disabled_connections: list[dict[str, Any]] | None = None
    inference: ResolvedInferenceProfile
    artifact_root: str
    approvals_mode: Literal["off", "require"] = "off"
    access_policy: CoworkAccessPolicy | None = None
    approval_grants: list[CoworkApprovalRequest] = Field(default_factory=list)
    interactive_approvals: bool = True
    runtime_options: dict[str, Any] = Field(default_factory=dict)
    harness_state: dict[str, Any] = Field(default_factory=dict)
