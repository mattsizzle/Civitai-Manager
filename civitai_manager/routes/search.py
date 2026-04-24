import requests
from fastapi import APIRouter, HTTPException

from ..core.config import BASE_URL, _auth_headers

router = APIRouter()


@router.get("/api/models")
def search_models(query: str = "", types: str = "", sort: str = "", period: str = "",
                  nsfw: str = "", tag: str = "", username: str = "",
                  limit: int = 20, cursor: str = ""):
    params: dict = {"limit": limit}
    if cursor:
        params["cursor"] = cursor
    for k, v in [("query", query), ("types", types), ("sort", sort),
                 ("period", period), ("nsfw", nsfw), ("tag", tag), ("username", username)]:
        if v:
            params[k] = v
    try:
        r = requests.get(f"{BASE_URL}/models", params=params, headers=_auth_headers(), timeout=20)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(502, str(e))


@router.get("/api/models/{model_id}")
def get_model(model_id: int):
    try:
        r = requests.get(f"{BASE_URL}/models/{model_id}", headers=_auth_headers(), timeout=20)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise HTTPException(502, str(e))
