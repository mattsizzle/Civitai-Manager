from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel

from ..core.config import _load_settings, _save_settings

router = APIRouter()


class SettingsIn(BaseModel):
    api_key: str = ""
    download_dir: str = ""


@router.get("/api/settings")
def get_settings():
    return _load_settings()


@router.post("/api/settings")
def post_settings(body: SettingsIn):
    s = _load_settings()
    s["api_key"] = body.api_key
    s["download_dir"] = body.download_dir or str(Path.home() / "civitai_models")
    _save_settings(s)
    return {"ok": True}
