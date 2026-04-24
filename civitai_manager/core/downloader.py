import json
import logging
import re
from pathlib import Path

import requests

log = logging.getLogger("civitai")

_downloads: dict[str, dict] = {}


def _write_model_json(model: dict, dl_dir: str, stem: str = None):
    try:
        if stem:
            jp = Path(dl_dir) / f"{stem}.json"
        else:
            safe = re.sub(r"[^\w\- ]", "_", model.get("name", "model"))[:60]
            jp = Path(dl_dir) / f"{safe}.json"
        log.info("MODEL JSON writing: %s", jp)
        jp.write_text(json.dumps(model, indent=2))
    except OSError as e:
        log.error("MODEL JSON write failed %s: %s", jp, e)


def _save_preview_image(version: dict, dl_dir: str, stem: str, api_key: str = "", force: bool = False):
    images = (version or {}).get("images") or []
    if not images:
        return
    img_url = images[0].get("url", "")
    if not img_url:
        return
    ext = Path(img_url.split("?")[0].rstrip("/")).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
        ext = ".jpg"
    dest = Path(dl_dir) / f"{stem}{ext}"
    if force:
        for old_ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            (Path(dl_dir) / f"{stem}{old_ext}").unlink(missing_ok=True)
    elif dest.exists():
        return
    try:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        r = requests.get(img_url, headers=headers, timeout=20, stream=True)
        if r.ok:
            with open(dest, "wb") as fh:
                for chunk in r.iter_content(65536):
                    if chunk:
                        fh.write(chunk)
            log.info("PREVIEW saved: %s", dest)
    except Exception as e:
        log.warning("PREVIEW save failed: %s", e)


def _do_download(dl_id: str, url: str, dl_dir: str, api_key: str,
                 model: dict, version: dict, file_info: dict, stem: str = ""):
    d = _downloads[dl_id]
    try:
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        log.info("DOWNLOAD GET %s (auth=%s)", url, bool(api_key))
        r = requests.get(url, headers=headers, stream=True, timeout=30, allow_redirects=True)
        log.info("DOWNLOAD response %s %s", r.status_code, r.url)
        if not r.ok:
            body = r.text[:500]
            log.error("DOWNLOAD failed %s: %s", r.status_code, body)
            d.update({"status": "error", "error": f"HTTP {r.status_code}: {body}"})
            return
        r.raise_for_status()

        cd = r.headers.get("content-disposition", "")
        filename = None
        if "filename=" in cd:
            m = re.findall(r'filename\*?=["\']?(?:UTF-\d\'\'\s*)?([^"\';\r\n]+)', cd)
            if m:
                filename = m[-1].strip().strip('"')
        filename = filename or url.split("/")[-1].split("?")[0] or "model_download"

        if stem:
            filename = stem + Path(filename).suffix

        dest = Path(dl_dir) / filename
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        d.update({"status": "downloading", "total": total})

        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=65536):
                if d.get("cancelled"):
                    dest.unlink(missing_ok=True)
                    d["status"] = "cancelled"
                    return
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    d["downloaded"] = downloaded

        d.update({"status": "done", "path": str(dest)})
        _write_model_json(model, dl_dir, dest.stem)
        _save_preview_image(version, dl_dir, dest.stem, api_key)
    except Exception as e:
        d.update({"status": "error", "error": str(e)})
