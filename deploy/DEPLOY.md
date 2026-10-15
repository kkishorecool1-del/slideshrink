# Deploying SlideShrink (free)

Netlify hosts **only the frontend**. Netlify has no Python runtime, so the
FastAPI/Pillow backend runs on a second free host (Hugging Face Spaces
recommended: 2 vCPU / 16 GB vs Render free's 0.1 CPU / 512 MB).

```
Browser ──> Netlify (React, static) ──fetch──> Backend host (FastAPI)
                                                     │
                                              uploads/jobs in memory
```

## 1. Backend → Hugging Face Spaces (free)

The repo root contains a `Dockerfile` that builds the frontend and serves it
together with the API (single service, no CORS needed if you use this mode).
For the split Netlify mode the API still honors CORS:

1. Create a Space: https://huggingface.co/new → type **Space**, name it
   (e.g. `slideshrink`), SDK **Docker**, hardware **CPU Basic (free)**.
2. Upload to the Space repo: `Dockerfile`, `.dockerignore`, `backend/`
   (without `.venv`/`data`), `frontend/` (without `node_modules`/`dist`),
   and `deploy/SPACE_README.md` renamed to `README.md`.
3. In **Space Settings → Variables**, add:
   - `SLIDESHRINK_CORS_ORIGINS` = `https://YOUR-SITE.netlify.app`
4. Wait for the build; the API will be at `https://USER-SPACE.hf.space`
   (`/api/health`, `/docs`).

Alternative: Render — push the repo to GitHub, New → Web Service →
runtime Docker, plan **Free**, it picks up `render.yaml` automatically.

## 2. Frontend → Netlify (free)

Set the build-time variable so the bundle knows where the API lives:

- Netlify UI → Site configuration → Environment variables →
  add `VITE_API_BASE` = `https://USER-SPACE.hf.space` (no trailing slash)

Then either:

- **Drag & drop**: build locally and drop the folder:
  ```bash
  cd frontend
  VITE_API_BASE=https://USER-SPACE.hf.space npm run build   # output in dist/
  ```
  Drag `frontend/dist/` onto https://app.netlify.com/drop, **or**
- **Git-based**: connect the repo; `netlify.toml` already sets
  `command = "cd frontend && npm ci && npm run build"` and
  `publish = "frontend/dist"`. Remember to set `VITE_API_BASE` as above.

After the site exists, set `SLIDESHRINK_CORS_ORIGINS` on the backend to the
final URL (e.g. `https://xyz-123.netlify.app`) and restart/redeploy it.

## 3. Sanity checklist

- `https://USER-SPACE.hf.space/api/health` → `{"status":"ok",…}`
- Open the Netlify URL → status dot shows **Local engine ready**
  (rename suggests local; it is actually the remote free backend)
- Upload a small .pptx → progress → download → open in PowerPoint

## Known free-tier caveats

- Jobs live in backend memory: a redeploy/restart/sleep loses running jobs
  (results already downloaded are unaffected; TTL is 1 hour anyway).
- HF Spaces sleep after ~48 h idle → first request after that is a cold start
  (15–60 s). Render free spins down after ~15 min.
- If uploads over ~100 MB fail with HTTP 413, the host proxy is limiting the
  body size; lower `SLIDESHRINK_MAX_UPLOAD_BYTES` (backend env var) to match.
- No authentication: anyone with the URL can use your quota. Fine for a demo;
  put it behind Cloudflare Access / basic auth before sharing widely.
