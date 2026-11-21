/**
 * HTTP for Internal Transfers and Receipt / Payment Vouchers (R12c).
 *
 *   GET  /internal-transfers?companyId=&fromDate=&toDate=&businessId=
 *   POST /internal-transfers                 (body: businessId, date, fromAccount, toAccount, amountPaise, ...)
 *   POST /internal-transfers/:id/cancel      (body: reason)
 *   GET  /vouchers?companyId=&kind=&fromDate=&toDate=&businessId=
 *   POST /vouchers                           (body: kind, businessId, date, moneyAccount, lines, ...)
 *   POST /vouchers/:id/cancel                (body: reason)
 *
 * Bad input of any kind is a `RepositoryValidationError`, which the server's error handler maps to 400.
 * Wiring is one line in `buildApi`: `registerMoneyMovementRoutes(app, { repository })`.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError } from "../database/errors.js";
import type { AccountingRepository } from "../database/repository.js";
import { cancelInternalTransfer, createInternalTransfer, listInternalTransfers } from "../banking/internal-transfers.js";
import { cancelVoucher, createVoucher, listVouchers } from "../banking/vouchers.js";

export interface MoneyMovementRoutesContext {
  readonly repository: AccountingRepository;
}

const text = z.string().trim().min(1);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "must be written as YYYY-MM-DD");

const listQuery = z.object({
  companyId: text,
  businessId: text.optional(),
  fromDate: date.optional(),
  toDate: date.optional(),
  kind: z.enum(["RECEIPT", "PAYMENT"]).optional(),
});

const transferBody = z.object({
  businessId: text,
  date,
  fromAccount: text,
  toAccount: text,
  amountPaise: z.number(),
  paymentMode: text.optional(),
  paymentReference: z.string().optional(),
  memo: z.string().optional(),
  fairId: text.optional(),
});

const voucherBody = z.object({
  kind: z.enum(["RECEIPT", "PAYMENT"]),
  businessId: text,
  date,
  moneyAccount: text,
  lines: z.array(z.object({ account: text, amountPaise: z.number(), description: z.string().optional() })),
  paymentMode: text.optional(),
  paymentReference: z.string().optional(),
  partyName: z.string().optional(),
  narration: z.string().optional(),
  fairId: text.optional(),
});

const cancelBody = z.object({ reason: z.string() });

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new RepositoryValidationError(
      `${what}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** Drops undefined so optional properties are simply absent (exactOptionalPropertyTypes). */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function registerMoneyMovementRoutes(app: FastifyInstance, context: MoneyMovementRoutesContext): void {
  const db = context.repository.db;

  app.get("/internal-transfers", async (request) => {
    const { companyId, ...filter } = parse(listQuery, request.query, "Query");
    return listInternalTransfers(db, companyId, defined({ businessId: filter.businessId, fromDate: filter.fromDate, toDate: filter.toDate }));
  });

  app.post("/internal-transfers", async (request, reply) => {
    const body = parse(transferBody, request.body, "Transfer");
    return reply.code(201).send(createInternalTransfer(db, defined(body)));
  });

  app.post<{ Params: { id: string } }>("/internal-transfers/:id/cancel", async (request) => {
    const body = parse(cancelBody, request.body, "Cancellation");
    return cancelInternalTransfer(db, request.params.id, body.reason);
  });

  app.get("/vouchers", async (request) => {
    const { companyId, ...filter } = parse(listQuery, request.query, "Query");
    return listVouchers(db, companyId, defined(filter));
  });

  app.post("/vouchers", async (request, reply) => {
    const body = parse(voucherBody, request.body, "Voucher");
    const lines = body.lines.map((l) => defined(l));
    return reply.code(201).send(createVoucher(db, { ...defined(body), lines }));
  });

  app.post<{ Params: { id: string } }>("/vouchers/:id/cancel", async (request) => {
    const body = parse(cancelBody, request.body, "Cancellation");
    return cancelVoucher(db, request.params.id, body.reason);
  });
}
