import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { completeRequestSchema } from "@/lib/submission-schema";
import { appendLogRow, createViewLink } from "@/lib/onedrive.server";

export const Route = createFileRoute("/api/public/submit-complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }
        const parsed = completeRequestSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: parsed.error.flatten() },
            { status: 400 },
          );
        }
        const {
          folderId,
          eventName,
          submitterName,
          itsNumber,
          miqaatDate,
          fileCount,
        } = parsed.data;

        try {
          const folderLink = await createViewLink(folderId);
          await appendLogRow([
            new Date().toISOString(),
            eventName,
            submitterName,
            itsNumber,
            miqaatDate,
            fileCount,
            folderLink,
          ]);
          return Response.json({ folderLink });
        } catch (err) {
          console.error("submit-complete failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : "Unknown error" },
            { status: 500 },
          );
        }
      },
    },
  },
});
