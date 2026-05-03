"""
Projects — Anton workspace folders containing a .anton/ directory.
Scans common local locations without walking the whole home directory.
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

TINTS = [
    ("rgba(31,156,176,0.12)", "var(--primary-700)"),
    ("rgba(72,190,227,0.14)", "#276F86"),
    ("rgba(120,186,172,0.18)", "#3D6159"),
    ("rgba(244,177,131,0.15)", "#B7522B"),
]

SKIP_DIRS = {
    ".cache",
    ".git",
    ".venv",
    "Library",
    "Movies",
    "Music",
    "node_modules",
}


def _candidate_roots() -> list[tuple[Path, int]]:
    """Return roots and search depth for likely Anton workspaces."""
    home = Path.home()
    roots = [
        (home, 1),
        (home / "Desktop", 4),
        (home / "Documents", 4),
        (home / "Projects", 4),
        (home / "Downloads", 4),
        (Path.cwd(), 2),
    ]
    return roots


def discover_workspace_paths() -> list[Path]:
    """Find local Anton workspace directories, including nested recent work."""
    found: dict[str, Path] = {}

    def add(path: Path) -> None:
        try:
            expanded = path.expanduser().absolute()
            key = str(expanded.resolve())
        except Exception:
            return
        if (expanded / ".anton").is_dir():
            found[key] = expanded

    def walk(root: Path, remaining_depth: int) -> None:
        if not root.exists() or root.name in SKIP_DIRS:
            return
        add(root)
        if remaining_depth <= 0:
            return
        try:
            children = sorted(root.iterdir(), key=lambda item: item.name.lower())
        except (OSError, PermissionError):
            return
        for child in children:
            if not child.is_dir() or child.name.startswith(".") or child.name in SKIP_DIRS:
                continue
            if (child / ".anton").is_dir():
                add(child)
            walk(child, remaining_depth - 1)

    for root, depth in _candidate_roots():
        walk(root, depth)

    return sorted(found.values(), key=lambda path: str(path).lower())


def _scan_for_workspaces() -> list[dict]:
    """Scan common directories for Anton workspaces (.anton/ subdirectory)."""
    found: dict[str, dict] = {}
    for path in discover_workspace_paths():
        _add_workspace(path, found)

    workspaces = list(found.values())
    return workspaces


def _add_workspace(path: Path, found: dict):
    key = str(path)
    if key in found:
        return

    anton_dir = path / ".anton"
    task_count = _count_jsonl(anton_dir / "episodes")
    file_count = _count_files(path)
    description = _read_description(path)
    tint, color = TINTS[len(found) % len(TINTS)]

    found[key] = {
        "id": path.name,
        "name": path.name,
        "path": str(path),
        "description": description or f"Workspace at {path}",
        "taskCount": task_count,
        "fileCount": file_count,
        "updated": _mtime(path),
        "tint": tint,
        "color": color,
    }


def _count_jsonl(p: Path) -> int:
    if not p.is_dir():
        return 0
    return len(list(p.glob("*.jsonl")))


def _count_files(p: Path) -> int:
    if p == Path.home():
        return 0

    max_count = 10000
    count = 0
    try:
        for child in p.iterdir():
            if child.name.startswith("."):
                continue
            if child.is_file():
                count += 1
            elif child.is_dir():
                for f in child.rglob("*"):
                    if f.is_file() and not any(part.startswith(".") for part in f.relative_to(p).parts):
                        count += 1
                        if count >= max_count:
                            return max_count
            if count >= max_count:
                return max_count
        return count
    except Exception:
        return 0


def _read_description(path: Path) -> str:
    """Read first non-heading line from .anton/anton.md if it exists."""
    md = path / ".anton" / "anton.md"
    if not md.exists():
        return ""
    try:
        for line in md.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                return line[:100]
    except Exception:
        pass
    return ""


def _mtime(p: Path) -> str:
    import time
    try:
        secs = time.time() - p.stat().st_mtime
        if secs < 3600:    return f"{int(secs // 60)}m ago"
        if secs < 86400:   return f"{int(secs // 3600)}h ago"
        if secs < 604800:  return f"{int(secs // 86400)}d ago"
        return f"{int(secs // 604800)}w ago"
    except Exception:
        return "—"


@router.get("")
async def list_projects():
    return _scan_for_workspaces()


class CreateProjectRequest(BaseModel):
    name: str
    path: str | None = None


@router.post("")
async def create_project(req: CreateProjectRequest):
    base = Path(req.path) if req.path else Path.home() / "Projects"
    target = base / req.name
    try:
        target.mkdir(parents=True, exist_ok=True)
        (target / ".anton").mkdir(exist_ok=True)
        (target / ".anton" / "episodes").mkdir(exist_ok=True)
        (target / ".anton" / "memory").mkdir(exist_ok=True)
        (target / ".anton" / "output").mkdir(exist_ok=True)
        (target / ".anton" / "context").mkdir(exist_ok=True)
        anton_md = target / ".anton" / "anton.md"
        if not anton_md.exists():
            anton_md.write_text(f"# {req.name}\n\nProject context for Anton.\n", encoding="utf-8")
        return {
            "id": req.name,
            "name": req.name,
            "path": str(target),
            "description": "New Anton workspace",
            "taskCount": 0,
            "fileCount": 0,
            "updated": "just now",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
