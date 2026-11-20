/**
 * HTTP for imports (R10-C): list the kinds, inspect a file, preview an import, commit it.
 *
 *   GET  /imports/kinds    every kind and its fields
 *   POST /imports/inspect  { kind, fileName, contentBase64 } -> format, encoding, delimiter, headers,
 *                          rowCount, the first 10 rows, and a suggested column map
 *   POST /imports/preview  { kind, fileName, contentBase64, columnMap, companyId, businessId?, dateFormat }
 *   POST /imports/commit   the same body; preview runs the real posting path and rolls back, commit keeps it
 *
 * TRANSPORT: base64 inside a JSON body, like attachments (S11-19), so every route that takes a
 * file carries a per-route `bodyLimit` (`IMPORT_BODY_LIMIT_BYTES`); Fastify's 1 MB default would
 * refuse a file over ~750 KB. A bad body, an unreadable file or a bad column map is a 400 through
 * `RepositoryValidationError`, which the server's error handler already maps.
 *
 * Kept out of `server.ts` like the attachment and backup routes. Registering is one line in
 * `buildApi`: `registerImportRoutes(app, { repository })`. Routes are NOT public, so the global
 * auth hook protects them with no further work.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import { CodecError, parseTabular, type ParsedTabular } from "../import-export/codec.js";
import { getImportKind, registeredKinds, runImport, suggestColumnMap } from "../import-export/import-engine.js";

export const IMPORT_BODY_LIMIT_BYTES = 20 * 1024 * 1024;
const SAMPLE_ROWS = 10;

export interface ImportRoutesContext {
  readonly repository: AccountingRepository;
}

const fileFields = {
  kind: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  contentBase64: z.string().min(1),
};
const inspectBody = z.object(fileFields);
const runBody = z.object({
  ...fileFields,
  columnMap: z.record(z.string(), z.string()),
  companyId: z.string().trim().min(1),
  businessId: z.string().trim().min(1).optional(),
  dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY"]),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new RepositoryValidationError(result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return result.data;
}

function readFile(fileName: string, contentBase64: string): ParsedTabular {
  const compact = contentBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw new RepositoryValidationError("contentBase64 is not valid base64.");
  }
  try {
    return parseTabular({ fileName, bytes: new Uint8Array(Buffer.from(compact, "base64")) });
  } catch (error) {
    if (error instanceof CodecError) throw new RepositoryValidationError(`${fileName}: ${error.message}`);
    throw error;
  }
}

export function registerImportRoutes(app: FastifyInstance, context: ImportRoutesContext): void {
  const { repository } = context;

  app.get("/imports/kinds", async () => ({
    kinds: registeredKinds().map((k) => ({
      kind: k.kind,
      scope: k.scope,
      ...(k.groupBy === undefined ? {} : { groupBy: k.groupBy }),
      fields: k.fields.map((f) => ({ key: f.key, label: f.label, required: f.required, synonyms: f.synonyms })),
    })),
  }));

  app.post("/imports/inspect", { bodyLimit: IMPORT_BODY_LIMIT_BYTES }, async (request) => {
    const body = parseBody(inspectBody, request.body);
    getImportKind(body.kind); // unknown kind -> 400
    const file = readFile(body.fileName, body.contentBase64);
    return {
      kind: body.kind,
      format: file.format,
      encoding: file.encoding,
      delimiter: file.delimiter,
      headers: file.headers,
      rowCount: file.rows.length,
      sampleRows: file.rows.slice(0, SAMPLE_ROWS),
      suggestedColumnMap: suggestColumnMap(body.kind, file.headers),
    };
  });

  for (const mode of ["PREVIEW", "COMMIT"] as const) {
    app.post(`/imports/${mode.toLowerCase()}`, { bodyLimit: IMPORT_BODY_LIMIT_BYTES }, async (request) => {
      const body = parseBody(runBody, request.body);
      const definition = getImportKind(body.kind);
      const company = repository.listCompanies().find((c) => c.id === body.companyId);
      if (company === undefined) throw new RepositoryValidationError(`Company ${body.companyId} was not found.`);
      if (body.businessId !== undefined && !repository.listBusinesses(body.companyId).some((b) => b.id === body.businessId)) {
        throw new RepositoryValidationError(`Business ${body.businessId} was not found in that company.`);
      }
      const parsed = readFile(body.fileName, body.contentBase64);
      return runImport({
        repository,
        kind: definition.kind,
        parsed,
        columnMap: body.columnMap,
        companyId: body.companyId,
        ...(body.businessId === undefined ? {} : { businessId: body.businessId }),
        dateFormat: body.dateFormat,
        mode,
      });
    });
  }
}
