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
async function sell(w: W, id: string, quantity: number): Promise<void> {
  await must("POST", "/invoices", { id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", invoiceDate: "2025-04-10", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise: 50000 }] });
  await must("POST", `/invoices/${id}/finalize`, {});
}
/** The app numbers the note (S17-4), so the label argument is only for the reader of the test. */
async function creditNote(w: W, invoiceId: string, _label: string, quantity: number): Promise<string> {
  const cn = await must("POST", "/credit-notes", { invoiceId, reason: "Return", noteDate: "2025-04-15", lines: [{ itemId: w.itemId, description: "Atlas", quantity, unitPricePaise: 50000 }] });
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
    const cn = await must("POST", "/credit-notes", { invoiceId: "inv-a", reason: "Return", noteDate: "2025-04-15", lines: [
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
    await must("POST", "/invoices", { id: "inv-7", businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-04-10", lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
    await must("POST", "/invoices/inv-7/finalize", {});
    const cn = await must("POST", "/credit-notes", { invoiceId: "inv-7", reason: "x", noteDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
    await must("POST", "/invoices/inv-7/cancel", {});
    const fin = await req("POST", `/credit-notes/${cn.id}/finalize`, { confirmBackdatedMonth: true });
    expect(fin.status).toBeGreaterThanOrEqual(400);
    const count = (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE id = ?").get(`je-credit-note-${cn.id}`) as { n: number }).n;
    expect(count).toBe(0);
  });
});

// S17-4: the app numbers every invoice, quotation, credit note and purchase return it originates,
// at first save: INV-001/25-26, one series per business, prefix and financial year. A number sent
// over HTTP is refused. Only the import path (repository methods called with a number) supplies one.
describe("document numbers are the app's: per business, per financial year (S17-4, was D11)", () => {
  const draft = (w: W, id: string, status = "DRAFT", invoiceDate = "2025-04-10"): any => ({ id, businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate, status, lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }] });
  const numberOf = async (id: string): Promise<string> => (await must("GET", `/invoices/${id}`)).number as string;

  it("numbers invoices in order, and a second business starts again at 001", async () => {
    const w = await world();
    const other = (await must("POST", "/businesses", { companyId: w.companyId, name: "Stationery" })).id;
    for (const id of ["a", "b", "c", "d"]) await must("POST", "/invoices", draft(w, id));
    expect(await Promise.all(["a", "b", "c", "d"].map(numberOf))).toEqual(["INV-001/25-26", "INV-002/25-26", "INV-003/25-26", "INV-004/25-26"]);
    await must("POST", "/invoices", { ...draft(w, "x"), businessId: other });
    expect(await numberOf("x")).toBe("INV-001/25-26");
    expect((await must("POST", "/invoices", draft(w, "e"))).number).toBe("INV-005/25-26");
  });

  it("a new financial year starts again at 001, by the document's own date", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    await must("POST", "/invoices", draft(w, "b", "DRAFT", "2026-04-02"));
    await must("POST", "/invoices", draft(w, "c", "DRAFT", "2026-03-31"));
    expect([await numberOf("a"), await numberOf("b"), await numberOf("c")]).toEqual(["INV-001/25-26", "INV-001/26-27", "INV-002/25-26"]);
  });

  it("a cancelled invoice keeps its number, so the next one does not reuse it", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    await must("POST", "/invoices/a/finalize", {});
    await must("POST", "/invoices/a/cancel", {});
    await must("POST", "/invoices", draft(w, "b"));
    expect(await numberOf("a")).toBe("INV-001/25-26");
    expect(await numberOf("b")).toBe("INV-002/25-26");
  });

  it("continues after the highest, including an imported number (import path keeps the file's number)", async () => {
    const w = await world();
    repository.saveDraft({ id: "old", number: "INV-007/25-26", businessId: w.businessId, customerId: w.customerId, invoiceDate: "2025-05-01", paymentAccount: "RECEIVABLES", status: "DRAFT", lines: [{ description: "Old", quantity: 1, unitPricePaise: 100 }] });
    expect((await must("POST", "/invoices", draft(w, "n"))).number).toBe("INV-008/25-26");
    // An imported number is still checked: the same one again is refused.
    expect(() => repository.saveDraft({ id: "old2", number: "INV-007/25-26", businessId: w.businessId, customerId: w.customerId, invoiceDate: "2025-05-01", paymentAccount: "RECEIVABLES", status: "DRAFT", lines: [{ description: "Old", quantity: 1, unitPricePaise: 100 }] })).toThrow(/already used/);
  });

  it("quotations are their own QUO series, apart from invoices", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    const q1 = await must("POST", "/quotations", draft(w, "q1", "QUOTATION"));
    const q2 = await must("POST", "/quotations", draft(w, "q2", "QUOTATION"));
    expect([q1.number, q2.number]).toEqual(["QUO-001/25-26", "QUO-002/25-26"]);
    expect((await must("POST", "/invoices", draft(w, "b"))).number).toBe("INV-002/25-26");
  });

  it("editing a draft never changes its number; sending a number is refused", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    await must("POST", "/invoices", draft(w, "b"));
    await must("PUT", "/invoices/b", draft(w, "b"));
    expect(await numberOf("b")).toBe("INV-002/25-26");
    const refused = await req("PUT", "/invoices/b", { ...draft(w, "b"), number: "INV-001/25-26" });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("The app numbers this document; leave the number out.");
    expect(await numberOf("b")).toBe("INV-002/25-26");
  });

  it("an edit never turns a quotation into an invoice or an invoice into a quotation", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "d"));
    await must("POST", "/quotations", draft(w, "q", "QUOTATION"));
    const statusOf = async (id: string): Promise<string> => (await must("GET", `/invoices/${id}`)).status as string;

    const q2d = await req("PUT", "/invoices/q", draft(w, "q", "DRAFT"));
    expect(q2d.status).toBe(400);
    expect(q2d.body.error).toBe("Use Convert to turn a quotation into an invoice; editing cannot change a quotation into an invoice.");
    expect(() => repository.updateDraft({ ...draft(w, "q", "DRAFT") })).toThrow(/Use Convert to turn a quotation/);
    expect([await statusOf("q"), await numberOf("q")]).toEqual(["QUOTATION", "QUO-001/25-26"]);

    const d2q = await req("PUT", "/invoices/d", draft(w, "d", "QUOTATION"));
    expect(d2q.status).toBe(400);
    expect(d2q.body.error).toBe("An invoice cannot be changed into a quotation by editing. Create a new quotation instead.");
    expect(() => repository.updateDraft({ ...draft(w, "d", "QUOTATION") })).toThrow(/cannot be changed into a quotation/);
    expect([await statusOf("d"), await numberOf("d")]).toEqual(["DRAFT", "INV-001/25-26"]);

    // Same-kind edits still work and keep the number.
    await must("PUT", "/invoices/q", { ...draft(w, "q", "QUOTATION"), notes: "edited" });
    await must("PUT", "/invoices/d", { ...draft(w, "d", "DRAFT"), notes: "edited" });
    expect([await statusOf("q"), await numberOf("q")]).toEqual(["QUOTATION", "QUO-001/25-26"]);
    expect([await statusOf("d"), await numberOf("d")]).toEqual(["DRAFT", "INV-001/25-26"]);

    // Conversion still gives the next INV number and both links.
    const converted = await must("POST", "/quotations/q/convert", {});
    expect(converted.number).toBe("INV-002/25-26");
    expect(converted.sourceQuotationId).toBe("q");
    expect((await must("GET", "/invoices/q")).convertedInvoiceId).toBe(converted.id);
  });

  it("every create route refuses a number in the body with a 400", async () => {
    const w = await world();
    const expected = "The app numbers this document; leave the number out.";
    const inv = await req("POST", "/invoices", { ...draft(w, "a"), number: "INV-9" });
    const quo = await req("POST", "/quotations", { ...draft(w, "q", "QUOTATION"), number: "Q-9" });
    await must("POST", "/invoices", draft(w, "i1"));
    await must("POST", "/invoices/i1/finalize", {});
    const cn = await req("POST", "/credit-notes", { invoiceId: "i1", number: "CN-9", reason: "x", lines: [{ description: "Service", quantity: 1, unitPricePaise: 100 }] });
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-9", billDate: "2025-04-05", paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: 1000 }] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    const pr = await req("POST", "/purchase-returns", { billId: bill.id, number: "PR-9", reason: "x", lines: [{ description: "Service", quantity: 1, unitPricePaise: 100 }] });
    for (const r of [inv, quo, cn, pr]) {
      expect(r.status).toBe(400);
      expect(r.body.error).toBe(expected);
    }
    // Nothing was written by the refused calls.
    expect(repository.db.prepare("SELECT COUNT(*) AS n FROM invoices WHERE id IN ('a', 'q')").get()).toEqual({ n: 0 });
  });

  it("credit notes and purchase returns are numbered CN / PR per business and year", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "i1"));
    await must("POST", "/invoices/i1/finalize", {});
    const lines = [{ description: "Service", quantity: 1, unitPricePaise: 1000 }];
    const cn1 = await must("POST", "/credit-notes", { invoiceId: "i1", reason: "x", noteDate: "2025-04-15", lines });
    const cn2 = await must("POST", "/credit-notes", { invoiceId: "i1", reason: "y", noteDate: "2025-04-16", lines });
    expect([cn1.number, cn2.number]).toEqual(["CN-001/25-26", "CN-002/25-26"]);
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-9", billDate: "2025-04-05", paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 2, unitPricePaise: 1000 }] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    const pr1 = await must("POST", "/purchase-returns", { billId: bill.id, reason: "x", returnDate: "2025-04-15", lines });
    expect(pr1.number).toBe("PR-001/25-26");
  });

  it("finalize re-checks the number (safety net for a duplicate that got in underneath)", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    await must("POST", "/invoices", draft(w, "b"));
    repository.db.prepare("UPDATE invoices SET number = 'INV-001/25-26' WHERE id = 'b'").run();
    expect((await req("POST", "/invoices/b/finalize", {})).status).toBeGreaterThanOrEqual(400);
  });

  it("converting a quotation gives the next INV number and links both ways; a second conversion is refused", async () => {
    const w = await world();
    await must("POST", "/invoices", draft(w, "a"));
    const quote = await must("POST", "/quotations", draft(w, "q", "QUOTATION"));
    expect(quote.number).toBe("QUO-001/25-26");
    const converted = await must("POST", "/quotations/q/convert", {});
    expect(converted.number).toBe("INV-002/25-26");
    expect(converted.status).toBe("DRAFT");
    expect(converted.sourceQuotationId).toBe("q");
    const invoice = await must("GET", `/invoices/${converted.id}`);
    expect(invoice.sourceQuotationId).toBe("q");
    const quotation = await must("GET", "/invoices/q");
    expect(quotation.convertedInvoiceIds).toEqual([converted.id]);
    expect(quotation.sourceQuotationId).toBeNull();
    expect((await must("GET", "/invoices/a")).sourceQuotationId).toBeNull();
    expect((await req("POST", "/quotations/q/convert", {})).status).toBe(400);
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
