---
title: SlideShrink
emoji: 📦
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# SlideShrink — PowerPoint Compressor

Upload up to 10 `.pptx` files (100 MB each), pick a preset, and download the
compressed results. React + TypeScript frontend served together with a
FastAPI + Pillow backend in a single Docker container.

- `GET /api/health` — service status and upload limits
- `POST /api/jobs` — start a compression job
- `/docs` — interactive API documentation

Jobs are held in memory and cleaned up after one hour; results do not survive
a Space restart or redeploy.
