import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Invoice } from "../accounting/types.js";
import { insertStatementLine, type LineSuggestion, type StatementLine } from "../banking/statement-lines.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { registerReviewQueueRoutes } from "./review-queue-routes.js";
import { todayAt } from "../database/test-clock.js";

const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;
let businessId: string;

const STUB: LineSuggestion = {
  ruleId: "r1", ruleName: "Bank charges", action: "ADD", accountCode: "OFFICE_EXPENSES",
  businessId: null, fairId: null, partyName: null, memo: null,
};

async function build(suggest?: (line: StatementLine) => LineSuggestion | null): Promise<void> {
  app = Fastify();
  // The same RepositoryValidationError -> 400 mapping as buildApi's handler.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerReviewQueueRoutes(app, { repository, suggest });
  await app.ready();
}

beforeEach(() => {
  repository = new AccountingRepository(":memory:", todayAt("2025-10-02"));
  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Biz" });
  const now = new Date().toISOString();
  repository.db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('HDFC', ?, 'HDFC', 'ASSET', 'BANK', NULL, 1, ?, ?)",
  ).run(companyId, now, now);
  repository.createAccount({ companyId, code: "OFFICE_EXPENSES", name: "Office Expenses", type: "EXPENSE" });
});
afterEach(async () => {
  await app.close();
  repository.close();
});

const seed = (amount: number, over: { biz?: string | null; date?: string } = {}): string =>
  insertStatementLine(repository.db, {
    companyId, accountCode: "HDFC", txnDate: over.date ?? "2025-10-20", description: "UPI-OFFICE", reference: "UPI-1",
    amountPaise: amount, businessId: over.biz === undefined ? businessId : over.biz,
  }).id;

const post = (url: string, payload: object) => app.inject({ method: "POST", url, payload });
const count = (table: string): number => (repository.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("review queue routes", () => {
  it("16. list: carries `suggestion` when a suggest is passed, null when not; 400 without companyId", async () => {
    await build();
    const id = seed(-RS(1_180));
    const plain = await app.inject({ method: "GET", url: `/bank-feed/lines?companyId=${companyId}&accountCode=HDFC` });
    expect(plain.statusCode).toBe(200);
    const body = plain.json<{ lines: Array<{ line: { id: string; status: string }; links: unknown[]; suggestion: unknown }> }>();
    expect(body.lines.map((l) => l.line.id)).toEqual([id]);
    expect(body.lines[0]!.suggestion).toBeNull();
    expect((await app.inject({ method: "GET", url: `/bank-feed/lines?accountCode=HDFC` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/bank-feed/lines?companyId=${companyId}&accountCode=HDFC&status=BOGUS` })).statusCode).toBe(400);
    await app.close();

    await build((line) => (line.id === id ? STUB : null));
    const withRule = await app.inject({ method: "GET", url: `/bank-feed/lines?companyId=${companyId}&accountCode=HDFC` });
    expect(withRule.json<{ lines: Array<{ suggestion: { ruleName: string } }> }>().lines[0]!.suggestion.ruleName).toBe("Bank charges");
  });

  it("16. patch, add (preview then confirm), uncategorise, transfer, exclude, undo: each once 200 and once 400", async () => {
    await build();
    // PATCH
    const noBiz = seed(-RS(100), { biz: null });
    const patched = await app.inject({ method: "PATCH", url: `/bank-feed/lines/${noBiz}`, payload: { businessId } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ line: { businessId: string } }>().line.businessId).toBe(businessId);
    expect((await app.inject({ method: "PATCH", url: `/bank-feed/lines/${noBiz}`, payload: {} })).statusCode).toBe(400);

    // ADD: preview writes nothing, confirm posts.
    const id = seed(-RS(1_180));
    const splits = [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }];
    const previewRes = await post(`/bank-feed/lines/${id}/add`, { splits, confirm: false });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json<{ confirmed: boolean; willPost: unknown[] }>()).toMatchObject({ confirmed: false });
    expect(count("vouchers")).toBe(0);
    const okAdd = await post(`/bank-feed/lines/${id}/add`, { splits, confirm: true });
    expect(okAdd.statusCode).toBe(200);
    expect(okAdd.json<{ confirmed: boolean; line: { status: string }; links: unknown[] }>()).toMatchObject({ confirmed: true, line: { status: "ADDED" } });
    expect((await post(`/bank-feed/lines/${id}/add`, { splits, confirm: true })).statusCode).toBe(400); // already ADDED
    expect((await post(`/bank-feed/lines/${id}/add`, { splits })).statusCode).toBe(400); // confirm missing (zod)

    // UNCATEGORISE
    const u = seed(RS(50));
    expect((await post(`/bank-feed/lines/${u}/uncategorise`, { confirm: true })).statusCode).toBe(200);
    expect((await post(`/bank-feed/lines/${u}/uncategorise`, { confirm: true })).statusCode).toBe(400);

    // TRANSFER
    const t = seed(-RS(500));
    expect((await post(`/bank-feed/lines/${t}/transfer`, { otherAccountCode: "CASH", confirm: true })).statusCode).toBe(200);
    const t2 = seed(-RS(500));
    expect((await post(`/bank-feed/lines/${t2}/transfer`, { otherAccountCode: "OFFICE_EXPENSES", confirm: true })).statusCode).toBe(400);

    // EXCLUDE
    const e = seed(-RS(5));
    expect((await post(`/bank-feed/lines/${e}/exclude`, { reason: "dup" })).statusCode).toBe(200);
    expect((await post(`/bank-feed/lines/${e}/exclude`, {})).statusCode).toBe(400);

    // UNDO: reason missing -> 400; preview 200; confirm 200.
    expect((await post(`/bank-feed/lines/${id}/undo`, { confirm: true })).statusCode).toBe(400);
    const undoPreview = await post(`/bank-feed/lines/${id}/undo`, { reason: "oops", confirm: false });
    expect(undoPreview.statusCode).toBe(200);
    expect(undoPreview.json<{ confirmed: boolean }>().confirmed).toBe(false);
    const undone = await post(`/bank-feed/lines/${id}/undo`, { reason: "oops", confirm: true });
    expect(undone.statusCode).toBe(200);
    expect(undone.json<{ line: { status: string } }>().line.status).toBe("FOR_REVIEW");
    expect((await post(`/bank-feed/lines/${id}/undo`, { reason: "again", confirm: true })).statusCode).toBe(400);
    expect((await post(`/bank-feed/lines/nope/undo`, { confirm: true })).statusCode).toBe(400);
  });

  it("16. matches and match: each once 200 and once 400", async () => {
    await build();
    const customerId = repository.createCustomer({ companyId, name: "Raman Books" });
    const invoice: Invoice = {
      id: "inv-a", number: "INV-001", businessId, customerId, invoiceDate: "2025-10-02", status: "DRAFT", paymentAccount: "RECEIVABLES",
      lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(23_600) }],
    };
    repository.saveDraft(invoice);
    repository.finalizeInvoice("inv-a");
    const id = seed(RS(23_600), { date: "2025-10-08" });
    const matches = await app.inject({ method: "GET", url: `/bank-feed/lines/${id}/matches` });
    expect(matches.statusCode).toBe(200);
    expect(matches.json<{ documents: Array<{ id: string }>; postedLines: unknown[] }>().documents.map((d) => d.id)).toEqual(["inv-a"]);
    expect((await app.inject({ method: "GET", url: `/bank-feed/lines/nope/matches` })).statusCode).toBe(400);

    const documents = [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(23_600) }];
    const previewRes = await post(`/bank-feed/lines/${id}/match`, { documents, confirm: false });
    expect(previewRes.statusCode).toBe(200);
    expect(previewRes.json<{ confirmed: boolean }>().confirmed).toBe(false);
    expect(count("payments")).toBe(0);
    expect((await post(`/bank-feed/lines/${id}/match`, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(1) }], confirm: true })).statusCode).toBe(400);
    expect((await post(`/bank-feed/lines/${id}/match`, { documents, confirm: true })).statusCode).toBe(200);
    expect(count("payments")).toBe(1);
    expect((await post(`/bank-feed/lines/${id}/match`, { documents, confirm: true })).statusCode).toBe(400); // already MATCHED
  });
});
