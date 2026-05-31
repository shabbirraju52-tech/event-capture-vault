## Speed up uploads

All changes are in `src/routes/index.tsx`. No backend changes.

### Changes

**Larger chunks**
- `CHUNK_SIZE`: 5 MB → **20 MB** (multiple of 320 KiB, well under Graph's 60 MiB cap). Fewer round-trips per file.

**Small-file fast path**
- New `SMALL_FILE_THRESHOLD = 4 MB`. Files at or below this size are sent in a **single PUT** to the upload session URL (full `Content-Range: bytes 0-(size-1)/size`) instead of the chunk loop. Saves an entire HTTP round-trip per small photo.

**Parallel file uploads**
- New `UPLOAD_CONCURRENCY = 4`. Replace the sequential `for (let i = 0; i < files.length; i++)` loop in `onSubmit` with a small worker pool: 4 files upload concurrently; as each finishes, the next pending file starts.
- Track `uploadedBytes` and per-file in-flight bytes in a ref/closure so the overall progress bar stays accurate across parallel workers.
- Per-file status updates (`uploading` / `done` / `error`) keep working the same way.

**Retry with backoff**
- Each chunk PUT goes through a `putChunkWithRetry` helper: up to **3 retries** with 1s / 2s / 4s backoff on `429`, `5xx`, or network errors. One flaky chunk no longer kills the whole submission.

### Why these help
- Latency-bound throughput: a 1 GB video previously did ~200 sequential 5 MB PUTs. Now it's ~50 PUTs at 20 MB each.
- Bandwidth utilization: with 4 parallel files, the browser can saturate the uplink even when individual files have idle gaps between chunks.
- Resilience: transient OneDrive 503s and brief network blips retry transparently instead of aborting the batch.

### Out of scope
- No change to OneDrive limits or `submit-init` (sessions are already created in parallel via `Promise.all`).
- No resumable-on-tab-close persistence (still a future enhancement).
- Concurrency is hard-coded to 4; no UI control.
