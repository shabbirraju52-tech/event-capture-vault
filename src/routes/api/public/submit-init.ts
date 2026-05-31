import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  ACCEPTED_MIME_PREFIXES,
  MAX_TOTAL_BYTES,
  initRequestSchema,
} from "@/lib/submission-schema";
import {
  LOG_FOLDER,
  buildFolderName,
  createUploadSession,
  ensureFolder,
} from "@/lib/onedrive.server";

export const Route = createFileRoute("/api/public/submit-init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = initRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const { files, eventName, submitterName, itsNumber, markaz, miqaatDate, submissionType } =
          parsed.data;

        // Validate file types and total size.
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (totalSize > MAX_TOTAL_BYTES) {
          return Response.json(
            { error: "Total upload exceeds 5 GB" },
            { status: 400 },
          );
        }
        for (const f of files) {
          if (!ACCEPTED_MIME_PREFIXES.some((p) => f.type.startsWith(p))) {
            return Response.json(
              { error: `File ${f.name} is not a photo or video` },
              { status: 400 },
            );
          }
        }

        try {
          const folderName = buildFolderName({
            miqaatDate,
            eventName,
            itsNumber,
            markaz,
            submissionType,
          });
          const folderPath = `${LOG_FOLDER}/${folderName}`;
          const folder = await ensureFolder(folderPath);

          const uploads = await Promise.all(
            files.map(async (f) => {
              const session = await createUploadSession({
                parentPath: folderPath,
                fileName: f.name,
              });
              return {
                name: f.name,
                uploadUrl: session.uploadUrl,
                expirationDateTime: session.expirationDateTime,
              };
            }),
          );

          return Response.json({
            folderId: folder.id,
            folderPath,
            uploads,
            meta: { eventName, submitterName, itsNumber, markaz, miqaatDate },
          });
        } catch (err) {
          console.error("submit-init failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
