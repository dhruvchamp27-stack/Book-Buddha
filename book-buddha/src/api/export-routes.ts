/**
 * HTTP for exports (R10-B): `GET /exports/:dataset?format=csv|json&companyId=&businessId=` plus, for the report
 * datasets, the filters of the matching /reports route (fairId, customerId, itemId, fromDate, toDate, asAtDate, basis).
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
  // Report filters: the same names the /reports routes take. Each report refuses the ones it does not take.
  fairId: z.string().trim().min(1).optional(),
  customerId: z.string().trim().min(1).optional(),
  itemId: z.string().trim().min(1).optional(),
  fromDate: z.string().trim().min(1).optional(),
  toDate: z.string().trim().min(1).optional(),
  asAtDate: z.string().trim().min(1).optional(),
  basis: z.enum(["CASH", "ACCRUAL"]).optional(),
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
    const { format, ...filters } = parsed.data;
    const scope = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
    const exported = buildExport(context.repository, dataset, scope);
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
