/**
 * HTTP for backups (R11): make one, list them, check one.
 *
 * There is deliberately NO restore route. Restoring replaces the database file, and the server
 * holds that file open; swapping it underneath a running server is the app shell's job (close,
 * swap, reopen), not a request handler's. See the header of `src/backup/backup.ts`.
 *
 * Kept out of `server.ts` like the attachment routes. Registering is one line in `buildApi`:
 * `registerBackupRoutes(app, { db, backupsRoot, attachmentsRoot })`.
 *
 * `:id` is matched against a strict pattern (`BACKUP_ID_PATTERN`) before it touches the file
 * system, so it can never name a path outside `backupsRoot`. Refusals are 400 through
 * `RepositoryValidationError`; an id that is well-formed but absent is 404.
 */
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  BackupError,
  BackupNotFoundError,
  BackupVerificationError,
  createBackup,
  listBackups,
  resolveBackupFolder,
  verifyBackup,
} from "../backup/backup.js";
import { RepositoryValidationError } from "../database/repository.js";

export interface BackupRoutesContext {
  readonly db: Database.Database;
  /** Where backup folders are kept. Must be a location the caller chose explicitly. */
  readonly backupsRoot: string;
  /** Where attachment files live; needed for scope EVERYTHING. */
  readonly attachmentsRoot: string;
}

const createBody = z.object({
  scope: z.enum(["DATABASE_ONLY", "EVERYTHING"]),
  label: z.string().trim().min(1).max(200).optional(),
});

export function registerBackupRoutes(app: FastifyInstance, context: BackupRoutesContext): void {
  app.post("/backups", async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    }
    try {
      const manifest = await createBackup(context.db, {
        backupsRoot: context.backupsRoot,
        attachmentsRoot: context.attachmentsRoot,
        scope: parsed.data.scope,
        ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
        kind: "MANUAL",
      });
      return reply.code(201).send(manifest);
    } catch (error) {
      // A copy that failed its own check is a server-side problem, not a bad request.
      if (error instanceof BackupVerificationError) return reply.code(500).send({ error: error.message, manifest: error.manifest });
      if (error instanceof BackupError) throw new RepositoryValidationError(error.message);
      throw error;
    }
  });

  app.get("/backups", async () => ({ backups: listBackups(context.backupsRoot) }));

  app.post<{ Params: { id: string } }>("/backups/:id/verify", async (request, reply) => {
    try {
      const folder = resolveBackupFolder(context.backupsRoot, request.params.id);
      return verifyBackup(folder);
    } catch (error) {
      if (error instanceof BackupNotFoundError) return reply.code(404).send({ error: error.message });
      if (error instanceof BackupError) throw new RepositoryValidationError(error.message);
      throw error;
    }
  });
}
