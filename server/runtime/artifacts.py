"""Cowork-owned artifact roots and validation."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any


logger = logging.getLogger(__name__)

HOUSEKEEPING_FILES = {"metadata.json", "README.md", ".published.json"}


def artifact_root_for_project(project_dir: Path) -> Path:
    return project_dir / "artifacts"


def ensure_artifact_root(project_dir: Path) -> Path:
    root = artifact_root_for_project(project_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def path_is_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def user_files(folder: Path) -> list[Path]:
    files: list[Path] = []
    try:
        for path in folder.rglob("*"):
            if not path.is_file() or path.is_symlink():
                continue
            rel = path.relative_to(folder)
            if rel.parts and rel.parts[0] in HOUSEKEEPING_FILES:
                continue
            if ".cowork-preview" in path.parts:
                continue
            files.append(path)
    except OSError:
        return []
    try:
        files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        pass
    return files


def pick_primary(folder: Path, files: list[Path], primary_hint: str | None = None) -> Path | None:
    if primary_hint:
        try:
            target = (folder / primary_hint).resolve()
            target.relative_to(folder.resolve())
            if target.is_file():
                return target
        except (OSError, ValueError):
            return None
    if not files:
        return None
    index = next((path for path in files if path.name == "index.html"), None)
    if index is not None:
        return index
    html = next((path for path in files if path.suffix.lower() == ".html"), None)
    return html or files[0]


def artifact_folder_mtime(folder: Path) -> float:
    latest = 0.0
    for path in folder.rglob("*"):
        if not path.is_file():
            continue
        try:
            latest = max(latest, path.stat().st_mtime)
        except OSError:
            continue
    return latest


def artifact_payload_from_folder(folder: Path, *, root: Path | None = None) -> dict[str, Any] | None:
    root = root or folder.parent
    try:
        resolved_folder = folder.resolve()
        resolved_root = root.resolve()
        resolved_folder.relative_to(resolved_root)
    except (OSError, ValueError):
        logger.warning("Ignoring artifact outside root: %s", folder)
        return None

    metadata_path = folder / "metadata.json"
    if not metadata_path.is_file():
        return None
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except Exception:
        logger.warning("Ignoring artifact with invalid metadata JSON: %s", metadata_path)
        return None
    if not isinstance(metadata, dict):
        logger.warning("Ignoring artifact metadata that is not an object: %s", metadata_path)
        return None

    files = user_files(folder)
    primary = pick_primary(
        folder,
        files,
        primary_hint=(
            metadata.get("primary")
            or metadata.get("primaryFile")
            or metadata.get("entrypoint")
        ),
    )
    if primary is None:
        logger.warning("Ignoring artifact without a primary file: %s", folder)
        return None
    if not path_is_inside(primary, folder):
        logger.warning("Ignoring artifact primary outside artifact folder: %s", primary)
        return None

    title = str(metadata.get("name") or metadata.get("title") or folder.name).strip() or folder.name
    description = str(metadata.get("description") or "").strip()
    try:
        primary_rel = str(primary.resolve().relative_to(folder.resolve()))
    except (OSError, ValueError):
        primary_rel = primary.name

    return {
        "id": metadata.get("id") or folder.name,
        "slug": str(metadata.get("slug") or folder.name),
        "title": title,
        "name": title,
        "description": description,
        "type": str(metadata.get("type") or "mixed"),
        "folder": str(folder.resolve()),
        "path": str(primary.resolve()),
        "file_path": str(primary.resolve()),
        "primary": primary_rel,
        "metadata_path": str(metadata_path.resolve()),
        "fileCount": len(files),
    }


def snapshot_artifacts(root: Path) -> dict[str, float]:
    if not root.is_dir():
        return {}
    snapshot: dict[str, float] = {}
    for metadata_path in root.glob("*/metadata.json"):
        if metadata_path.is_file():
            try:
                snapshot[str(metadata_path.parent.resolve())] = artifact_folder_mtime(metadata_path.parent)
            except OSError:
                continue
    return snapshot


def scan_artifacts(root: Path) -> list[dict[str, Any]]:
    if not root.is_dir():
        return []
    artifacts: list[dict[str, Any]] = []
    for metadata_path in sorted(root.glob("*/metadata.json")):
        payload = artifact_payload_from_folder(metadata_path.parent, root=root)
        if payload:
            artifacts.append(payload)
    return artifacts


def scan_updated_artifacts(root: Path, before: dict[str, float]) -> list[dict[str, Any]]:
    artifacts: list[dict[str, Any]] = []
    for payload in scan_artifacts(root):
        folder_text = str(payload.get("folder") or "")
        if not folder_text:
            continue
        folder = Path(folder_text)
        try:
            key = str(folder.resolve())
        except OSError:
            continue
        if key not in before or artifact_folder_mtime(folder) > before[key]:
            artifacts.append(payload)
    return artifacts


def scan_ignored_artifacts(root: Path, before: dict[str, float]) -> list[dict[str, str]]:
    ignored: list[dict[str, str]] = []
    if not root.is_dir():
        return ignored
    for folder in sorted(path for path in root.iterdir() if path.is_dir()):
        try:
            key = str(folder.resolve())
        except OSError:
            continue
        current_mtime = artifact_folder_mtime(folder)
        if key in before and current_mtime <= before[key]:
            continue
        metadata_path = folder / "metadata.json"
        if not metadata_path.exists():
            continue
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            ignored.append({"path": str(folder), "reason": "metadata.json is not valid JSON"})
            continue
        if not isinstance(metadata, dict):
            ignored.append({"path": str(folder), "reason": "metadata.json must contain a JSON object"})
            continue
        if artifact_payload_from_folder(folder, root=root) is None:
            ignored.append({"path": str(folder), "reason": "artifact metadata does not point to a valid primary file"})
    return ignored
