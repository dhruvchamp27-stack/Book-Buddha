/**
 * HTTP for the Cash Flow Statement (direct method, S17-6).
 *
 *   GET /reports/cash-flow?businessId=&fairId=&from=&to=      (fromDate / toDate accepted as aliases)
 *   PUT /chart-accounts/:code/cash-flow-section               { section: OPERATING|INVESTING|FINANCING|null }
 *
 * Kept out of `server.ts`; the orchestrator wires `registerCashFlowRoutes(app, { repository })`.
 * Bad input is a `RepositoryValidationError`, which the server's error handler maps to 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import { getCashFlow, setCashFlowSection } from "../database/cash-flow.js";
import { CASH_FLOW_SECTIONS } from "../database/cash-flow-section-schema.js";

export interface CashFlowRoutesContext {
  readonly repository: AccountingRepository;
}

const id = z.string().trim().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date written as YYYY-MM-DD.");
const query = z.object({
  businessId: id.optional(),
  fairId: id.optional(),
  from: date.optional(),
  to: date.optional(),
  fromDate: date.optional(),
  toDate: date.optional(),
}).strict();
const sectionBody = z.object({ section: z.enum(CASH_FLOW_SECTIONS).nullable() }).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || where}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function registerCashFlowRoutes(app: FastifyInstance, context: CashFlowRoutesContext): void {
  const db = context.repository.db;

  app.get("/reports/cash-flow", async (request) => {
    const q = parse(query, request.query, "query");
    return getCashFlow(db, { businessId: q.businessId, fairId: q.fairId, from: q.from ?? q.fromDate, to: q.to ?? q.toDate });
  });

  app.put<{ Params: { code: string } }>("/chart-accounts/:code/cash-flow-section", async (request) => {
    const { section } = parse(sectionBody, request.body, "body");
    setCashFlowSection(db, request.params.code, section);
    return { code: request.params.code, cashFlowSection: section };
  });
}
