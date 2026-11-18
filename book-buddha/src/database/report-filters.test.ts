import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import type { JournalEntry } from "../accounting/types.js";
import { AccountingRepository, RepositoryValidationError, istDateOf } from "./repository.js";

interface World {
  repository: AccountingRepository;
  companyId: string;
  bizA: string;
  bizB: string;
  customerId: string;
  supplierId: string;
}

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co" });
  const bizA = repository.createBusiness({ companyId, name: "Books A" });
  const bizB = repository.createBusiness({ companyId, name: "Books B" });
  const customerId = repository.createCustomer({ companyId, name: "Cust" });
  const supplierId = repository.createSupplier({ companyId, name: "Sup" });
  return { repository, companyId, bizA, bizB, customerId, supplierId };
}

function invoice(w: World, id: string, businessId: string, invoiceDate: string, quantity: number, unitPricePaise: number): void {
  w.repository.saveDraft({
    id, number: id, businessId, customerId: w.customerId, invoiceDate, paymentAccount: "CASH", status: "DRAFT",
    lines: [{ description: "Service", quantity, unitPricePaise }],
  });
  w.repository.finalizeInvoice(id);
}

function bill(w: World, number: string, businessId: string, billDate: string, quantity: number, unitPricePaise: number): string {
  const created = w.repository.createPurchaseBill({
    businessId, supplierId: w.supplierId, number, billDate, paymentAccount: "CASH",
    lines: [{ description: "Supplies", quantity, unitPricePaise }],
  });
  w.repository.finalizePurchaseBill(created.id);
  return created.id;
}

/**
 * Business A: invoice 10,000 (10 Jan), invoice 5,000 (5 Feb), bill 1,000 (20 Jan).
 * Business B: invoice 6,000 (12 Feb), bill 1,500 (15 Feb).
 */
function scenario(): World {
  const w = setup();
  invoice(w, "A1", w.bizA, "2026-01-10", 10, 1000);
  invoice(w, "A2", w.bizA, "2026-02-05", 5, 1000);
  bill(w, "PB-A", w.bizA, "2026-01-20", 2, 500);
  invoice(w, "B1", w.bizB, "2026-02-12", 3, 2000);
  bill(w, "PB-B", w.bizB, "2026-02-15", 1, 1500);
  return w;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("report filters", () => {
  it("leaves the unfiltered reports exactly as they were (regression)", () => {
    const { repository } = scenario();
    try {
      // The pre-filter query, run independently against journal_lines.
      const legacy = repository.db
        .prepare("SELECT account, SUM(debit_paise) AS d, SUM(credit_paise) AS c FROM journal_lines GROUP BY account ORDER BY account")
        .all() as Array<{ account: string; d: number; c: number }>;
      // S10-5: the trial balance nets each account onto ONE side, so the independent query is
      // netted the same way. The regression this test exists for is unchanged - the unfiltered
      // report must still equal a query run with no knowledge of the filter code.
      const legacyRows = legacy.map((r) => ({
        account: r.account,
        debitPaise: r.d - r.c > 0 ? r.d - r.c : 0,
        creditPaise: r.c - r.d > 0 ? r.c - r.d : 0,
      }));
      expect(repository.getTrialBalance()).toEqual(legacyRows);
      expect(repository.getTrialBalance({})).toEqual(legacyRows);

      const pl = repository.getProfitAndLoss();
      expect(pl).toMatchObject({ totalIncomePaise: 21000, totalExpensesPaise: 2500, netProfitPaise: 18500 });
      expect(repository.getProfitAndLoss({})).toEqual(pl);
      // A filter wide enough to cover everything agrees with no filter.
      expect(repository.getProfitAndLoss({ fromDate: "2000-01-01", toDate: "2999-12-31" })).toEqual(pl);

      const bs = repository.getBalanceSheet();
      expect(bs.totalAssetsPaise).toBe(18500);
      expect(bs.totalAssetsPaise).toBe(bs.totalLiabilitiesPaise + bs.totalEquityPaise);
      expect(repository.getBalanceSheet({})).toEqual(bs);
      expect(repository.getBalanceSheet({ asAtDate: "2999-12-31" })).toEqual(bs);

      expect(repository.getGeneralLedger()).toHaveLength(legacyRowsCount(repository));
      expect(repository.getGeneralLedger({})).toEqual(repository.getGeneralLedger());
    } finally {
      repository.close();
    }
  });

  it("filters per business and the consolidated view equals the two combined", () => {
    const { repository, bizA, bizB } = scenario();
    try {
      const plA = repository.getProfitAndLoss({ businessId: bizA });
      const plB = repository.getProfitAndLoss({ businessId: bizB });
      const all = repository.getProfitAndLoss();
      expect(plA).toMatchObject({ totalIncomePaise: 15000, totalExpensesPaise: 1000, netProfitPaise: 14000 });
      expect(plB).toMatchObject({ totalIncomePaise: 6000, totalExpensesPaise: 1500, netProfitPaise: 4500 });
      expect(plA.totalIncomePaise + plB.totalIncomePaise).toBe(all.totalIncomePaise);
      expect(plA.totalExpensesPaise + plB.totalExpensesPaise).toBe(all.totalExpensesPaise);

      const bsA = repository.getBalanceSheet({ businessId: bizA });
      const bsB = repository.getBalanceSheet({ businessId: bizB });
      const bsAll = repository.getBalanceSheet();
      expect(bsA.totalAssetsPaise).toBe(14000);
      expect(bsB.totalAssetsPaise).toBe(4500);
      expect(bsA.totalAssetsPaise + bsB.totalAssetsPaise).toBe(bsAll.totalAssetsPaise);
      expect(bsA.totalEquityPaise + bsB.totalEquityPaise).toBe(bsAll.totalEquityPaise);

      const tbA = repository.getTrialBalance({ businessId: bizA });
      expect(tbA.reduce((t, r) => t + r.debitPaise, 0)).toBe(tbA.reduce((t, r) => t + r.creditPaise, 0));
      const glB = repository.getGeneralLedger({ businessId: bizB });
      expect(new Set(glB.map((r) => r.sourceId)).size).toBe(2);
      expect(glB.every((r) => r.sourceId !== "A1" && r.sourceId !== "A2")).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("filters by period for P&L / ledger and as-at for balance sheet / trial balance", () => {
    const { repository } = scenario();
    try {
      expect(repository.getProfitAndLoss({ fromDate: "2026-01-01", toDate: "2026-01-31" }))
        .toMatchObject({ totalIncomePaise: 10000, totalExpensesPaise: 1000 });
      expect(repository.getProfitAndLoss({ fromDate: "2026-02-01", toDate: "2026-02-28" }))
        .toMatchObject({ totalIncomePaise: 11000, totalExpensesPaise: 1500 });
      // Boundaries are inclusive.
      expect(repository.getProfitAndLoss({ fromDate: "2026-01-10", toDate: "2026-01-10" })).toMatchObject({ totalIncomePaise: 10000, totalExpensesPaise: 0 });

      // Balance sheet / trial balance: everything on or before the date.
      expect(repository.getBalanceSheet({ asAtDate: "2026-01-31" }).totalAssetsPaise).toBe(9000);
      expect(repository.getBalanceSheet({ asAtDate: "2026-02-05" }).totalAssetsPaise).toBe(14000);
      expect(repository.getBalanceSheet({ asAtDate: "2026-02-28" }).totalAssetsPaise).toBe(18500);
      expect(repository.getBalanceSheet({ asAtDate: "2025-12-31" }).totalAssetsPaise).toBe(0);
      const tb = repository.getTrialBalance({ asAtDate: "2026-01-31" });
      expect(tb.find((r) => r.account === "SALES")).toMatchObject({ creditPaise: 10000 });

      // Ledger: period + date order.
      const gl = repository.getGeneralLedger({ fromDate: "2026-02-01", toDate: "2026-02-28" });
      expect(new Set(gl.map((r) => r.sourceId))).toEqual(new Set(["A2", "B1", gl.find((r) => r.sourceType === "PURCHASE_BILL")?.sourceId]));
      const full = repository.getGeneralLedger();
      const byEntryDate = (id: string): string => (repository.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(id) as { entry_date: string }).entry_date;
      const dates = full.map((r) => byEntryDate(r.journalEntryId));
      expect(dates).toEqual([...dates].sort());
    } finally {
      repository.close();
    }
  });

  it("puts a reversal in the month it happened, not the month of the cancelled invoice", () => {
    const w = scenario();
    const { repository } = w;
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-18T05:00:00.000Z"));
      repository.cancelInvoice("A1");
      expect(repository.db.prepare("SELECT business_id, entry_date FROM journal_entries WHERE id = 'je-A1-reversal'").get())
        .toEqual({ business_id: w.bizA, entry_date: "2026-03-18" });
      // January is untouched (it may already be filed); March carries the reversal.
      expect(repository.getProfitAndLoss({ fromDate: "2026-01-01", toDate: "2026-01-31" }).totalIncomePaise).toBe(10000);
      expect(repository.getProfitAndLoss({ fromDate: "2026-03-01", toDate: "2026-03-31" }).totalIncomePaise).toBe(-10000);
      expect(repository.getProfitAndLoss({ businessId: w.bizB, fromDate: "2026-03-01", toDate: "2026-03-31" }).totalIncomePaise).toBe(0);
      // Cumulatively the cancellation nets the invoice out.
      expect(repository.getProfitAndLoss().totalIncomePaise).toBe(11000);
    } finally {
      repository.close();
    }
  });

  it("stamps forward writes with the date that matches the backfill rules (IST)", () => {
    const w = setup();
    const { repository } = w;
    try {
      repository.saveDraft({
        id: "R1", number: "R1", businessId: w.bizA, customerId: w.customerId, invoiceDate: "2026-03-01",
        paymentAccount: "RECEIVABLES", status: "DRAFT", lines: [{ description: "Service", quantity: 1, unitPricePaise: 1000 }],
      });
      repository.finalizeInvoice("R1");
      // 20:30 UTC on 4 March is 02:00 IST on 5 March.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-04T20:30:00.000Z"));
      const payment = repository.recordPayment("R1", 400);
      const row = (id: string) => repository.db.prepare("SELECT business_id, entry_date FROM journal_entries WHERE id = ?").get(id);
      expect(row("je-R1")).toEqual({ business_id: w.bizA, entry_date: "2026-03-01" });
      expect(row(`je-payment-${payment.id}`)).toEqual({ business_id: w.bizA, entry_date: "2026-03-05" });
      expect(istDateOf("2026-03-04T20:30:00.000Z")).toBe("2026-03-05");
      expect(istDateOf("2026-03-04T18:29:00.000Z")).toBe("2026-03-04");
    } finally {
      repository.close();
    }
  });

  it("rejects bad filters", () => {
    const { repository } = setup();
    try {
      expect(() => repository.getProfitAndLoss({ fromDate: "2026-13-01" })).toThrow(RepositoryValidationError);
      expect(() => repository.getBalanceSheet({ asAtDate: "yesterday" })).toThrow(RepositoryValidationError);
      expect(() => repository.getGeneralLedger({ fromDate: "2026-03-01", toDate: "2026-02-01" })).toThrow("From date cannot be after");
    } finally {
      repository.close();
    }
  });
});

function legacyRowsCount(repository: AccountingRepository): number {
  return (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get() as { n: number }).n;
}

describe("insertJournalEntry guard", () => {
  const entry: JournalEntry = {
    id: "je-x", sourceId: "s", description: "d", isReversal: false,
    lines: [{ account: "CASH", debitPaise: 1, creditPaise: 0 }, { account: "SALES", debitPaise: 0, creditPaise: 1 }],
  };
  const insert = (repository: AccountingRepository, dims: unknown): void =>
    (repository as unknown as { insertJournalEntry(e: JournalEntry, d: unknown): void }).insertJournalEntry(entry, dims);

  it("rejects a missing or blank business and a malformed date, writing nothing", () => {
    const { repository, bizA } = setup();
    try {
      expect(() => insert(repository, { businessId: "", entryDate: "2026-01-01" })).toThrow(RepositoryValidationError);
      expect(() => insert(repository, { businessId: "   ", entryDate: "2026-01-01" })).toThrow("needs a business");
      expect(() => insert(repository, { entryDate: "2026-01-01" })).toThrow(RepositoryValidationError);
      expect(() => insert(repository, { businessId: bizA, entryDate: "2026-02-30" })).toThrow("YYYY-MM-DD");
      expect(() => insert(repository, { businessId: bizA, entryDate: "01/02/2026" })).toThrow("YYYY-MM-DD");
      expect(() => insert(repository, { businessId: bizA })).toThrow(RepositoryValidationError);
      expect(repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
      expect(() => insert(repository, { businessId: bizA, entryDate: "2026-02-28" })).not.toThrow();
    } finally {
      repository.close();
    }
  });
});

describe("report filter query parameters", () => {
  it("accepts optional filters, keeps no-parameter behaviour, and rejects bad input", async () => {
    const w = scenario();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const get = async (url: string) => app.inject({ method: "GET", url });
      const all = (await get("/reports/profit-and-loss")).json<{ totalIncomePaise: number }>();
      expect(all.totalIncomePaise).toBe(21000);
      expect((await get(`/reports/profit-and-loss?businessId=${w.bizA}`)).json<{ totalIncomePaise: number }>().totalIncomePaise).toBe(15000);
      expect((await get("/reports/profit-and-loss?fromDate=2026-02-01&toDate=2026-02-28")).json<{ totalIncomePaise: number }>().totalIncomePaise).toBe(11000);
      expect((await get("/reports/balance-sheet?asAtDate=2026-01-31")).json<{ totalAssetsPaise: number }>().totalAssetsPaise).toBe(9000);
      expect((await get("/reports/trial-balance?asAtDate=2026-01-31")).statusCode).toBe(200);
      expect((await get(`/reports/general-ledger?businessId=${w.bizB}&fromDate=2026-02-01`)).statusCode).toBe(200);
      // Wrong shape for the report / bad date => 400, never a silently-unfiltered answer.
      expect((await get("/reports/balance-sheet?fromDate=2026-01-01")).statusCode).toBe(400);
      expect((await get("/reports/profit-and-loss?asAtDate=2026-01-01")).statusCode).toBe(400);
      expect((await get("/reports/profit-and-loss?fromDate=01-02-2026")).statusCode).toBe(400);
      expect((await get("/reports/profit-and-loss?fromDate=2026-02-30")).statusCode).toBe(400);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
