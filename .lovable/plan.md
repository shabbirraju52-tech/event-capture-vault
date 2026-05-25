## Raise upload limits

Bump the caps in both the schema (server-enforced) and the form copy (client-shown).

### Changes

**`src/lib/submission-schema.ts`**
- `fileDescriptorSchema.size`: max `2 GB` → `50 GB` (50 * 1024³)
- `initRequestSchema.files`: max `50` → `200`
- `MAX_TOTAL_BYTES`: `5 GB` → `100 GB`

**`src/routes/index.tsx`**
- Dropzone helper text: "up to 50 files · up to 5 GB total" → "up to 200 files · up to 100 GB total"
- `setFiles(... .slice(0, 50))` → `.slice(0, 200)`

No backend/auth/OneDrive changes — OneDrive's per-file ceiling (250 GB) is well above the new 50 GB cap, and upload sessions already handle large chunked PUTs.

### Note on very large uploads

Files in the tens of GB take a long time and depend on the user's connection staying alive. The chunked upload retries each 5 MB chunk on failure, but if the tab closes mid-file the upload restarts from the beginning of that file. If this becomes a real issue we can add resumable session persistence later.