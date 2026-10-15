# README_SPACES.md - Deploy to Hugging Face Spaces (Docker, free CPU)
# 1. Create a new Space at https://huggingface.co/new-space → choose "Docker" SDK
#    (Blank template is fine — our root Dockerfile + README frontmatter define it)
# 2. Hardware: CPU basic (free). Upgrade to CPU Upgrade ($0.03/hr) for faster Pillow work.
# 3. Push this repo to the Space (see bottom), or connect GitHub repo in Space settings.
# 4. In Space settings → Variables, set (optional, defaults already sane):
# SLIDESHRINK_DATA_DIR=/tmp/slideshrink-data
# SLIDESHRINK_JOB_TTL_SECONDS=3600
# SLIDESHRINK_MAX_UPLOAD_BYTES=104857600
# SLIDESHRINK_MAX_WORKERS=3
# NOTE: same-origin single service — no CORS / VITE_API_BASE needed.
#
# The Dockerfile in the repo root builds both frontend + backend
# Frontend will be served at / and API at /api/
#
# --- Push commands (run from repo root after creating the Space) ---
# git remote add space https://huggingface.co/spaces/YOURUSER/slideshrink
# git push space main
# --- Verify ---
# curl https://YOURUSER-slideshrink.hf.space/api/health
# → {"status":"ok","max_upload_mb":100,"max_files_per_job":10}