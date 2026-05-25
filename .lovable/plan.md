
## Goal
Public web form that collects event submission details + photos/videos, creates a unique OneDrive folder per submission, uploads the files there, and appends a row to an Excel log in your OneDrive with the folder link and details.

## Setup steps (you'll need to do)
1. Connect Microsoft OneDrive (for file uploads) and Microsoft Excel (for the log sheet) connectors — I'll prompt you when ready.
2. Decide on a parent OneDrive folder name (e.g. `/EventSubmissions`) and an Excel file (e.g. `/EventSubmissions/log.xlsx` with a table called `Submissions`). I can create these on first submission if missing.

## Form (public, no login)
Fields collected:
- Miqaat / Event name (required, text)
- Submitter name (required, text)
- ITS number (required, exactly 8 digits — validated client + server with zod)
- Date of miqaat (required, date)
- File uploads — multiple photos and videos (drag-and-drop, with previews, size limits)

After submit: success screen with link to the created OneDrive folder.

## Backend flow (TanStack Start server route at `/api/public/submit`)
For each submission:
1. Validate fields with zod; reject if ITS isn't 8 digits or files exceed limits.
2. Create a unique folder in OneDrive: `EventSubmissions/{YYYY-MM-DD}_{event-slug}_{its}_{shortId}` via Graph API through the connector gateway.
3. Upload each file to that folder. Small files (<4 MB) via simple PUT; larger files (videos) via Graph upload session (chunked).
4. Get a shareable view link for the folder (`createLink` endpoint).
5. Append a row to the Excel table with: timestamp, event name, submitter name, ITS number, miqaat date, file count, folder link.
6. Return folder link + summary to the client.

To avoid huge requests to the server, the browser uploads files directly to OneDrive using a short-lived upload session URL the server returns (server still owns folder creation, link generation, and Excel logging).

## Security
- Rate-limit submissions per IP (in-memory bucket, with a note that durable rate limiting would need a DB).
- Validate file MIME types (images + videos only) and per-file / total size caps.
- Strip path-unsafe characters from event name when building folder name.
- Never expose connector keys to the client; all Graph calls go through the server via the gateway.

## Technical details
- Stack: TanStack Start, server routes under `src/routes/api/public/`.
- Connectors: `microsoft_onedrive` for file/folder ops, `microsoft_excel` for table row append. Both use the Lovable connector gateway (your single account).
- New files:
  - `src/routes/index.tsx` — the form UI (replaces placeholder)
  - `src/routes/api/public/submit.ts` — create folder + log row
  - `src/routes/api/public/upload-session.ts` — request a Graph upload session for a given file in a given folder
  - `src/lib/graph.server.ts` — shared Graph gateway helpers
  - `src/lib/submission-schema.ts` — zod schemas shared client+server
- UI built with existing shadcn components (Input, Button, Calendar, Form, Sonner toasts).

## Out of scope (ask if you want them)
- Admin dashboard to view submissions
- Email notification on submit
- Per-submitter OneDrive (would need per-user OAuth)
