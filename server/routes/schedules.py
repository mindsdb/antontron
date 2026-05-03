"""Local scheduled task APIs for Anton CoWork."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from anton_api import conversation_manager
from .cowork_state import load_state, save_state, utc_now_iso


router = APIRouter(prefix="/v1/schedules", tags=["schedules"])


def _task_title(content: str) -> str:
    text = (content or "").strip().splitlines()[0] if content else "Scheduled task"
    return text[:60] + ("…" if len(text) > 60 else "")

SERVER_STARTED_AT = datetime.now(timezone.utc)
_scheduler_task: asyncio.Task | None = None


class ScheduleRequest(BaseModel):
    title: str = Field(default="Scheduled task", max_length=160)
    prompt: str
    cadence: str = "once"
    timezone: str = "local"
    next_run_at: str
    project_path: str | None = None
    model: str | None = None
    enabled: bool = True


class ScheduleUpdateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    prompt: str | None = None
    cadence: str | None = None
    timezone: str | None = None
    next_run_at: str | None = None
    project_path: str | None = None
    model: str | None = None
    enabled: bool | None = None


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _new_schedule_id() -> str:
    return f"sch_{uuid.uuid4().hex[:14]}"


def _normalise_cadence(value: str) -> str:
    cadence = value.strip().lower()
    if cadence not in {"once", "hourly", "daily", "weekly"}:
        raise HTTPException(status_code=400, detail="Cadence must be once, hourly, daily, or weekly.")
    return cadence


def _mark_missed(state: dict) -> bool:
    changed = False
    now = datetime.now(timezone.utc)
    for schedule in state.get("schedules", []):
        if not schedule.get("enabled"):
            continue
        if schedule.get("catchupPending"):
            continue
        next_run = _parse_datetime(schedule.get("nextRunAt"))
        if next_run and next_run < SERVER_STARTED_AT and next_run < now:
            schedule["catchupPending"] = True
            schedule["updatedAt"] = utc_now_iso()
            changed = True
    return changed


def _advance_schedule(schedule: dict) -> None:
    cadence = schedule.get("cadence", "once")
    if cadence == "once":
        schedule["enabled"] = False
        return
    next_run = _parse_datetime(schedule.get("nextRunAt")) or datetime.now(timezone.utc)
    delta = {
        "hourly": timedelta(hours=1),
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
    }[cadence]
    now = datetime.now(timezone.utc)
    while next_run <= now:
        next_run += delta
    schedule["nextRunAt"] = next_run.isoformat()


def _serialise_schedule(request: ScheduleRequest) -> dict:
    cadence = _normalise_cadence(request.cadence)
    next_run = _parse_datetime(request.next_run_at)
    if not next_run:
        raise HTTPException(status_code=400, detail="Next run time must be a valid ISO datetime.")
    now = utc_now_iso()
    return {
        "id": _new_schedule_id(),
        "title": request.title.strip() or _task_title(request.prompt),
        "prompt": request.prompt,
        "cadence": cadence,
        "timezone": request.timezone or "local",
        "nextRunAt": next_run.isoformat(),
        "enabled": request.enabled,
        "projectPath": request.project_path,
        "model": request.model,
        "lastRunAt": None,
        "lastResultSessionId": None,
        "lastError": None,
        "catchupPending": False,
        "createdAt": now,
        "updatedAt": now,
    }


async def _run_schedule(schedule: dict, manual: bool = False) -> dict:
    from anton.core.llm.provider import StreamTextDelta

    title = schedule.get("title") or _task_title(schedule.get("prompt", "Scheduled task"))
    task = {
        "title": title,
        "summary": "Scheduled Anton task",
        "projectPath": schedule.get("projectPath"),
        "model": schedule.get("model"),
        "status": "running",
        "createdAt": utc_now_iso(),
        "updatedAt": utc_now_iso(),
        "scheduledId": schedule.get("id"),
        "attachments": [],
        "messages": [
            {
                "role": "user",
                "content": schedule.get("prompt", ""),
                "createdAt": utc_now_iso(),
                "attachments": [],
            }
        ],
    }

    conversation_id: str | None = None
    try:
        event_stream, conversation_id = await conversation_manager.chat_stream(
            schedule.get("prompt", ""),
            project_path=schedule.get("projectPath"),
            model=schedule.get("model"),
        )
        task["id"] = conversation_id
        parts: list[str] = []
        async for event in event_stream:
            if isinstance(event, StreamTextDelta):
                parts.append(event.text)
        answer = "".join(parts).strip()
        task["messages"].append({"role": "assistant", "content": answer, "createdAt": utc_now_iso()})
        task["status"] = "idle"
        task["updatedAt"] = utc_now_iso()
        schedule["lastError"] = None
    except Exception as exc:
        if conversation_id is None:
            conversation_id = f"sched_{uuid.uuid4().hex[:12]}"
            task["id"] = conversation_id
        task["status"] = "error"
        task["error"] = str(exc)
        task["updatedAt"] = utc_now_iso()
        schedule["lastError"] = str(exc)

    schedule["lastRunAt"] = utc_now_iso()
    schedule["lastResultSessionId"] = conversation_id
    schedule["catchupPending"] = False
    if not manual:
        _advance_schedule(schedule)
    schedule["updatedAt"] = utc_now_iso()
    return {"schedule": schedule, "session": task}


async def _scheduler_loop() -> None:
    while True:
        await asyncio.sleep(30)
        state = load_state()
        now = datetime.now(timezone.utc)
        changed = _mark_missed(state)
        for schedule in state.get("schedules", []):
            if not schedule.get("enabled") or schedule.get("catchupPending"):
                continue
            next_run = _parse_datetime(schedule.get("nextRunAt"))
            if not next_run or next_run > now:
                continue
            await _run_schedule(schedule, manual=False)
            changed = True
        if changed:
            save_state(state)


def start_scheduler() -> None:
    global _scheduler_task
    if _scheduler_task and not _scheduler_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _scheduler_task = loop.create_task(_scheduler_loop())


@router.get("")
def list_schedules():
    state = load_state()
    if _mark_missed(state):
        save_state(state)
    return {"schedules": state.get("schedules", [])}


@router.post("")
def create_schedule(request: ScheduleRequest):
    state = load_state()
    schedule = _serialise_schedule(request)
    state["schedules"].insert(0, schedule)
    save_state(state)
    return {"schedule": schedule}


@router.put("/{schedule_id}")
def update_schedule(schedule_id: str, request: ScheduleUpdateRequest):
    state = load_state()
    schedule = next((item for item in state.get("schedules", []) if item.get("id") == schedule_id), None)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    if request.title is not None:
        schedule["title"] = request.title.strip() or schedule["title"]
    if request.prompt is not None:
        schedule["prompt"] = request.prompt
    if request.cadence is not None:
        schedule["cadence"] = _normalise_cadence(request.cadence)
    if request.timezone is not None:
        schedule["timezone"] = request.timezone or "local"
    if request.next_run_at is not None:
        next_run = _parse_datetime(request.next_run_at)
        if not next_run:
            raise HTTPException(status_code=400, detail="Next run time must be a valid ISO datetime.")
        schedule["nextRunAt"] = next_run.isoformat()
        schedule["catchupPending"] = False
    if request.project_path is not None:
        schedule["projectPath"] = request.project_path
    if request.model is not None:
        schedule["model"] = request.model
    if request.enabled is not None:
        schedule["enabled"] = request.enabled
        if request.enabled:
            schedule["catchupPending"] = False
    schedule["updatedAt"] = utc_now_iso()
    save_state(state)
    return {"schedule": schedule}


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str):
    state = load_state()
    before = len(state.get("schedules", []))
    state["schedules"] = [item for item in state.get("schedules", []) if item.get("id") != schedule_id]
    if len(state["schedules"]) == before:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    save_state(state)
    return {"ok": True}


@router.post("/{schedule_id}/pause")
def pause_schedule(schedule_id: str):
    return update_schedule(schedule_id, ScheduleUpdateRequest(enabled=False))


@router.post("/{schedule_id}/resume")
def resume_schedule(schedule_id: str):
    return update_schedule(schedule_id, ScheduleUpdateRequest(enabled=True))


@router.post("/{schedule_id}/run-now")
async def run_schedule_now(schedule_id: str):
    state = load_state()
    schedule = next((item for item in state.get("schedules", []) if item.get("id") == schedule_id), None)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    result = await _run_schedule(schedule, manual=True)
    save_state(state)
    return result
