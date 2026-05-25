import { z } from "zod";

export const MARKAZ_OPTIONS = [
  "Fakhri",
  "Jamali",
  "Badri",
  "Ardiya",
  "Other",
] as const;

export const submissionMetaSchema = z.object({
  eventName: z.string().trim().min(1, "Event name is required").max(120),
  submitterName: z.string().trim().min(1, "Your name is required").max(120),
  itsNumber: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "ITS number must be exactly 8 digits"),
  markaz: z.enum(MARKAZ_OPTIONS, {
    message: "Please select a markaz",
  }),
  miqaatDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date is required"),
});

export type SubmissionMeta = z.infer<typeof submissionMetaSchema>;

export const fileDescriptorSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().min(1).max(50 * 1024 * 1024 * 1024), // 50 GB cap per file
  type: z.string().max(255),
});

export type FileDescriptor = z.infer<typeof fileDescriptorSchema>;

export const initRequestSchema = submissionMetaSchema.extend({
  files: z.array(fileDescriptorSchema).min(1, "Add at least one file").max(200),
});

export const completeRequestSchema = submissionMetaSchema.extend({
  folderId: z.string().min(1),
  folderPath: z.string().min(1),
  fileCount: z.number().int().min(1),
});

export const ACCEPTED_MIME_PREFIXES = ["image/", "video/"];
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024 * 1024; // 100 GB total per submission
