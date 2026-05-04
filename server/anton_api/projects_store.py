"""Projects store — folder-as-id workspaces under a single common directory.

Mirrors the original antontron model in src/main/index.ts:
  <projects_dir>/<name>/.anton/...   one folder per project
  <projects_dir>/../state.json       { "activeProject": "<name>" }

The projects dir is taken from ANTON_PROJECTS_DIR (set by Electron to
app.getPath('userData')/projects), with ~/.antontron/projects as the fallback
for standalone server runs.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import TypedDict


logger = logging.getLogger(__name__)


DEFAULT_PROJECT = "default"
# General is the orphan-fallback project surfaced to the client when a
# task has no project assigned. We always keep it provisioned so the
# UI can confidently route there.
GENERAL_PROJECT = "general"
_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")


class Project(TypedDict):
    name: str
    path: str


def projects_dir() -> Path:
    env = os.environ.get("ANTON_PROJECTS_DIR")
    base = Path(env).expanduser() if env else Path.home() / ".antontron" / "projects"
    return base.resolve()


def _state_path() -> Path:
    return projects_dir().parent / "state.json"


def project_path(name: str) -> Path:
    return projects_dir() / name


def sanitize_name(name: str) -> str:
    cleaned = _NAME_RE.sub("-", (name or "").strip()).strip("-._")
    return cleaned[:64]


def ensure_projects_dir() -> Path:
    p = projects_dir()
    p.mkdir(parents=True, exist_ok=True)
    return p


def _scaffold(target: Path) -> None:
    (target / ".anton").mkdir(parents=True, exist_ok=True)


def ensure_default_project() -> None:
    ensure_projects_dir()
    default_dir = project_path(DEFAULT_PROJECT)
    if not default_dir.exists():
        default_dir.mkdir(parents=True, exist_ok=True)
    _scaffold(default_dir)
    # Also provision the orphan-fallback "general" project so the
    # client can always route there for unassigned tasks.
    ensure_general_project()


def ensure_general_project() -> None:
    ensure_projects_dir()
    general_dir = project_path(GENERAL_PROJECT)
    if not general_dir.exists():
        general_dir.mkdir(parents=True, exist_ok=True)
    _scaffold(general_dir)


def list_projects() -> list[Project]:
    ensure_projects_dir()
    out: list[Project] = []
    for child in sorted(projects_dir().iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir() or child.name.startswith("."):
            continue
        out.append({"name": child.name, "path": str(child)})
    return out


def create_project(name: str) -> Project:
    sanitized = sanitize_name(name)
    if not sanitized:
        raise ValueError("Invalid project name")
    ensure_projects_dir()
    target = project_path(sanitized)
    if target.exists():
        raise FileExistsError("Project already exists")
    target.mkdir(parents=True)
    _scaffold(target)
    return {"name": sanitized, "path": str(target)}


def rename_project(old_name: str, new_name: str) -> Project:
    if old_name == DEFAULT_PROJECT:
        raise ValueError("Cannot rename default project")
    sanitized = sanitize_name(new_name)
    if not sanitized:
        raise ValueError("Invalid project name")
    old_dir = project_path(old_name)
    new_dir = project_path(sanitized)
    if not old_dir.exists():
        raise FileNotFoundError("Project not found")
    if new_dir.exists():
        raise FileExistsError("Project already exists")
    old_dir.rename(new_dir)
    state = _read_state()
    if state.get("activeProject") == old_name:
        _write_state({"activeProject": sanitized})
    return {"name": sanitized, "path": str(new_dir)}


def delete_project(name: str) -> bool:
    if name == DEFAULT_PROJECT:
        raise ValueError("Cannot delete default project")
    target = project_path(name)
    if not target.exists():
        return False
    shutil.rmtree(target)
    state = _read_state()
    if state.get("activeProject") == name:
        _write_state({"activeProject": DEFAULT_PROJECT})
    return True


def _read_state() -> dict:
    path = _state_path()
    if not path.is_file():
        return {"activeProject": DEFAULT_PROJECT}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"activeProject": DEFAULT_PROJECT}
        if not data.get("activeProject"):
            data["activeProject"] = DEFAULT_PROJECT
        return data
    except Exception:
        return {"activeProject": DEFAULT_PROJECT}


def _write_state(state: dict) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, str(path))
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def get_active() -> str:
    name = _read_state().get("activeProject") or DEFAULT_PROJECT
    if not project_path(name).exists():
        ensure_default_project()
        _write_state({"activeProject": DEFAULT_PROJECT})
        return DEFAULT_PROJECT
    return name


def set_active(name: str) -> str:
    if not project_path(name).exists():
        raise FileNotFoundError("Project not found")
    _write_state({"activeProject": name})
    return name


def resolve_project(name: str | None) -> tuple[str, Path]:
    """Return (name, path) for an explicit name or the active project."""
    target_name = name or get_active()
    target_path = project_path(target_name)
    if not target_path.exists():
        raise FileNotFoundError(f"Project not found: {target_name}")
    return target_name, target_path
