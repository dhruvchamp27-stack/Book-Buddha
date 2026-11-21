/**
 * HTTP for the bank-feed review queue (R12 12f).
 *
 *   GET   /bank-feed/lines?companyId=&accountCode=&status=      lines + links + bank-rule suggestion (default FOR_REVIEW)
 *   PATCH /bank-feed/lines/:id                                  { businessId?, fairId? }   (null clears)
 *   GET   /bank-feed/lines/:id/matches                          open documents + posted lines this line could match
 *   POST  /bank-feed/lines/:id/add          { splits: [{ accountCode, amountPaise, description? }], partyName?, narration?, paymentMode?, confirm }
 *   POST  /bank-feed/lines/:id/uncategorise { confirm }
 *   POST  /bank-feed/lines/:id/transfer     { otherAccountCode, paymentMode?, confirm }
 *   POST  /bank-feed/lines/:id/match        { documents?: [{ kind, id, amountPaise }], journalLineIds?, paymentMode?, confirm? }
 *   POST  /bank-feed/lines/:id/exclude      { reason? }
 *   POST  /bank-feed/lines/:id/undo         { reason?, confirm? }
 *
 * confirm: false (or missing, where an action posts) answers { confirmed: false, willPost: [...] } and
 * writes NOTHING; confirm: true does it and answers { confirmed: true, line, links }.
 * Amounts are whole paise; a line's amount is + money IN to the bank account, - money OUT (a bank's
 * "Debit / Withdrawal" column is money OUT = negative, the opposite of the books' word).
 *
 * Kept out of `server.ts`; the orchestrator wires `registerReviewQueueRoutes(app, { repository, suggest })`,
 * handing 12g's `suggestFor` as `suggest`. Bad input is a RepositoryValidationError -> 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  addLine, excludeLine, findMatches, listReviewQueue, matchLine, transferLine, uncategoriseLine, undoLine, updateLine,
} from "../banking/review-queue.js";
import { getStatementLine, type LineSuggestion, type StatementLine } from "../banking/statement-lines.js";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";

export interface ReviewQueueRoutesContext {
  readonly repository: AccountingRepository;
  /** 12g's bank-rule suggestion for a line (pre-fill only); absent = every line's suggestion is null. */
  readonly suggest?: ((line: StatementLine) => LineSuggestion | null) | undefined;
}

const text = z.string().trim().min(1);
const listQuery = z.object({
  companyId: text,
  accountCode: text,
  status: z.enum(["FOR_REVIEW", "ADDED", "MATCHED", "TRANSFERRED", "EXCLUDED"]).optional(),
});
const patchBody = z.object({ businessId: text.nullable().optional(), fairId: text.nullable().optional() });
const addBody = z.object({
  splits: z.array(z.object({ accountCode: text, amountPaise: z.number().int(), description: z.string().optional() })),
  partyName: z.string().optional(),
  narration: z.string().optional(),
  paymentMode: z.string().optional(),
  confirm: z.boolean(),
});
const confirmBody = z.object({ confirm: z.boolean() });
const transferBody = z.object({ otherAccountCode: text, paymentMode: z.string().optional(), confirm: z.boolean() });
const matchBody = z.object({
  documents: z.array(z.object({ kind: z.enum(["INVOICE", "BILL"]), id: text, amountPaise: z.number().int() })).optional(),
  journalLineIds: z.array(z.number().int()).optional(),
  paymentMode: z.string().optional(),
  confirm: z.boolean().optional(),
});
const excludeBody = z.object({ reason: z.string().optional() });
const undoBody = z.object({ reason: z.string().optional(), confirm: z.boolean().optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || where}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function registerReviewQueueRoutes(app: FastifyInstance, context: ReviewQueueRoutesContext): void {
  const { repository, suggest } = context;
  const db = repository.db;

  app.get("/bank-feed/lines", async (request) => {
    const q = parse(listQuery, request.query, "query");
    return { lines: listReviewQueue(repository, q, suggest) };
  });

  app.patch<{ Params: { id: string } }>("/bank-feed/lines/:id", async (request) => {
    const body = parse(patchBody, request.body, "body");
    return { line: updateLine(repository, request.params.id, body) };
  });

  app.get<{ Params: { id: string } }>("/bank-feed/lines/:id/matches", async (request) => {
    getStatementLine(db, request.params.id);
    return findMatches(repository, request.params.id);
  });

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/add", async (request) =>
    addLine(repository, request.params.id, parse(addBody, request.body, "body")));

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/uncategorise", async (request) =>
    uncategoriseLine(repository, request.params.id, parse(confirmBody, request.body, "body")));

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/transfer", async (request) =>
    transferLine(repository, request.params.id, parse(transferBody, request.body, "body")));

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/match", async (request) =>
    matchLine(repository, request.params.id, parse(matchBody, request.body, "body")));

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/exclude", async (request) => {
    const body = parse(excludeBody, request.body, "body");
    return { confirmed: true, line: excludeLine(repository, request.params.id, body.reason) };
  });

  app.post<{ Params: { id: string } }>("/bank-feed/lines/:id/undo", async (request) =>
    undoLine(repository, request.params.id, parse(undoBody, request.body, "body")));
}
