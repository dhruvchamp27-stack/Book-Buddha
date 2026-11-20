/**
 * HTTP for exports (R10-B): `GET /exports/:dataset?format=csv|json&companyId=&businessId=`.
 *
 * Read-only. Kept out of `server.ts` like the backup and attachment routes; wiring is one line in
 * `buildApi`: `registerExportRoutes(app, { repository })`. Bad input (unknown dataset, unknown
 * format, an empty id) is a `RepositoryValidationError`, which the server's error handler maps to 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import { EXPORT_DATASETS, buildExport, isExportDataset, toCsv, toJsonExport } from "../import-export/exports.js";

export interface ExportRoutesContext {
  readonly repository: AccountingRepository;
}

const query = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  companyId: z.string().trim().min(1).optional(),
  businessId: z.string().trim().min(1).optional(),
});

export function registerExportRoutes(app: FastifyInstance, context: ExportRoutesContext): void {
  app.get<{ Params: { dataset: string } }>("/exports/:dataset", async (request, reply) => {
    const { dataset } = request.params;
    if (!isExportDataset(dataset)) {
      throw new RepositoryValidationError(`Unknown export "${dataset}". Choose one of: ${EXPORT_DATASETS.join(", ")}.`);
    }
    const parsed = query.safeParse(request.query);
    if (!parsed.success) {
      throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "query"}: ${i.message}`).join("; "));
    }
    const { format, companyId, businessId } = parsed.data;
    const exported = buildExport(context.repository, dataset, {
      ...(companyId === undefined ? {} : { companyId }),
      ...(businessId === undefined ? {} : { businessId }),
    });
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (format === "json") {
      return reply
        .header("Content-Disposition", `attachment; filename="${dataset}-${day}.json"`)
        .type("application/json; charset=utf-8")
        .send(toJsonExport(dataset, exported, now.toISOString()));
    }
    return reply
      .header("Content-Disposition", `attachment; filename="${dataset}-${day}.csv"`)
      .type("text/csv; charset=utf-8")
      .send(toCsv(exported));
  });
}
