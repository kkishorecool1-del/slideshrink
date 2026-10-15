# Multi-stage build: compiles the React frontend, then serves it from FastAPI.
# Works on Hugging Face Spaces (Docker), Render (Docker), or any Docker host.

# --- Stage 1: frontend build ---
FROM node:20-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- Stage 2: backend runtime ---
FROM python:3.12-slim
# HF Spaces runs containers as uid 1000; keep ownership consistent everywhere.
RUN useradd -m -u 1000 user
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r backend/requirements.txt

COPY --chown=user:user backend/ ./backend/
COPY --chown=user:user --from=frontend /src/dist ./frontend/dist

RUN mkdir -p /app/backend/data && chown -R user:user /app
USER user
ENV SLIDESHRINK_DATA_DIR=/app/backend/data

WORKDIR /app/backend
# HF exposes port 7860 by default; Render (and similar) provide $PORT.
EXPOSE 7860
# Fly machines auto-stop when idle; first request wakes in ~2-5s. Keep a single
# uvicorn worker: job state lives in-memory (multi-worker would split state),
# while intra-job file parallelism is handled by SLIDESHRINK_MAX_WORKERS threads.
# Limit max concurrent HTTP requests so sudden bursts queue instead of OOMing.
ENV UVICORN_LIMIT_CONCURRENCY=20
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1 --limit-concurrency ${UVICORN_LIMIT_CONCURRENCY:-20} --timeout-keep-alive 75"]
