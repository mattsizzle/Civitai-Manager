import json
from pathlib import Path

BASE_URL = "https://civitai.com/api/v1"
SETTINGS_FILE = Path.home() / ".civitai_manager.json"


def _load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text())
    except Exception:
        return {"api_key": "", "download_dir": str(Path.home() / "civitai_models")}


def _save_settings(s: dict):
    SETTINGS_FILE.write_text(json.dumps(s, indent=2))


def _auth_headers() -> dict:
    key = _load_settings().get("api_key", "")
    return {"Authorization": f"Bearer {key}"} if key else {}
