# README_SPACES.md - Deploy to Hugging Face Spaces
# 1. Create a new Space at https://huggingface.co/new-space
# 2. Choose "Docker" as the Space SDK
# 3. Set Space hardware (CPU basic is free)
# 4. In Space settings → Repository settings, connect your GitHub repo
# 5. Or push directly: git push https://huggingface.co/username/slideshrink main

# Environment variables to set in Space settings → Variables:
# SLIDESHRINK_CORS_ORIGINS=https://your-site-name.netlify.app
# SLIDESHRINK_DATA_DIR=/data/slideshrink
# SLIDESHRINK_JOB_TTL_SECONDS=3600
# SLIDESHRINK_MAX_UPLOAD_BYTES=104857600

# The Dockerfile in the repo root builds both frontend + backend
# Frontend will be served at / and API at /api/