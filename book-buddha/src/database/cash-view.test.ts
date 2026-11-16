import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { AccountingRepository, RepositoryValidationError, istDateOf, type ProfitAndLossReport } from "./repository.js";

/**
 * Derived Cash/Accrual Profit and Loss (sub-slice 7d). Posting stays accrual-always; the cash
 * view is derived from documents, their payments and their posted lines, and writes nothing.
 * Money is integer paise throughout.
 */

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  supplierId: string;
  /** Stock item: 30 on hand at cost 60,000 paise each (so 10 sold at 100,000 = COGS 600,000). */
  goodsId: string;
  stockPurchaseItemId: string;
  serviceItemId: string;
}

function world(accountingBasis: "CASH" | "ACCRUAL" = "ACCRUAL"): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Cust" });
  const supplierId = repository.createSupplier({ companyId, name: "Sup" });
  const goodsId = repository.createItem({ companyId, name: "Goods", unit: "each", trackStock: true });
  repository.addStockMovement({ itemId: goodsId, movementType: "OPENING", quantity: 30, unitCostPaise: 60000 });
  const stockPurchaseItemId = repository.createItem({ companyId, name: "Stock bought", unit: "each", trackStock: true });
  const serviceItemId = repository.createItem({ companyId, name: "Freight", unit: "job", trackStock: false });
  return { repository, companyId, businessId, customerId, supplierId, goodsId, stockPurchaseItemId, serviceItemId };
}

/** Owner's invoice: taxable 1,000,000 + 18% CGST/SGST 180,000 = 1,180,000; COGS 600,000. */
function ownerInvoice(w: World, id: string, invoiceDate: string, paymentAccount: "RECEIVABLES" | "CASH" = "RECEIVABLES"): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate, paymentAccount, status: "DRAFT",
    taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    lines: [{ itemId: w.goodsId, description: "Goods", quantity: 10, unitPricePaise: 100000 }],
  });
  w.repository.finalizeInvoice(id);
}

/** Owner's bill: stock 500,000 + freight 100,000 = taxable 600,000, IGST 18% 108,000 = 708,000. */
function ownerBill(w: World, billDate: string): string {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate, paymentAccount: "PAYABLES",
    taxType: "IGST", taxRateBasisPoints: 1800,
    lines: [
      { itemId: w.stockPurchaseItemId, description: "Stock", quantity: 1, unitPricePaise: 500000 },
      { itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 100000 },
    ],
  });
  w.repository.finalizePurchaseBill(bill.id);
  return bill.id;
}

function at(iso: string): void {
  vi.setSystemTime(new Date(iso));
}

function row(report: ProfitAndLossReport, account: string): number {
  const found = [...report.income, ...report.expenses].find((r) => r.account === account);
  return found === undefined ? 0 : Math.abs(found.balancePaise);
}

function counts(repository: AccountingRepository): { entries: number; lines: number } {
  const n = (table: string): number => (repository.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { entries: n("journal_entries"), lines: n("journal_lines") };
}

function sumOf(repository: AccountingRepository, account: string, filter: { fromDate?: string; toDate?: string } = {}): number {
  return repository.deriveCashView(filter).recognitions
    .filter((r) => r.account === account)
    .reduce((total, r) => total + r.amountPaise, 0);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("cash view: the owner's acceptance figures", () => {
  it("ACCEPTANCE invoice: Rs 11,800 invoice, Rs 5,900 collected -> cash 590000 gross / 90000 GST / 500000 net / 300000 COGS", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(accrual).toMatchObject({
        basis: "ACCRUAL", grossSalesPaise: 1180000, gstOnSalesPaise: 180000, totalIncomePaise: 1000000, totalExpensesPaise: 600000,
      });
      expect(row(accrual, "COGS")).toBe(600000);

      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash).toMatchObject({
        basis: "CASH", grossSalesPaise: 590000, gstOnSalesPaise: 90000, totalIncomePaise: 500000, totalExpensesPaise: 300000,
        netProfitPaise: 200000,
      });
      expect(cash.grossSalesPaise).toBe(cash.totalIncomePaise + cash.gstOnSalesPaise);
      expect(row(cash, "COGS")).toBe(300000);

      // CGST 45000 / SGST 45000 (accrual 90000 / 90000).
      expect(sumOf(w.repository, "OUTPUT_CGST")).toBe(45000);
      expect(sumOf(w.repository, "OUTPUT_SGST")).toBe(45000);
      // Receivable outstanding is unchanged by the toggle: still 590000.
      expect(w.repository.getReceivables().reduce((t, r) => t + r.outstandingPaise, 0)).toBe(590000);
      const tb = w.repository.getTrialBalance().find((r) => r.account === "RECEIVABLES");
      expect((tb?.debitPaise ?? 0) - (tb?.creditPaise ?? 0)).toBe(590000);
    } finally {
      w.repository.close();
    }
  });

  it("ACCEPTANCE bill: Rs 7,080 bill, Rs 3,540 paid -> cash expense 50000 / inventory 250000 / ITC 54000, payable 354000", () => {
    const w = world();
    try {
      const billId = ownerBill(w, "2026-01-12");
      w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-01-21" });

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(row(accrual, "EXPENSE")).toBe(100000);
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(row(cash, "EXPENSE")).toBe(50000);
      expect(cash.totalExpensesPaise).toBe(50000);
      // Inventory is an asset: never in the P&L, but recognised at half in the cash view.
      expect(cash.expenses.map((r) => r.account)).toEqual(["EXPENSE"]);
      expect(sumOf(w.repository, "INVENTORY")).toBe(250000);
      expect(sumOf(w.repository, "INPUT_IGST")).toBe(54000);
      // Accrual figures for the same bill (the trial balance is the ledger).
      const tb = (account: string): number => {
        const found = w.repository.getTrialBalance().find((r) => r.account === account);
        return (found?.debitPaise ?? 0) - (found?.creditPaise ?? 0);
      };
      expect(tb("INVENTORY")).toBe(500000);
      expect(tb("INPUT_IGST")).toBe(108000);
      // Payable outstanding unchanged by the toggle: 354000.
      expect(w.repository.getPayables().reduce((t, r) => t + r.outstandingPaise, 0)).toBe(354000);
      expect(-tb("PAYABLES")).toBe(354000);
    } finally {
      w.repository.close();
    }
  });

  it("ACCEPTANCE net profit: accrual 300000 (Rs 3,000) vs cash 150000 (Rs 1,500) for the invoice + bill together", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      const billId = ownerBill(w, "2026-01-12");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-01-20" });

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(accrual).toMatchObject({ totalIncomePaise: 1000000, totalExpensesPaise: 700000, netProfitPaise: 300000 });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash).toMatchObject({ totalIncomePaise: 500000, totalExpensesPaise: 350000, netProfitPaise: 150000 });
      // Supplier payments never decide COGS: the COGS line is 50% because 50% of the INVOICE was collected.
      expect(row(cash, "COGS")).toBe(300000);
      expect(row(cash, "EXPENSE")).toBe(50000);
    } finally {
      w.repository.close();
    }
  });

  it("COGS follows the sale's collection, not the supplier payment", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      const billId = ownerBill(w, "2026-01-12");
      w.repository.recordSupplierPayment({ billId, amountPaise: 708000, paidOn: "2026-01-20" }); // supplier paid in full, customer paid nothing
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(row(cash, "COGS")).toBe(0);
      expect(cash.totalIncomePaise).toBe(0);
      expect(row(cash, "EXPENSE")).toBe(100000);
    } finally {
      w.repository.close();
    }
  });
});

describe("cash view: convergence, rounding and periods", () => {
  it("full collection recognises exactly the accrual figures (every P&L total equal)", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      const billId = ownerBill(w, "2026-01-12");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-01-20" });
      w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-01-20" });

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash).toEqual({ ...accrual, basis: "CASH" });
      expect(cash).toMatchObject({ grossSalesPaise: 1180000, gstOnSalesPaise: 180000, totalIncomePaise: 1000000, netProfitPaise: 300000 });
    } finally {
      w.repository.close();
    }
  });

  it("many odd payments (1, 999, 2500, remainder) land exactly with no paise lost", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      const remainder = 1180000 - 1 - 999 - 2500;
      for (const amount of [1, 999, 2500, remainder]) {
        w.repository.recordPayment("INV-1", amount, "2026-01-20");
        // Never over the accrual figure at any point.
        expect(w.repository.getProfitAndLoss({ basis: "CASH" }).totalIncomePaise).toBeLessThanOrEqual(1000000);
      }
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash).toEqual({ ...accrual, basis: "CASH" });
      expect(sumOf(w.repository, "SALES")).toBe(1000000);
      expect(sumOf(w.repository, "COGS")).toBe(600000);
      expect(sumOf(w.repository, "OUTPUT_CGST") + sumOf(w.repository, "OUTPUT_SGST")).toBe(180000);
      // Every individual P&L recognition is non-negative (INVENTORY legitimately goes down when stock is sold).
      expect(w.repository.deriveCashView().recognitions.filter((r) => r.account !== "INVENTORY").every((r) => r.amountPaise >= 0)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("period split: January and February each show their own collections and together equal the fully collected figures", () => {
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      w.repository.recordPayment("INV-1", 590000, "2026-02-10");

      const jan = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" });
      const feb = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" });
      expect(jan).toMatchObject({ grossSalesPaise: 590000, gstOnSalesPaise: 90000, totalIncomePaise: 500000, totalExpensesPaise: 300000 });
      expect(feb).toMatchObject({ grossSalesPaise: 590000, gstOnSalesPaise: 90000, totalIncomePaise: 500000, totalExpensesPaise: 300000 });
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(jan.totalIncomePaise + feb.totalIncomePaise).toBe(accrual.totalIncomePaise);
      expect(jan.totalExpensesPaise + feb.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
      expect(jan.grossSalesPaise + feb.grossSalesPaise).toBe(accrual.grossSalesPaise);
      expect(jan.gstOnSalesPaise + feb.gstOnSalesPaise).toBe(accrual.gstOnSalesPaise);
      // The accrual sale sits in January only; February's accrual P&L is empty while its cash P&L has the collection.
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL", fromDate: "2026-02-01", toDate: "2026-02-28" }).totalIncomePaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a payment belongs to its IST date: 19:00 UTC on 31 Jan is already 1 Feb in India", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      at("2026-01-31T19:00:00.000Z");
      w.repository.recordPayment("INV-1", 590000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" }).totalIncomePaise).toBe(0);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-01" }).totalIncomePaise).toBe(500000);
    } finally {
      w.repository.close();
    }
  });

  it("an unpaid credit invoice has no cash-view footprint at all", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      expect(w.repository.getProfitAndLoss({ basis: "CASH" })).toMatchObject({
        income: [], expenses: [], totalIncomePaise: 0, totalExpensesPaise: 0, netProfitPaise: 0, grossSalesPaise: 0, gstOnSalesPaise: 0,
      });
    } finally {
      w.repository.close();
    }
  });

  it("filters the cash view by business", () => {
    const w = world();
    try {
      const other = w.repository.createBusiness({ companyId: w.companyId, name: "Other" });
      ownerInvoice(w, "INV-1", "2026-01-10");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      expect(w.repository.getProfitAndLoss({ basis: "CASH", businessId: w.businessId }).totalIncomePaise).toBe(500000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", businessId: other }).totalIncomePaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("cash view: documents paid at once and reversals", () => {
  it("a paid-at-once (CASH) invoice appears in the cash view in full at its document date", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-C", "2026-01-10", "CASH");
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" })).toMatchObject({
        grossSalesPaise: 1180000, gstOnSalesPaise: 180000, totalIncomePaise: 1000000, totalExpensesPaise: 600000,
      });
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" }).totalIncomePaise).toBe(0);
      expect(w.repository.getProfitAndLoss({ basis: "CASH" })).toEqual({ ...w.repository.getProfitAndLoss({ basis: "ACCRUAL" }), basis: "CASH" });
    } finally {
      w.repository.close();
    }
  });

  it("cancelling a paid-at-once invoice fully negates it in the cash view, on the reversal's own date", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-C", "2026-01-10", "CASH");
      at("2026-02-15T06:00:00.000Z");
      w.repository.cancelInvoice("INV-C");
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" }).totalIncomePaise).toBe(1000000);
      const feb = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" });
      expect(feb.totalIncomePaise).toBe(-1000000);
      expect(feb.grossSalesPaise).toBe(-1180000);
      const all = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(all).toMatchObject({ totalIncomePaise: 0, totalExpensesPaise: 0, grossSalesPaise: 0, gstOnSalesPaise: 0 });
    } finally {
      w.repository.close();
    }
  });

  it("cancelling an unpaid credit invoice has no effect in the cash view (ratio 0)", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      at("2026-02-15T06:00:00.000Z");
      w.repository.cancelInvoice("INV-1");
      expect(w.repository.getProfitAndLoss({ basis: "CASH" })).toMatchObject({ income: [], expenses: [], netProfitPaise: 0 });
    } finally {
      w.repository.close();
    }
  });

  it("a paid-at-once expense is recognised in full on its expense date", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      const categoryId = w.repository.createExpenseCategory({ companyId: w.companyId, name: "Rent" });
      const expense = w.repository.createExpense({
        businessId: w.businessId, categoryId, number: "EX-1", expenseDate: "2026-01-05", description: "Rent",
        amountPaise: 10000, paymentAccount: "CASH",
      });
      w.repository.finalizeExpense(expense.id);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" }).totalExpensesPaise).toBe(10000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01" }).totalExpensesPaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("cash view: credit notes (current behaviour, pinned; owner decision pending)", () => {
  // The uniform rule folds a credit note's lines into its invoice's lines. No refund is modelled.
  function creditNote(w: World, id: string): void {
    w.repository.saveCreditNote({
      id, invoiceId: "INV-1", number: id, reason: "Return", status: "DRAFT",
      lines: [{ itemId: w.goodsId, description: "Goods", quantity: 2, unitPricePaise: 100000 }],
    });
    w.repository.finalizeCreditNote(id);
  }

  it("a note raised before collection is recognised pro rata with later collections (against the ORIGINAL invoice total)", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      creditNote(w, "CN-1"); // 2 units back: SALES -200000, GST -36000, COGS -120000
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 590000); // half of the original 1,180,000
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(accrual).toMatchObject({ totalIncomePaise: 800000, totalExpensesPaise: 480000, gstOnSalesPaise: 144000 });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      // Half of the net-of-note lines. Gross stays the cash actually received, so it no longer equals net + GST.
      expect(cash).toMatchObject({ totalIncomePaise: 400000, totalExpensesPaise: 240000, gstOnSalesPaise: 72000, grossSalesPaise: 590000 });
    } finally {
      w.repository.close();
    }
  });

  it("a note raised after full collection restates the earlier collection periods retroactively (dated to the payments)", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 1180000);
      const before = w.repository.getProfitAndLoss({ basis: "CASH" });
      at("2026-02-10T06:00:00.000Z");
      creditNote(w, "CN-1");
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise).toBe(800000);
      expect(before.totalIncomePaise).toBe(1000000);
      // The note is folded into the invoice's lines, so the payment already recognised is re-measured
      // against the lines as they stand now. January (the collection month) changes after the fact;
      // February (the note's own month) shows nothing. Pinned as-is; an owner decision is pending.
      expect(w.repository.getProfitAndLoss({ basis: "CASH" }).totalIncomePaise).toBe(800000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" }).totalIncomePaise).toBe(800000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" }).totalIncomePaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("cash view: default basis resolution", () => {
  function twoCompanies(): { repository: AccountingRepository; cashBiz: string; accrualBiz: string } {
    const repository = new AccountingRepository();
    const seed = (basis: "CASH" | "ACCRUAL", name: string): string => {
      const companyId = repository.createCompany({ name, accountingBasis: basis });
      const businessId = repository.createBusiness({ companyId, name: `${name} Books` });
      const customerId = repository.createCustomer({ companyId, name: "Cust" });
      repository.saveDraft({
        id: `INV-${name}`, number: `INV-${name}`, businessId, customerId, invoiceDate: "2026-01-10", paymentAccount: "RECEIVABLES", status: "DRAFT",
        lines: [{ description: "Service", quantity: 1, unitPricePaise: 10000 }],
      });
      repository.finalizeInvoice(`INV-${name}`);
      repository.recordPayment(`INV-${name}`, 4000);
      return businessId;
    };
    const cashBiz = seed("CASH", "CashCo");
    const accrualBiz = seed("ACCRUAL", "AccrualCo");
    return { repository, cashBiz, accrualBiz };
  }

  it("a CASH company's business defaults to cash, an ACCRUAL one to accrual, consolidated to accrual; explicit basis overrides", () => {
    const { repository, cashBiz, accrualBiz } = twoCompanies();
    try {
      expect(repository.getProfitAndLoss({ businessId: cashBiz })).toMatchObject({ basis: "CASH", totalIncomePaise: 4000 });
      expect(repository.getProfitAndLoss({ businessId: accrualBiz })).toMatchObject({ basis: "ACCRUAL", totalIncomePaise: 10000 });
      expect(repository.getProfitAndLoss()).toMatchObject({ basis: "ACCRUAL", totalIncomePaise: 20000 });
      expect(repository.getProfitAndLoss({ fromDate: "2026-01-01" })).toMatchObject({ basis: "ACCRUAL" });
      expect(repository.getProfitAndLoss({ businessId: cashBiz, basis: "ACCRUAL" })).toMatchObject({ basis: "ACCRUAL", totalIncomePaise: 10000 });
      expect(repository.getProfitAndLoss({ businessId: accrualBiz, basis: "CASH" })).toMatchObject({ basis: "CASH", totalIncomePaise: 4000 });
      expect(repository.getProfitAndLoss({ basis: "CASH" })).toMatchObject({ basis: "CASH", totalIncomePaise: 8000 });
    } finally {
      repository.close();
    }
  });

  it("rejects an unknown basis", () => {
    const { repository } = twoCompanies();
    try {
      expect(() => repository.getProfitAndLoss({ basis: "BOGUS" as never })).toThrow("Basis must be CASH or ACCRUAL");
    } finally {
      repository.close();
    }
  });

  it("is exposed on /reports/profit-and-loss as a strict optional query parameter", async () => {
    const { repository, cashBiz } = twoCompanies();
    const app = buildApi(repository);
    try {
      const get = async (url: string) => app.inject({ method: "GET", url });
      expect((await get(`/reports/profit-and-loss?businessId=${cashBiz}`)).json<ProfitAndLossReport>()).toMatchObject({ basis: "CASH", totalIncomePaise: 4000 });
      expect((await get(`/reports/profit-and-loss?businessId=${cashBiz}&basis=ACCRUAL`)).json<ProfitAndLossReport>()).toMatchObject({ basis: "ACCRUAL", totalIncomePaise: 10000 });
      expect((await get("/reports/profit-and-loss?basis=CASH")).json<ProfitAndLossReport>()).toMatchObject({ basis: "CASH", totalIncomePaise: 8000 });
      expect((await get("/reports/profit-and-loss?basis=NOPE")).statusCode).toBe(400);
      expect((await get("/reports/profit-and-loss?bogus=1")).statusCode).toBe(400);
      // basis belongs to the P&L only: the other period report still rejects it.
      expect((await get("/reports/general-ledger?basis=CASH")).statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});

describe("cash view is derived, never posted", () => {
  it("writes no journal entries or lines: counts are unchanged by every cash report call", async () => {
    const w = world("CASH");
    const app = buildApi(w.repository);
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      ownerInvoice(w, "INV-C", "2026-01-11", "CASH");
      const billId = ownerBill(w, "2026-01-12");
      w.repository.recordPayment("INV-1", 590000, "2026-01-20");
      w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-01-20" });

      const before = counts(w.repository);
      expect(before.entries).toBeGreaterThan(0);
      const tbBefore = w.repository.getTrialBalance();

      w.repository.getProfitAndLoss({ basis: "CASH" });
      w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" });
      w.repository.getProfitAndLoss({ basis: "CASH", businessId: w.businessId });
      w.repository.getProfitAndLoss({ businessId: w.businessId }); // defaults to CASH for this company
      w.repository.deriveCashView();
      await app.inject({ method: "GET", url: "/reports/profit-and-loss?basis=CASH" });
      await app.inject({ method: "GET", url: `/reports/profit-and-loss?businessId=${w.businessId}` });

      expect(counts(w.repository)).toEqual(before);
      expect(w.repository.getTrialBalance()).toEqual(tbBefore);
      // The company is CASH-basis but posting was accrual-always: the ledger still holds the full invoices.
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise).toBe(2000000);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});

describe("payment dates: a payment can be entered after the fact with its real date", () => {
  /** Invoice dated 10 Jan, bill dated 12 Jan; both are entered "today" (real clock, no fake timers). */
  function entered(): { w: World; billId: string } {
    const w = world();
    ownerInvoice(w, "INV-1", "2026-01-10");
    return { w, billId: ownerBill(w, "2026-01-12") };
  }
  const cashIncome = (w: World, fromDate: string, toDate: string): number =>
    w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate }).totalIncomePaise;
  const cashExpense = (w: World, fromDate: string, toDate: string): number =>
    w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate }).totalExpensesPaise;
  const entryDateOf = (w: World, id: string): string =>
    (w.repository.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(id) as { entry_date: string }).entry_date;

  it("ACCEPTANCE customer payment: Rs 5,900 collected on 14 Feb against a January invoice lands in the February cash P&L only", () => {
    const { w } = entered();
    try {
      const payment = w.repository.recordPayment("INV-1", 590000, "2026-02-14");
      expect(cashIncome(w, "2026-01-01", "2026-01-31")).toBe(0);
      expect(cashIncome(w, "2026-02-01", "2026-02-28")).toBe(500000);
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" })).toMatchObject({
        grossSalesPaise: 590000, gstOnSalesPaise: 90000, totalExpensesPaise: 300000,
      });
      // The stored date and the ledger date agree.
      expect(istDateOf(payment.paidAt)).toBe("2026-02-14");
      expect(entryDateOf(w, `je-payment-${payment.id}`)).toBe("2026-02-14");
      expect(w.repository.listPayments("INV-1")[0]?.paidAt).toBe(payment.paidAt);
      // Accrual is untouched: the sale stays in January.
      expect(w.repository.getProfitAndLoss({ basis: "ACCRUAL", fromDate: "2026-01-01", toDate: "2026-01-31" }).totalIncomePaise).toBe(1000000);
    } finally {
      w.repository.close();
    }
  });

  it("ACCEPTANCE supplier payment: Rs 3,540 paid on 5 Mar against a January bill lands in the March cash P&L only", () => {
    const { w, billId } = entered();
    try {
      const payment = w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-03-05" });
      expect(cashExpense(w, "2026-01-01", "2026-02-28")).toBe(0);
      expect(cashExpense(w, "2026-03-01", "2026-03-31")).toBe(50000);
      expect(istDateOf(payment.paidAt)).toBe("2026-03-05");
      expect(entryDateOf(w, `je-supplier-payment-${payment.id}`)).toBe("2026-03-05");
      expect(w.repository.listSupplierPayments({ billId })[0]?.paidAt).toBe(payment.paidAt);
    } finally {
      w.repository.close();
    }
  });

  it("the same date reaches every date-range report: general ledger, trial balance and balance sheet", () => {
    const { w, billId } = entered();
    try {
      const customerPayment = w.repository.recordPayment("INV-1", 590000, "2026-02-14");
      const supplierPayment = w.repository.recordSupplierPayment({ billId, amountPaise: 354000, paidOn: "2026-02-20" });
      const ids = (fromDate: string, toDate: string): string[] =>
        [...new Set(w.repository.getGeneralLedger({ fromDate, toDate }).map((r) => r.journalEntryId))];
      expect(ids("2026-02-01", "2026-02-28").sort()).toEqual(
        [`je-payment-${customerPayment.id}`, `je-supplier-payment-${supplierPayment.id}`].sort(),
      );
      expect(ids("2026-02-14", "2026-02-14")).toEqual([`je-payment-${customerPayment.id}`]);
      expect(ids("2026-01-01", "2026-01-31")).not.toContain(`je-payment-${customerPayment.id}`);
      const cashAsAt = (asAtDate: string): number => {
        const row = w.repository.getTrialBalance({ asAtDate }).find((r) => r.account === "CASH");
        return (row?.debitPaise ?? 0) - (row?.creditPaise ?? 0);
      };
      expect(cashAsAt("2026-02-13")).toBe(0);
      expect(cashAsAt("2026-02-14")).toBe(590000);
      expect(cashAsAt("2026-02-20")).toBe(590000 - 354000);
      expect(w.repository.getBalanceSheet({ asAtDate: "2026-02-13" }).assets.find((r) => r.account === "CASH")).toBeUndefined();
    } finally {
      w.repository.close();
    }
  });

  it("no date given: both payments are stamped with the moment of recording, exactly as before", () => {
    const { w, billId } = entered();
    try {
      const before = Date.now();
      const customerPayment = w.repository.recordPayment("INV-1", 590000);
      const supplierPayment = w.repository.recordSupplierPayment({ billId, amountPaise: 354000 });
      const after = Date.now();
      for (const [paidAt, entryId] of [
        [customerPayment.paidAt, `je-payment-${customerPayment.id}`],
        [supplierPayment.paidAt, `je-supplier-payment-${supplierPayment.id}`],
      ] as const) {
        expect(Date.parse(paidAt)).toBeGreaterThanOrEqual(before);
        expect(Date.parse(paidAt)).toBeLessThanOrEqual(after);
        expect(entryDateOf(w, entryId)).toBe(istDateOf(paidAt));
      }
    } finally {
      w.repository.close();
    }
  });

  it("a dated payment is a full ISO instant that sorts alongside undated ones", () => {
    const { w } = entered();
    try {
      const old = w.repository.recordPayment("INV-1", 100000, "2026-02-14");
      const now = w.repository.recordPayment("INV-1", 100000);
      expect(old.paidAt).toBe("2026-02-14T06:30:00.000Z");
      expect(w.repository.listPayments("INV-1").map((p) => p.id)).toEqual([old.id, now.id]);
    } finally {
      w.repository.close();
    }
  });

  it("refuses an impossible or malformed date, for customers and suppliers, and writes nothing", () => {
    const { w, billId } = entered();
    try {
      const before = counts(w.repository);
      const rows = (): number =>
        (w.repository.db.prepare("SELECT (SELECT COUNT(*) FROM payments) + (SELECT COUNT(*) FROM supplier_payments) AS n").get() as { n: number }).n;
      for (const bad of ["2026-02-30", "2026-13-01", "2025-02-29", "14/02/2026", "2026-2-3", "yesterday", "2026-02-14T10:00:00Z", ""]) {
        expect(() => w.repository.recordPayment("INV-1", 1000, bad)).toThrow(RepositoryValidationError);
        expect(() => w.repository.recordPayment("INV-1", 1000, bad)).toThrow("Payment date must be a real date");
        expect(() => w.repository.recordSupplierPayment({ billId, amountPaise: 1000, paidOn: bad })).toThrow(RepositoryValidationError);
      }
      expect(rows()).toBe(0);
      expect(counts(w.repository)).toEqual(before);
      // A leap day is a real date.
      expect(w.repository.recordPayment("INV-1", 1000, "2028-02-29").paidAt).toBe("2028-02-29T06:30:00.000Z");
    } finally {
      w.repository.close();
    }
  });

  it("over-paying is still refused when a date is given", () => {
    const { w } = entered();
    try {
      expect(() => w.repository.recordPayment("INV-1", 1180001, "2026-02-14")).toThrow("cannot exceed");
    } finally {
      w.repository.close();
    }
  });

  it("API: accepts paidOn on both payment routes and answers 400 (not 500) for a bad date", async () => {
    const { w, billId } = entered();
    const app = buildApi(w.repository);
    try {
      const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });

      const good = await post("/invoices/INV-1/payments", { amountPaise: 590000, paidOn: "2026-02-14" });
      expect(good.statusCode).toBe(201);
      expect(istDateOf(good.json<{ paidAt: string }>().paidAt)).toBe("2026-02-14");
      const goodSupplier = await post("/supplier-payments", { billId, amountPaise: 354000, paidOn: "2026-03-05" });
      expect(goodSupplier.statusCode).toBe(201);
      expect(istDateOf(goodSupplier.json<{ paidAt: string }>().paidAt)).toBe("2026-03-05");
      expect(cashIncome(w, "2026-02-01", "2026-02-28")).toBe(500000);
      expect(cashExpense(w, "2026-03-01", "2026-03-31")).toBe(50000);

      const before = counts(w.repository);
      for (const bad of ["2026-02-30", "14/02/2026", "tomorrow", 20260214, null]) {
        expect((await post("/invoices/INV-1/payments", { amountPaise: 1000, paidOn: bad })).statusCode).toBe(400);
        expect((await post("/supplier-payments", { billId, amountPaise: 1000, paidOn: bad })).statusCode).toBe(400);
      }
      expect(counts(w.repository)).toEqual(before);

      // No date at all still works.
      expect((await post("/invoices/INV-1/payments", { amountPaise: 1000 })).statusCode).toBe(201);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
