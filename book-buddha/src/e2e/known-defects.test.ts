import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "../database/repository.js";
import { todayAt } from "../database/test-clock.js";

/**
 * DEFECTS D1-D16 found by the S16 audit read. Each case asserts the CORRECT accounting behaviour.
 * All 16 are now FIXED (session 16) and run as plain `it` regression tests. A NEW confirmed defect
 * goes in as `knownDefect(...)` (= `it.fails`): it passes while the defect exists and turns RED the
 * moment it is fixed - the signal to flip it to `it("FIXED Dn: ...")`.
 * Arrange steps use `must(...)` so a broken setup throws a "SETUP:" error instead of hiding behind
 * an expected failure.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const knownDefect = it.fails;

let repository: AccountingRepository;
let app: FastifyInstance;
beforeEach(async () => {
  repository = new AccountingRepository(":memory:", todayAt("2025-01-01"));
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  repository.close();
});

interface R { status: number; body: any }
type Method = "GET" | "POST" | "PATCH";
async function req(method: Method, url: string, payload?: object, headers?: Record<string, string>, target: FastifyInstance = app): Promise<R> {
  const res = await target.inject({ method, url, ...(payload === undefined ? {} : { payload }), ...(headers === undefined ? {} : { headers }) });
  let body: any;
  try { body = res.json(); } catch { body = res.body; }
  return { status: res.statusCode, body };
}
/** Arrange step: must succeed, else a SETUP error (never a silent pass of an expected failure). */
async function must(method: Method, url: string, payload?: object): Promise<any> {
  const r = await req(method, url, payload);
  if (r.status >= 300) throw new Error(`SETUP: ${method} ${url} -> ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const ledger = (account: string): number =>
  (repository.db.prepare("SELECT COALESCE(SUM(debit_paise),0) - COALESCE(SUM(credit_paise),0) AS n FROM journal_lines WHERE account = ?").get(account) as { n: number }).n;
const valuation = (): number => repository.getInventoryValuation().reduce((t, r) => t + r.valuePaise, 0);

interface W { companyId: string; businessId: string; customerId: string; supplierId: string; itemId: string }
async function world(): Promise<W> {
  const companyId = (await must("POST", "/companies", { name: "Co", accountingBasis: "ACCRUAL" })).id;
  const businessId = (await must("POST", "/businesses", { companyId, name: "Books" })).id;
  const customerId = (await must("POST", "/customers", { companyId, name: "Asha School" })).id;
  const supplierId = (await must("POST", "/suppliers", { companyId, name: "Paper Co" })).id;
  const itemId = (await must("POST", "/items", { companyId, name: "Atlas", unit: "each", trackStock: true })).id;
  return { companyId, businessId, customerId, supplierId, itemId };
}
/** Credit bill of 100 (10,000 paise), one non-tracked line, finalized; then a finalized return of 40. */
async function billAndReturn(w: W): Promise<string> {
  const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2025-04-10", paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
  await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
  const ret = await must("POST", "/purchase-returns", { billId: bill.id, reason: "Short supply", returnDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
  await must("POST", `/purchase-returns/${ret.id}/finalize`, {});
  return bill.id as string;
}
async function openingStock(w: W, quantity: number, unitCostPaise: number): Promise<void> {
  await must("POST", "/inventory/movements", { itemId: w.itemId, movementType: "OPENING", quantity, unitCostPaise, businessId: w.businessId, occurredOn: "2025-04-01" });
}
async function purchase(w: W, quantity: number, unitPricePaise: number, number: string): Promise<void> {
  const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number, billDate: "2025-04-05", paymentAccount: "PAYABLES", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise }] });
  await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
}
async function sellFinal(w: W, id: string, quantity: number, unitPricePaise: number): Promise<void> {
  await must("POST", "/invoices", { id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", invoiceDate: "2025-04-10", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise }] });
  await must("POST", `/invoices/${id}/finalize`, {});
}
/** The app numbers the note (S17-4); `_label` is only for the reader of the test. */
async function creditNote(w: W, invoiceId: string, _label: string, quantity: number, unitPricePaise: number): Promise<string> {
  const cn = await must("POST", "/credit-notes", { invoiceId, reason: "Return", noteDate: "2025-04-15", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise }] });
  await must("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
  return cn.id as string;
}

describe("known defects (each asserts the correct behaviour; passes while the defect exists)", () => {
  // Root cause: the supplier-payment cap is computed from the bill total less payments only and
  // ignores finalized purchase returns, so a payment above the net 6,000 outstanding is accepted.
  it("FIXED D1: supplier payment cap ignores a finalized purchase return (P1)", async () => {
    const w = await world();
    const billId = await billAndReturn(w);
    const pay = await req("POST", "/supplier-payments", { billId, amountPaise: 10000, paidOn: "2025-04-20" });
    expect(pay.status, "payment above the 60 outstanding must be refused").toBeGreaterThanOrEqual(400);
  });

  // Root cause: the payables report / supplier statement compute outstanding from bill totals and
  // payments only, with no deduction for purchase returns (PAYABLES ledger correctly shows 60).
  it("FIXED D2: payables report and supplier statement ignore purchase returns (P2)", async () => {
    const w = await world();
    const billId = await billAndReturn(w);
    const payables = await must("GET", `/reports/payables?businessId=${w.businessId}`);
    const row = (payables as any[]).find((p) => p.documentId === billId);
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect(0 - ledger("PAYABLES"), "control: PAYABLES ledger credit is 6,000").toBe(6000);
    expect.soft(row?.outstandingPaise, "payables report outstanding").toBe(6000);
    expect.soft(stmt.closingBalancePaise, "supplier statement closing").toBe(6000);
  });

  // Root cause: the supplier statement is built from bills/payments only; opening supplier balances
  // and their settlements are never added as rows, so it disagrees with the PAYABLES ledger.
  it("FIXED D3: supplier statement omits the opening balance and its settlement rows (P3)", async () => {
    const w = await world();
    const op = await must("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-04-01", amountPaise: 300000 });
    await must("POST", `/opening-supplier-balances/${op.id}/settlements`, { amountPaise: 300000, paidOn: "2025-04-10" });
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect(0 - ledger("PAYABLES"), "control: ledger PAYABLES is settled to 0").toBe(0);
    expect.soft((stmt.rows as any[]).some((r) => r.amountPaise === -300000), "statement shows the settlement row").toBe(true);
    expect.soft(stmt.closingBalancePaise, "statement closing agrees with ledger").toBe(0);
  });

  // Root cause: the FIFO cost a credit note restores is looked up per invoice in a way that a second
  // part-return re-reads the first layer's cost instead of the remaining sold layer (wrong cost back).
  it("FIXED D4: two part-returns on one invoice restore the wrong FIFO cost (P5)", async () => {
    const w = await world();
    await openingStock(w, 1, 10000);
    await purchase(w, 1, 30000, "PB-5");
    await sellFinal(w, "inv-5", 2, 50000);
    await creditNote(w, "inv-5", "CN-5a", 1, 50000);
    await creditNote(w, "inv-5", "CN-5b", 1, 50000);
    expect.soft(ledger("INVENTORY"), "INVENTORY ledger restored to 400").toBe(40000);
    expect.soft(valuation(), "valuation restored to 400").toBe(40000);
    expect.soft(valuation(), "valuation == ledger").toBe(ledger("INVENTORY"));
  });

  // Root cause: cancelling a credit note reverses the stock return against the wrong (latest/other)
  // layer, so the 100 unit is removed instead of the layer the note restored; valuation drifts from ledger.
  it("FIXED D5: cancelling a credit note removes the wrong stock layer (P6)", async () => {
    const w = await world();
    await openingStock(w, 1, 10000);
    await purchase(w, 1, 30000, "PB-6");
    await sellFinal(w, "inv-6", 1, 50000);
    const cnId = await creditNote(w, "inv-6", "CN-6", 1, 50000);
    await must("POST", `/credit-notes/${cnId}/cancel`, {});
    expect.soft(valuation(), "valuation == ledger").toBe(ledger("INVENTORY"));
    expect.soft(valuation(), "only the 300 unit remains").toBe(30000);
    expect.soft(ledger("INVENTORY"), "ledger").toBe(30000);
  });

  // Root cause: credit-note finalize validates against the invoice's line quantities but does not
  // check the invoice status, so a draft note can be finalized against a CANCELLED invoice.
  it("FIXED D6: a draft credit note can be finalized after its invoice is cancelled (P7a)", async () => {
    const w = await world();
    await must("POST", "/invoices", { id: "inv-7", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-04-10", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", "/invoices/inv-7/finalize", {});
    const cn = await must("POST", "/credit-notes", { invoiceId: "inv-7", reason: "x", noteDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
    await must("POST", "/invoices/inv-7/cancel", {});
    const fin = await req("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
    expect(fin.status, "finalize against a cancelled invoice must be refused").toBeGreaterThanOrEqual(400);
  });

  // Root cause: purchase-return finalize does not check the bill status, so a draft return can be
  // finalized after its bill was cancelled (same gap as the credit-note path).
  it("FIXED D7: a draft purchase return can be finalized after its bill is cancelled (P7b)", async () => {
    const w = await world();
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-7", billDate: "2025-04-10", paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    const ret = await must("POST", "/purchase-returns", { billId: bill.id, reason: "x", returnDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
    await must("POST", `/purchase-bills/${bill.id}/cancel`, {});
    const fin = await req("POST", `/purchase-returns/${ret.id}/finalize`, {});
    expect(fin.status, "finalize against a cancelled bill must be refused").toBeGreaterThanOrEqual(400);
  });

  // Root cause: the purchase-return line is matched to a bill line by item id only (first match), so
  // with the same tracked item on two lines at different prices the 100 return is checked against the 300 line.
  it("FIXED D8: same tracked item on two bill lines, return at the lower price is refused (P12)", async () => {
    const w = await world();
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-12", billDate: "2025-04-10", paymentAccount: "PAYABLES", lines: [
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 10000 },
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 30000 },
    ] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    const invBefore = ledger("INVENTORY");
    const valBefore = valuation();
    const create = await req("POST", "/purchase-returns", { billId: bill.id, reason: "Damaged", returnDate: "2025-04-15", lines: [{ itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 10000 }] });
    expect(create.status, "return of one unit at the 100 price must be accepted").toBe(201);
    const fin = await req("POST", `/purchase-returns/${create.body.id}/finalize`, {});
    expect(fin.status).toBe(200);
    expect.soft(invBefore - ledger("INVENTORY"), "stock cost removed (ledger)").toBe(10000);
    expect.soft(valBefore - valuation(), "stock cost removed (valuation)").toBe(10000);
    expect.soft(ledger("INVENTORY"), "ledger == valuation").toBe(valuation());
  });

  // Root cause: the cash-basis P&L allocates a bill's expense by payments/total and does not net
  // purchase returns, so after a May return on a part-paid April bill the figures go wrong or the report throws.
  it("FIXED D9: cash-basis P&L fails after a purchase return on a part-paid bill (P14)", async () => {
    const w = await world();
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-14", billDate: "2025-04-10", paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    await must("POST", "/supplier-payments", { billId: bill.id, amountPaise: 5000, paidOn: "2025-04-20" });
    const april = `/reports/profit-and-loss?businessId=${w.businessId}&basis=CASH&fromDate=2025-04-01&toDate=2025-04-30`;
    const aprMay = `/reports/profit-and-loss?businessId=${w.businessId}&basis=CASH&fromDate=2025-04-01&toDate=2025-05-31`;
    const aprBefore = await req("GET", april);
    const ret = await must("POST", "/purchase-returns", { billId: bill.id, reason: "Short", returnDate: "2025-05-05", lines: [{ description: "Service", quantity: 1, unitPricePaise: 2000 }] });
    await must("POST", `/purchase-returns/${ret.id}/finalize`, {});
    const aprAfter = await req("GET", april);
    const both = await req("GET", aprMay);
    expect.soft(aprBefore.body.totalExpensesPaise, "April expense before return").toBe(5000);
    expect.soft(aprAfter.body.totalExpensesPaise, "April expense after return").toBe(5000);
    expect.soft(both.status, "April-May cash P&L does not throw").toBe(200);
  });

  // Root cause: the P&L derives "GST on sales" from the net balance of OUTPUT_* accounts, so a GST
  // payment voucher (Dr OUTPUT_CGST/SGST) is read as a sales reversal and lowers it from 18 to 0.
  it("FIXED D10: a GST payment voucher reduces GST on sales on the P&L (P10)", async () => {
    const w = await world();
    await must("POST", "/invoices", { id: "inv-10", businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", invoiceDate: "2025-04-05", taxType: "CGST_SGST", taxRateBasisPoints: 1800, lines: [{ description: "Books", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", "/invoices/inv-10/finalize", {});
    const q = `/reports/profit-and-loss?businessId=${w.businessId}&fromDate=2025-04-01&toDate=2025-04-30`;
    await must("POST", "/vouchers", { kind: "PAYMENT", businessId: w.businessId, date: "2025-04-20", moneyAccount: "CASH", narration: "GST remittance", lines: [{ account: "OUTPUT_CGST", amountPaise: 900 }, { account: "OUTPUT_SGST", amountPaise: 900 }] });
    const after = await must("GET", q);
    expect(after.gstOnSalesPaise, "remittance is not a reversal of sales GST").toBe(1800);
  });

  // Root cause: invoice numbers are not unique per business (no index/check in create or finalize),
  // so a second invoice with the same number is accepted and finalized.
  // S17-4: the app now numbers invoices itself, so a duplicate cannot be asked for over HTTP: a number
  // in the body is refused, and two invoices get two different numbers.
  it("FIXED D11: two invoices with the same number in one business (P8)", async () => {
    const w = await world();
    const mk = (id: string): object => ({ id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-04-10", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    const a = await must("POST", "/invoices", mk("dup-a"));
    await must("POST", "/invoices/dup-a/finalize", {});
    const asked = await req("POST", "/invoices", { ...mk("dup-x"), number: a.number });
    const b = await req("POST", "/invoices", mk("dup-b"));
    expect(asked.status, "a number sent in the body is refused").toBe(400);
    expect(b.status).toBeLessThan(300);
    expect(b.body.number, "the second invoice gets its own number").not.toBe(a.number);
    const bf = await req("POST", "/invoices/dup-b/finalize", {});
    expect(bf.status).toBeLessThan(300);
  });

  // Root cause: POST /accounts/:code/active toggles the chart row directly and, unlike
  // /bank-accounts/:code/deactivate, does not check for a non-zero balance on bank/money accounts.
  it("FIXED D12: a bank account holding a balance can be deactivated via the generic accounts route (P11)", async () => {
    const w = await world();
    const code = (await must("POST", "/bank-accounts", { companyId: w.companyId, name: "HDFC Current", kind: "CURRENT" })).bankAccount.code as string;
    await must("POST", "/opening-balances", { businessId: w.businessId, asAt: "2025-04-01", lines: [{ account: code, debitPaise: 500000, creditPaise: 0 }] });
    const viaBank = await req("POST", `/bank-accounts/${code}/deactivate`, { companyId: w.companyId });
    expect(viaBank.status, "control: the bank route refuses").toBeGreaterThanOrEqual(400);
    const generic = await req("POST", `/accounts/${code}/active`, { active: false });
    expect(generic.status, "the generic route must refuse as well").toBeGreaterThanOrEqual(400);
  });

  // Root cause: audit events are written without the signed-in user (actor_id stays NULL) even
  // when real authentication is on, so the tamper-evident log cannot say who did what.
  it("FIXED D13: audit events carry no actor (P13)", async () => {
    const authRepo = new AccountingRepository(":memory:", todayAt("2025-01-01"));
    const authApp = buildApi(authRepo);
    try {
      await authApp.ready();
      await req("POST", "/auth/setup", { password: "Secret123" }, undefined, authApp);
      const login = await req("POST", "/auth/login", { password: "Secret123" }, undefined, authApp);
      if (login.status !== 200) throw new Error(`SETUP: login -> ${login.status}`);
      const headers = { authorization: `Bearer ${login.body.token}` };
      const company = await req("POST", "/companies", { name: "Co" }, headers, authApp);
      if (company.status !== 201) throw new Error(`SETUP: company -> ${company.status}`);
      const cust = await req("POST", "/customers", { companyId: company.body.id, name: "Asha School" }, headers, authApp);
      if (cust.status !== 201) throw new Error(`SETUP: customer -> ${cust.status}`);
      const row = authRepo.db.prepare("SELECT id, action, entity_id, actor_id FROM audit_events ORDER BY id DESC LIMIT 1").get() as { actor_id: string | null };
      expect(row.actor_id, "actor_id").not.toBeNull();
    } finally {
      await authApp.close();
      authRepo.close();
    }
  });

  // Root cause: server.ts:148 / :219 / :250 use `.default(new Date().toISOString().slice(0, 10))` in
  // the zod schemas, evaluated ONCE at module load - a long-running server stamps every defaulted date with its start day.
  it("FIXED D14: schema date defaults (invoice/bill/expense date) are frozen at module load (P9)", async () => {
    const w = await world();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-06-15T06:00:00Z"));
    let created: R;
    try {
      created = await req("POST", "/invoices", { id: "inv-14", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    } finally {
      vi.useRealTimers();
    }
    if (created.status >= 300) throw new Error(`SETUP: create invoice -> ${created.status} ${JSON.stringify(created.body)}`);
    const fetched = await must("GET", "/invoices/inv-14");
    expect(String(fetched.invoiceDate ?? created.body.invoiceDate).slice(0, 10), "defaulted invoiceDate is the day of creation").toBe("2099-06-15");
  });

  // Root cause: GST is rounded per component (CGST and SGST halves of 0.54 paise) so tax + taxable
  // does not tie to the total / journal balances for a 3-paise sale, and finalize throws (500).
  it("FIXED D15: a tiny sale (3 paise at 18% CGST_SGST) fails to finalize (P15)", async () => {
    const w = await world();
    await must("POST", "/invoices", { id: "inv-15", businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", invoiceDate: "2025-04-10", taxType: "CGST_SGST", taxRateBasisPoints: 1800, lines: [{ description: "Pencil", quantity: 1, unitPricePaise: 3 }] });
    const fin = await req("POST", "/invoices/inv-15/finalize", {});
    expect(fin.status, `finalize body: ${JSON.stringify(fin.body).slice(0, 200)}`).toBe(200);
  });

  // Policy S8-1 (still OPEN): cancelling a receipt in a later month posts the reversal in that month,
  // but the cash-basis P&L removes the income from the original (January) month instead.
  it("FIXED D16 (ruling S16-7 replaces S8-1): a receipt cancelled in a later month removes the earlier month's cash income (P16)", async () => {
    const w = await world();
    await must("POST", "/invoices", { id: "inv-16", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-01-10", lines: [{ description: "Books", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", "/invoices/inv-16/finalize", {});
    await must("POST", "/invoices/inv-16/payments", { amountPaise: 10000, paidOn: "2025-01-20" });
    const paymentId = ((await must("GET", "/invoices/inv-16/payments")) as any[])[0].id as string;
    const jan = `/reports/profit-and-loss?businessId=${w.businessId}&basis=CASH&fromDate=2025-01-01&toDate=2025-01-31`;
    const janBefore = (await must("GET", jan)).totalIncomePaise;
    expect(janBefore, "control: January cash income is 100 before the cancel").toBe(10000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-02-15T06:00:00Z"));
    try {
      await must("POST", `/payments/${paymentId}/cancel`, {});
    } finally {
      vi.useRealTimers();
    }
    const janAfter = (await must("GET", jan)).totalIncomePaise;
    expect(janAfter, "January cash income stays 100 after a February cancellation").toBe(10000);
  });
});
