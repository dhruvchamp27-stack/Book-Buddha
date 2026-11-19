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
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { getAttachment } from "../attachments/attachments.js";
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

  // The remaining routes (upload, list by entity, download, delete) are R9's build work.
  // An upload route MUST carry `bodyLimit: ATTACHMENT_BODY_LIMIT_BYTES`; see the note at the top.
}
