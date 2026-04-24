import logging
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

_pkg = Path(__file__).parent
app = FastAPI()
app.mount("/static", StaticFiles(directory=str(_pkg / "static")), name="static")
templates = Jinja2Templates(directory=str(_pkg / "templates"))

from .routes import downloads, local_files, search, settings  # noqa: E402

app.include_router(settings.router)
app.include_router(search.router)
app.include_router(downloads.router)
app.include_router(local_files.router)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


def main():
    uvicorn.run(app, host="0.0.0.0", port=8765)


if __name__ == "__main__":
    main()
