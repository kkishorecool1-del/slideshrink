# Deploy — Fly.io (recommended, Mumbai) or Render

## Option A: Fly.io — fastest for Indian users (recommended)

Single service: same Docker image serves the React frontend + FastAPI API on one URL. No CORS, no split deploy.

```bash
# 1. Install + login (once)
curl -L https://fly.io/install.sh | sh
flyctl auth login

# 2. Launch from repo ROOT (reuses fly.toml: app=slideshrink, region=bom/Mumbai)
cd /Users/ekcsm036/Desktop/websites/PPT/slideshrink
flyctl launch --no-deploy
# - app name: slideshrink (or slideshrink-xyz if taken)
# - region: bom
# - Postgres/Redis: NO

# 3. Deploy
flyctl deploy

# 4. Open
flyctl open
```

Your app: `https://slideshrink.fly.dev` (or your chosen name).
Health: `https://slideshrink.fly.dev/api/health` → `{"status":"ok",...}`.

**Notes**
- Machine: `shared-cpu-1x`, 1024MB (fits free allowance). Auto-stops when idle, wakes in ~2–5s on next request.
- Jobs are ephemeral (`/tmp`, auto-cleaned after `SLIDESHRINK_JOB_TTL_SECONDS`). For persistence across deploys: `flyctl volumes create slideshrink_data --size 1 --region bom`, then uncomment `[[mounts]]` in `fly.toml` + set `SLIDESHRINK_DATA_DIR=/var/data/slideshrink`.
- Compression parallelism: `SLIDESHRINK_MAX_WORKERS=3` (env in `fly.toml`) — files in one job compress concurrently.
- Frontend + API are same-origin, so `VITE_API_BASE` / CORS are not needed.

## Option B: Render (current setup, slower free tier)

1. Push to GitHub (auto-deploys via `render.yaml`).
2. Dashboard → New → Web Service → connect repo → Apply.
3. App: `https://slideshrink-xxxx.onrender.com`.
4. Free tier: 0.1 shared CPU + sleeps after 15 min idle — expect 5–15× slower compression vs Fly/local.