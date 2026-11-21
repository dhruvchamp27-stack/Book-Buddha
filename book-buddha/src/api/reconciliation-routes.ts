/**
 * HTTP for bank reconciliation (R12d). Wiring is one line in `buildApi`:
 * `registerReconciliationRoutes(app, { repository })`.
 *
 * SIGN CONVENTION: every balance is debit minus credit (money held). An overdraft or cash credit in
 * use is NEGATIVE, so a statement showing Rs 1,50,000 owed is sent as -15000000 paise.
 *
 *   GET   /reconciliations?companyId=&accountCode=    history, newest first
 *   POST  /reconciliations                            { companyId, accountCode, statementEndDate, statementEndingBalancePaise }
 *   GET   /reconciliations/:id                        header, candidates, cleared figures, difference
 *   POST  /reconciliations/:id/ticks                  { journalLineIds, ticked }
 *   PATCH /reconciliations/:id                        { statementEndDate?, statementEndingBalancePaise? }
 *   POST  /reconciliations/:id/finish | undo | discard   (undo takes { reason })
 *   GET   /reconciliations/:id/report
 *
 * Bad input is a `RepositoryValidationError`, which the server's error handler maps to 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import {
  discardReconciliation,
  editStatement,
  finishReconciliation,
  getReconciliation,
  getReconciliationReport,
  listReconciliations,
  setTicked,
  startReconciliation,
  undoReconciliation,
} from "../banking/reconciliation.js";

export interface ReconciliationRoutesContext {
  readonly repository: AccountingRepository;
}

const idText = z.string().trim().min(1);
const paise = z.number().int();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const listQuery = z.object({ companyId: idText, accountCode: idText });
const startBody = z.object({ companyId: idText, accountCode: idText, statementEndDate: isoDate, statementEndingBalancePaise: paise });
const ticksBody = z.object({ journalLineIds: z.array(z.number().int()).min(1), ticked: z.boolean() });
const editBody = z
  .object({ statementEndDate: isoDate.optional(), statementEndingBalancePaise: paise.optional() })
  .refine((b) => b.statementEndDate !== undefined || b.statementEndingBalancePaise !== undefined, "give an end date or an ending balance");
const undoBody = z.object({ reason: z.string().trim().min(1, "a reason is required") });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function registerReconciliationRoutes(app: FastifyInstance, context: ReconciliationRoutesContext): void {
  const db = context.repository.db;

  app.get("/reconciliations", async (request) => {
    const q = parse(listQuery, request.query);
    return listReconciliations(db, q.companyId, q.accountCode);
  });

  app.post("/reconciliations", async (request, reply) => {
    const body = parse(startBody, request.body);
    const header = startReconciliation(db, body);
    return reply.code(201).send(getReconciliation(db, header.id));
  });

  app.get<{ Params: { id: string } }>("/reconciliations/:id", async (request) => getReconciliation(db, request.params.id));

  app.post<{ Params: { id: string } }>("/reconciliations/:id/ticks", async (request) => {
    const body = parse(ticksBody, request.body);
    return setTicked(db, request.params.id, body.journalLineIds, body.ticked);
  });

  app.patch<{ Params: { id: string } }>("/reconciliations/:id", async (request) => {
    const body = parse(editBody, request.body);
    return editStatement(db, request.params.id, {
      ...(body.statementEndDate === undefined ? {} : { statementEndDate: body.statementEndDate }),
      ...(body.statementEndingBalancePaise === undefined ? {} : { statementEndingBalancePaise: body.statementEndingBalancePaise }),
    });
  });

  app.post<{ Params: { id: string } }>("/reconciliations/:id/finish", async (request) => {
    finishReconciliation(db, request.params.id);
    return getReconciliation(db, request.params.id);
  });

  app.post<{ Params: { id: string } }>("/reconciliations/:id/undo", async (request) => {
    const body = parse(undoBody, request.body);
    undoReconciliation(db, request.params.id, body.reason);
    return getReconciliation(db, request.params.id);
  });

  app.post<{ Params: { id: string } }>("/reconciliations/:id/discard", async (request) => {
    discardReconciliation(db, request.params.id);
    return { discarded: true };
  });

  app.get<{ Params: { id: string } }>("/reconciliations/:id/report", async (request) => getReconciliationReport(db, request.params.id));
}
