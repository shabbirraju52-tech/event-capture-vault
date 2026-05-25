import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Upload, X, FileVideo, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import {
  submissionMetaSchema,
  type SubmissionMeta,
  ACCEPTED_MIME_PREFIXES,
} from "@/lib/submission-schema";
import tkmLogo from "@/assets/tkm-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TKM Miqaat / Event Photos Submission" },
      {
        name: "description",
        content:
          "Toloba ul Kulliyaat il Mumenoon — submit photos and videos from miqaats and events.",
      },
    ],
  }),
  component: SubmitPage,
});


const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks for uploadUrl PUTs

async function uploadFileToOneDrive(
  file: File,
  uploadUrl: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  let start = 0;
  while (start < file.size) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(end - start),
        "Content-Range": `bytes ${start}-${end - 1}/${file.size}`,
      },
      body: chunk,
    });
    if (!res.ok && res.status !== 202 && res.status !== 201 && res.status !== 200) {
      const text = await res.text();
      throw new Error(`Upload failed at ${start}: ${res.status} ${text}`);
    }
    start = end;
    onProgress(Math.round((start / file.size) * 100));
  }
}

interface FileState {
  file: File;
  progress: number;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

function SubmitPage() {
  const [files, setFiles] = useState<FileState[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [success, setSuccess] = useState<{ folderLink: string } | null>(null);

  const form = useForm<SubmissionMeta>({
    resolver: zodResolver(submissionMetaSchema),
    defaultValues: {
      eventName: "",
      submitterName: "",
      itsNumber: "",
      miqaatDate: new Date().toISOString().slice(0, 10),
    },
  });

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next: FileState[] = [];
    for (const f of Array.from(list)) {
      if (!ACCEPTED_MIME_PREFIXES.some((p) => f.type.startsWith(p))) {
        toast.error(`${f.name} is not a photo or video`);
        continue;
      }
      next.push({ file: f, progress: 0, status: "pending" });
    }
    setFiles((prev) => [...prev, ...next].slice(0, 50));
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmit(meta: SubmissionMeta) {
    if (files.length === 0) {
      toast.error("Please add at least one photo or video");
      return;
    }
    setSubmitting(true);
    setOverallProgress(0);
    try {
      // 1. Init: create folder + get upload sessions
      const initRes = await fetch("/api/public/submit-init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...meta,
          files: files.map((f) => ({
            name: f.file.name,
            size: f.file.size,
            type: f.file.type,
          })),
        }),
      });
      if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}));
        throw new Error(
          typeof err.error === "string" ? err.error : "Failed to start upload",
        );
      }
      const init = (await initRes.json()) as {
        folderId: string;
        folderPath: string;
        uploads: Array<{ name: string; uploadUrl: string }>;
      };

      // 2. Upload each file directly to OneDrive
      const total = files.reduce((sum, f) => sum + f.file.size, 0);
      let uploadedBytes = 0;
      for (let i = 0; i < files.length; i++) {
        const up = init.uploads[i];
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "uploading", progress: 0 } : f,
          ),
        );
        try {
          await uploadFileToOneDrive(files[i].file, up.uploadUrl, (pct) => {
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, progress: pct } : f,
              ),
            );
            const fileUploaded = (files[i].file.size * pct) / 100;
            setOverallProgress(
              Math.round(((uploadedBytes + fileUploaded) / total) * 100),
            );
          });
          uploadedBytes += files[i].file.size;
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "done", progress: 100 } : f,
            ),
          );
        } catch (err) {
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i
                ? {
                    ...f,
                    status: "error",
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : f,
            ),
          );
          throw err;
        }
      }

      // 3. Complete: get share link + log to Excel
      const completeRes = await fetch("/api/public/submit-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...meta,
          folderId: init.folderId,
          folderPath: init.folderPath,
          fileCount: files.length,
        }),
      });
      if (!completeRes.ok) {
        const err = await completeRes.json().catch(() => ({}));
        throw new Error(
          typeof err.error === "string"
            ? err.error
            : "Files uploaded but logging failed",
        );
      }
      const complete = (await completeRes.json()) as { folderLink: string };
      setSuccess({ folderLink: complete.folderLink });
      toast.success("Submission complete!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-xl">
          <CardHeader className="text-center">
            <img
              src={tkmLogo}
              alt="Toloba ul Kulliyaat il Mumenoon"
              className="mx-auto mb-4 h-24 w-auto"
            />
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-8 w-8 text-primary" />
            </div>
            <CardTitle>Submission received</CardTitle>
            <CardDescription>
              Your files have been uploaded and the entry is logged.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <a
              href={success.folderLink}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all rounded-md border border-input bg-muted/40 p-3 text-sm text-primary hover:underline"
            >
              {success.folderLink}
            </a>
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => {
                setSuccess(null);
                setFiles([]);
                form.reset({
                  eventName: "",
                  submitterName: "",
                  itsNumber: "",
                  miqaatDate: new Date().toISOString().slice(0, 10),
                });
              }}
            >
              Submit another
            </Button>
          </CardContent>
        </Card>
        <Toaster richColors position="top-center" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Miqaat Photo & Video Submission
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Share photos and videos from the event. Each submission gets its own
            folder.
          </p>
        </header>

        <Card>
          <CardContent className="pt-6">
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
              noValidate
            >
              <div className="space-y-2">
                <Label htmlFor="eventName">Name of Miqaat / Event</Label>
                <Input
                  id="eventName"
                  placeholder="e.g. Ashara Mubaraka 1447H"
                  {...form.register("eventName")}
                  disabled={submitting}
                />
                {form.formState.errors.eventName && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.eventName.message}
                  </p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="submitterName">Your name</Label>
                  <Input
                    id="submitterName"
                    placeholder="Full name"
                    {...form.register("submitterName")}
                    disabled={submitting}
                  />
                  {form.formState.errors.submitterName && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.submitterName.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="itsNumber">ITS number</Label>
                  <Input
                    id="itsNumber"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="8 digits"
                    {...form.register("itsNumber")}
                    disabled={submitting}
                  />
                  {form.formState.errors.itsNumber && (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.itsNumber.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="miqaatDate">Date of Miqaat</Label>
                <Input
                  id="miqaatDate"
                  type="date"
                  {...form.register("miqaatDate")}
                  disabled={submitting}
                />
                {form.formState.errors.miqaatDate && (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.miqaatDate.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Photos & videos</Label>
                <label
                  htmlFor="file-input"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input bg-muted/30 p-6 text-center transition-colors hover:bg-muted/60"
                >
                  <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">
                    Click to add files
                  </span>
                  <span className="mt-1 text-xs text-muted-foreground">
                    Images and videos · up to 50 files · up to 5 GB total
                  </span>
                  <input
                    id="file-input"
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="sr-only"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }}
                    disabled={submitting}
                  />
                </label>

                {files.length > 0 && (
                  <ul className="space-y-2 pt-2">
                    {files.map((f, i) => (
                      <li
                        key={`${f.file.name}-${i}`}
                        className="flex items-center gap-3 rounded-md border border-border bg-card p-2 text-sm"
                      >
                        {f.file.type.startsWith("video/") ? (
                          <FileVideo className="h-5 w-5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-foreground">
                            {f.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(f.file.size / 1024 / 1024).toFixed(1)} MB
                            {f.status === "uploading" && ` · ${f.progress}%`}
                            {f.status === "done" && " · uploaded"}
                            {f.status === "error" && ` · ${f.error}`}
                          </p>
                          {f.status === "uploading" && (
                            <Progress value={f.progress} className="mt-1 h-1" />
                          )}
                        </div>
                        {!submitting && (
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                            aria-label="Remove file"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {submitting && (
                <div className="space-y-1">
                  <Progress value={overallProgress} />
                  <p className="text-xs text-muted-foreground text-center">
                    Uploading… {overallProgress}%
                  </p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Submitting
                  </>
                ) : (
                  "Submit"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Toaster richColors position="top-center" />
    </main>
  );
}
