import re
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from ..core.config import _load_settings
from ..core.downloader import _do_download, _downloads, _save_preview_image, _write_model_json

router = APIRouter()


class DownloadReq(BaseModel):
    url: str
    model: dict
    version: dict
    file: Optional[dict] = None
    subdir: str = ""
    stem: str = ""


class SaveInfoReq(BaseModel):
    model: dict
    version: Optional[dict] = None


@router.post("/api/download")
def start_download(req: DownloadReq, bg: BackgroundTasks):
    s = _load_settings()
    dl_dir = s.get("download_dir", str(Path.home() / "civitai_models"))
    if req.subdir:
        root = Path(dl_dir).resolve()
        sub = (root / req.subdir).resolve()
        if not sub.is_relative_to(root):
            raise HTTPException(403)
        dl_dir = str(sub)
    Path(dl_dir).mkdir(parents=True, exist_ok=True)
    dl_id = str(uuid.uuid4())
    _downloads[dl_id] = {"status": "starting", "downloaded": 0, "total": 0, "path": "", "error": ""}
    bg.add_task(_do_download, dl_id, req.url, dl_dir, s.get("api_key", ""),
                req.model, req.version, req.file, req.stem)
    return {"id": dl_id}


@router.get("/api/download/{dl_id}")
def download_status(dl_id: str):
    d = _downloads.get(dl_id)
    if not d:
        raise HTTPException(404)
    return d


@router.post("/api/download/{dl_id}/cancel")
def cancel_download(dl_id: str):
    if dl_id in _downloads:
        _downloads[dl_id]["cancelled"] = True
    return {"ok": True}


@router.post("/api/save-info")
def save_info(req: SaveInfoReq):
    s = _load_settings()
    dl_dir = s.get("download_dir", str(Path.home() / "civitai_models"))
    Path(dl_dir).mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^\w\- ]", "_", req.model.get("name", "model"))[:60]
    _write_model_json(req.model, dl_dir)
    if req.version:
        _save_preview_image(req.version, dl_dir, safe, s.get("api_key", ""))
    return {"ok": True}
