import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { applyMoneyMovementsSchema } from "../banking/money-movements-schema.js";
import { registerMoneyMovementRoutes } from "./money-movement-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;
let businessId: string;

beforeEach(async () => {
  repository = new AccountingRepository();
  applyMoneyMovementsSchema(repository.db);
  // A bare Fastify app with the same RepositoryValidationError -> 400 mapping as buildApi's handler.
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerMoneyMovementRoutes(app, { repository });
  await app.ready();

  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Biz" });
  const now = new Date().toISOString();
  repository.db
    .prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('HDFC', ?, 'HDFC', 'ASSET', 'BANK', NULL, 1, ?, ?)")
    .run(companyId, now, now);
});
afterEach(async () => {
  await app.close();
  repository.close();
});

describe("money movement routes (R12c)", () => {
  it("POST/GET /internal-transfers and POST .../cancel succeed; each has a 400 case", async () => {
    const created = await app.inject({
      method: "POST", url: "/internal-transfers",
      payload: { businessId, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: 1_200_000, paymentMode: "CASH", memo: "Banked" },
    });
    expect(created.statusCode).toBe(201);
    const transfer = created.json<{ id: string; number: string; status: string }>();
    expect(transfer).toMatchObject({ number: "TRF-001/25-26", status: "POSTED" });

    const listed = await app.inject({ method: "GET", url: `/internal-transfers?companyId=${companyId}&fromDate=2025-10-01&toDate=2025-10-31` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<Array<{ id: string }>>().map((t) => t.id)).toEqual([transfer.id]);

    const cancelled = await app.inject({ method: "POST", url: `/internal-transfers/${transfer.id}/cancel`, payload: { reason: "Mistake" } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe("CANCELLED");

    // 400s: same account, float amount, bad body, missing company on the list, no reason, double cancel, unknown id.
    const bad = (payload: unknown): Promise<{ statusCode: number }> => app.inject({ method: "POST", url: "/internal-transfers", payload: payload as object });
    const base = { businessId, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: 100 };
    expect((await bad({ ...base, toAccount: "CASH" })).statusCode).toBe(400);
    expect((await bad({ ...base, amountPaise: 10.5 })).statusCode).toBe(400);
    expect((await bad({ ...base, date: "10/10/2025" })).statusCode).toBe(400);
    expect((await bad({ businessId })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/internal-transfers" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/internal-transfers/${transfer.id}/cancel`, payload: { reason: "" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/internal-transfers/${transfer.id}/cancel`, payload: { reason: "again" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/internal-transfers/nope/cancel", payload: { reason: "x" } })).statusCode).toBe(400);
  });

  it("POST/GET /vouchers and POST .../cancel succeed; each has a 400 case", async () => {
    const created = await app.inject({
      method: "POST", url: "/vouchers",
      payload: {
        kind: "RECEIPT", businessId, date: "2025-10-20", moneyAccount: "HDFC", partyName: "HDFC Bank",
        lines: [{ account: "OTHER_INCOME", amountPaise: 41_200, description: "Interest" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const voucher = created.json<{ id: string; number: string; totalPaise: number; lines: unknown[] }>();
    expect(voucher).toMatchObject({ number: "RV-001/25-26", totalPaise: 41_200 });
    expect(voucher.lines).toHaveLength(1);

    const listed = await app.inject({ method: "GET", url: `/vouchers?companyId=${companyId}&kind=RECEIPT` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<Array<{ id: string }>>().map((v) => v.id)).toEqual([voucher.id]);
    const none = await app.inject({ method: "GET", url: `/vouchers?companyId=${companyId}&kind=PAYMENT` });
    expect(none.json()).toEqual([]);

    const cancelled = await app.inject({ method: "POST", url: `/vouchers/${voucher.id}/cancel`, payload: { reason: "Mistake" } });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json<{ status: string }>().status).toBe("CANCELLED");

    const bad = (payload: unknown): Promise<{ statusCode: number }> => app.inject({ method: "POST", url: "/vouchers", payload: payload as object });
    const base = { kind: "PAYMENT", businessId, date: "2025-10-20", moneyAccount: "HDFC", lines: [{ account: "EXPENSE", amountPaise: 100 }] };
    expect((await bad({ ...base, lines: [{ account: "RECEIVABLES", amountPaise: 100 }] })).statusCode).toBe(400);
    expect((await bad({ ...base, lines: [] })).statusCode).toBe(400);
    expect((await bad({ ...base, lines: [{ account: "EXPENSE", amountPaise: 0 }] })).statusCode).toBe(400);
    expect((await bad({ ...base, kind: "TRANSFER" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/vouchers" })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/vouchers/${voucher.id}/cancel`, payload: { reason: "again" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/vouchers/${voucher.id}/cancel`, payload: {} })).statusCode).toBe(400);
  });
});
