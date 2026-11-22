import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/** Regression tests for supplier-side defects D1, D2, D3, D7, D8 (fixed in repository.ts). */
let repository: AccountingRepository;
let app: FastifyInstance;
beforeEach(async () => {
  repository = new AccountingRepository(":memory:", todayAt("2025-04-01"));
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  repository.close();
});

interface R { status: number; body: any }
type Method = "GET" | "POST";
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

interface W { businessId: string; supplierId: string; itemId: string }
async function world(): Promise<W> {
  const companyId = (await must("POST", "/companies", { name: "Co", accountingBasis: "ACCRUAL" })).id;
  const businessId = (await must("POST", "/businesses", { companyId, name: "Books" })).id;
  const supplierId = (await must("POST", "/suppliers", { companyId, name: "Paper Co" })).id;
  const itemId = (await must("POST", "/items", { companyId, name: "Atlas", unit: "each", trackStock: true })).id;
  return { businessId, supplierId, itemId };
}
async function serviceBill(w: W, number: string, billDate: string, amount: number): Promise<string> {
  const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number, billDate, paymentAccount: "PAYABLES", lines: [{ description: "Service", quantity: 1, unitPricePaise: amount }] });
  await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
  return bill.id as string;
}
async function serviceReturn(billId: string, number: string, returnDate: string, amount: number): Promise<string> {
  const ret = await must("POST", "/purchase-returns", { billId, reason: "Short supply", returnDate, lines: [{ description: "Service", quantity: 1, unitPricePaise: amount }] });
  await must("POST", `/purchase-returns/${ret.id}/finalize`, {});
  return ret.id as string;
}

describe("supplier defects", () => {
  it("D1: a supplier payment above the net-of-returns outstanding is refused; the net amount is accepted", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-1", "2025-04-10", 10000);
    await serviceReturn(billId, "PR-1", "2025-04-15", 4000);
    const over = await req("POST", "/supplier-payments", { billId, amountPaise: 10000, paidOn: "2025-04-20" });
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(over.body)).toMatch(/outstanding/i);
    const justOver = await req("POST", "/supplier-payments", { billId, amountPaise: 6001, paidOn: "2025-04-20" });
    expect(justOver.status).toBeGreaterThanOrEqual(400);
    const exact = await req("POST", "/supplier-payments", { billId, amountPaise: 6000, paidOn: "2025-04-20" });
    expect(exact.status).toBeLessThan(300);
    expect(0 - ledger("PAYABLES")).toBe(0);
  });

  it("D2: the payables report nets purchase returns", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-2", "2025-04-10", 10000);
    await serviceReturn(billId, "PR-2", "2025-04-15", 4000);
    const rows = (await must("GET", `/reports/payables?businessId=${w.businessId}`)) as any[];
    const row = rows.find((p) => p.documentId === billId);
    expect(row.outstandingPaise).toBe(6000);
    expect(row.paidPaise).toBe(4000);
    expect(row.totalPaise).toBe(10000);
  });

  it("D2: a fully returned bill drops off the payables report", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-2b", "2025-04-10", 10000);
    await serviceReturn(billId, "PR-2b", "2025-04-15", 10000);
    const rows = (await must("GET", `/reports/payables?businessId=${w.businessId}`)) as any[];
    expect(rows.find((p) => p.documentId === billId)).toBeUndefined();
  });

  it("D2: the statement carries one RETURN row per finalized return (draft returns do not appear)", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-2c", "2025-04-10", 10000);
    await serviceReturn(billId, "PR-2c", "2025-04-15", 4000);
    await must("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-16", lines: [{ description: "Service", quantity: 1, unitPricePaise: 1000 }] });
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    const returns = (stmt.rows as any[]).filter((r) => r.type === "RETURN");
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ date: "2025-04-15", amountPaise: -4000, reference: "PR-001/25-26", documentId: billId });
    expect(stmt.closingBalancePaise).toBe(6000);
  });

  it("D3: the statement shows the opening balance and its settlement, and closes at the ledger", async () => {
    const w = await world();
    const op = await must("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-04-01", amountPaise: 300000 });
    await must("POST", `/opening-supplier-balances/${op.id}/settlements`, { amountPaise: 300000, paidOn: "2025-04-10" });
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect((stmt.rows as any[]).map((r) => [r.type, r.amountPaise])).toEqual([["OPENING", 300000], ["SETTLEMENT", -300000]]);
    expect(stmt.closingBalancePaise).toBe(0);
  });

  it("D3: on the same date the opening row sorts before the bill", async () => {
    const w = await world();
    await serviceBill(w, "PB-3", "2025-04-10", 5000);
    await must("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-04-10", amountPaise: 20000 });
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect((stmt.rows as any[]).map((r) => r.type)).toEqual(["OPENING", "BILL"]);
    expect(stmt.closingBalancePaise).toBe(0 - ledger("PAYABLES"));
  });

  it("D3: a reversed opening balance is left off the statement", async () => {
    const w = await world();
    const op = await must("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-04-01", amountPaise: 20000 });
    repository.db.prepare("UPDATE opening_supplier_balances SET reversed_at = ? WHERE id = ?").run("2025-04-02", op.id);
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect(stmt.rows).toEqual([]);
  });

  it("statement closing equals the PAYABLES ledger after bill + opening + settlement + return + payment", async () => {
    const w = await world();
    const op = await must("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-04-01", amountPaise: 300000 });
    const billId = await serviceBill(w, "PB-all", "2025-04-05", 10000);
    await must("POST", `/opening-supplier-balances/${op.id}/settlements`, { amountPaise: 100000, paidOn: "2025-04-10" });
    await serviceReturn(billId, "PR-all", "2025-04-15", 4000);
    await must("POST", "/supplier-payments", { billId, amountPaise: 2000, paidOn: "2025-04-20" });
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    expect((stmt.rows as any[]).map((r) => r.type)).toEqual(["OPENING", "BILL", "SETTLEMENT", "RETURN", "PAYMENT"]);
    expect(stmt.closingBalancePaise).toBe(204000);
    expect(stmt.closingBalancePaise).toBe(0 - ledger("PAYABLES"));
  });

  it("statement: a return that goes partly to SUPPLIER_CREDITS only lowers what is owed by the PAYABLES part", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-sc", "2025-04-10", 10000);
    await must("POST", "/supplier-payments", { billId, amountPaise: 8000, paidOn: "2025-04-12" });
    await serviceReturn(billId, "PR-sc", "2025-04-15", 5000); // 2000 owed -> 2000 off PAYABLES, 3000 to SUPPLIER_CREDITS
    const stmt = await must("GET", `/reports/supplier-statement?supplierId=${w.supplierId}`);
    const ret = (stmt.rows as any[]).find((r) => r.type === "RETURN");
    expect(ret.amountPaise).toBe(-2000);
    expect(stmt.closingBalancePaise).toBe(0);
    expect(stmt.closingBalancePaise).toBe(0 - ledger("PAYABLES"));
  });

  it("D7: a draft purchase return cannot be finalized once its bill is cancelled", async () => {
    const w = await world();
    const billId = await serviceBill(w, "PB-7", "2025-04-10", 10000);
    const ret = await must("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-15", lines: [{ description: "Service", quantity: 1, unitPricePaise: 4000 }] });
    await must("POST", `/purchase-bills/${billId}/cancel`, {});
    const fin = await req("POST", `/purchase-returns/${ret.id}/finalize`, {});
    expect(fin.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(fin.body)).toMatch(/CANCELLED/);
    expect(ledger("PAYABLES")).toBe(0);
  });

  async function twoPriceBill(w: W): Promise<string> {
    const bill = await must("POST", "/purchase-bills", { businessId: w.businessId, supplierId: w.supplierId, number: "PB-8", billDate: "2025-04-10", paymentAccount: "PAYABLES", lines: [
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 10000 },
      { itemId: w.itemId, description: "Atlas", quantity: 1, unitPricePaise: 30000 },
    ] });
    await must("POST", `/purchase-bills/${bill.id}/finalize`, {});
    return bill.id as string;
  }
  const returnLine = (price: number, quantity = 1) => ({ itemId: undefined as string | undefined, description: "Atlas", quantity, unitPricePaise: price });

  it("D8: with one item on two lines at different prices, a return at either price is accepted and takes that lot's cost", async () => {
    const w = await world();
    const billId = await twoPriceBill(w);
    for (const price of [10000, 30000] as const) {
      const before = ledger("INVENTORY");
      const valBefore = valuation();
      const create = await req("POST", "/purchase-returns", { billId, reason: "Damaged", returnDate: "2025-04-15", lines: [{ ...returnLine(price), itemId: w.itemId }] });
      expect(create.status).toBe(201);
      expect((await req("POST", `/purchase-returns/${create.body.id}/finalize`, {})).status).toBe(200);
      expect(before - ledger("INVENTORY")).toBe(price);
      expect(valBefore - valuation()).toBe(price);
      expect(ledger("INVENTORY")).toBe(valuation());
    }
    expect(valuation()).toBe(0);
  });

  it("D8: quantity is capped per (item, price) lot, and a price on no line is refused with the existing wording", async () => {
    const w = await world();
    const billId = await twoPriceBill(w);
    const twoAtLow = await req("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-15", lines: [{ ...returnLine(10000, 2), itemId: w.itemId }] });
    expect(twoAtLow.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(twoAtLow.body)).toMatch(/exceeds what bill/);
    const wrongPrice = await req("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-15", lines: [{ ...returnLine(20000), itemId: w.itemId }] });
    expect(wrongPrice.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(wrongPrice.body)).toMatch(/must use the price the bill charged/);
    // already-returned is per price too: after returning the 100 unit, the 300 unit is still returnable.
    const first = await must("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-15", lines: [{ ...returnLine(10000), itemId: w.itemId }] });
    await must("POST", `/purchase-returns/${first.id}/finalize`, {});
    const again = await req("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-16", lines: [{ ...returnLine(10000), itemId: w.itemId }] });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const other = await req("POST", "/purchase-returns", { billId, reason: "x", returnDate: "2025-04-16", lines: [{ ...returnLine(30000), itemId: w.itemId }] });
    expect(other.status).toBe(201);
  });
});
