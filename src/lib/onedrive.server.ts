/**
 * Helpers for calling Microsoft Graph (OneDrive + Excel) through the
 * Lovable connector gateway. Server-only.
 */

const ONEDRIVE_GATEWAY = "https://connector-gateway.lovable.dev/microsoft_onedrive";
const EXCEL_GATEWAY = "https://connector-gateway.lovable.dev/microsoft_excel";

export const LOG_FOLDER = "EventSubmissions";
export const LOG_FILE = "log.xlsx";
export const LOG_TABLE = "Submissions";
export const LOG_PATH = `${LOG_FOLDER}/${LOG_FILE}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

function oneDriveHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${requireEnv("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": requireEnv("MICROSOFT_ONEDRIVE_API_KEY"),
    ...extra,
  };
}

function excelHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    Authorization: `Bearer ${requireEnv("LOVABLE_API_KEY")}`,
    "X-Connection-Api-Key": requireEnv("MICROSOFT_EXCEL_API_KEY"),
    ...extra,
  };
}

async function check(res: Response, label: string) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${label} failed [${res.status}]: ${text}`);
  }
  return res;
}

/** Slugify a string for use in a OneDrive folder name. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "event";
}

export function buildFolderName(opts: {
  miqaatDate: string;
  eventName: string;
  itsNumber: string;
  markaz?: string;
}): string {
  const shortId = Math.random().toString(36).slice(2, 8);
  const markazPart = opts.markaz ? `_${slugify(opts.markaz)}` : "";
  return `${opts.miqaatDate}_${slugify(opts.eventName)}${markazPart}_${opts.itsNumber}_${shortId}`;
}

/** Ensure a folder exists at the given path under the drive root. */
export async function ensureFolder(path: string): Promise<{ id: string }> {
  // Try to fetch the item first.
  const getRes = await fetch(
    `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(path)}`,
    { headers: oneDriveHeaders() },
  );
  if (getRes.ok) {
    const item = (await getRes.json()) as { id: string };
    return { id: item.id };
  }
  if (getRes.status !== 404) {
    await check(getRes, "OneDrive get folder");
  }
  // Create it. Parent must exist; for nested paths, ensure each segment.
  const segments = path.split("/").filter(Boolean);
  let parentPath = "";
  let created: { id: string } | null = null;
  for (const segment of segments) {
    const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
    const existing = await fetch(
      `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(currentPath)}`,
      { headers: oneDriveHeaders() },
    );
    if (existing.ok) {
      created = (await existing.json()) as { id: string };
    } else if (existing.status === 404) {
      const parentEndpoint = parentPath
        ? `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(parentPath)}:/children`
        : `${ONEDRIVE_GATEWAY}/me/drive/root/children`;
      const createRes = await fetch(parentEndpoint, {
        method: "POST",
        headers: oneDriveHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          name: segment,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });
      await check(createRes, `OneDrive create folder ${currentPath}`);
      created = (await createRes.json()) as { id: string };
    } else {
      await check(existing, "OneDrive folder lookup");
    }
    parentPath = currentPath;
  }
  if (!created) throw new Error("Folder creation produced no result");
  return created;
}

/** Create a Graph upload session for a file in the given parent folder by path. */
export async function createUploadSession(opts: {
  parentPath: string;
  fileName: string;
}): Promise<{ uploadUrl: string; expirationDateTime: string }> {
  const url = `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(
    opts.parentPath,
  )}/${encodeURIComponent(opts.fileName)}:/createUploadSession`;
  const res = await fetch(url, {
    method: "POST",
    headers: oneDriveHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      item: {
        "@microsoft.graph.conflictBehavior": "rename",
        name: opts.fileName,
      },
    }),
  });
  await check(res, "OneDrive createUploadSession");
  return (await res.json()) as {
    uploadUrl: string;
    expirationDateTime: string;
  };
}

/** Create or fetch an anonymous view link for a drive item. */
export async function createViewLink(itemId: string): Promise<string> {
  const res = await fetch(
    `${ONEDRIVE_GATEWAY}/me/drive/items/${itemId}/createLink`,
    {
      method: "POST",
      headers: oneDriveHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ type: "view", scope: "anonymous" }),
    },
  );
  await check(res, "OneDrive createLink");
  const data = (await res.json()) as { link: { webUrl: string } };
  return data.link.webUrl;
}

/** Upload a small file (<4MB) directly via simple PUT to a path. */
export async function uploadSmallFile(opts: {
  path: string;
  body: ArrayBuffer | Uint8Array;
  contentType?: string;
}): Promise<{ id: string }> {
  const res = await fetch(
    `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(opts.path)}:/content`,
    {
      method: "PUT",
      headers: oneDriveHeaders({
        "Content-Type": opts.contentType ?? "application/octet-stream",
      }),
      body: opts.body as BodyInit,
    },
  );
  await check(res, `OneDrive upload ${opts.path}`);
  return (await res.json()) as { id: string };
}

/** Ensure the log workbook exists; if not, upload an empty template. */
export async function ensureLogWorkbook(): Promise<{ itemId: string }> {
  await ensureFolder(LOG_FOLDER);
  const getRes = await fetch(
    `${ONEDRIVE_GATEWAY}/me/drive/root:/${encodeURI(LOG_PATH)}`,
    { headers: oneDriveHeaders() },
  );
  if (getRes.ok) {
    const item = (await getRes.json()) as { id: string };
    return { itemId: item.id };
  }
  if (getRes.status !== 404) {
    await check(getRes, "OneDrive get log workbook");
  }
  // Seed it from the embedded template.
  const { LOG_TEMPLATE_XLSX_BASE64 } = await import("./log-template.server");
  const bytes = Uint8Array.from(atob(LOG_TEMPLATE_XLSX_BASE64), (c) =>
    c.charCodeAt(0),
  );
  const created = await uploadSmallFile({
    path: LOG_PATH,
    body: bytes,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  // Create the table over the header row if it does not exist yet.
  await ensureLogTable(created.id);
  return { itemId: created.id };
}

async function ensureLogTable(itemId: string): Promise<void> {
  // Check existing tables.
  const listRes = await fetch(
    `${EXCEL_GATEWAY}/me/drive/items/${itemId}/workbook/tables`,
    { headers: excelHeaders() },
  );
  if (listRes.ok) {
    const data = (await listRes.json()) as { value?: Array<{ name: string }> };
    if (data.value?.some((t) => t.name === LOG_TABLE)) return;
  }
  // Add a table over A1:H1 (8 header columns).
  const addRes = await fetch(
    `${EXCEL_GATEWAY}/me/drive/items/${itemId}/workbook/worksheets/Submissions/tables/add`,
    {
      method: "POST",
      headers: excelHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ address: "A1:H1", hasHeaders: true }),
    },
  );
  await check(addRes, "Excel tables/add");
  const table = (await addRes.json()) as { id: string; name: string };
  // Rename to LOG_TABLE so we can refer to it by stable name.
  if (table.name !== LOG_TABLE) {
    const renameRes = await fetch(
      `${EXCEL_GATEWAY}/me/drive/items/${itemId}/workbook/tables/${table.id}`,
      {
        method: "PATCH",
        headers: excelHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: LOG_TABLE }),
      },
    );
    await check(renameRes, "Excel rename table");
  }
}

export async function appendLogRow(row: Array<string | number>): Promise<void> {
  const { itemId } = await ensureLogWorkbook();
  const res = await fetch(
    `${EXCEL_GATEWAY}/me/drive/items/${itemId}/workbook/tables/${LOG_TABLE}/rows/add`,
    {
      method: "POST",
      headers: excelHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ values: [row] }),
    },
  );
  await check(res, "Excel tables/rows/add");
}
