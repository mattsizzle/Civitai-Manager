import json
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..core.config import _load_settings
from ..core.downloader import _do_download, _downloads, _save_preview_image, _write_model_json
from ..core.files import (
    _extract_ids, _fetch_model_and_version, _json_format,
    _load_sidecar, _resolve_local_file,
)

router = APIRouter()

MODEL_EXTS = {".safetensors", ".pt", ".ckpt", ".pth", ".bin"}
_PREVIEW_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

_SKIP_DIRS = {
    # Linux
    ".trash", ".local", ".cache", "lost+found", "proc", "sys", "dev", "run",
    # macOS
    ".trashes", ".spotlight-v100", ".fseventsd", ".documentrevisions-v100",
    ".temporaryitems", ".ds_store", "__macosx",
    # Windows
    "system volume information", "$recycle.bin", "$recycler", "recycled",
    "recovery", "config.msi",
    # Generic hidden / version-control
    ".git", ".svn", ".hg", "__pycache__", "node_modules",
}


class LocalFileReq(BaseModel):
    path: str


@router.get("/api/local-files")
def list_local_files(subdir: str = ""):
    s = _load_settings()
    dl_dir = s.get("download_dir", "")
    if not dl_dir:
        return {"files": [], "dirs": [], "error": "Download directory not configured"}
    root = Path(dl_dir).resolve()
    if not root.exists():
        return {"files": [], "dirs": [], "error": f"Directory not found: {dl_dir}"}
    if subdir:
        cur = (root / subdir).resolve()
        if not cur.is_relative_to(root):
            raise HTTPException(403)
    else:
        cur = root

    files, dirs = [], []
    for entry in sorted(cur.iterdir(), key=lambda e: e.name.lower()):
        if entry.is_dir():
            if entry.name.lower() in _SKIP_DIRS or entry.name.startswith('.'):
                continue
            dirs.append({"name": entry.name, "path": str(entry.relative_to(root))})
        elif entry.is_file() and entry.suffix.lower() in MODEL_EXTS:
            info = None
            jp = entry.with_suffix(".json")
            if jp.exists():
                try:
                    info = json.loads(jp.read_text())
                except Exception:
                    pass
            preview_rel = None
            for ext in (".png", ".jpg", ".jpeg", ".webp"):
                img = entry.with_suffix(ext)
                if img.exists():
                    preview_rel = str(img.relative_to(root))
                    break
            files.append({
                "name": entry.name,
                "path": str(entry.relative_to(root)),
                "size": entry.stat().st_size,
                "info": info,
                "preview": preview_rel,
            })
    return {"files": files, "dirs": dirs, "directory": dl_dir, "subdir": subdir}


@router.get("/api/local-dirs")
def list_local_dirs():
    s = _load_settings()
    dl_dir = s.get("download_dir", "")
    if not dl_dir:
        return {"dirs": []}
    root = Path(dl_dir).resolve()
    if not root.exists():
        return {"dirs": []}
    dirs = sorted(
        [str(p.relative_to(root)) for p in root.rglob("*")
         if p.is_dir()
         and not any(part.lower() in _SKIP_DIRS or part.startswith('.') for part in p.parts[len(root.parts):])],
        key=str.lower,
    )
    return {"dirs": dirs}


@router.get("/api/local-files/image")
def local_image(path: str):
    s = _load_settings()
    root = Path(s.get("download_dir", "")).resolve()
    img_path = (root / path).resolve()
    if not img_path.is_relative_to(root):
        raise HTTPException(403)
    if not img_path.exists():
        raise HTTPException(404)
    return FileResponse(img_path)


@router.post("/api/local-files/delete")
def delete_model(req: LocalFileReq):
    _, file_path = _resolve_local_file(req.path)
    if not file_path.exists():
        raise HTTPException(404, "File not found")
    deleted = []
    for p in [
        file_path,
        file_path.with_suffix(".json"),
        *[file_path.with_suffix(ext) for ext in _PREVIEW_EXTS],
    ]:
        if p.exists():
            p.unlink()
            deleted.append(p.name)
    return {"ok": True, "deleted": deleted}


@router.post("/api/local-files/refresh-meta")
def refresh_meta(req: LocalFileReq):
    _, file_path = _resolve_local_file(req.path)
    info = _load_sidecar(file_path)
    model_id, version_id = _extract_ids(info, file_path.name)
    if not model_id:
        raise HTTPException(400, "No model ID found in JSON")
    s = _load_settings()
    model, version = _fetch_model_and_version(model_id, version_id)
    _write_model_json(model, str(file_path.parent), file_path.stem)
    _save_preview_image(version, str(file_path.parent), file_path.stem, s.get("api_key", ""), force=True)
    return {"ok": True}


@router.post("/api/local-files/redownload")
def redownload_file(req: LocalFileReq, bg: BackgroundTasks):
    _, file_path = _resolve_local_file(req.path)
    info = _load_sidecar(file_path)
    model_id, version_id = _extract_ids(info, file_path.name)
    if not version_id:
        raise HTTPException(400, "No version ID found in JSON")

    fmt = _json_format(info)
    if fmt == "full_model":
        versions = info.get("modelVersions", [])
        version_stub = next((v for v in versions if v.get("id") == version_id),
                            versions[0] if versions else {})
        files = version_stub.get("files", [])
        primary = next((f for f in files if f.get("primary")), files[0] if files else None)
        dl_url = (primary.get("downloadUrl") if primary
                  else f"https://civitai.com/api/download/models/{version_id}")
        model_stub = info
    else:
        model_stub, version_stub = _fetch_model_and_version(model_id, version_id)
        files = version_stub.get("files", [])
        primary = next((f for f in files if f.get("primary")), files[0] if files else None)
        dl_url = (primary.get("downloadUrl") if primary
                  else f"https://civitai.com/api/download/models/{version_id}")

    if not dl_url:
        raise HTTPException(400, "Could not determine download URL")

    s = _load_settings()
    dl_id = str(uuid.uuid4())
    _downloads[dl_id] = {"status": "starting", "downloaded": 0, "total": 0, "path": "", "error": ""}
    bg.add_task(_do_download, dl_id, dl_url, str(file_path.parent),
                s.get("api_key", ""), model_stub, version_stub, primary)
    return {"id": dl_id}
