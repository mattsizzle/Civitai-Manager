import json
import logging
from pathlib import Path
from typing import Optional

import requests
from fastapi import HTTPException

from .config import BASE_URL, _auth_headers, _load_settings

log = logging.getLogger("civitai")


def _json_format(info: dict) -> str:
    """Detect JSON schema.

    Returns: 'full_model' | 'ours' | 'civhelper_version' | 'civhelper_meta' | 'unknown'
    """
    if "modelVersions" in info and "id" in info and "modelId" not in info:
        return "full_model"
    if info.get("civitaiUrl"):
        return "ours"
    if "modelId" in info:
        if "model" in info and "files" in info:
            return "civhelper_version"
        if "modelVersionId" in info:
            return "civhelper_meta"
    return "unknown"


def _extract_ids(info: dict, filename: str = None) -> tuple[Optional[int], Optional[int]]:
    fmt = _json_format(info)
    if fmt == "full_model":
        versions = info.get("modelVersions", [])
        vid = None
        if filename:
            fname_lower = filename.lower()
            for v in versions:
                if any(vf.get("name", "").lower() == fname_lower for vf in v.get("files", [])):
                    vid = v.get("id")
                    break
        if vid is None and versions:
            vid = versions[0].get("id")
        return info.get("id"), vid
    if fmt == "ours":
        return info.get("id"), info.get("modelVersionId")
    if fmt == "civhelper_version":
        return info.get("modelId"), info.get("id")
    if fmt == "civhelper_meta":
        return info.get("modelId"), info.get("modelVersionId")
    return None, None


def _resolve_local_file(req_path: str) -> tuple[Path, Path]:
    s = _load_settings()
    root = Path(s.get("download_dir", "")).resolve()
    target = (root / req_path).resolve()
    log.info("RESOLVE root=%s target=%s exists=%s", root, target, target.exists())
    if not target.is_relative_to(root):
        raise HTTPException(403)
    return root, target


def _load_sidecar(file_path: Path) -> dict:
    jp = file_path.with_suffix(".json")
    if not jp.exists():
        raise HTTPException(404, "No info JSON found for this file")
    try:
        return json.loads(jp.read_text())
    except Exception:
        raise HTTPException(400, "Could not parse info JSON")


def _fetch_model_and_version(model_id: int, version_id: Optional[int]) -> tuple[dict, dict]:
    try:
        r = requests.get(f"{BASE_URL}/models/{model_id}", headers=_auth_headers(), timeout=20)
        r.raise_for_status()
        model = r.json()
    except requests.RequestException as e:
        raise HTTPException(502, str(e))
    version = next((v for v in model.get("modelVersions", []) if v.get("id") == version_id), None)
    if not version and model.get("modelVersions"):
        version = model["modelVersions"][0]
    return model, version
