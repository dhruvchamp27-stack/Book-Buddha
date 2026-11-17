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

describe("cash view: credit notes re-base the remainder (S2-2, S4-3, S4-6; figures CONFIRMED)", () => {
  // The uniform rule folds a credit note's lines into its invoice's lines. No refund is modelled.
  function creditNote(w: World, id: string): void {
    w.repository.saveCreditNote({
      id, invoiceId: "INV-1", number: id, reason: "Return", status: "DRAFT",
      lines: [{ itemId: w.goodsId, description: "Goods", quantity: 2, unitPricePaise: 100000 }],
    });
    w.repository.finalizeCreditNote(id);
  }

  /**
   * S2-2: a credit note RE-BASES the remainder. The denominator is what the customer is actually
   * being asked to pay - the invoice LESS its credit notes - not the original bill.
   *
   * FIGURES CHANGED HERE by that decision (owner to confirm):
   *   income    400000 -> 500000
   *   expenses  240000 -> 300000
   *   GST        72000 ->  90000
   * The invoice is 1,180,000 with a 236,000 note, so 944,000 is owed; 590,000 of that is 62.5%,
   * and 62.5% of the net lines (800,000 / 480,000 / 144,000) gives the new figures. The old
   * denominator was the original 1,180,000, making the share 50%.
   */
  it("ACCEPTANCE re-base: a note before collection, later collections measured against what is OWED", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      creditNote(w, "CN-1"); // 2 units back: SALES -200000, GST -36000, COGS -120000
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 590000); // 62.5% of the 944,000 now owed
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      expect(accrual).toMatchObject({ totalIncomePaise: 800000, totalExpensesPaise: 480000, gstOnSalesPaise: 144000 });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      // Gross stays the cash actually received, so it no longer equals net + GST.
      expect(cash).toMatchObject({ totalIncomePaise: 500000, totalExpensesPaise: 300000, gstOnSalesPaise: 90000, grossSalesPaise: 590000 });
    } finally {
      w.repository.close();
    }
  });

  /**
   * THE property S1-6 demands, and the one a net denominator silently broke: a note must not move
   * a month that has already been reported.
   *
   * The trap is mixed margins. Dividing by the net total re-measures EVERY earlier payment
   * against the new lines, so returning a line that carried no COGS raised the COGS share of the
   * earlier payment - January's cash expenses rose from 120,000 to 180,000 after a FEBRUARY note,
   * even though January's cash and goods never changed. The event-ordered walk keeps the note's
   * effect entirely in the future.
   */
  it("ACCEPTANCE mixed margins: a note NEVER moves a month already reported", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      // Goods 1,000,000 (COGS 600,000) plus freight 500,000 which carries NO cost at all.
      w.repository.saveDraft({
        id: "INV-M", number: "INV-M", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-01-10", paymentAccount: "RECEIVABLES", status: "DRAFT",
        taxType: "NONE", taxRateBasisPoints: 0,
        lines: [
          { itemId: w.goodsId, description: "Goods", quantity: 10, unitPricePaise: 100000 },
          { itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 },
        ],
      });
      w.repository.finalizeInvoice("INV-M");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-M", 300000);
      const january = () => w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" });
      const before = january();
      expect(before).toMatchObject({ totalIncomePaise: 300000, totalExpensesPaise: 120000 });

      // February: the freight line is credited - the line with no COGS behind it.
      at("2026-02-10T06:00:00.000Z");
      w.repository.saveCreditNote({
        id: "CN-M", invoiceId: "INV-M", number: "CN-M", reason: "Freight waived", status: "DRAFT",
        lines: [{ itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 }],
      });
      w.repository.finalizeCreditNote("CN-M");

      // January is byte-for-byte what it was. This is the assertion that fails on a net total.
      expect(january()).toMatchObject({ totalIncomePaise: before.totalIncomePaise, totalExpensesPaise: before.totalExpensesPaise });
      expect(january().totalExpensesPaise).toBe(120000);
      // February recognises nothing by itself: the note is not a cash event.
      expect(w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" }).totalIncomePaise).toBe(0);

      // And paying off the re-based remainder still converges on accrual.
      at("2026-03-10T06:00:00.000Z");
      w.repository.recordPayment("INV-M", 700000); // 1,500,000 billed - 500,000 credited - 300,000 paid
      expect(() => w.repository.recordPayment("INV-M", 1)).toThrow(/outstanding balance of 0 paise/);
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash.totalIncomePaise).toBe(accrual.totalIncomePaise);
      expect(cash.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
    } finally {
      w.repository.close();
    }
  });

  /**
   * S4-3, RULED BY THE OWNER 2026-11-17. AMENDS S2-2. When the credit note is itself the
   * settling event - it exactly equals what was left unpaid - no payment follows it, so the COGS
   * behind the goods the customer KEPT used to be stranded: cash expenses 400,000 against an
   * accrual 600,000.
   *
   * The owner ruled that a note which CLEARS what is owed is a settlement event. S2-2 still holds
   * for the note's own lines - the returned goods never hit the cash P&L on the note date - but
   * the lines the customer KEPT are now fully settled, so their remaining recognition lands in
   * the note's month. S1-6 is untouched: January is not rewritten. The consequence the owner
   * accepted is visible below - February shows a 200,000 expense on a day no money moved.
   */
  it("ACCEPTANCE settling note: a note that clears the balance trues up in its own month (S4-3)", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      // Goods 1,000,000 (COGS 600,000) plus freight 500,000 with no cost. Total 1,500,000.
      w.repository.saveDraft({
        id: "INV-T", number: "INV-T", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-01-10", paymentAccount: "RECEIVABLES", status: "DRAFT",
        taxType: "NONE", taxRateBasisPoints: 0,
        lines: [
          { itemId: w.goodsId, description: "Goods", quantity: 10, unitPricePaise: 100000 },
          { itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 },
        ],
      });
      w.repository.finalizeInvoice("INV-T");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-T", 1000000, "2026-01-20"); // everything but the freight
      at("2026-02-10T06:00:00.000Z");
      // Allowed: it is exactly the 500,000 still unpaid.
      w.repository.saveCreditNote({
        id: "CN-T", invoiceId: "INV-T", number: "CN-T", reason: "Freight waived", status: "DRAFT",
        lines: [{ itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 }],
      });
      w.repository.finalizeCreditNote("CN-T");

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(accrual).toMatchObject({ totalIncomePaise: 1000000, totalExpensesPaise: 600000 });
      // THE POINT: the cash view now CONVERGES on accrual once nothing is owed, whether the
      // last settling event was a payment or a note.
      expect(cash.totalIncomePaise).toBe(1000000);
      expect(cash.totalExpensesPaise).toBe(600000);
      expect(cash.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
      // Nothing is owed, so no later cash could ever have closed the gap.
      expect(() => w.repository.recordPayment("INV-T", 1)).toThrow(/outstanding balance of 0 paise/);

      const period = (fromDate: string, toDate: string) => w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate });
      // January is byte-for-byte what it was before the note: S1-6 is not bent to pay for S4-3.
      expect(period("2026-01-01", "2026-01-31")).toMatchObject({ totalIncomePaise: 1000000, totalExpensesPaise: 400000 });
      // February carries the true-up alone - 200,000 of cost, and no income, on a day no money
      // moved. The note's OWN lines still recognise nothing, which is S2-2 intact.
      expect(period("2026-02-01", "2026-02-28")).toMatchObject({ totalIncomePaise: 0, totalExpensesPaise: 200000 });
    } finally {
      w.repository.close();
    }
  });

  /**
   * The property that makes the re-basing right, and the one the old denominator could never
   * satisfy: once the customer has paid everything they owe, the cash view must equal the accrual
   * view. Against the original bill, settling the net 944,000 of a 1,180,000 invoice gave only
   * 80% of the net lines - 640,000 of income against an accrual 800,000 - and the gap never
   * closed, no matter how much was collected.
   */
  it("ACCEPTANCE convergence: settling the re-based balance in full lands on the accrual figures", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-1", "2026-01-10");
      creditNote(w, "CN-1");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 590000);
      at("2026-02-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 354000); // the rest of the 944,000 owed
      // Nothing is left to pay, and nothing further may be paid.
      expect(() => w.repository.recordPayment("INV-1", 1)).toThrow(/outstanding balance of 0 paise/);

      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash.totalIncomePaise).toBe(accrual.totalIncomePaise);
      expect(cash.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
      expect(cash.gstOnSalesPaise).toBe(accrual.gstOnSalesPaise);
      expect(cash.netProfitPaise).toBe(accrual.netProfitPaise);
      // And the recognition is split across the two collection months, never dated to the note.
      const jan = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-01-01", toDate: "2026-01-31" });
      const feb = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-02-01", toDate: "2026-02-28" });
      expect(jan.totalIncomePaise + feb.totalIncomePaise).toBe(accrual.totalIncomePaise);
      expect(jan.totalIncomePaise).toBe(500000);
      expect(feb.totalIncomePaise).toBe(300000);
    } finally {
      w.repository.close();
    }
  });

  /**
   * This test used to pin the OPPOSITE behaviour: a note raised after full collection was folded
   * into the invoice's lines, so the already-recognised payment was re-measured and JANUARY - a
   * month that had been reported and closed - silently changed from 1,000,000 to 800,000, while
   * February showed nothing. That directly contradicts S1-6 ("a previously collected invoice:
   * NEVER rewrite an earlier month's cash figures").
   *
   * R3 resolves it by PREVENTION rather than by re-dating: a credit note may no longer exceed
   * what is still unpaid, so the situation cannot arise. The same choice cancelInvoice already
   * makes. The cost is that a genuine return-after-payment has to wait for the refund path,
   * which is deferred - and that gap is the owner's to close, so it is named in the message.
   */
  /**
   * S4-6, the owner's acceptance figures for the refund path (2026-11-17). This test USED to
   * assert that the note was refused outright: under S3-3 a return after full payment had
   * nowhere to go, because crediting drove RECEIVABLES negative and no refund path existed.
   * The owner ruled the path should be built, so the note is now allowed and the money owed back
   * is a liability.
   *
   * Invoice Rs 11,800 paid in full on 20 Jan. Two of ten units come back on 10 Feb (Rs 2,360,
   * cost Rs 1,200). Refunded in cash on 5 Mar. The owner chose the refund month over the month
   * the goods returned, which is S1-6: cash reports follow the money.
   */
  it("ACCEPTANCE refund: a return after full payment reduces the month the money went BACK (S4-6)", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      const ledger = (account: string): number => {
        const row = w.repository.getTrialBalance().find((r) => r.account === account);
        return (row?.debitPaise ?? 0) - (row?.creditPaise ?? 0);
      };
      const period = (fromDate: string, toDate: string) => w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate });

      ownerInvoice(w, "INV-1", "2026-01-10");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-1", 1180000);
      // January: the whole invoice, because the whole invoice was collected.
      expect(period("2026-01-01", "2026-01-31")).toMatchObject({
        totalIncomePaise: 1000000, gstOnSalesPaise: 180000, totalExpensesPaise: 600000,
      });

      at("2026-02-10T06:00:00.000Z");
      creditNote(w, "CN-1"); // 2 units back: 236,000 inclusive, COGS 120,000
      // The money owed back is a LIABILITY. Receivables stop at zero rather than going negative
      // and hiding behind getReceivables' "outstanding > 0" filter, which is what S3-3 feared.
      expect(ledger("RECEIVABLES")).toBe(0);
      expect(-ledger("CUSTOMER_CREDITS")).toBe(236000);
      expect(w.repository.getCreditNoteBalance("CN-1")).toMatchObject({ refundablePaise: 236000, dischargedPaise: 0, outstandingPaise: 236000 });
      // February recognises NOTHING: the goods are back but no money has moved.
      expect(period("2026-02-01", "2026-02-28")).toMatchObject({ totalIncomePaise: 0, totalExpensesPaise: 0 });
      // And January is untouched, which was the whole point of the old test and still is.
      expect(period("2026-01-01", "2026-01-31").totalIncomePaise).toBe(1000000);

      at("2026-03-05T06:00:00.000Z");
      w.repository.recordCreditNoteRefund({ id: "RF-1", creditNoteId: "CN-1", amountPaise: 236000, refundedOn: "2026-03-05", paymentAccount: "CASH" });

      // MARCH carries the reduction - the owner's figures.
      const march = period("2026-03-01", "2026-03-31");
      expect(march.totalIncomePaise).toBe(-200000);
      expect(march.gstOnSalesPaise).toBe(-36000);
      expect(march.totalExpensesPaise).toBe(-120000);
      // January still untouched after the refund: S1-6 holds end to end.
      expect(period("2026-01-01", "2026-01-31").totalIncomePaise).toBe(1000000);

      // Year to date now equals accrual: 8,000 income, 1,440 GST, 4,800 cost.
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(accrual).toMatchObject({ totalIncomePaise: 800000, gstOnSalesPaise: 144000, totalExpensesPaise: 480000 });
      expect(cash.totalIncomePaise).toBe(800000);
      expect(cash.gstOnSalesPaise).toBe(144000);
      expect(cash.totalExpensesPaise).toBe(480000);
      // The liability is discharged, and the cash actually went out.
      expect(ledger("CUSTOMER_CREDITS")).toBe(0);
      expect(w.repository.getCreditNoteBalance("CN-1").outstandingPaise).toBe(0);
      expect(() => w.repository.recordCreditNoteRefund({ id: "RF-2", creditNoteId: "CN-1", amountPaise: 1, refundedOn: "2026-03-06", paymentAccount: "CASH" }))
        .toThrow(/0 paise left to give back/);
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

/**
 * THE SPLIT NOTE - the one shape every other test misses. S4-6 covers a note that is wholly
 * refundable, S4-3 one that is wholly offset; this is a note that is BOTH, which is the only
 * case that exercises the pro-rata division of a note's lines between what came off the bill
 * and what is owed back. That division is the assistant's modelling choice, so the figures here
 * are UNCONFIRMED until the owner works them by hand.
 *
 * Invoice Rs 15,000 - goods Rs 10,000 costing Rs 6,000, plus freight Rs 5,000 carrying no cost.
 * Rs 14,000 collected in January. In February the freight is credited: only Rs 1,000 was still
 * owed, so Rs 1,000 comes off the bill and Rs 4,000 becomes money owed back, refunded in two
 * parts across March and April.
 *
 * Worked by hand:
 *   January  - 14/15 of everything: income 14,000, cost 5,600.
 *   February - the note clears the Rs 1,000 still owed, so S4-3 trues up. Income does not move
 *              (the Rs 1,000 offset cancels the Rs 1,000 of income it had already recognised),
 *              but the cost of the goods the customer KEPT lands: +400.
 *   March +   - the refunds give back 4/5 of a Rs 5,000 freight line: income -4,000 in total.
 *   April
 *   Totals   - income 10,000, cost 6,000, which is exactly the accrual position.
 */
describe("cash view: a note that is PART offset and PART refundable (figures unconfirmed)", () => {
  it("divides the note pro rata and still converges on accrual", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      const period = (fromDate: string, toDate: string) =>
        w.repository.getProfitAndLoss({ basis: "CASH", fromDate, toDate });

      w.repository.saveDraft({
        id: "INV-S", number: "INV-S", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-01-10", paymentAccount: "RECEIVABLES", status: "DRAFT",
        taxType: "NONE", taxRateBasisPoints: 0,
        lines: [
          { itemId: w.goodsId, description: "Goods", quantity: 10, unitPricePaise: 100000 },
          { itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 },
        ],
      });
      w.repository.finalizeInvoice("INV-S");

      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-S", 1400000, "2026-01-20");
      // 14/15 of the invoice: income 1,400,000 and cost 560,000.
      expect(period("2026-01-01", "2026-01-31")).toMatchObject({ totalIncomePaise: 1400000, totalExpensesPaise: 560000 });

      at("2026-02-10T06:00:00.000Z");
      w.repository.saveCreditNote({
        id: "CN-S", invoiceId: "INV-S", number: "CN-S", reason: "Freight waived", status: "DRAFT",
        lines: [{ itemId: w.serviceItemId, description: "Freight", quantity: 1, unitPricePaise: 500000 }],
      });
      w.repository.finalizeCreditNote("CN-S");

      // THE SPLIT: only 100,000 was still owed, so that much comes off the bill and 400,000 is
      // owed back. This is the assertion the other tests cannot make.
      expect(w.repository.getCreditNoteBalance("CN-S")).toMatchObject({ refundablePaise: 400000, outstandingPaise: 400000 });

      // February: the note clears the balance, so S4-3 trues up the cost of the goods KEPT.
      // Income does not move - the offset exactly cancels the income already recognised for it.
      expect(period("2026-02-01", "2026-02-28")).toMatchObject({ totalIncomePaise: 0, totalExpensesPaise: 40000 });
      // January is untouched by the note, which is S1-6.
      expect(period("2026-01-01", "2026-01-31")).toMatchObject({ totalIncomePaise: 1400000, totalExpensesPaise: 560000 });

      // The refund goes back in two parts, so the cumulative ladder has to telescope.
      at("2026-03-05T06:00:00.000Z");
      w.repository.recordCreditNoteRefund({ id: "RF-1", creditNoteId: "CN-S", amountPaise: 150000, refundedOn: "2026-03-05", paymentAccount: "CASH" });
      at("2026-04-05T06:00:00.000Z");
      w.repository.recordCreditNoteRefund({ id: "RF-2", creditNoteId: "CN-S", amountPaise: 250000, refundedOn: "2026-04-05", paymentAccount: "BANK" });

      // 4/5 of the 500,000 freight line handed back, split across the two refund months.
      const march = period("2026-03-01", "2026-03-31");
      const april = period("2026-04-01", "2026-04-30");
      expect(march.totalIncomePaise + april.totalIncomePaise).toBe(-400000);
      expect(march.totalExpensesPaise).toBe(0);
      expect(april.totalExpensesPaise).toBe(0);
      // January STILL untouched after both refunds.
      expect(period("2026-01-01", "2026-01-31")).toMatchObject({ totalIncomePaise: 1400000, totalExpensesPaise: 560000 });

      // And the whole thing converges on accrual: income 10,000, cost 6,000.
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(accrual).toMatchObject({ totalIncomePaise: 1000000, totalExpensesPaise: 600000 });
      expect(cash.totalIncomePaise).toBe(1000000);
      expect(cash.totalExpensesPaise).toBe(600000);
      // Gross is the cash that actually stayed: 1,400,000 collected less 400,000 given back.
      expect(cash.grossSalesPaise).toBe(1000000);
      expect(cash.grossSalesPaise).toBe(cash.totalIncomePaise + cash.gstOnSalesPaise);
    } finally {
      w.repository.close();
    }
  });

  it("does the same with GST and real stock behind the returned line", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      // The owner's invoice: 1,000,000 taxable + 180,000 GST, cost 600,000 for 10 units.
      ownerInvoice(w, "INV-G", "2026-01-10");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-G", 1100000, "2026-01-20"); // leaves 80,000 owed

      at("2026-02-10T06:00:00.000Z");
      // 2 units back: 200,000 taxable + 36,000 GST = 236,000, of which only 80,000 can come off
      // the bill. 156,000 is owed back.
      w.repository.saveCreditNote({
        id: "CN-G", invoiceId: "INV-G", number: "CN-G", reason: "Return", status: "DRAFT",
        lines: [{ itemId: w.goodsId, description: "Goods", quantity: 2, unitPricePaise: 100000 }],
      });
      w.repository.finalizeCreditNote("CN-G");
      expect(w.repository.getCreditNoteBalance("CN-G")).toMatchObject({ refundablePaise: 156000 });

      at("2026-03-05T06:00:00.000Z");
      w.repository.recordCreditNoteRefund({ id: "RF-G", creditNoteId: "CN-G", amountPaise: 156000, refundedOn: "2026-03-05", paymentAccount: "CASH" });

      // Fully settled and fully refunded, so cash must equal accrual on every total - including
      // GST, which the stock entry and the tax clamp both have a chance to knock off.
      const accrual = w.repository.getProfitAndLoss({ basis: "ACCRUAL" });
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(accrual).toMatchObject({ totalIncomePaise: 800000, gstOnSalesPaise: 144000, totalExpensesPaise: 480000 });
      expect(cash.totalIncomePaise).toBe(800000);
      expect(cash.gstOnSalesPaise).toBe(144000);
      expect(cash.totalExpensesPaise).toBe(480000);
      expect(cash.grossSalesPaise).toBe(cash.totalIncomePaise + cash.gstOnSalesPaise);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a refund or an application whose date is not a real date", () => {
    vi.useFakeTimers();
    at("2026-01-10T06:00:00.000Z");
    const w = world();
    try {
      ownerInvoice(w, "INV-D", "2026-01-10");
      at("2026-01-20T06:00:00.000Z");
      w.repository.recordPayment("INV-D", 1180000, "2026-01-20");
      at("2026-02-10T06:00:00.000Z");
      w.repository.saveCreditNote({
        id: "CN-D", invoiceId: "INV-D", number: "CN-D", reason: "Return", status: "DRAFT",
        lines: [{ itemId: w.goodsId, description: "Goods", quantity: 2, unitPricePaise: 100000 }],
      });
      w.repository.finalizeCreditNote("CN-D");
      // "garbage" sorts after every ISO date, so a plain string comparison would wave it
      // through and put it straight into the journal entry's date.
      expect(() => w.repository.recordCreditNoteRefund({ id: "RF-D", creditNoteId: "CN-D", amountPaise: 1000, refundedOn: "garbage", paymentAccount: "CASH" }))
        .toThrow(/Refund date/);
      expect(() => w.repository.recordCreditNoteRefund({ id: "RF-D2", creditNoteId: "CN-D", amountPaise: 1000, refundedOn: "2026-13-45", paymentAccount: "CASH" }))
        .toThrow(/Refund date/);
    } finally {
      w.repository.close();
    }
  });
});
