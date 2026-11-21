/**
 * HTTP for bank accounts, the payment-mode list and the account register (R12a).
 *
 *   GET/POST /bank-accounts            GET ?companyId= | POST {companyId, name, kind, ...}
 *   PATCH    /bank-accounts/:code      {companyId, name?, bankName?, branch?, accountNumberLast4?, ifsc?, ...}
 *   POST     /bank-accounts/:code/deactivate | /reactivate   {companyId}
 *   GET      /bank-accounts/:code/register?companyId=&fromDate=&toDate=&businessId=
 *   GET/POST /payment-modes            GET ?companyId=&includeInactive= | POST {companyId, code, label}
 *   PATCH    /payment-modes/:code      {companyId, label?, active?}
 *
 * Kept out of `server.ts`; the orchestrator wires `registerBankAccountRoutes(app, { repository })`.
 * Bad input is a `RepositoryValidationError`, which the server's error handler maps to 400.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RepositoryValidationError, type AccountingRepository } from "../database/repository.js";
import {
  BANK_ACCOUNT_KINDS,
  createBankAccount,
  deactivateBankAccount,
  listBankAccounts,
  reactivateBankAccount,
  updateBankAccount,
} from "../banking/bank-accounts.js";
import { addPaymentMode, listPaymentModes, renamePaymentMode, setPaymentModeActive } from "../banking/payment-modes.js";
import { getAccountRegister } from "../banking/register.js";

export interface BankAccountRoutesContext {
  readonly repository: AccountingRepository;
}

const id = z.string().trim().min(1);
const optText = z.string().nullable().optional();

const companyQuery = z.object({ companyId: id });
const createBody = z.object({
  companyId: id,
  name: z.string(),
  kind: z.enum(BANK_ACCOUNT_KINDS),
  code: z.string().optional(),
  bankName: optText,
  branch: optText,
  accountNumberLast4: optText,
  ifsc: optText,
  partOfCashManagement: z.boolean().optional(),
  sanctionedLimitPaise: z.number().int().nullable().optional(),
});
const patchBody = z.object({
  companyId: id,
  name: z.string().optional(),
  bankName: optText,
  branch: optText,
  accountNumberLast4: optText,
  ifsc: optText,
  partOfCashManagement: z.boolean().optional(),
  sanctionedLimitPaise: z.number().int().nullable().optional(),
});
const registerQuery = z.object({
  companyId: id,
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  businessId: id.optional(),
});
const modesQuery = z.object({
  companyId: id,
  includeInactive: z.enum(["true", "false", "1", "0"]).optional(),
});
const modeCreateBody = z.object({ companyId: id, code: z.string(), label: z.string() });
const modePatchBody = z.object({ companyId: id, label: z.string().optional(), active: z.boolean().optional() });

function parse<T>(schema: z.ZodType<T>, value: unknown, where: string): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new RepositoryValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || where}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function registerBankAccountRoutes(app: FastifyInstance, context: BankAccountRoutesContext): void {
  const db = context.repository.db;

  app.get("/bank-accounts", async (request) => {
    const { companyId } = parse(companyQuery, request.query, "query");
    return { bankAccounts: listBankAccounts(db, companyId) };
  });

  app.post("/bank-accounts", async (request, reply) => {
    const body = parse(createBody, request.body, "body");
    const code = createBankAccount(db, body);
    const created = listBankAccounts(db, body.companyId).find((a) => a.code === code);
    return reply.code(201).send({ bankAccount: created });
  });

  app.patch<{ Params: { code: string } }>("/bank-accounts/:code", async (request) => {
    const { companyId, ...patch } = parse(patchBody, request.body, "body");
    updateBankAccount(db, companyId, request.params.code, patch);
    return { bankAccount: listBankAccounts(db, companyId).find((a) => a.code === request.params.code) };
  });

  app.post<{ Params: { code: string } }>("/bank-accounts/:code/deactivate", async (request) => {
    const { companyId } = parse(companyQuery, request.body, "body");
    deactivateBankAccount(db, companyId, request.params.code);
    return { bankAccount: listBankAccounts(db, companyId).find((a) => a.code === request.params.code) };
  });

  app.post<{ Params: { code: string } }>("/bank-accounts/:code/reactivate", async (request) => {
    const { companyId } = parse(companyQuery, request.body, "body");
    reactivateBankAccount(db, companyId, request.params.code);
    return { bankAccount: listBankAccounts(db, companyId).find((a) => a.code === request.params.code) };
  });

  app.get<{ Params: { code: string } }>("/bank-accounts/:code/register", async (request) => {
    const q = parse(registerQuery, request.query, "query");
    return getAccountRegister(db, {
      companyId: q.companyId,
      accountCode: request.params.code,
      fromDate: q.fromDate,
      toDate: q.toDate,
      businessId: q.businessId,
    });
  });

  app.get("/payment-modes", async (request) => {
    const q = parse(modesQuery, request.query, "query");
    return { paymentModes: listPaymentModes(db, q.companyId, { includeInactive: q.includeInactive === "true" || q.includeInactive === "1" }) };
  });

  app.post("/payment-modes", async (request, reply) => {
    const body = parse(modeCreateBody, request.body, "body");
    return reply.code(201).send({ paymentMode: addPaymentMode(db, body) });
  });

  app.patch<{ Params: { code: string } }>("/payment-modes/:code", async (request) => {
    const body = parse(modePatchBody, request.body, "body");
    if (body.label === undefined && body.active === undefined) {
      throw new RepositoryValidationError("Send a new label, an active flag, or both.");
    }
    if (body.label !== undefined) renamePaymentMode(db, body.companyId, request.params.code, body.label);
    if (body.active !== undefined) setPaymentModeActive(db, body.companyId, request.params.code, body.active);
    const code = request.params.code.trim().toUpperCase();
    return { paymentMode: listPaymentModes(db, body.companyId, { includeInactive: true }).find((m) => m.code === code) };
  });
}
