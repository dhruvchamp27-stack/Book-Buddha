import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

export const ATTACHMENT_ENTITY_TYPES = [
  "INVOICE",
  "CREDIT_NOTE",
  "PURCHASE_BILL",
  "EXPENSE",
  "CUSTOMER",
  "SUPPLIER",
  "FAIR",
] as const;

export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

/** Default cap: 10 MiB. Override per call with `maxSizeBytes`. */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** MIME type -> the extensions that are acceptable for it. The first one is what we store. */
const ALLOWED_TYPES: Readonly<Record<string, readonly string[]>> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "text/csv": [".csv"],
  "text/plain": [".txt"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

const MAX_ORIGINAL_FILENAME_LENGTH = 255;

export interface Attachment {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  originalFilename: string;
  storedFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdBy: string | null;
  createdAt: string;
}

export interface StoreAttachmentInput {
  entityType: AttachmentEntityType;
  entityId: string;
  originalFilename: string;
  mimeType: string;
  content: Buffer;
  createdBy?: string | null;
  maxSizeBytes?: number;
}

interface AttachmentRow {
  id: string;
  entity_type: AttachmentEntityType;
  entity_id: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_by: string | null;
  created_at: string;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    originalFilename: row.original_filename,
    storedFilename: row.stored_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Reduce whatever the user's machine/browser sent to a plain display name.
 * Directory parts (POSIX, Windows drive, UNC) are dropped; control characters
 * (including NUL) are refused outright. The result is only ever used as
 * metadata - it is NEVER used to build a path on disk.
 */
function cleanOriginalFilename(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error("Attachment filename is required.");
  }
  if (raw.length > MAX_ORIGINAL_FILENAME_LENGTH) {
    throw new Error(`Attachment filename is too long (max ${MAX_ORIGINAL_FILENAME_LENGTH} characters).`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error("Attachment filename contains control characters and was refused.");
  }
  const segments = raw.split(/[\\/]/);
  const base = (segments[segments.length - 1] ?? "").trim();
  if (base === "" || base === "." || base === "..") {
    throw new Error("Attachment filename has no usable file name.");
  }
  return base;
}

function hasValidSignature(mimeType: string, content: Buffer): boolean {
  switch (mimeType) {
    case "application/pdf":
      return content.subarray(0, 5).toString("latin1") === "%PDF-";
    case "image/png":
      return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/jpeg":
      return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
    default:
      return true;
  }
}

/**
 * Resolve `storedFilename` inside `storageRoot` and prove it stays inside.
 * This is the one control every disk path in this module goes through.
 */
function resolveInsideRoot(storageRoot: string, storedFilename: string): string {
  if (storedFilename.includes("\0") || storedFilename !== path.basename(storedFilename)) {
    throw new Error("Unsafe stored filename refused.");
  }
  const root = path.resolve(storageRoot);
  const full = path.resolve(root, storedFilename);
  const relative = path.relative(root, full);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || path.dirname(full) !== root) {
    throw new Error("Attachment path escapes the storage folder and was refused.");
  }
  return full;
}

/**
 * FAILURE ORDER (chosen deliberately):
 *   1. validate everything, 2. write the bytes to a temp file in the storage
 *   folder, 3. rename it to its final generated name, 4. insert the metadata row.
 * If the process dies after step 3 but before step 4, we are left with an
 * ORPHANED FILE: wasted disk space, but no record points at it and nothing is
 * wrong with the books - it can be found and swept later. The opposite order
 * could leave a metadata row pointing at a missing file, i.e. a document the
 * user believes is attached but cannot be opened - silent, unrecoverable
 * corruption. So the file always lands first. If the insert itself fails we
 * remove the file again on a best-effort basis.
 * deleteAttachment follows the same rule in reverse: row first, then file.
 */
export function storeAttachment(
  db: Database.Database,
  storageRoot: string,
  input: StoreAttachmentInput,
): Attachment {
  if (!(ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new Error(`Unknown attachment entity type: ${String(input.entityType)}.`);
  }
  if (typeof input.entityId !== "string" || input.entityId.trim() === "") {
    throw new Error("Attachment entity id is required.");
  }
  if (!Buffer.isBuffer(input.content)) {
    throw new Error("Attachment content must be a Buffer.");
  }
  if (input.content.length === 0) {
    throw new Error("Attachment file is empty.");
  }
  const maxSize = input.maxSizeBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  if (input.content.length > maxSize) {
    throw new Error(
      `Attachment is too large (${input.content.length} bytes; the limit is ${maxSize} bytes).`,
    );
  }

  const mimeType = String(input.mimeType).split(";")[0]!.trim().toLowerCase();
  const allowedExtensions = ALLOWED_TYPES[mimeType];
  if (!allowedExtensions) {
    throw new Error(`File type "${mimeType}" is not allowed.`);
  }

  const originalFilename = cleanOriginalFilename(input.originalFilename);
  const extension = path.extname(originalFilename).toLowerCase();
  if (!allowedExtensions.includes(extension)) {
    throw new Error(
      `File extension "${extension}" does not match its type "${mimeType}" (expected ${allowedExtensions.join(" or ")}).`,
    );
  }
  if (!hasValidSignature(mimeType, input.content)) {
    throw new Error(`File content does not look like a real ${mimeType} file.`);
  }

  const id = randomUUID();
  const storedFilename = `${id}${allowedExtensions[0]}`;
  const root = path.resolve(storageRoot);
  fs.mkdirSync(root, { recursive: true });
  const finalPath = resolveInsideRoot(root, storedFilename);
  const tempPath = resolveInsideRoot(root, `${id}.tmp`);

  try {
    fs.writeFileSync(tempPath, input.content, { flag: "wx" });
    fs.renameSync(tempPath, finalPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  const row: AttachmentRow = {
    id,
    entity_type: input.entityType,
    entity_id: input.entityId,
    original_filename: originalFilename,
    stored_filename: storedFilename,
    mime_type: mimeType,
    size_bytes: input.content.length,
    sha256: createHash("sha256").update(input.content).digest("hex"),
    created_by: input.createdBy ?? null,
    created_at: new Date().toISOString(),
  };

  try {
    db.prepare(
      `INSERT INTO attachments
        (id, entity_type, entity_id, original_filename, stored_filename, mime_type, size_bytes, sha256, created_by, created_at)
       VALUES
        (@id, @entity_type, @entity_id, @original_filename, @stored_filename, @mime_type, @size_bytes, @sha256, @created_by, @created_at)`,
    ).run(row);
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  }
  return toAttachment(row);
}

export function listAttachments(
  db: Database.Database,
  entityType: AttachmentEntityType,
  entityId: string,
): Attachment[] {
  const rows = db
    .prepare(`SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at, id`)
    .all(entityType, entityId) as AttachmentRow[];
  return rows.map(toAttachment);
}

export function getAttachment(db: Database.Database, id: string): Attachment | null {
  const row = db.prepare(`SELECT * FROM attachments WHERE id = ?`).get(id) as AttachmentRow | undefined;
  return row ? toAttachment(row) : null;
}

/** Absolute path of the stored file, re-checked to be inside `storageRoot`. */
export function getAttachmentPath(storageRoot: string, attachment: Attachment): string {
  return resolveInsideRoot(storageRoot, attachment.storedFilename);
}

/** Row first, then file - see the failure-order note on storeAttachment. */
export function deleteAttachment(db: Database.Database, storageRoot: string, id: string): void {
  const attachment = getAttachment(db, id);
  if (!attachment) {
    throw new Error(`Attachment ${id} was not found.`);
  }
  const filePath = getAttachmentPath(storageRoot, attachment);
  db.prepare(`DELETE FROM attachments WHERE id = ?`).run(id);
  fs.rmSync(filePath, { force: true });
}
