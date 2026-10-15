# SIMPLE DEPLOY - Render.com (Entire app in ONE service)

## 2-Minute Setup

1. **Push to GitHub**
   ```bash
   cd /Users/ekcsm036/Desktop/websites/PPT/slideshrink
   git init && git add . && git commit -m "deploy"
   # Create repo at github.com/new, then:
   git remote add origin https://github.com/YOURUSER/slideshrink.git
   git push -u origin main
   ```

2. **Deploy to Render**
   - Go to https://dashboard.render.com → **New → Web Service**
   - Connect your GitHub repo `slideshrink`
   - Render detects `render-simple.yaml` → click **Apply**
   - Wait 2-3 minutes for build

3. **Done!** 
   - Your app: `https://slideshrink-xxxx.onrender.com`
   - Frontend + API both work on same URL
   - Free tier included (spins down after 15 min idle)

## That's it. No Netlify, no separate backend, no CORS config.

---

## Why not Netlify?
- Netlify Functions = Node.js only (your backend is Python/FastAPI)
- 6 MB upload limit (your app needs 100 MB)
- 26 second timeout (compression takes 30+ seconds)
- No persistent disk (your app stores temp files)

---

## Other "All-in-One" Options (if not Render)

| Platform | Command | Free Tier |
|----------|---------|-----------|
| **Railway** | `railway up` (from root) | $5 credit/mo |
| **Fly.io** | `flyctl launch` (from root) | 3 VMs free |
| **Hugging Face** | New Space → Docker | Free CPU |

All use your existing `Dockerfile` which builds frontend + backend together.