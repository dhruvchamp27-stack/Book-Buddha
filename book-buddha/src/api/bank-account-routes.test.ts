import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyBankAccountsSchema } from "../banking/bank-accounts-schema.js";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { registerBankAccountRoutes } from "./bank-account-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;
let businessId: string;

beforeEach(async () => {
  repository = new AccountingRepository();
  applyBankAccountsSchema(repository.db);
  // A bare Fastify app with the same RepositoryValidationError -> 400 mapping as buildApi's handler.
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerBankAccountRoutes(app, { repository });
  await app.ready();
  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Biz" });
});
afterEach(async () => {
  await app.close();
  repository.close();
});

describe("bank account routes", () => {
  it("11. bank accounts: list, create, patch, deactivate, reactivate, register - each once OK and once 400", async () => {
    // GET /bank-accounts
    const list = await app.inject({ method: "GET", url: `/bank-accounts?companyId=${companyId}` });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ bankAccounts: Array<{ code: string }> }>().bankAccounts.map((a) => a.code)).toEqual(["BANK"]);
    expect((await app.inject({ method: "GET", url: "/bank-accounts" })).statusCode).toBe(400);

    // POST /bank-accounts
    const created = await app.inject({ method: "POST", url: "/bank-accounts", payload: { companyId, name: "HDFC", kind: "CURRENT", ifsc: "HDFC0001234" } });
    expect(created.statusCode).toBe(201);
    expect(created.json<{ bankAccount: { code: string; type: string } }>().bankAccount).toMatchObject({ code: "BANK_HDFC", type: "ASSET" });
    expect((await app.inject({ method: "POST", url: "/bank-accounts", payload: { companyId, name: "HDFC", kind: "CURRENT" } })).statusCode).toBe(400); // duplicate name
    expect((await app.inject({ method: "POST", url: "/bank-accounts", payload: { companyId, name: "Z", kind: "WALLET" } })).statusCode).toBe(400); // zod

    // PATCH
    const patched = await app.inject({ method: "PATCH", url: "/bank-accounts/BANK_HDFC", payload: { companyId, branch: "Fort", accountNumberLast4: "4321" } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<{ bankAccount: { branch: string; accountNumberLast4: string } }>().bankAccount).toMatchObject({ branch: "Fort", accountNumberLast4: "4321" });
    expect((await app.inject({ method: "PATCH", url: "/bank-accounts/BANK_HDFC", payload: { companyId, accountNumberLast4: "12a4" } })).statusCode).toBe(400);

    // Register: a balance, so deactivate is refused first.
    postJournalEntry(
      repository.db,
      { id: "je-r1", sourceId: "s1", sourceType: "MONEY_VOUCHER", description: "Capital in", isReversal: false,
        lines: [{ account: "BANK_HDFC", debitPaise: 500_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 500_000 }] },
      { businessId, entryDate: "2026-10-01" },
    );
    const register = await app.inject({ method: "GET", url: `/bank-accounts/BANK_HDFC/register?companyId=${companyId}&fromDate=2026-10-01` });
    expect(register.statusCode).toBe(200);
    expect(register.json<{ closingBalancePaise: number; rows: unknown[] }>()).toMatchObject({ closingBalancePaise: 500_000 });
    expect((await app.inject({ method: "GET", url: `/bank-accounts/BANK_HDFC/register?companyId=${companyId}&fromDate=not-a-date` })).statusCode).toBe(400);

    expect((await app.inject({ method: "POST", url: "/bank-accounts/BANK_HDFC/deactivate", payload: { companyId } })).statusCode).toBe(400);
    postJournalEntry(
      repository.db,
      { id: "je-r2", sourceId: "s2", sourceType: "MONEY_VOUCHER", description: "Out", isReversal: false,
        lines: [{ account: "EXPENSE", debitPaise: 500_000, creditPaise: 0 }, { account: "BANK_HDFC", debitPaise: 0, creditPaise: 500_000 }] },
      { businessId, entryDate: "2026-10-02" },
    );
    const off = await app.inject({ method: "POST", url: "/bank-accounts/BANK_HDFC/deactivate", payload: { companyId } });
    expect(off.statusCode).toBe(200);
    expect(off.json<{ bankAccount: { active: boolean } }>().bankAccount.active).toBe(false);
    expect((await app.inject({ method: "POST", url: "/bank-accounts/BANK_HDFC/reactivate", payload: { companyId } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/bank-accounts/BANK_HDFC/reactivate", payload: { companyId } })).statusCode).toBe(400); // already active
  });

  it("11. payment modes: list, add, patch - each once OK and once 400", async () => {
    const list = await app.inject({ method: "GET", url: `/payment-modes?companyId=${companyId}` });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ paymentModes: Array<{ code: string }> }>().paymentModes.map((m) => m.code)).toEqual(["CASH", "NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER"]);
    expect((await app.inject({ method: "GET", url: "/payment-modes" })).statusCode).toBe(400);

    const added = await app.inject({ method: "POST", url: "/payment-modes", payload: { companyId, code: "DD", label: "Demand draft" } });
    expect(added.statusCode).toBe(201);
    expect(added.json<{ paymentMode: { code: string } }>().paymentMode.code).toBe("DD");
    expect((await app.inject({ method: "POST", url: "/payment-modes", payload: { companyId, code: "DD", label: "Again" } })).statusCode).toBe(400);

    const renamed = await app.inject({ method: "PATCH", url: "/payment-modes/DD", payload: { companyId, label: "Bank draft", active: false } });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<{ paymentMode: { label: string; active: boolean } }>().paymentMode).toMatchObject({ label: "Bank draft", active: false });
    const hidden = await app.inject({ method: "GET", url: `/payment-modes?companyId=${companyId}` });
    expect(hidden.json<{ paymentModes: Array<{ code: string }> }>().paymentModes.map((m) => m.code)).not.toContain("DD");
    const shown = await app.inject({ method: "GET", url: `/payment-modes?companyId=${companyId}&includeInactive=true` });
    expect(shown.json<{ paymentModes: Array<{ code: string }> }>().paymentModes.map((m) => m.code)).toContain("DD");
    expect((await app.inject({ method: "PATCH", url: "/payment-modes/UPI", payload: { companyId, label: "Unified" } })).statusCode).toBe(400); // system
    expect((await app.inject({ method: "PATCH", url: "/payment-modes/DD", payload: { companyId } })).statusCode).toBe(400); // nothing to change
  });
});
