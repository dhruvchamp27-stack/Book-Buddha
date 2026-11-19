/**
 * HTTP for attachments (R9).
 *
 * The storage engine was built in session 2 (`src/attachments/attachments.ts`, migration v7) and
 * has been unreachable ever since: no route, no repository call. This file is the door. It is kept
 * OUT of `server.ts` on purpose — attachments are the one part of the API that touches the file
 * system, and keeping them in their own file means the whole surface can be read in one screen.
 *
 * TRANSPORT: base64 inside an ordinary JSON body (owner ruling S11-19). Not multipart — that would
 * need `@fastify/multipart`, i.e. an install, and nothing here needs one. The cost of base64 is
 * SIZE: it inflates a file by about a third, so Fastify's default 1 MB `bodyLimit` would refuse a
 * 1 MB PDF. Any route that accepts an upload must therefore carry
 * `bodyLimit: ATTACHMENT_BODY_LIMIT_BYTES` in its route options. That is a per-route limit
 * deliberately, not a server-wide one: the other 123 routes have no business accepting 15 MB.
 *
 * ERRORS: `attachments.ts` throws plain `Error` for every refusal (bad type, too large, bad
 * signature, missing row). A plain `Error` reaching Fastify is a 500 — "internal server error" for
 * what is really the caller's fault. So every call into the engine goes through
 * `asRequestError`, which re-throws as `RepositoryValidationError`; `buildApi`'s error handler
 * already answers that with 400 and the engine's own message. A missing attachment is answered
 * 404 by the route itself rather than thrown, because "not found" is not a validation failure.
 */
import fs from "node:fs";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ATTACHMENT_ENTITY_TYPES,
  deleteAttachment,
  getAttachment,
  getAttachmentPath,
  listAttachments,
  storeAttachment,
  type AttachmentEntityType,
} from "../attachments/attachments.js";
import { RepositoryValidationError } from "../database/repository.js";

/**
 * The body limit for an upload route, in bytes.
 *
 * Worked out, not guessed: the engine's own cap is 10 MiB (`DEFAULT_MAX_ATTACHMENT_BYTES`), base64
 * encodes 3 bytes as 4 so a 10 MiB file arrives as 13.34 MiB, and the JSON envelope around it
 * (field names, the filename, the MIME type) adds a few hundred bytes. 15 MiB clears that with
 * room to spare and still refuses anything absurd. The ENGINE stays the real gatekeeper: a file
 * inside this limit but over 10 MiB is refused by `storeAttachment` with a message naming both
 * figures, which is a better answer than a bare 413 from the HTTP layer.
 */
export const ATTACHMENT_BODY_LIMIT_BYTES = 15 * 1024 * 1024;

/** Proof the limit above actually covers the engine's cap, so the two cannot drift apart. */
export const ATTACHMENT_BASE64_OVERHEAD = 4 / 3;

export interface AttachmentRoutesContext {
  /** The same connection the repository uses: attachments share the one database file. */
  readonly db: Database.Database;
  /** Folder the files live in. Created on first write by `storeAttachment`. */
  readonly storageRoot: string;
}

/**
 * Run an engine call and turn its plain `Error` into the 400 the caller deserves.
 * Anything that is NOT an `Error` is left alone — that would be a genuine fault and should 500.
 */
export function asRequestError<T>(call: () => T): T {
  try {
    return call();
  } catch (error) {
    if (error instanceof RepositoryValidationError) throw error;
    if (error instanceof Error) throw new RepositoryValidationError(error.message);
    throw error;
  }
}

/**
 * Registers the attachment routes on `app`.
 *
 * Every route here is PROTECTED, like all the others: a route is public only when it says
 * `config: { public: true }`, and none of these may. `src/api/auth-enforcement.test.ts` sweeps
 * `app.authRoutes` automatically, so a route added here is covered without editing a list.
 */
export function registerAttachmentRoutes(app: FastifyInstance, context: AttachmentRoutesContext): void {
  // Metadata for one attachment. No bytes: this answers "what is this file", so a listing can be
  // rendered without moving 10 MB. The download route is the one that serves content.
  app.get<{ Params: { id: string } }>("/attachments/:id", async (request, reply) => {
    const attachment = asRequestError(() => getAttachment(context.db, request.params.id));
    if (attachment === null) {
      return reply.code(404).send({ error: `Attachment ${request.params.id} was not found.` });
    }
    return attachment;
  });

  // Upload. The `bodyLimit` is REQUIRED here (see the note at the top): without it Fastify's 1 MB
  // default refuses any file over ~750 KB once it is base64.
  app.post("/attachments", { bodyLimit: ATTACHMENT_BODY_LIMIT_BYTES }, async (request, reply) => {
    const parsed = uploadBody.safeParse(request.body);
    if (!parsed.success) {
      throw new RepositoryValidationError(
        parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
      );
    }
    const input = parsed.data;
    const content = decodeStrictBase64(input.contentBase64);
    const stored = asRequestError(() =>
      storeAttachment(context.db, context.storageRoot, {
        entityType: input.entityType as AttachmentEntityType,
        entityId: input.entityId,
        originalFilename: input.fileName,
        mimeType: input.mimeType,
        content,
      }),
    );
    return reply.code(201).send(stored);
  });

  // Everything attached to ONE entity. Both parameters are required: there is deliberately no
  // "list everything" route.
  app.get<{ Querystring: { entityType?: string; entityId?: string } }>("/attachments", async (request) => {
    const { entityType, entityId } = request.query;
    if (typeof entityType !== "string" || entityType === "" || typeof entityId !== "string" || entityId === "") {
      throw new RepositoryValidationError("Both entityType and entityId are required.");
    }
    if (!(ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
      throw new RepositoryValidationError(`Unknown attachment entity type: ${entityType}.`);
    }
    return asRequestError(() => listAttachments(context.db, entityType as AttachmentEntityType, entityId));
  });

  // The bytes. Registered after `/attachments/:id`; Fastify matches the longer static suffix.
  app.get<{ Params: { id: string } }>("/attachments/:id/content", async (request, reply) => {
    const attachment = asRequestError(() => getAttachment(context.db, request.params.id));
    if (attachment === null) {
      return reply.code(404).send({ error: `Attachment ${request.params.id} was not found.` });
    }
    // getAttachmentPath re-proves the file sits directly inside storageRoot (defence in depth).
    const filePath = asRequestError(() => getAttachmentPath(context.storageRoot, attachment));
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: `The file for attachment ${attachment.id} is missing from disk.` });
      }
      throw error;
    }
    return reply
      .header("content-type", attachment.mimeType)
      .header("content-disposition", contentDispositionFor(attachment.originalFilename))
      .header("x-content-type-options", "nosniff")
      .send(bytes);
  });

  app.delete<{ Params: { id: string } }>("/attachments/:id", async (request, reply) => {
    const attachment = asRequestError(() => getAttachment(context.db, request.params.id));
    if (attachment === null) {
      return reply.code(404).send({ error: `Attachment ${request.params.id} was not found.` });
    }
    asRequestError(() => deleteAttachment(context.db, context.storageRoot, attachment.id));
    return reply.code(204).send();
  });
}

const uploadBody = z
  .object({
    entityType: z.string(),
    entityId: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
    contentBase64: z.string(),
  })
  .strict();

/**
 * Decode base64 or refuse. `Buffer.from(x, "base64")` silently skips junk, so the text is checked
 * against the strict alphabet and padding rules first: length a multiple of 4, `=` only at the end.
 */
export function decodeStrictBase64(text: string): Buffer {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) {
    throw new RepositoryValidationError("contentBase64 is not valid base64.");
  }
  return Buffer.from(text, "base64");
}

/**
 * A `Content-Disposition` header that cannot be broken out of. `"`, `\` and control characters are
 * removed from the quoted form (a CR/LF there would split the header); the quoted form is also
 * limited to printable ASCII, and `filename*=` (RFC 5987) carries the real UTF-8 name.
 */
export function contentDispositionFor(fileName: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = fileName.replace(/[\u0000-\u001f\u007f"\\]/g, "");
  const fallback = cleaned.replace(/[^\x20-\x7e]/g, "_") || "attachment";
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
