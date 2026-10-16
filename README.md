# SlideShrink — local PowerPoint compressor

A local-first PPTX compression web app for macOS and trusted LAN use. React + TypeScript frontend, FastAPI + Pillow backend.

## What it does

- Upload up to 10 `.pptx` files in one batch (100 MB per file by default).
- Choose High quality, Balanced, or Smallest size.
- Optionally provide a best-effort target size. The backend tries progressively smaller image dimensions, then returns the smallest validated output found. Targets are not guaranteed.
- Poll progress and download individual files or a ZIP of successful results.
- Optimize supported images under `ppt/media/`; preserve unsupported image formats/media unchanged.
- Keep original uploads untouched, validate ZIP paths and size limits, test package CRCs, and clean temporary data after the configured retention time.

## Important limitations

- `.pptx` only. Convert old `.ppt` files to `.pptx` in PowerPoint first.
- The compressor optimizes JPEG, PNG, WebP, and BMP assets. TIFF is left unchanged to avoid changing multi-frame semantics. PNG optimization is lossless; large reductions are not guaranteed. JPEG/WebP are re-encoded and may lose quality.
- Embedded OLE files, videos, audio, and fonts are retained unchanged. This version does not edit slide XML or relationships.
- Output is ZIP-integrity checked, but no automated visual-render comparison is performed. Open important presentations in PowerPoint and review animations, transparency, media, and layout before using them professionally.
- Jobs are held in in-memory state, so this is intended for one local backend process, not multi-worker deployment. Restarting the backend clears job state. Keep it on localhost or a trusted LAN only.

## Requirements

- macOS with Python 3.11+ and Node.js 20+.
- A modern browser.

## Install and run on Mac

Open Terminal and go to the folder where you extracted this project.

### 1. Start the backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Leave that Terminal window running.

### 2. Start the frontend

Open a second Terminal window:

```bash
cd /path/to/slideshrink/frontend
npm install
npm run dev
```

Open <http://localhost:5173>.

## Install and run on Windows

SlideShrink is packaged as a Windows desktop application (Electron) that bundles
the Python backend and React frontend into a single window.

### Requirements
- Windows 10 or 11
- Python 3.11+ (`python --version`)
- Node.js 20+ (`node --version`)

### Option 1: One-click desktop launcher (recommended)

Double-click `start-slideshrink.bat` (or run `start-slideshrink.ps1` in
PowerShell). It will:
1. Install Electron
2. Set up the Python backend (virtualenv + dependencies)
3. Build the React frontend
4. Launch the SlideShrink window

When you close the window, the backend stops automatically.

### Option 2: Run backend and frontend separately

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```
Open http://localhost:5173.

### Build a redistributable Windows installer

```powershell
npm install
npm run build:frontend
npm run dist
```
This produces an NSIS installer (`SlideShrink Setup x64.exe` / `.ia32.exe`) in
the `release/` folder.

## LAN access from another device

Only use this on a trusted private network. Do not expose the app directly to the public internet.

1. Stop the frontend and restart it with the configured Vite host (already set to `0.0.0.0` in `vite.config.ts`): `npm run dev -- --host 0.0.0.0`.
2. Start FastAPI listening on the LAN: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
3. Find your Mac's LAN IP in System Settings → Network, then open `http://MAC_LAN_IP:5173` from another device.
4. For cross-device use, set `SLIDESHRINK_CORS_ORIGINS` to the exact frontend origin(s) if you call the backend directly. The Vite development proxy already sends `/api` calls to `127.0.0.1:8000` from the Mac, so LAN clients can use the frontend without calling the API directly.
5. macOS Firewall may ask permission. Allow only on a trusted private network. For better LAN hardening, use a reverse proxy and authentication before sharing with other users.

## Production frontend build

```bash
cd frontend
npm install
npm run build
```

The build is in `frontend/dist`. Serve it with a static web server configured to proxy `/api` to FastAPI. Keep FastAPI bound to `127.0.0.1` when the reverse proxy is on the same Mac. This repo does not include authentication; do not publish the service to the public internet as-is.

## Configuration

Set environment variables before starting FastAPI:

| Variable | Default | Meaning |
|---|---:|---|
| `SLIDESHRINK_DATA_DIR` | `backend/data` | Temporary job data directory |
| `SLIDESHRINK_MAX_UPLOAD_BYTES` | `104857600` | Maximum bytes per uploaded file (100 MiB) |
| `SLIDESHRINK_MAX_FILES` | `10` | Maximum files per job |
| `SLIDESHRINK_MAX_ZIP_ENTRIES` | `5000` | Maximum entries inside one PPTX package |
| `SLIDESHRINK_MAX_UNCOMPRESSED_BYTES` | `1073741824` | Maximum total expanded package size (1 GiB) |
| `SLIDESHRINK_MAX_ENTRY_BYTES` | `262144000` | Maximum expanded size of one package entry (250 MiB) |
| `SLIDESHRINK_JOB_TTL_SECONDS` | `3600` | Completed-job retention time (1 hour) |
| `SLIDESHRINK_CORS_ORIGINS` | local Vite origins | Comma-separated allowed browser origins |

## API endpoints

- `GET /api/health` — health and upload limits.
- `POST /api/jobs` — multipart fields `files` (repeated), `preset` (`high`, `balanced`, `smallest`), optional `target_mb`.
- `GET /api/jobs/{job_id}` — status/progress and per-file results.
- `GET /api/jobs/{job_id}/files/{file_index}/download` — download a result.
- `GET /api/jobs/{job_id}/download-all` — ZIP of successful results.
- `DELETE /api/jobs/{job_id}` — remove a job and its files.

## Security notes

- Do not run this app as root/admin.
- Use only trusted local networks; this development build does not include user authentication or CSRF protection for a public deployment.
- The backend validates extensions, required PPTX package entries, ZIP entry paths, duplicate entries, CRC integrity, and expanded-size limits. This reduces risk but does not replace OS sandboxing or antivirus scanning.
- Consider keeping macOS Firewall enabled and avoiding port forwarding.
