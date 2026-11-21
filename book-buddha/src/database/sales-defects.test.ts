import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";

/** Regression tests for sales-side defects D4, D5, D6, D11, D12 (fixed in repository.ts / stock-layers.ts). */
let repository: AccountingRepository;
let app: FastifyInstance;
beforeEach(async () => {
  repository = new AccountingRepository();
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  repository.close();
});

interface R { status: number; body: any }
type Method = "GET" | "POST" | "PATCH" | "PUT";
async function req(method: Method, url: string, payload?: object): Promise<R> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  let body: any;
  try { body = res.json(); } catch { body = res.body; }
  return { status: res.statusCode, body };
}
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
/** Two cost layers: 1 unit at 100 (opening) then 1 unit at 300 (purchase). */
async function twoLayers(w: W): Promise<void> {
  await must("POST", "/inventory/movements", { itemId: w.itemId, movementType: "OPENING", quantity: 1, unitCostPaise: 10000, businessId: w.businessId, occurredOn: "2025-04-01" });
  const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2025-04-05", paymentAccount: "PAYABLES", lines: [{ itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 30000 }] });
  await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
}
async function sell(w: W, id: string, quantity: number, number = id): Promise<void> {
  await must("POST", "/invoices", { id, number, businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", invoiceDate: "2025-04-10", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise: 50000 }] });
  await must("POST", `/invoices/${id}/finalize`, {});
}
async function creditNote(w: W, invoiceId: string, number: string, quantity: number): Promise<string> {
  const cn = await must("POST", "/credit-notes", { invoiceId, number, reason: "Return", noteDate: "2025-04-15", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise: 50000 }] });
  await must("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
  return cn.id as string;
}
const inSync = (label: string): void => expect(valuation(), `valuation == INVENTORY ledger ${label}`).toBe(ledger("INVENTORY"));

describe("credit-note stock costing (D4, D5)", () => {
  it("D4: two part-returns restore the first-sold layer then the next, at their own costs", async () => {
    const w = await world();
    await twoLayers(w);
    await sell(w, "inv-a", 2);
    await creditNote(w, "inv-a", "CN-a", 1);
    expect(ledger("INVENTORY")).toBe(10000);
    await creditNote(w, "inv-a", "CN-b", 1);
    expect(ledger("INVENTORY")).toBe(40000);
    expect(valuation()).toBe(40000);
  });

  it("D4: two lines of one item inside ONE note also advance through the sold layers", async () => {
    const w = await world();
    await twoLayers(w);
    await sell(w, "inv-a", 2);
    const cn = await must("POST", "/credit-notes", { invoiceId: "inv-a", number: "CN-x", reason: "Return", noteDate: "2025-04-15", lines: [
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 50000 },
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 50000 },
    ] });
    await must("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
    expect(ledger("INVENTORY")).toBe(40000);
    expect(valuation()).toBe(40000);
  });

  it("D5: cancelling a credit note takes its own returned lot back out, not the oldest layer", async () => {
    const w = await world();
    await twoLayers(w);
    await sell(w, "inv-a", 1); // takes the 100 unit
    const cn = await creditNote(w, "inv-a", "CN-a", 1); // the 100 unit returns to the BACK, behind the 300
    await must("POST", `/credit-notes/${cn}/cancel`, {});
    expect(valuation()).toBe(30000);
    expect(ledger("INVENTORY")).toBe(30000);
  });

  it("D5: cancel is refused when the note's own returned lot has gone out again, even if other stock is on hand", async () => {
    const w = await world();
    await twoLayers(w);
    await sell(w, "inv-a", 1);
    const cn = await creditNote(w, "inv-a", "CN-a", 1);
    // Sell the 300 unit and then the returned 100 unit: nothing is left, the lot is gone.
    await sell(w, "inv-b", 2);
    const r = await req("POST", `/credit-notes/${cn}/cancel`, {});
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toMatch(/already gone out/);
    inSync("after the refused cancel");
  });

  it("D4 + D5 combined: two layers, two part-returns, cancel the later note - valuation equals the ledger at every step", async () => {
    const w = await world();
    await twoLayers(w);
    inSync("after stock in");
    expect(ledger("INVENTORY")).toBe(40000);
    await sell(w, "inv-a", 2);
    inSync("after the sale");
    expect(ledger("INVENTORY")).toBe(0);
    await creditNote(w, "inv-a", "CN-a", 1);
    inSync("after CN-a");
    expect(ledger("INVENTORY")).toBe(10000);
    const cnb = await creditNote(w, "inv-a", "CN-b", 1);
    inSync("after CN-b");
    expect(ledger("INVENTORY")).toBe(40000);
    await must("POST", `/credit-notes/${cnb}/cancel`, {});
    inSync("after cancelling CN-b");
    expect(ledger("INVENTORY")).toBe(10000);
    // The surviving lot is CN-a's 100 unit.
    expect(repository.getInventoryValuation().find((r) => r.itemId === w.itemId)?.valuePaise).toBe(10000);
  });
});

describe("credit note against a cancelled invoice (D6)", () => {
  it("refuses to finalize a draft note once its invoice is cancelled, and leaves no journal entry", async () => {
    const w = await world();
    await must("POST", "/invoices", { id: "inv-7", number: "INV-7", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-04-10", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", "/invoices/inv-7/finalize", {});
    const cn = await must("POST", "/credit-notes", { invoiceId: "inv-7", number: "CN-7", reason: "x", noteDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
    await must("POST", "/invoices/inv-7/cancel", {});
    const fin = await req("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
    expect(fin.status).toBeGreaterThanOrEqual(400);
    const count = (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE id = ?").get(`je-credit-note-${cn.id}`) as { n: number }).n;
    expect(count).toBe(0);
  });
});

describe("invoice numbers are unique per business (D11)", () => {
  const draft = (w: W, id: string, number: string, status = "DRAFT"): object => ({ id, number, businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-04-10", status, lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });

  it("refuses a second invoice with the same number, even as a draft", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "INV-1"));
    expect((await req("POST", "/invoices", draft(w, "b", "INV-1"))).status).toBeGreaterThanOrEqual(400);
  });

  it("a cancelled invoice keeps its number", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "INV-1"));
    await must("POST", "/invoices/a/finalize", {});
    await must("POST", "/invoices/a/cancel", {});
    expect((await req("POST", "/invoices", draft(w, "b", "INV-1"))).status).toBeGreaterThanOrEqual(400);
  });

  it("another business may use the same number", async () => {
    const w = await world();
    const other = (await must("POST", "/businesses", { companyId: w.companyId, name: "Stationery" })).id;
    await must("POST", "/invoices", draft(w, "a", "INV-1"));
    await must("POST", "/invoices", { ...draft(w, "b", "INV-1"), businessId: other });
  });

  it("quotations are a separate series: a quotation and an invoice may share a number", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "N-1"));
    await must("POST", "/quotations", draft(w, "q", "N-1", "QUOTATION"));
  });

  it("editing a draft into a taken number is refused; saving it under its own number is fine", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "INV-1"));
    await must("POST", "/invoices", draft(w, "b", "INV-2"));
    await must("PUT", "/invoices/b", draft(w, "b", "INV-2"));
    expect((await req("PUT", "/invoices/b", draft(w, "b", "INV-1"))).status).toBeGreaterThanOrEqual(400);
  });

  it("finalize re-checks the number (safety net for a duplicate that got in underneath)", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "INV-1"));
    await must("POST", "/invoices", draft(w, "b", "INV-2"));
    repository.db.prepare("UPDATE invoices SET number = 'INV-1' WHERE id = 'b'").run();
    expect((await req("POST", "/invoices/b/finalize", {})).status).toBeGreaterThanOrEqual(400);
  });

  it("converting a quotation REFUSES a taken number and takes the number he gives (S16-9)", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a", "INV-Q1"));
    await must("POST", "/quotations", draft(w, "q", "Q1", "QUOTATION"));
    const refused = await req("POST", "/quotations/q/convert", {});
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toContain("INV-Q1 is already used");
    expect(repository.db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE number LIKE 'INV-Q1%'").get()).toEqual({ n: 1 });
    const converted = await must("POST", "/quotations/q/convert", { number: "INV-7" });
    expect(converted.number).toBe("INV-7");
    // With no clash and no number given, the default is still INV-<quotation number>.
    await must("POST", "/quotations", draft(w, "q2", "Q2", "QUOTATION"));
    expect((await must("POST", "/quotations/q2/convert", {})).number).toBe("INV-Q2");
  });
});

describe("generic account switch refuses a bank account holding money (D12)", () => {
  it("refuses while the balance is non-zero, allows it at zero", async () => {
    const w = await world();
    const code = (await must("POST", "/bank-accounts", { companyId: w.companyId, name: "HDFC Current", kind: "CURRENT" })).bankAccount.code as string;
    const empty = await must("POST", "/bank-accounts", { companyId: w.companyId, name: "Empty Savings", kind: "SAVINGS" });
    await must("POST", "/opening-balances", { businessId: w.businessId, asAt: "2025-04-01", lines: [{ account: code, debitPaise: 500000, creditPaise: 0 }] });
    const refused = await req("POST", `/accounts/${code}/active`, { active: false });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(refused.body)).toMatch(/still has a balance/);
    expect((await req("POST", `/accounts/${empty.bankAccount.code}/active`, { active: false })).status).toBe(200);
  });
});
