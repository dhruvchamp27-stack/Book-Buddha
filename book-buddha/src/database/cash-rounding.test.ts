import { describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError, assertRoundingWithinTolerance } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * S11-22: the derived cash view must tie to the cash that actually moved, to the paise, with a
 * visible, SIGNED ROUNDING line. Every figure below is worked by hand from
 * round(line x paid / total) and is NOT read off the code.
 *
 * Rs 118 document: 10000 + CGST 900 + SGST 900 = 11800 paise.
 *   paid 5000 -> 4237 + 381 + 381 = 4999 (1 short of 5000)
 *   paid 7    -> 6 + 1 + 1 = 8 (1 over 7)
 */

interface World {
  repository: AccountingRepository;
  businessId: string;
  customerId: string;
  supplierId: string;
  serviceItemId: string;
}

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-10"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Cust" });
  const supplierId = repository.createSupplier({ companyId, name: "Sup" });
  const serviceItemId = repository.createItem({ companyId, name: "Service", unit: "job", trackStock: false });
  return { repository, businessId, customerId, supplierId, serviceItemId };
}

function invoice118(w: World, id: string): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: "2026-01-10",
    paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    lines: [{ itemId: w.serviceItemId, description: "Service", quantity: 1, unitPricePaise: 10000 }],
  });
  w.repository.finalizeInvoice(id);
}

function billOrExpense118(w: World, kind: "BILL" | "EXPENSE"): string {
  if (kind === "BILL") {
    const bill = w.repository.createPurchaseBill({
      businessId: w.businessId, supplierId: w.supplierId, number: "PB-1", billDate: "2026-01-10", paymentAccount: "PAYABLES",
      taxType: "CGST_SGST", taxRateBasisPoints: 1800,
      lines: [{ itemId: w.serviceItemId, description: "Service", quantity: 1, unitPricePaise: 10000 }],
    });
    w.repository.finalizePurchaseBill(bill.id);
    return bill.id;
  }
  const expense = w.repository.createExpense({
    businessId: w.businessId, supplierId: w.supplierId, number: "EX-1", expenseDate: "2026-01-10", description: "Service",
    amountPaise: 10000, taxType: "CGST_SGST", taxRateBasisPoints: 1800, paymentAccount: "PAYABLES",
  });
  w.repository.finalizeExpense(expense.id);
  return expense.id;
}

function sumOf(repository: AccountingRepository, account: string, documentId: string): number {
  return repository.deriveCashView().recognitions
    .filter((r) => r.account === account && r.documentId === documentId)
    .reduce((total, r) => total + r.amountPaise, 0);
}

function roundingRows(repository: AccountingRepository, documentId: string) {
  return repository.deriveCashView().recognitions.filter((r) => r.account === "ROUNDING" && r.documentId === documentId);
}

describe("cash view rounding (S11-22): the cash P&L ties to the cash that moved", () => {
  it("Rs 118 invoice, Rs 50 collected: shares 4237 + 381 + 381, ROUNDING exactly +1, total exactly 5000", () => {
    const w = world();
    try {
      invoice118(w, "INV-1");
      w.repository.recordPayment("INV-1", 5000, "2026-01-20");
      expect(sumOf(w.repository, "SALES", "INV-1")).toBe(4237);
      expect(sumOf(w.repository, "OUTPUT_CGST", "INV-1")).toBe(381);
      expect(sumOf(w.repository, "OUTPUT_SGST", "INV-1")).toBe(381);
      expect(roundingRows(w.repository, "INV-1")).toEqual([
        { date: "2026-01-20", account: "ROUNDING", amountPaise: 1, documentType: "INVOICE", documentId: "INV-1" },
      ]);
      const total = sumOf(w.repository, "SALES", "INV-1") + sumOf(w.repository, "OUTPUT_CGST", "INV-1")
        + sumOf(w.repository, "OUTPUT_SGST", "INV-1") + sumOf(w.repository, "ROUNDING", "INV-1");
      expect(total).toBe(5000);
      const cash = w.repository.getProfitAndLoss({ basis: "CASH" });
      expect(cash.grossSalesPaise).toBe(5000);
      expect(cash.gstOnSalesPaise).toBe(762);
      expect(cash.totalIncomePaise).toBe(4238);
      // Report rows carry balance as debit - credit, so one paisa of ROUNDING income (a credit) reads -1.
      expect(cash.income.filter((r) => r.account === "ROUNDING").map((r) => r.balancePaise)).toEqual([-1]);
    } finally {
      w.repository.close();
    }
  });

  it("Rs 118 invoice, 7 paise collected: shares 6 + 1 + 1, ROUNDING exactly -1, total exactly 7", () => {
    const w = world();
    try {
      invoice118(w, "INV-1");
      w.repository.recordPayment("INV-1", 7, "2026-01-20");
      expect(sumOf(w.repository, "SALES", "INV-1")).toBe(6);
      expect(sumOf(w.repository, "OUTPUT_CGST", "INV-1")).toBe(1);
      expect(sumOf(w.repository, "OUTPUT_SGST", "INV-1")).toBe(1);
      expect(roundingRows(w.repository, "INV-1")).toEqual([
        { date: "2026-01-20", account: "ROUNDING", amountPaise: -1, documentType: "INVOICE", documentId: "INV-1" },
      ]);
      const total = sumOf(w.repository, "SALES", "INV-1") + sumOf(w.repository, "OUTPUT_CGST", "INV-1")
        + sumOf(w.repository, "OUTPUT_SGST", "INV-1") + sumOf(w.repository, "ROUNDING", "INV-1");
      expect(total).toBe(7);
    } finally {
      w.repository.close();
    }
  });

  it("a fully collected invoice has NO rounding line at all", () => {
    const w = world();
    try {
      invoice118(w, "INV-1");
      w.repository.recordPayment("INV-1", 11800, "2026-01-20");
      expect(roundingRows(w.repository, "INV-1")).toEqual([]);
      expect(sumOf(w.repository, "SALES", "INV-1")).toBe(10000);
      expect(sumOf(w.repository, "OUTPUT_CGST", "INV-1")).toBe(900);
      expect(sumOf(w.repository, "OUTPUT_SGST", "INV-1")).toBe(900);
    } finally {
      w.repository.close();
    }
  });

  it("two part payments that add to the whole leave ROUNDING netting to exactly 0 (5000 then 6800)", () => {
    const w = world();
    try {
      invoice118(w, "INV-1");
      w.repository.recordPayment("INV-1", 5000, "2026-01-20");
      w.repository.recordPayment("INV-1", 6800, "2026-02-20");
      // Payment 1: +1 (4999 vs 5000). Payment 2 recognises the rest: 5763 + 519 + 519 = 6801 against 6800, so -1.
      expect(roundingRows(w.repository, "INV-1").map((r) => [r.date, r.amountPaise])).toEqual([["2026-01-20", 1], ["2026-02-20", -1]]);
      expect(sumOf(w.repository, "ROUNDING", "INV-1")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a Rs 118 purchase bill part-paid Rs 50: expense shares 4237 + 381 + 381, ROUNDING exactly -1", () => {
    const w = world();
    try {
      const billId = billOrExpense118(w, "BILL");
      w.repository.recordSupplierPayment({ billId, amountPaise: 5000, paidOn: "2026-01-20" });
      expect(sumOf(w.repository, "EXPENSE", billId)).toBe(4237);
      expect(sumOf(w.repository, "INPUT_CGST", billId)).toBe(381);
      expect(sumOf(w.repository, "INPUT_SGST", billId)).toBe(381);
      // A bill is debit-positive: shares are 1 paisa UNDER the 5000 paid, so ROUNDING is a paisa of expense = -1.
      expect(roundingRows(w.repository, billId)).toEqual([
        { date: "2026-01-20", account: "ROUNDING", amountPaise: -1, documentType: "PURCHASE_BILL", documentId: billId },
      ]);
      expect(sumOf(w.repository, "EXPENSE", billId) + sumOf(w.repository, "INPUT_CGST", billId)
        + sumOf(w.repository, "INPUT_SGST", billId) - sumOf(w.repository, "ROUNDING", billId)).toBe(5000);
    } finally {
      w.repository.close();
    }
  });

  it("a Rs 118 expense part-paid 7 paise: shares 6 + 1 + 1, ROUNDING exactly +1, total exactly 7 paid out", () => {
    const w = world();
    try {
      const expenseId = billOrExpense118(w, "EXPENSE");
      w.repository.recordSupplierPayment({ expenseId, amountPaise: 7, paidOn: "2026-01-20" });
      expect(sumOf(w.repository, "EXPENSE", expenseId)).toBe(6);
      expect(sumOf(w.repository, "INPUT_CGST", expenseId)).toBe(1);
      expect(sumOf(w.repository, "INPUT_SGST", expenseId)).toBe(1);
      expect(roundingRows(w.repository, expenseId)).toEqual([
        { date: "2026-01-20", account: "ROUNDING", amountPaise: 1, documentType: "EXPENSE", documentId: expenseId },
      ]);
    } finally {
      w.repository.close();
    }
  });

  it("a fully paid bill has NO rounding line", () => {
    const w = world();
    try {
      const billId = billOrExpense118(w, "BILL");
      w.repository.recordSupplierPayment({ billId, amountPaise: 11800, paidOn: "2026-01-20" });
      expect(roundingRows(w.repository, billId)).toEqual([]);
    } finally {
      w.repository.close();
    }
  });

  it("tolerance guard: a gap beyond the line count RAISES, naming the document and both figures", () => {
    const input = { documentType: "INVOICE", documentId: "INV-9", cashPaise: 5000, recognisedPaise: 4996, lineCount: 3 };
    expect(() => assertRoundingWithinTolerance(input)).toThrow(RepositoryValidationError);
    expect(() => assertRoundingWithinTolerance(input)).toThrow(
      "Cash-basis rounding on INVOICE INV-9 is out of tolerance: 5000 paise moved but 4996 paise were recognised, a gap of 4 paise against a limit of 3 paise for 3 lines. Per-line rounding cannot explain this; the posted lines do not add up to the document total.",
    );
    // Exactly at the bound, in either direction, is rounding and does not raise.
    expect(() => assertRoundingWithinTolerance({ ...input, recognisedPaise: 4997 })).not.toThrow();
    expect(() => assertRoundingWithinTolerance({ ...input, recognisedPaise: 5003 })).not.toThrow();
  });

  it("tolerance guard fires end to end when a posted line is corrupted", () => {
    const w = world();
    try {
      invoice118(w, "INV-1");
      w.repository.recordPayment("INV-1", 5000, "2026-01-20");
      expect(roundingRows(w.repository, "INV-1")).toHaveLength(1);
      // Make the posted SALES line 4000 paise larger than the invoice total supports: a defect, not rounding.
      const triggers = w.repository.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'journal_lines'").all() as Array<{ name: string }>;
      for (const t of triggers) w.repository.db.exec(`DROP TRIGGER IF EXISTS "${t.name}"`);
      w.repository.db.exec("UPDATE journal_lines SET credit_paise = credit_paise + 4000 WHERE account = 'SALES'");
      expect(() => w.repository.deriveCashView()).toThrow(/Cash-basis rounding on INVOICE INV-1 is out of tolerance: 5000 paise moved but \d+ paise were recognised/);
    } finally {
      w.repository.close();
    }
  });
});
