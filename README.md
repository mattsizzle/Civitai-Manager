# Civitai Manager

A lightweight, self-hosted web UI for browsing, downloading, and managing [Civitai](https://civitai.com) models. Runs entirely on your machine — no cloud account, no telemetry, no Electron.

![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![License](https://img.shields.io/badge/license-GPL--3.0-green)

---

## What it does

- **Search** Civitai's model library with filters for type, sort order, time period, NSFW toggle, tags, and creator username
- **Browse model detail** — version selector, image carousel, trigger words, file list with sizes and scan results
- **Download** any model version to a local directory, with optional subdirectory and custom filename stem
- **Manage local files** — browse your download folder as a tree, view stored model info, refresh metadata, redownload files
- **API key support** — paste your Civitai API key to access gated and Early Access models
- Opens a browser tab automatically on launch; works over SSH port-forwarding too

---

## Requirements

- Python 3.11 or newer
- Internet access to reach `civitai.com`
- A Civitai API key is **optional** for public models, but required to download Early Access content

---

## Installation

### Recommended: pipx (isolated, no venv needed)

```bash
pipx install git+https://github.com/mattsizzle/Civitai-Manager.git
civitai-manager
```

### pip into a virtual environment

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install git+https://github.com/mattsizzle/Civitai-Manager.git
civitai-manager
```

### uv (fastest)

```bash
uv tool install git+https://github.com/mattsizzle/Civitai-Manager.git
civitai-manager
```

### Development install (editable)

```bash
git clone https://github.com/mattsizzle/Civitai-Manager.git
cd civitai-app
pip install -e .
civitai-manager
```

The app starts a local server at **http://0.0.0.0:8765** and opens your default browser automatically.

---

## First-run setup

1. Click **⚙ Settings** in the top-right corner
2. Set your **Download Directory** — the folder where models will be saved (e.g. `/home/you/models`)
3. Optionally paste your **Civitai API Key** (get one at [civitai.com/user/account](https://civitai.com/user/account) under API Keys)
4. Click **Save**

Settings are stored at `~/.civitai_manager.json`.

---

## Usage

### Searching for models

Use the **Search** tab on the left panel. Type a query and hit **Go** or press Enter. Narrow results with the filter dropdowns:

| Filter | Options |
|---|---|
| Type | Checkpoint, LORA, LoCon, TextualInversion, Controlnet, and more |
| Sort | Highest Rated, Most Downloaded, Newest |
| Period | AllTime, Year, Month, Week, Day |
| NSFW | Show / Hide |
| Tag | Any Civitai tag (e.g. `anime`, `realistic`) |
| Creator | Username to filter by author |
| Results per page | 1–100 |

Paginate with the **‹ ›** buttons at the bottom of the panel.

### Loading a model directly

Paste a Civitai model URL or a bare model ID into the box in the header and click **Load**:

```
https://civitai.com/models/4384?modelVersionId=109123
```

### Downloading a model

1. Select a model from search results to open its detail panel
2. Choose a **version** from the dropdown
3. Select a **file** from the file table (the primary file is pre-selected)
4. Click **⬇ Download**
5. In the dialog, choose a **subdirectory** (or leave blank for the root download folder) and an optional **filename stem**
6. Click **⬇ Download** to start — a progress bar tracks the transfer

Each download saves three files alongside the model:

| File | Contents |
|---|---|
| `modelname.safetensors` | The model weights |
| `modelname.json` | Full model metadata from the Civitai API |
| `modelname.png` | First preview image for the version |

### Browsing local files

Switch to the **Local Files** tab. Your download folder is shown as a navigable tree:

- Click a **📁 folder** to enter it — breadcrumb navigation appears at the top
- Click a **model file** to open its detail panel on the right
- Use the **Filter** box to search by filename
- Sort by name, size, or file type

### Model detail panel (local files)

Selecting a local model shows the same rich detail view as search results — version selector, image carousel, trigger words, stats — but locked to the version that matches the file on disk. Action buttons at the bottom:

- **🔍 View on Search** — opens the model in the search panel so you can compare versions or check for updates
- **↺ Refresh Metadata** — re-fetches the model JSON and preview image from Civitai (picks the correct version automatically)
- **⬇ Redownload** — re-downloads the model file to the same directory

---

## Remote access

The server listens on `0.0.0.0:8765`, so it's reachable from any machine on your network:

```
http://<host-ip>:8765
```

If the host is behind a firewall, forward the port over SSH:

```bash
ssh -L 8765:localhost:8765 user@remotehost
```

Then visit `http://localhost:8765` in your local browser.

---

## Project structure

```
civitai_manager/
├── __init__.py          # FastAPI app wiring, entry point
├── core/
│   ├── config.py        # Settings load/save, API auth headers
│   ├── downloader.py    # Download worker, JSON + image saver
│   └── files.py         # JSON format detection, ID extraction, sidecar helpers
├── routes/
│   ├── search.py        # GET /api/models, GET /api/models/{id}
│   ├── downloads.py     # POST /api/download, GET /api/download/{id}, POST /api/save-info
│   ├── local_files.py   # GET /api/local-files, refresh-meta, redownload, image proxy
│   └── settings.py      # GET/POST /api/settings
├── static/
│   ├── app.js           # All frontend logic (vanilla JS, no framework)
│   └── app.css          # Dark-theme styles
└── templates/
    └── index.html       # Single-page shell
```

No database. No background daemon. The server process holds active download state in memory; restarting it cancels any in-progress downloads.

---

## Contributing

Pull requests are welcome. The stack is intentionally minimal:

- **Backend**: FastAPI + uvicorn, stdlib only beyond that (no ORM, no task queue)
- **Frontend**: Vanilla JS + CSS, no build step, no npm

To run in development mode with auto-reload:

```bash
pip install -e .
uvicorn civitai_manager:app --reload --port 8765
```

---

## License

GPL-3.0 — see [LICENSE](LICENSE).

> This project is not affiliated with or endorsed by Civitai. Use in accordance with [Civitai's Terms of Service](https://civitai.com/content/tos).
