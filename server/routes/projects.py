"""Projects — folder-as-id workspaces under a single common directory.

Mirrors the original antontron IPC handlers (src/main/index.ts):
  GET    /v1/projects               → list
  POST   /v1/projects               → create
  GET    /v1/projects/active        → current active project name
  PUT    /v1/projects/active        → set active project name
  PATCH  /v1/projects/{name}        → rename
  DELETE /v1/projects/{name}        → delete
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from anton_api import projects_store


router = APIRouter()
logger = logging.getLogger(__name__)


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


class SetActiveRequest(BaseModel):
    name: str


@router.get("")
async def list_projects():
    return {"projects": projects_store.list_projects()}


@router.post("")
async def create_project(req: CreateProjectRequest):
    try:
        return projects_store.create_project(req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/active")
async def get_active_project():
    return {"name": projects_store.get_active()}


@router.put("/active")
async def set_active_project(req: SetActiveRequest):
    try:
        return {"name": projects_store.set_active(req.name)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/{name}")
async def rename_project(name: str, req: RenameProjectRequest):
    try:
        return projects_store.rename_project(name, req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{name}")
async def delete_project(name: str):
    try:
        deleted = projects_store.delete_project(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"status": "deleted", "name": name}
