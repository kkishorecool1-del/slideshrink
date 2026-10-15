# SlideShrink Deployment Guide

## Architecture Overview

```
┌─────────────────┐     API calls      ┌─────────────────┐
│   Netlify       │ ──────────────────► │  Python Host    │
│   (Frontend)    │ ◄────────────────── │  (Backend)      │
│                 │   Compressed PPTX   │                 │
└─────────────────┘                     └─────────────────┘
   Static React                          FastAPI + Pillow
   + Vite Build                          + Uvicorn
```

- **Frontend**: Deploys to Netlify (free, automatic HTTPS, CDN)
- **Backend**: Deploys to a Python host (Render, Railway, Fly.io, Hugging Face Spaces)
- **Connection**: Frontend uses `VITE_API_BASE` env var to find backend

---

## Quick Start (5 minutes)

### 1. Push to GitHub
```bash
cd /Users/ekcsm036/Desktop/websites/PPT/slideshrink
git init
git add .
git commit -m "Initial commit"
# Create GitHub repo, then:
git remote add origin https://github.com/YOURUSER/slideshrink.git
git push -u origin main
```

### 2. Deploy Backend (Choose One)

#### Option A: Render.com (Free tier available)
1. Go to https://dashboard.render.com → **New → Web Service**
2. Connect GitHub repo, select `slideshrink` repo
3. Root directory: `backend` (or use root with `render.yaml`)
4. Render auto-detects `render.yaml` — click **Apply**
5. **Important**: After deploy, copy your backend URL (e.g., `https://slideshrink-backend.onrender.com`)
6. In Render dashboard → Environment, set:
   ```
   SLIDESHRINK_CORS_ORIGINS=https://YOUR-SITE.netlify.app
   ```
   (Use your actual Netlify URL from step 3, or `*` temporarily)

#### Option B: Railway.app
1. Go to https://railway.app → **New Project → Deploy from GitHub**
2. Select repo, set Root Directory to `backend`
3. Railway uses `railway.json` automatically
4. Set `SLIDESHRINK_CORS_ORIGINS` in Variables tab

#### Option C: Fly.io
```bash
cd backend
flyctl launch  # Creates fly.toml, select Dockerfile
flyctl volumes create slideshrink_data --size 1
flyctl secrets set SLIDESHRINK_CORS_ORIGINS=https://YOUR-SITE.netlify.app
flyctl deploy
```

#### Option D: Hugging Face Spaces (Free, Docker)
1. https://huggingface.co/new-space → Choose **Docker**
2. Connect GitHub repo or push directly
3. Set env vars in Space Settings → Variables (see `README_SPACES.md`)

---

### 3. Deploy Frontend to Netlify

1. Go to https://app.netlify.com → **Add new site → Import from Git**
2. Connect GitHub, select `slideshrink` repo
3. Build settings (auto-detected from `netlify.toml`):
   - **Base directory**: `frontend`
   - **Build command**: `npm ci && npm run build`
   - **Publish directory**: `dist`
4. **Before deploying**, go to **Site settings → Environment variables** and add:
   ```
   VITE_API_BASE=https://YOUR-BACKEND-URL
   ```
   Example: `VITE_API_BASE=https://slideshrink-backend.onrender.com`
5. Click **Deploy site**
6. After deploy, copy your Netlify URL (e.g., `https://slideshrink-app.netlify.app`)

---

### 4. Connect Frontend ↔ Backend

1. **Update backend CORS** with your Netlify URL:
   - Render: Dashboard → Environment → `SLIDESHRINK_CORS_ORIGINS=https://slideshrink-app.netlify.app`
   - Railway: Variables tab
   - Fly.io: `flyctl secrets set SLIDESHRINK_CORS_ORIGINS=https://slideshrink-app.netlify.app`
   - HF Spaces: Settings → Variables

2. **Redeploy backend** (auto-deploys on push, or trigger manually)

3. **Test**: Open your Netlify URL, upload a PPTX, verify compression works

---

## Detailed Configuration

### Frontend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_BASE` | Yes (prod) | Backend URL (e.g., `https://api.example.com`). Empty = same-origin |

### Backend Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLIDESHRINK_CORS_ORIGINS` | `http://127.0.0.1:5173,http://localhost:5173` | Comma-separated allowed origins |
| `SLIDESHRINK_DATA_DIR` | `backend/data` | Temp job storage directory |
| `SLIDESHRINK_MAX_UPLOAD_BYTES` | `104857600` | Max bytes per file (100 MB) |
| `SLIDESHRINK_MAX_FILES` | `10` | Max files per job |
| `SLIDESHRINK_JOB_TTL_SECONDS` | `3600` | Job retention (1 hour) |
| `SLIDESHRINK_MAX_ZIP_ENTRIES` | `5000` | Max entries in PPTX |
| `SLIDESHRINK_MAX_UNCOMPRESSED_BYTES` | `1073741824` | Max expanded size (1 GB) |
| `SLIDESHRINK_MAX_ENTRY_BYTES` | `262144000` | Max single entry (250 MB) |

---

## Netlify Redirects Explained

The `netlify.toml` includes:

```toml
[[redirects]]
  from = "/api/*"
  to = "${VITE_API_BASE}/api/:splat"
  status = 200
```

- **Purpose**: Proxies `/api/*` calls to your backend transparently
- **How it works**: Netlify Edge Functions rewrite the request to `${VITE_API_BASE}/api/...`
- **CORS**: Backend must allow your Netlify origin in `SLIDESHRINK_CORS_ORIGINS`
- **Note**: This is a **proxy**, not a redirect — browser URL stays on your Netlify domain

### SPA Fallback
```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```
Handles React Router client-side routes.

---

## Testing the Build Locally

```bash
# Build frontend
cd frontend
npm ci
npm run build
# Output in frontend/dist/

# Test with a static server
npx serve dist -p 4173
# Open http://localhost:4173 (set VITE_API_BASE in .env for local testing)
```

---

## Common Issues & Fixes

### "Backend offline" in UI
- Check `VITE_API_BASE` is set correctly in Netlify env vars
- Verify backend `/api/health` returns 200: `curl https://your-backend.com/api/health`
- Check browser Network tab for failed `/api/health` calls

### CORS Errors
- Backend `SLIDESHRINK_CORS_ORIGINS` must include your Netlify URL exactly
- Include both `https://` and no trailing slash
- For multiple origins: `https://a.netlify.app,https://b.netlify.app`

### Large File Uploads Fail
- Netlify Functions have 26s timeout, 6 MB body limit
- **Solution**: The proxy redirect bypasses Functions — requests go direct to backend
- Ensure backend host allows large uploads (Render/Railway/Fly do)

### Build Fails on Netlify
- Check Node version: `NODE_VERSION=20` in `netlify.toml`
- Run `npm ci && npm run build` locally first
- Check Netlify build logs for TypeScript errors

### Backend Crashes on Startup
- Check logs in provider dashboard
- Common: Missing `SLIDESHRINK_DATA_DIR` write permission
- Ensure persistent volume/disk is mounted (Render disk, Fly volume, Railway volume)

---

## Cost Estimate (Monthly)

| Platform | Free Tier | Paid Starts At |
|----------|-----------|----------------|
| Netlify | ✅ Unlimited personal | $19/team |
| Render | ✅ 750 hrs/mo (spins down) | $7/mo (always on) |
| Railway | $5 credit/mo | $5/mo after credit |
| Fly.io | ✅ 3 shared-cpu VMs | $2/mo per VM |
| Hugging Face | ✅ Free CPU | $0.05/hr GPU |

**Recommended free stack**: Netlify + Render (or HF Spaces)

---

## Custom Domain

1. Netlify: Site settings → Domain management → Add custom domain
2. Backend: Add custom domain in provider dashboard
3. Update `VITE_API_BASE` and `SLIDESHRINK_CORS_ORIGINS` to new domains
4. Redeploy both

---

## Security Checklist

- [ ] Backend `SLIDESHRINK_CORS_ORIGINS` set to exact Netlify URL (not `*`)
- [ ] Netlify Security headers enabled (in `netlify.toml`)
- [ ] Backend not running as root (Dockerfile uses `user` uid 1000)
- [ ] HTTPS enforced on both (automatic on Netlify/Render/Railway/Fly)
- [ ] File upload limits configured appropriately
- [ ] Job TTL cleanup working (check logs after 1 hour)
- [ ] No secrets in repo (API keys, tokens)

---

## Monitoring

- **Netlify**: Analytics, Functions logs, Build logs
- **Render**: Metrics tab, Logs, Health checks
- **Railway**: Metrics, Logs, Deploy history
- **Fly.io**: `flyctl logs`, `flyctl status`, Grafana Cloud (free tier)
- **Health endpoint**: `GET /api/health` returns `{status, max_upload_mb, max_files_per_job}`

---

## Scaling Considerations

Current limitations:
- In-memory job state (single worker only)
- No authentication
- Local file storage

For production scaling:
1. Add Redis for job queue/state
2. Add PostgreSQL for job persistence
3. Add authentication (Clerk, Auth0, or custom)
4. Use S3-compatible storage for temp files
5. Run multiple workers behind load balancer

---

## Support

- Check logs first
- Verify env vars match exactly
- Test backend `/api/health` directly
- Open GitHub issue with logs + config