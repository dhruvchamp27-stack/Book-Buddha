import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository, RepositoryValidationError } from "./repository.js";
import { todayAt } from "./test-clock.js";

interface World {
  repository: AccountingRepository;
  companyId: string;
  bizA: string;
  bizB: string;
  customerId: string;
  supplierId: string;
  stockItemId: string;
  fairA: string;
  fairB: string;
}

function setup(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-10-01"));
  const companyId = repository.createCompany({ name: "Co" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const stockItemId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const fairA = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair A" });
  const fairB = repository.createFair({ companyId, hostCustomerId: customerId, name: "Fair B" });
  return { repository, companyId, bizA, bizB, customerId, supplierId, stockItemId, fairA, fairB };
}

/** A stock sale (cost 4,000 each, bought untagged). */
function sell(w: World, id: string, quantity: number, unitPricePaise: number, opts: { fairId?: string; account?: "CASH" | "RECEIVABLES"; date?: string; businessId?: string } = {}): void {
  w.repository.saveDraft({
    id, number: id, businessId: opts.businessId ?? w.bizA, customerId: w.customerId, paymentAccount: opts.account ?? "CASH", status: "DRAFT",
    ...(opts.fairId === undefined ? {} : { fairId: opts.fairId }),
    ...(opts.date === undefined ? {} : { invoiceDate: opts.date }),
    lines: [{ itemId: w.stockItemId, description: "Atlas", quantity, unitPricePaise }],
  });
  w.repository.finalizeInvoice(id);
}

function stockUp(w: World, quantity: number): void {
  const b = w.repository.createPurchaseBill({
    id: "B0", businessId: w.bizA, supplierId: w.supplierId, number: "B0", billDate: "2026-10-01", paymentAccount: "CASH",
    lines: [{ itemId: w.stockItemId, description: "Atlas", quantity, unitPricePaise: 4000 }],
  });
  w.repository.finalizePurchaseBill(b.id);
}

function serviceBill(w: World, id: string, amountPaise: number, date: string, fairId?: string): void {
  const b = w.repository.createPurchaseBill({
    id, businessId: w.bizA, supplierId: w.supplierId, number: id, billDate: date, paymentAccount: "CASH",
    ...(fairId === undefined ? {} : { fairId }),
    lines: [{ description: "Stall hire", quantity: 1, unitPricePaise: amountPaise }],
  });
  w.repository.finalizePurchaseBill(b.id);
}

function expense(w: World, id: string, amountPaise: number, date: string, fairId?: string): void {
  w.repository.createExpense({
    id, businessId: w.bizA, number: id, expenseDate: date, description: "Transport", amountPaise, paymentAccount: "CASH",
    ...(fairId === undefined ? {} : { fairId }),
  });
  w.repository.finalizeExpense(id);
}

/**
 * Fair A: sales 40,000 (4 x 10,000), COGS 16,000, bill 5,000, expense 2,000  => costs 23,000, profit 17,000.
 * Fair B: sales 20,000 (2 x 10,000), COGS  8,000, bill 1,000, expense 3,000  => costs 12,000, profit  8,000.
 * No fair: sales 10,000, COGS 4,000, expense 700                             => costs  4,700, profit  5,300.
 */
function twoFairs(): World {
  const w = setup();
  stockUp(w, 20);
  sell(w, "IA", 4, 10000, { fairId: w.fairA, date: "2026-11-05" });
  serviceBill(w, "PBA", 5000, "2026-11-06", w.fairA);
  expense(w, "EXA", 2000, "2026-11-07", w.fairA);
  sell(w, "IB", 2, 10000, { fairId: w.fairB, date: "2026-11-08" });
  serviceBill(w, "PBB", 1000, "2026-11-09", w.fairB);
  expense(w, "EXB", 3000, "2026-11-10", w.fairB);
  sell(w, "IN", 1, 10000, { date: "2026-11-11" });
  expense(w, "EXN", 700, "2026-11-12");
  return w;
}

describe("fair filter on reports, slice 8c", () => {
  it("each fair P&L shows only its own revenue and costs (acceptance)", () => {
    const w = twoFairs();
    try {
      const a = w.repository.getProfitAndLoss({ fairId: w.fairA });
      expect(a).toMatchObject({ totalIncomePaise: 40000, totalExpensesPaise: 23000, netProfitPaise: 17000, basis: "ACCRUAL" });
      const cost = (r: typeof a, account: string): number => r.expenses.find((e) => e.account === account)?.balancePaise ?? 0;
      expect(cost(a, "COGS")).toBe(16000);
      expect(cost(a, "EXPENSE")).toBe(7000);
      const b = w.repository.getProfitAndLoss({ fairId: w.fairB });
      expect(b).toMatchObject({ totalIncomePaise: 20000, totalExpensesPaise: 12000, netProfitPaise: 8000 });
      expect(cost(b, "COGS")).toBe(8000);
      expect(cost(b, "EXPENSE")).toBe(4000);
    } finally {
      w.repository.close();
    }
  });

  it("excludes untagged entries from a fair report but includes them, and every fair, in the unfiltered one (regression)", () => {
    const w = twoFairs();
    try {
      const all = w.repository.getProfitAndLoss();
      expect(all).toMatchObject({ totalIncomePaise: 70000, totalExpensesPaise: 39700, netProfitPaise: 30300 });
      expect(w.repository.getProfitAndLoss({})).toEqual(all);
      const parts = [w.fairA, w.fairB].map((fairId) => w.repository.getProfitAndLoss({ fairId }).netProfitPaise);
      expect((parts[0] as number) + (parts[1] as number)).toBe(25000);
      expect(all.netProfitPaise - 25000).toBe(5300); // exactly the untagged sale, its COGS and expense

      const legacy = w.repository.db
        .prepare("SELECT account, SUM(debit_paise) AS d, SUM(credit_paise) AS c FROM journal_lines GROUP BY account ORDER BY account")
        .all() as Array<{ account: string; d: number; c: number }>;
      // S10-5: the trial balance nets each account onto ONE side, so the independent query is
      // netted the same way. The regression intent is unchanged.
      expect(w.repository.getTrialBalance()).toEqual(legacy.map((r) => ({
        account: r.account,
        debitPaise: r.d - r.c > 0 ? r.d - r.c : 0,
        creditPaise: r.c - r.d > 0 ? r.c - r.d : 0,
      })));
      const totalLines = (w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get() as { n: number }).n;
      expect(w.repository.getGeneralLedger()).toHaveLength(totalLines);
    } finally {
      w.repository.close();
    }
  });

  it("filters the trial balance and general ledger by fair in SQL", () => {
    const w = twoFairs();
    try {
      const tb = w.repository.getTrialBalance({ fairId: w.fairA });
      expect(tb.find((r) => r.account === "SALES")).toMatchObject({ creditPaise: 40000 });
      expect(tb.reduce((t, r) => t + r.debitPaise, 0)).toBe(tb.reduce((t, r) => t + r.creditPaise, 0));
      const gl = w.repository.getGeneralLedger({ fairId: w.fairA });
      expect(gl.length).toBeGreaterThan(0);
      const fairOfEntry = w.repository.db.prepare("SELECT fair_id FROM journal_entries WHERE id = ?");
      for (const row of gl) expect((fairOfEntry.get(row.journalEntryId) as { fair_id: string }).fair_id).toBe(w.fairA);
      expect(gl.some((row) => row.sourceId === "IN")).toBe(false);
      expect(w.repository.getGeneralLedger().length).toBeGreaterThan(gl.length);
    } finally {
      w.repository.close();
    }
  });

  it("combines the fair filter with a date range", () => {
    const w = setup();
    try {
      stockUp(w, 20);
      sell(w, "O1", 1, 10000, { fairId: w.fairA, date: "2026-10-15" });
      sell(w, "N1", 2, 10000, { fairId: w.fairA, date: "2026-11-15" });
      serviceBill(w, "PBN", 1500, "2026-11-20", w.fairA);
      sell(w, "N2", 1, 10000, { fairId: w.fairB, date: "2026-11-16" });
      const nov = { fromDate: "2026-11-01", toDate: "2026-11-30" };
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA, ...nov })).toMatchObject({ totalIncomePaise: 20000, totalExpensesPaise: 8000 + 1500, netProfitPaise: 10500 });
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA, toDate: "2026-10-31" })).toMatchObject({ totalIncomePaise: 10000, totalExpensesPaise: 4000 });
      expect(w.repository.getTrialBalance({ fairId: w.fairA, asAtDate: "2026-10-31" }).find((r) => r.account === "SALES")).toMatchObject({ creditPaise: 10000 });
    } finally {
      w.repository.close();
    }
  });

  it("honours the fair filter on the CASH basis (only the collected share)", () => {
    const w = setup();
    try {
      stockUp(w, 20);
      sell(w, "CA", 4, 10000, { fairId: w.fairA, account: "RECEIVABLES", date: "2026-11-05" }); // 40,000, COGS 16,000
      sell(w, "CB", 2, 10000, { fairId: w.fairB, account: "RECEIVABLES", date: "2026-11-06" }); // 20,000, COGS 8,000
      sell(w, "CN", 1, 10000, { account: "RECEIVABLES", date: "2026-11-07" }); // untagged, unpaid
      w.repository.recordPayment("CA", 10000); // a quarter
      w.repository.recordPayment("CB", 20000); // all of it
      const cash = (fairId?: string) => w.repository.getProfitAndLoss({ basis: "CASH", ...(fairId === undefined ? {} : { fairId }) });
      expect(cash(w.fairA)).toMatchObject({ basis: "CASH", totalIncomePaise: 10000, totalExpensesPaise: 4000, netProfitPaise: 6000, grossSalesPaise: 10000 });
      expect(cash(w.fairB)).toMatchObject({ totalIncomePaise: 20000, totalExpensesPaise: 8000, netProfitPaise: 12000, grossSalesPaise: 20000 });
      expect(cash()).toMatchObject({ totalIncomePaise: 30000, totalExpensesPaise: 12000, grossSalesPaise: 30000 });
      // Accrual on the same fair is the full invoice: the two bases differ.
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL", fairId: w.fairA })).toMatchObject({ totalIncomePaise: 40000 });
      expect(w.repository.deriveCashView({ fairId: w.fairA }).recognitions.every((r) => r.documentId === "CA")).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("the cash fair filter also covers supplier bills", () => {
    const w = setup();
    try {
      const bill = w.repository.createPurchaseBill({
        id: "CPB", businessId: w.bizA, supplierId: w.supplierId, fairId: w.fairA, number: "CPB", billDate: "2026-11-01",
        paymentAccount: "PAYABLES", lines: [{ description: "Stall hire", quantity: 1, unitPricePaise: 8000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      w.repository.recordSupplierPayment({ billId: "CPB", amountPaise: 2000 });
      serviceBill(w, "OTH", 900, "2026-11-02", w.fairB);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fairId: w.fairA })).toMatchObject({ totalExpensesPaise: 2000 });
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fairId: w.fairB })).toMatchObject({ totalExpensesPaise: 900 });
    } finally {
      w.repository.close();
    }
  });

  it("combines the fair filter with a business filter", () => {
    const w = setup();
    try {
      const specs: Array<[string, string, string | undefined, number]> = [
        ["S1", w.bizA, w.fairA, 1000], ["S2", w.bizB, w.fairA, 2000], ["S3", w.bizA, w.fairB, 4000], ["S4", w.bizB, undefined, 8000],
      ];
      for (const [id, biz, fair, amount] of specs) {
        w.repository.saveDraft({
          id, number: id, businessId: biz, customerId: w.customerId, paymentAccount: "CASH", status: "DRAFT",
          ...(fair === undefined ? {} : { fairId: fair }),
          lines: [{ description: "Service", quantity: 1, unitPricePaise: amount }],
        });
        w.repository.finalizeInvoice(id);
      }
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA }).totalIncomePaise).toBe(3000);
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA, businessId: w.bizA }).totalIncomePaise).toBe(1000);
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA, businessId: w.bizB }).totalIncomePaise).toBe(2000);
      expect(w.repository.getProfitAndLoss({ fairId: w.fairB, businessId: w.bizB, basis: "CASH" }).totalIncomePaise).toBe(0);
      expect(w.repository.getProfitAndLoss({ fairId: w.fairA, businessId: w.bizB, basis: "CASH" }).totalIncomePaise).toBe(2000);
      expect(w.repository.getGeneralLedger({ fairId: w.fairA, businessId: w.bizB }).every((r) => r.sourceId === "S2")).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a fair filter on the Balance Sheet", () => {
    const w = twoFairs();
    try {
      expect(() => w.repository.getBalanceSheet({ fairId: w.fairA })).toThrow(RepositoryValidationError);
      expect(() => w.repository.getBalanceSheet({ fairId: w.fairA })).toThrow(/no per-fair Balance Sheet/);
      expect(w.repository.getBalanceSheet().totalAssetsPaise).toBeGreaterThan(0);
    } finally {
      w.repository.close();
    }
  });

  it("accepts fairId on three report routes and returns 400 on the Balance Sheet route", async () => {
    const w = twoFairs();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const get = async (url: string) => app.inject({ method: "GET", url });
      const pl = await get(`/reports/profit-and-loss?fairId=${w.fairA}`);
      expect(pl.json<{ netProfitPaise: number }>().netProfitPaise).toBe(17000);
      expect((await get(`/reports/profit-and-loss?fairId=${w.fairA}&basis=CASH`)).statusCode).toBe(200);
      expect((await get("/reports/profit-and-loss")).json<{ netProfitPaise: number }>().netProfitPaise).toBe(30300);
      const tb = await get(`/reports/trial-balance?fairId=${w.fairB}`);
      expect(tb.json<Array<{ account: string; creditPaise: number }>>().find((r) => r.account === "SALES")?.creditPaise).toBe(20000);
      const gl = await get(`/reports/general-ledger?fairId=${w.fairB}&fromDate=2026-11-01`);
      expect(gl.statusCode).toBe(200);
      expect(gl.json<Array<{ sourceId: string }>>().some((r) => r.sourceId === "IA")).toBe(false);
      expect((await get(`/reports/balance-sheet?fairId=${w.fairA}`)).statusCode).toBe(400);
      expect((await get("/reports/balance-sheet")).statusCode).toBe(200);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
