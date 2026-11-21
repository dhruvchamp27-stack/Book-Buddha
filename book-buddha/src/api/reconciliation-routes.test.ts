import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyReconciliationSchema } from "../banking/reconciliation-schema.js";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { registerReconciliationRoutes } from "./reconciliation-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;
const lineIds: number[] = [];

beforeEach(async () => {
  repository = new AccountingRepository();
  applyReconciliationSchema(repository.db);
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerReconciliationRoutes(app, { repository });
  await app.ready();

  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Biz" });
  repository.db
    .prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('HDFC', ?, 'HDFC', 'ASSET', 'BANK', NULL, 1, 'x', 'x')")
    .run(companyId);
  lineIds.length = 0;
  for (const [n, amount] of [[1, 100_00], [2, 25_00]] as const) {
    postJournalEntry(
      repository.db,
      {
        id: `je-http-${n}`,
        sourceId: `s${n}`,
        sourceType: "MONEY_VOUCHER",
        description: `Receipt ${n}`,
        isReversal: false,
        lines: [
          { account: "HDFC", debitPaise: amount, creditPaise: 0 },
          { account: "CAPITAL", debitPaise: 0, creditPaise: amount },
        ],
      },
      { businessId, entryDate: `2025-10-0${n}` },
    );
    lineIds.push((repository.db.prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(`je-http-${n}`) as { id: number }).id);
  }
});
afterEach(async () => {
  await app.close();
  repository.close();
});

describe("reconciliation routes", () => {
  it("11. every route works once and refuses bad input once", async () => {
    // POST /reconciliations
    const bad = await app.inject({ method: "POST", url: "/reconciliations", payload: { companyId, accountCode: "HDFC", statementEndDate: "31/10/2025", statementEndingBalancePaise: 1 } });
    expect(bad.statusCode).toBe(400);
    const wrongAccount = await app.inject({ method: "POST", url: "/reconciliations", payload: { companyId, accountCode: "RECEIVABLES", statementEndDate: "2025-10-31", statementEndingBalancePaise: 1 } });
    expect(wrongAccount.statusCode).toBe(400);
    const started = await app.inject({ method: "POST", url: "/reconciliations", payload: { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 12_500 } });
    expect(started.statusCode).toBe(201);
    const id = started.json<{ header: { id: string } }>().header.id;

    // GET /reconciliations (list)
    const list = await app.inject({ method: "GET", url: `/reconciliations?companyId=${companyId}&accountCode=HDFC` });
    expect(list.statusCode).toBe(200);
    expect(list.json<unknown[]>()).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/reconciliations" })).statusCode).toBe(400);

    // GET /reconciliations/:id
    const got = await app.inject({ method: "GET", url: `/reconciliations/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json<{ candidates: unknown[] }>().candidates).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/reconciliations/nope" })).statusCode).toBe(400);

    // POST ticks
    expect((await app.inject({ method: "POST", url: `/reconciliations/${id}/ticks`, payload: { journalLineIds: [999_999], ticked: true } })).statusCode).toBe(400);
    const ticked = await app.inject({ method: "POST", url: `/reconciliations/${id}/ticks`, payload: { journalLineIds: [lineIds[0]], ticked: true } });
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json<{ differencePaise: number }>().differencePaise).toBe(2_500);

    // finish refused (difference), then PATCH, then finish
    const refused = await app.inject({ method: "POST", url: `/reconciliations/${id}/finish` });
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toContain("Rs 25");
    expect((await app.inject({ method: "PATCH", url: `/reconciliations/${id}`, payload: {} })).statusCode).toBe(400);
    const patched = await app.inject({ method: "PATCH", url: `/reconciliations/${id}`, payload: { statementEndingBalancePaise: 10_000 } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ differencePaise: number }>().differencePaise).toBe(0);
    const finished = await app.inject({ method: "POST", url: `/reconciliations/${id}/finish` });
    expect(finished.statusCode).toBe(200);
    expect(finished.json<{ header: { status: string } }>().header.status).toBe("FINISHED");

    // GET report
    const report = await app.inject({ method: "GET", url: `/reconciliations/${id}/report` });
    expect(report.statusCode).toBe(200);
    expect(report.json<{ unclearedLines: unknown[] }>().unclearedLines).toHaveLength(1);

    // undo
    expect((await app.inject({ method: "POST", url: `/reconciliations/${id}/undo`, payload: {} })).statusCode).toBe(400);
    const undone = await app.inject({ method: "POST", url: `/reconciliations/${id}/undo`, payload: { reason: "mistake" } });
    expect(undone.statusCode).toBe(200);
    expect(undone.json<{ header: { status: string } }>().header.status).toBe("UNDONE");
    expect((await app.inject({ method: "GET", url: `/reconciliations/${id}/report` })).statusCode).toBe(400);

    // discard
    const second = await app.inject({ method: "POST", url: "/reconciliations", payload: { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 } });
    const id2 = second.json<{ header: { id: string } }>().header.id;
    const discarded = await app.inject({ method: "POST", url: `/reconciliations/${id2}/discard` });
    expect(discarded.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/reconciliations/${id2}/discard` })).statusCode).toBe(400);
  });
});
