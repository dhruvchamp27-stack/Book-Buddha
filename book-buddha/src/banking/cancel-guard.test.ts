import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "../database/repository.js";
import { insertStatementLine, reversedEntryIdOf } from "./statement-lines.js";
import { todayAt } from "../database/test-clock.js";

/**
 * R12 cancel guard (orchestrator, S15). Money that a bank statement line was added or matched to
 * cannot be cancelled from its own screen: the bank line would stay MATCHED/ADDED against money the
 * books no longer hold. Each named cancel door is proved on its own (deleting any one call fails a
 * test here), plus the backstop in postJournalEntry that covers every other door (an expense here).
 */

const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;
let businessId: string;
let HDFC: string;

async function call<T>(url: string, payload: object, status = 200): Promise<T> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}
async function refused(url: string, payload: object = { reason: "test" }): Promise<string> {
  const res = await app.inject({ method: "POST", url, payload });
  expect(res.statusCode, `POST ${url} should be refused: ${res.body}`).toBe(400);
  return res.body;
}
const line = (date: string, description: string, amountPaise: number): string =>
  insertStatementLine(repository.db, { companyId, accountCode: HDFC, txnDate: date, description, amountPaise, businessId }).id;
interface Done { line: { status: string }; links: Array<{ documentId: string | null; journalLineId: number }> }

beforeEach(async () => {
  repository = new AccountingRepository(":memory:", todayAt("2025-10-01"));
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
  companyId = (await call<{ id: string }>("/companies", { name: "Fair Books", accountingBasis: "ACCRUAL" }, 201)).id;
  businessId = (await call<{ id: string }>("/businesses", { companyId, name: "Book Fair" }, 201)).id;
  await call("/accounts", { companyId, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" }, 201);
  HDFC = (await call<{ bankAccount: { code: string } }>("/bank-accounts", { companyId, name: "HDFC Current", kind: "CURRENT" }, 201)).bankAccount.code;
  await call("/opening-balances", {
    businessId, asAt: "2025-10-01",
    lines: [{ account: HDFC, debitPaise: RS(50_000), creditPaise: 0 }, { account: "CASH", debitPaise: RS(20_000), creditPaise: 0 }],
  }, 201);
});
afterEach(async () => {
  await app.close();
  repository.close();
});

describe("R12 cancel guard: money on a bank line is cancelled only through Undo on that line", () => {
  it("1. a supplier payment the bank feed posted (matched to a bill)", async () => {
    const { id: supplierId } = await call<{ id: string }>("/suppliers", { companyId, name: "Paper Co" }, 201);
    const bill = await call<{ id: string }>("/purchase-bills", { businessId, supplierId, number: "PB-001", billDate: "2025-10-10", paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: RS(18_000) }] }, 201);
    await call(`/purchase-bills/${bill.id}/finalize`, {});
    const id = line("2025-10-15", "NEFT DR-PAPER CO", -RS(18_000));
    const done = await call<Done>(`/bank-feed/lines/${id}/match`, { documents: [{ kind: "BILL", id: bill.id, amountPaise: RS(18_000) }], confirm: true });
    const body = await refused(`/supplier-payments/${done.links[0]!.documentId}/cancel`);
    expect(body).toContain("This supplier payment is matched to the bank statement line of 2025-10-15");
    expect(body).toContain("it cancels this for you");
  });

  it("2. a voucher the bank feed posted (Add)", async () => {
    const id = line("2025-10-31", "CHGS", -RS(300));
    const done = await call<Done>(`/bank-feed/lines/${id}/add`, { splits: [{ accountCode: "BANK_CHARGES", amountPaise: RS(300) }], confirm: true });
    expect(await refused(`/vouchers/${done.links[0]!.documentId}/cancel`)).toContain("Voucher PV-001/25-26 is matched to the bank statement line");
  });

  it("3. an Internal Transfer the bank feed posted (Transfer)", async () => {
    const id = line("2025-10-03", "CASH DEPOSIT", RS(12_000));
    const done = await call<Done>(`/bank-feed/lines/${id}/transfer`, { otherAccountCode: "CASH", confirm: true });
    expect(await refused(`/internal-transfers/${done.links[0]!.documentId}/cancel`)).toContain("Internal transfer TRF-001/25-26 is matched to the bank statement line");
  });

  it("4. a payment typed by hand, then matched: refused, then Undo (which only unlinks) lets it cancel", async () => {
    const { id: customerId } = await call<{ id: string }>("/customers", { companyId, name: "Asha School" }, 201);
    await call("/invoices", { id: "inv-a",businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-10-02", taxType: "NONE", taxRateBasisPoints: 0, lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(5_900) }] }, 201);
    await call("/invoices/inv-a/finalize", {});
    const payment = await call<{ id: string }>("/invoices/inv-a/payments", { amountPaise: RS(5_900), paidOn: "2025-10-28", moneyAccount: HDFC, paymentMode: "CHEQUE" }, 201);
    const id = line("2025-10-30", "CLG CHQ ASHA", RS(5_900));
    const bankLine = repository.db
      .prepare("SELECT jl.id FROM journal_lines jl WHERE jl.journal_entry_id = ? AND jl.account = ?")
      .get(`je-payment-${payment.id}`, HDFC) as { id: number };
    expect((await call<Done>(`/bank-feed/lines/${id}/match`, { journalLineIds: [bankLine.id] })).line.status).toBe("MATCHED");
    const body = await refused(`/payments/${payment.id}/cancel`);
    expect(body).toContain("This payment is matched to the bank statement line of 2025-10-30");
    expect(body).toContain("first; then this can be cancelled"); // not "it cancels this for you": Undo only unlinks
    await call(`/bank-feed/lines/${id}/undo`, { reason: "wrong match", confirm: true });
    await call(`/payments/${payment.id}/cancel`, { reason: "bounced" });
  });

  it("5. the backstop in the journal door: an expense paid from the bank, matched, cannot be cancelled", async () => {
    const expense = await call<{ id: string }>("/expenses", { businessId, number: "EXP-001", expenseDate: "2025-10-20", description: "Printing", amountPaise: RS(1_180), paymentAccount: "CASH", moneyAccount: HDFC, paymentMode: "UPI" }, 201);
    await call(`/expenses/${expense.id}/finalize`, {});
    const bankLine = repository.db
      .prepare("SELECT jl.id FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id WHERE je.source_id = ? AND jl.account = ?")
      .get(expense.id, HDFC) as { id: number };
    const id = line("2025-10-20", "UPI-PRINTING", -RS(1_180));
    await call(`/bank-feed/lines/${id}/match`, { journalLineIds: [bankLine.id] });
    const before = (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
    const body = await refused(`/expenses/${expense.id}/cancel`, {});
    expect(body).toContain("cancels an entry that is matched to the bank statement line of 2025-10-20");
    expect((repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n).toBe(before);
    await call(`/bank-feed/lines/${id}/undo`, { reason: "wrong match", confirm: true });
    await call(`/expenses/${expense.id}/cancel`, {});
  });

  it("6. reversedEntryIdOf reads both naming conventions", () => {
    expect(reversedEntryIdOf("je-payment-p1-reversal")).toBe("je-payment-p1");
    expect(reversedEntryIdOf("je-opening-balance-reversal-b1")).toBe("je-opening-balance-b1");
    expect(reversedEntryIdOf("je-opening-customer-reversal-c1")).toBe("je-opening-customer-c1");
    expect(reversedEntryIdOf("je-payment-p1")).toBeNull();
  });
});
