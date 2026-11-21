import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBankRulesSchema } from "../banking/bank-rules-schema.js";
import { insertStatementLine } from "../banking/statement-lines.js";
import { applyStatementLinesSchema } from "../banking/statement-lines-schema.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { registerBankRuleRoutes } from "./bank-rules-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;

beforeEach(async () => {
  repository = new AccountingRepository();
  applyStatementLinesSchema(repository.db);
  applyBankRulesSchema(repository.db);
  // A bare Fastify app with the same RepositoryValidationError -> 400 mapping as buildApi's handler.
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerBankRuleRoutes(app, { repository });
  await app.ready();
  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  repository.db
    .prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('BANK_CHARGES', ?, 'Bank Charges', 'EXPENSE', NULL, NULL, 1, 'x', 'x')")
    .run(companyId);
});
afterEach(async () => {
  await app.close();
  repository.close();
});

const rule = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  companyId,
  name: "Bank charges",
  action: "ADD",
  targetAccount: "BANK_CHARGES",
  conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "chgs" }],
  ...over,
});

describe("bank rule routes", () => {
  it("9. list, create, patch, delete, reorder, test - each once OK and once 400", async () => {
    // GET
    const empty = await app.inject({ method: "GET", url: `/bank-rules?companyId=${companyId}` });
    expect(empty.statusCode).toBe(200);
    expect(empty.json<{ rules: unknown[] }>().rules).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/bank-rules" })).statusCode).toBe(400);

    // POST
    const created = await app.inject({ method: "POST", url: "/bank-rules", payload: rule() });
    expect(created.statusCode).toBe(201);
    const first = created.json<{ rule: { id: string; priority: number } }>().rule;
    expect(first.priority).toBe(1);
    expect((await app.inject({ method: "POST", url: "/bank-rules", payload: rule({ targetAccount: "UNCATEGORIZED" }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/bank-rules", payload: rule({ action: "NOPE" }) })).statusCode).toBe(400); // zod
    const second = (await app.inject({ method: "POST", url: "/bank-rules", payload: rule({ name: "Second" }) })).json<{ rule: { id: string } }>().rule;

    // PATCH
    const patched = await app.inject({ method: "PATCH", url: `/bank-rules/${first.id}`, payload: { companyId, memo: "hello", active: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ rule: { memo: string; active: boolean } }>().rule).toMatchObject({ memo: "hello", active: false });
    expect((await app.inject({ method: "PATCH", url: `/bank-rules/${first.id}`, payload: { companyId } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/bank-rules/missing", payload: { companyId, memo: "x" } })).statusCode).toBe(400);

    // REORDER
    const reordered = await app.inject({ method: "POST", url: "/bank-rules/reorder", payload: { companyId, orderedIds: [second.id, first.id] } });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json<{ rules: Array<{ id: string }> }>().rules.map((r) => r.id)).toEqual([second.id, first.id]);
    expect((await app.inject({ method: "POST", url: "/bank-rules/reorder", payload: { companyId, orderedIds: [second.id] } })).statusCode).toBe(400);

    // TEST (by id and by draft)
    insertStatementLine(repository.db, { companyId, accountCode: "BANK", txnDate: "2025-10-31", description: "CHGS INCL GST", amountPaise: -35400 });
    insertStatementLine(repository.db, { companyId, accountCode: "BANK", txnDate: "2025-10-31", description: "NEFT", amountPaise: -100 });
    const byId = await app.inject({ method: "POST", url: "/bank-rules/test", payload: { companyId, accountCode: "BANK", ruleId: first.id } });
    expect(byId.statusCode).toBe(200);
    expect(byId.json<{ lines: Array<{ description: string }> }>().lines.map((l) => l.description)).toEqual(["CHGS INCL GST"]);
    const { companyId: _c, ...draft } = rule({ name: "Draft", conditions: [{ field: "AMOUNT", operator: "LESS_THAN", valuePaise: 1000 }] });
    const byDraft = await app.inject({ method: "POST", url: "/bank-rules/test", payload: { companyId, accountCode: "BANK", rule: draft } });
    expect(byDraft.statusCode).toBe(200);
    expect(byDraft.json<{ lines: unknown[] }>().lines).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: "/bank-rules/test", payload: { companyId, accountCode: "BANK" } })).statusCode).toBe(400);
    expect(repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });

    // DELETE
    const del = await app.inject({ method: "DELETE", url: `/bank-rules/${first.id}?companyId=${companyId}` });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/bank-rules/${first.id}?companyId=${companyId}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/bank-rules?companyId=${companyId}` })).json<{ rules: unknown[] }>().rules).toHaveLength(1);
  });
});
