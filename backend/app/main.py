from __future__ import annotations

import asyncio
import io
import json
import os
import re
import shutil
import tempfile
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SLIDESHRINK_DATA_DIR", str(APP_DIR.parent / "data"))).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = int(os.environ.get("SLIDESHRINK_MAX_UPLOAD_BYTES", 100 * 1024 * 1024))
MAX_FILES_PER_JOB = int(os.environ.get("SLIDESHRINK_MAX_FILES", 10))
MAX_ZIP_ENTRIES = int(os.environ.get("SLIDESHRINK_MAX_ZIP_ENTRIES", 5000))
MAX_UNCOMPRESSED_BYTES = int(os.environ.get("SLIDESHRINK_MAX_UNCOMPRESSED_BYTES", 1024 * 1024 * 1024))
MAX_SINGLE_ENTRY_BYTES = int(os.environ.get("SLIDESHRINK_MAX_ENTRY_BYTES", 250 * 1024 * 1024))
JOB_TTL_SECONDS = int(os.environ.get("SLIDESHRINK_JOB_TTL_SECONDS", 3600))
ALLOWED_PRESETS = {"high", "balanced", "smallest"}

PRESETS: dict[str, dict[str, Any]] = {
    "high": {"jpeg_quality": 88, "max_dimension": 5000, "png_optimize": True, "label": "High quality"},
    "balanced": {"jpeg_quality": 78, "max_dimension": 3200, "png_optimize": True, "label": "Balanced"},
    "smallest": {"jpeg_quality": 62, "max_dimension": 2200, "png_optimize": True, "label": "Smallest size"},
}

app = FastAPI(title="SlideShrink API", version="1.0.0")
# The dev frontend is separate; production LAN use is same-origin through Vite's proxy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("SLIDESHRINK_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@dataclass
class FileResult:
    original_name: str
    stored_name: str
    original_bytes: int
    output_bytes: int = 0
    saved_bytes: int = 0
    saved_percent: float = 0.0
    status: str = "queued"
    message: str = "Queued"
    output_path: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)


@dataclass
class Job:
    id: str
    preset: str
    target_mb: float | None
    created_at: float
    status: str = "queued"
    progress: int = 0
    progress_fine: float = 0.0
    message: str = "Waiting to start"
    detail: str = ""
    files: list[FileResult] = field(default_factory=list)
    error: str | None = None
    work_dir: str = ""


JOBS: dict[str, Job] = {}
JOB_TASKS: dict[str, asyncio.Task] = {}


class JobCreateResponse(BaseModel):
    job_id: str
    status: str
    file_count: int


class HealthResponse(BaseModel):
    status: str
    max_upload_mb: int
    max_files_per_job: int


def safe_filename(name: str) -> str:
    name = Path(name or "presentation.pptx").name
    name = re.sub(r"[^A-Za-z0-9._() -]", "_", name).strip(" .")
    if not name:
        name = "presentation.pptx"
    if not name.lower().endswith(".pptx"):
        raise ValueError("Only .pptx files are supported. Legacy .ppt files must be saved as .pptx first.")
    return name[:180]


def inspect_pptx(path: Path) -> tuple[zipfile.ZipFile, list[zipfile.ZipInfo]]:
    try:
        zf = zipfile.ZipFile(path, "r")
        infos = zf.infolist()
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("This file is not a valid PowerPoint .pptx package.") from exc
    if len(infos) > MAX_ZIP_ENTRIES:
        zf.close()
        raise ValueError(f"Presentation contains too many package entries (limit {MAX_ZIP_ENTRIES}).")
    total = 0
    names = set()
    for info in infos:
        # Reject absolute paths and parent traversal before extracting/processing anything.
        p = PurePosixPath(info.filename)
        if p.is_absolute() or ".." in p.parts or "\\" in info.filename or info.filename.startswith("/"):
            zf.close()
            raise ValueError("Unsafe path found inside the PPTX package.")
        if info.filename in names:
            zf.close()
            raise ValueError("Duplicate package paths were detected; this file cannot be safely processed.")
        names.add(info.filename)
        if info.file_size > MAX_SINGLE_ENTRY_BYTES:
            zf.close()
            raise ValueError("A package entry exceeds the configured safety limit.")
        total += info.file_size
        if total > MAX_UNCOMPRESSED_BYTES:
            zf.close()
            raise ValueError("Expanded package size exceeds the configured safety limit.")
    if "[Content_Types].xml" not in names or "ppt/presentation.xml" not in names:
        zf.close()
        raise ValueError("The ZIP file does not contain the required PowerPoint package files.")
    bad_entry = zf.testzip()
    if bad_entry:
        zf.close()
        raise ValueError("PowerPoint package integrity check failed.")
    return zf, infos


def optimize_image(raw: bytes, suffix: str, preset: str, scale: float = 1.0) -> tuple[bytes, str]:
    cfg = PRESETS[preset]
    try:
        with Image.open(io.BytesIO(raw)) as original:
            fmt = (original.format or suffix.lstrip(".")).upper()
            if fmt not in {"JPEG", "JPG", "PNG", "WEBP", "BMP", "TIFF"}:
                return raw, "unsupported image format left unchanged"
            image = ImageOps.exif_transpose(original)
            image.load()
            if image.width < 1 or image.height < 1:
                return raw, "invalid dimensions left unchanged"
            max_dim = max(256, int(cfg["max_dimension"] * scale))
            if max(image.size) > max_dim:
                ratio = max_dim / max(image.size)
                new_size = (max(1, round(image.width * ratio)), max(1, round(image.height * ratio)))
                image = image.resize(new_size, Image.Resampling.LANCZOS)

            out = io.BytesIO()
            if fmt in {"JPEG", "JPG"}:
                if image.mode not in ("RGB", "L"):
                    # JPEG has no alpha channel. Preserve the visual appearance on white.
                    rgba = image.convert("RGBA")
                    background = Image.new("RGB", rgba.size, (255, 255, 255))
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    image = background
                image.save(out, format="JPEG", quality=cfg["jpeg_quality"], optimize=True, progressive=True)
            elif fmt == "PNG":
                # Keep full color and alpha; optimize losslessly to avoid transparency/color shifts.
                image.save(out, format="PNG", optimize=True, compress_level=9)
            elif fmt == "WEBP":
                image.save(out, format="WEBP", quality=cfg["jpeg_quality"], method=6)
            elif fmt == "BMP":
                # BMP conversion can alter package expectations; only optimize by re-saving same format.
                image.save(out, format="BMP")
            else:
                return raw, "TIFF left unchanged to preserve multi-frame/image semantics"
            candidate = out.getvalue()
            if len(candidate) >= len(raw):
                return raw, "original retained because optimized image was not smaller"
            return candidate, f"optimized {image.width}×{image.height}"
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        return raw, "image could not be safely decoded; original retained"


def compress_package(source: Path, output: Path, preset: str, target_bytes: int | None, on_entry: Callable[[int, int, str], None] | None = None) -> dict[str, Any]:
    """Repack PPTX and optimize raster media. Target size triggers progressively stronger attempts."""
    source_bytes = source.stat().st_size
    attempts = [1.0]
    if target_bytes and source_bytes > target_bytes:
        attempts = [1.0, 0.85, 0.70, 0.55, 0.40]
    best_path = output.with_suffix(".best.pptx")
    best_size = source_bytes + 1
    best_stats: dict[str, Any] = {}
    total_steps = max(1, len(attempts))
    try:
        for attempt_idx, scale in enumerate(attempts):
            attempt_path = output.with_name(output.stem + f".attempt{int(scale*100)}.pptx")
            zf, infos = inspect_pptx(source)
            optimized = 0
            original_media_bytes = 0
            output_media_bytes = 0
            total_entries = max(1, len(infos))
            try:
                with zf, zipfile.ZipFile(attempt_path, "w") as zout:
                    zout.comment = zf.comment
                    for entry_idx, info in enumerate(infos):
                        data = zf.read(info.filename)
                        lower = info.filename.lower()
                        if lower.startswith("ppt/media/") and Path(lower).suffix in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"} and not info.is_dir():
                            original_media_bytes += len(data)
                            candidate, _ = optimize_image(data, Path(lower).suffix, preset, scale)
                            if len(candidate) < len(data):
                                data = candidate
                                optimized += 1
                            output_media_bytes += len(data)
                        # Preserve original entry metadata/attributes; only payload/compression may change.
                        clone = zipfile.ZipInfo(info.filename, date_time=info.date_time)
                        clone.compress_type = zipfile.ZIP_DEFLATED
                        clone.comment = info.comment
                        clone.extra = info.extra
                        clone.internal_attr = info.internal_attr
                        clone.external_attr = info.external_attr
                        clone.create_system = info.create_system
                        zout.writestr(clone, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
                        if on_entry is not None and (entry_idx % 2 == 0 or entry_idx + 1 == total_entries):
                            on_entry(entry_idx + 1, total_entries, f"Pass {attempt_idx + 1}/{total_steps} · entry {entry_idx + 1}/{total_entries}")
            except Exception:
                attempt_path.unlink(missing_ok=True)
                raise
            # Validate rebuilt package and CRCs before accepting it.
            check, _ = inspect_pptx(attempt_path)
            check.close()
            size = attempt_path.stat().st_size
            if size < best_size:
                if best_path.exists():
                    best_path.unlink()
                attempt_path.replace(best_path)
                best_size = size
                best_stats = {
                    "attempt_scale": scale,
                    "images_optimized": optimized,
                    "original_media_bytes": original_media_bytes,
                    "output_media_bytes": output_media_bytes,
                }
            else:
                attempt_path.unlink(missing_ok=True)
            if target_bytes and best_size <= target_bytes:
                break
        if best_size >= source_bytes:
            # Repacking can occasionally make a file larger. Return an unchanged copy in that case.
            shutil.copy2(source, output)
            best_path.unlink(missing_ok=True)
            return {"output_bytes": source_bytes, "images_optimized": 0, "target_reached": bool(target_bytes and source_bytes <= target_bytes), "message": "No safe size reduction was found; original package copied unchanged."}
        best_path.replace(output)
        return {
            **best_stats,
            "output_bytes": output.stat().st_size,
            "target_reached": bool(target_bytes and output.stat().st_size <= target_bytes),
            "message": "Target reached." if target_bytes and output.stat().st_size <= target_bytes else ("Target not reached; best validated result returned." if target_bytes else "Compression complete."),
        }
    finally:
        best_path.unlink(missing_ok=True)
        for p in output.parent.glob(output.stem + ".attempt*.pptx"):
            p.unlink(missing_ok=True)


def job_public(job: Job) -> dict[str, Any]:
    return {
        "job_id": job.id,
        "status": job.status,
        "progress": job.progress,
        "progress_fine": round(job.progress_fine, 2),
        "message": job.message,
        "detail": job.detail,
        "preset": job.preset,
        "target_mb": job.target_mb,
        "created_at": job.created_at,
        "error": job.error,
        "files": [
            {
                "original_name": f.original_name,
                "original_bytes": f.original_bytes,
                "output_bytes": f.output_bytes,
                "saved_bytes": f.saved_bytes,
                "saved_percent": f.saved_percent,
                "status": f.status,
                "message": f.message,
                "stats": f.stats,
                "download_url": f"/api/jobs/{job.id}/files/{i}/download" if f.output_path and Path(f.output_path).exists() else None,
            }
            for i, f in enumerate(job.files)
        ],
    }


async def process_job(job: Job) -> None:
    job.status = "processing"
    try:
        count = len(job.files)
        for index, item in enumerate(job.files):
            item.status = "processing"
            item.message = "Inspecting and optimizing package…"
            job.message = f"Compressing {index + 1} of {count}: {item.original_name}"
            source = Path(job.work_dir) / "input" / item.stored_name
            output_name = f"{index:02d}_{Path(item.stored_name).stem}_compressed.pptx"
            output = Path(job.work_dir) / "output" / output_name
            output.parent.mkdir(parents=True, exist_ok=True)
            target_bytes = int(job.target_mb * 1024 * 1024) if job.target_mb else None
            file_base = (index / count) * 100.0
            file_span = 100.0 / count

            def on_entry(done: int, total: int, label: str, _fb: float = file_base, _fs: float = file_span) -> None:
                frac = min(1.0, max(0.0, done / max(1, total)))
                job.progress_fine = round(_fb + _fs * frac, 2)
                job.progress = int(job.progress_fine)
                job.detail = label

            try:
                stats = await asyncio.to_thread(compress_package, source, output, job.preset, target_bytes, on_entry)
                item.output_bytes = output.stat().st_size
                item.saved_bytes = max(0, item.original_bytes - item.output_bytes)
                item.saved_percent = round((item.saved_bytes / item.original_bytes * 100) if item.original_bytes else 0, 2)
                item.output_path = str(output)
                item.stats = stats
                item.status = "complete"
                item.message = stats.get("message", "Compression complete")
            except Exception as exc:
                item.status = "error"
                item.message = str(exc)[:300] or "Compression failed"
            job.progress = int(((index + 1) / count) * 100)
            job.progress_fine = float(job.progress)
            job.detail = f"Finished {item.original_name} ({index + 1}/{count})"
        if all(f.status == "error" for f in job.files):
            job.status = "error"
            job.error = "All files failed to process. Review the file-level error messages."
            job.message = job.error
        else:
            job.status = "complete"
            job.message = "Processing finished. Review each result and download the optimized files."
    except Exception as exc:
        job.status = "error"
        job.error = str(exc)[:500]
        job.message = "The job failed unexpectedly."
    finally:
        # Remove originals as soon as processing is complete; keep outputs until TTL cleanup.
        shutil.rmtree(Path(job.work_dir) / "input", ignore_errors=True)


async def cleanup_old_jobs() -> None:
    now = time.time()
    for job_id, job in list(JOBS.items()):
        if now - job.created_at > JOB_TTL_SECONDS and job.status in {"complete", "error"}:
            shutil.rmtree(job.work_dir, ignore_errors=True)
            JOBS.pop(job_id, None)
            JOB_TASKS.pop(job_id, None)


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024), max_files_per_job=MAX_FILES_PER_JOB)


@app.post("/api/jobs", response_model=JobCreateResponse)
async def create_job(
    files: list[UploadFile] = File(...),
    preset: str = Form("balanced"),
    target_mb: float | None = Form(None),
) -> JobCreateResponse:
    await cleanup_old_jobs()
    if preset not in ALLOWED_PRESETS:
        raise HTTPException(status_code=400, detail="Unknown compression preset.")
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one .pptx file.")
    if len(files) > MAX_FILES_PER_JOB:
        raise HTTPException(status_code=413, detail=f"Maximum {MAX_FILES_PER_JOB} files per job.")
    if target_mb is not None and (target_mb <= 0 or target_mb > 10000):
        raise HTTPException(status_code=400, detail="Target size must be between 0 and 10000 MB.")

    job_id = uuid.uuid4().hex
    work_dir = tempfile.mkdtemp(prefix=f"slideshrink_{job_id}_", dir=DATA_DIR)
    input_dir = Path(work_dir) / "input"
    input_dir.mkdir(parents=True, exist_ok=True)
    job = Job(id=job_id, preset=preset, target_mb=target_mb, created_at=time.time(), work_dir=work_dir)
    total_received = 0
    try:
        for index, upload in enumerate(files):
            try:
                original_name = safe_filename(upload.filename or "presentation.pptx")
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{upload.filename or 'File'}: {exc}") from exc
            stored_name = f"{index:03d}_{uuid.uuid4().hex}.pptx"
            dest = input_dir / stored_name
            size = 0
            with dest.open("wb") as out:
                while True:
                    chunk = await upload.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    total_received += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(status_code=413, detail=f"{original_name} exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB per-file limit.")
                    if total_received > MAX_UPLOAD_BYTES * MAX_FILES_PER_JOB:
                        raise HTTPException(status_code=413, detail="Combined upload exceeds the configured job limit.")
                    out.write(chunk)
            if size == 0:
                raise HTTPException(status_code=400, detail=f"{original_name} is empty.")
            # Validate package before registering the job.
            try:
                zf, _ = inspect_pptx(dest)
                zf.close()
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=f"{original_name}: {exc}") from exc
            job.files.append(FileResult(original_name=original_name, stored_name=stored_name, original_bytes=size))
            await upload.close()
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        for upload in files:
            try:
                await upload.close()
            except Exception:
                pass
        raise
    JOBS[job_id] = job
    JOB_TASKS[job_id] = asyncio.create_task(process_job(job))
    return JobCreateResponse(job_id=job_id, status=job.status, file_count=len(job.files))


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    await cleanup_old_jobs()
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    return job_public(job)


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    await cleanup_old_jobs()
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found or expired.")

    async def stream() -> Any:
        last = ""
        # Push fine-grained progress ~8x/sec until the job reaches a terminal state.
        while True:
            job = JOBS.get(job_id)
            if not job:
                yield "event: error\ndata: {\"detail\": \"Job not found or expired.\"}\n\n"
                break
            payload = json.dumps(job_public(job))
            if payload != last:
                yield f"data: {payload}\n\n"
                last = payload
            if job.status in {"complete", "error"}:
                break
            await asyncio.sleep(0.12)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no",
    })


@app.get("/api/jobs/{job_id}/files/{file_index}/download")
async def download_file(job_id: str, file_index: int) -> FileResponse:
    await cleanup_old_jobs()
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    if file_index < 0 or file_index >= len(job.files):
        raise HTTPException(status_code=404, detail="File result not found.")
    item = job.files[file_index]
    if item.status != "complete" or not item.output_path or not Path(item.output_path).is_file():
        raise HTTPException(status_code=409, detail="This file is not ready to download.")
    download_name = f"{Path(item.original_name).stem}_compressed.pptx"
    return FileResponse(item.output_path, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation", filename=download_name)


@app.get("/api/jobs/{job_id}/download-all")
async def download_all(job_id: str) -> FileResponse:
    await cleanup_old_jobs()
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired.")
    ready = [(i, f) for i, f in enumerate(job.files) if f.status == "complete" and f.output_path and Path(f.output_path).is_file()]
    if not ready:
        raise HTTPException(status_code=409, detail="No completed files are available yet.")
    zip_path = Path(job.work_dir) / "output" / "slideshrink_results.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for i, item in ready:
            z.write(item.output_path, arcname=f"{i:02d}_{Path(item.original_name).stem}_compressed.pptx")
    return FileResponse(zip_path, media_type="application/zip", filename="slideshrink_results.zip")


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str) -> dict[str, str]:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or already deleted.")
    task = JOB_TASKS.get(job_id)
    if task and not task.done():
        task.cancel()
    shutil.rmtree(job.work_dir, ignore_errors=True)
    JOBS.pop(job_id, None)
    JOB_TASKS.pop(job_id, None)
    return {"status": "deleted"}


# --- Static frontend hosting (single-service deployments) ---
# When a production build exists (frontend/dist), serve it from this same
# process so hosts like Hugging Face Spaces / Render only need one service.
# Registered after all API routes, so /api/*, /docs, /openapi.json win.
FRONTEND_DIST = Path(
    os.environ.get("SLIDESHRINK_FRONTEND_DIST", str(APP_DIR.parent.parent / "frontend" / "dist"))
).resolve()
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
