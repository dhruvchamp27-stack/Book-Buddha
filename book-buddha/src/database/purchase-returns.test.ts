import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { migrations, runMigrations } from "./migrations.js";
import { applyPurchaseReturnsSchema } from "./purchase-returns-schema.js";
import { AccountingRepository } from "./repository.js";

/**
 * R8 - purchase returns and supplier refunds (migration v19), the supplier mirror of a credit
 * note and its refund.
 *
 * Until now, goods could only go back to a supplier by CANCELLING the whole bill: all or nothing,
 * and it rewrites a document that was correct when it was issued. These tests cover the partial,
 * dated case, and in particular the three places this could quietly go wrong:
 *
 *  - INVENTORY must stay equal to the stock-layer value after the goods leave.
 *  - PAYABLES must never go into DEBIT when a PAID bill is returned. That is the shape this
 *    project has already had to close on RECEIVABLES (S4-1) and on SALES (session 8); the third
 *    time it appears, it gets a test of its own.
 *  - Returning a DISCOUNTED bill in full must give back exactly what was owed for it - not the
 *    undiscounted line total, which the supplier never charged.
 */

const at = (version: number) => migrations.filter((m) => m.version <= version);

describe("migration v19 adds the purchase-return tables and SUPPLIER_CREDITS", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });
  afterEach(() => db.close());

  const tables = (): string[] =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);

  it("applies to a v18 database and leaves everything already there untouched", () => {
    runMigrations(db, at(18));
    expect((db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number }).v).toBe(18);
    expect(tables()).not.toContain("purchase_returns");
    const chartBefore = db.prepare("SELECT code, name, type, role FROM chart_accounts ORDER BY code").all();

    applyPurchaseReturnsSchema(db);

    for (const table of ["purchase_returns", "purchase_return_lines", "supplier_refunds"]) {
      expect(tables(), table).toContain(table);
    }
    expect(db.prepare("SELECT code, name, type, role FROM chart_accounts WHERE code = 'SUPPLIER_CREDITS'").get())
      .toEqual({ code: "SUPPLIER_CREDITS", name: "Supplier Credits Receivable", type: "ASSET", role: null });
    // SUPPLIER_CREDITS is the ONLY account added, and no existing row was rewritten.
    const chartAfter = db.prepare("SELECT code, name, type, role FROM chart_accounts WHERE code <> 'SUPPLIER_CREDITS' ORDER BY code").all();
    expect(chartAfter).toEqual(chartBefore);
  });

  it("is registered as v19, rebuilds no table, and is a clean no-op the second time", () => {
    const v19 = migrations.find((m) => m.version === 19);
    expect(v19?.name).toBe("purchase_returns");
    expect(migrations.filter((m) => m.version === 19)).toHaveLength(1);

    runMigrations(db, at(18));
    const triggersBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    applyPurchaseReturnsSchema(db);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).toEqual(triggersBefore);

    expect(() => applyPurchaseReturnsSchema(db)).not.toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM chart_accounts WHERE code = 'SUPPLIER_CREDITS'").get()).toEqual({ n: 1 });
  });

  it("refuses to run, and rolls itself back, if SUPPLIER_CREDITS has been reused for something else", () => {
    runMigrations(db, at(18));
    db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, active, created_at, updated_at)"
      + " VALUES ('SUPPLIER_CREDITS', NULL, 'Someone Elses', 'LIABILITY', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() => applyPurchaseReturnsSchema(db)).toThrow(/SUPPLIER_CREDITS/);
  });
});

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  supplierId: string;
  customerId: string;
  bookId: string;
  serviceId: string;
}

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const bookId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: true });
  const serviceId = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  return { repository, companyId, businessId, supplierId, customerId, bookId, serviceId };
}

/** An account's balance straight off the journal: debits less credits. */
function balancePaise(repository: AccountingRepository, account: string): number {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS balance FROM journal_lines WHERE account = ?")
    .get(account) as { balance: number };
  return row.balance;
}

/** Every line in the book: the whole ledger must balance, not just the entry under test. */
function ledgerBalances(repository: AccountingRepository): boolean {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) AS dr, COALESCE(SUM(credit_paise), 0) AS cr FROM journal_lines")
    .get() as { dr: number; cr: number };
  return row.dr === row.cr;
}

function stockValuePaise(w: World, itemId: string): number {
  return w.repository.getInventoryValuation().find((row) => row.itemId === itemId)?.valuePaise ?? 0;
}

/** A finalized bill: 10 novels at Rs 100 on credit, unless told otherwise. */
function billFor(w: World, options: {
  quantity?: number; unitPricePaise?: number; paymentAccount?: "CASH" | "PAYABLES";
  discountPaise?: number; extraChargePaise?: number; taxType?: "NONE" | "CGST_SGST" | "IGST";
  taxRateBasisPoints?: number; itemId?: string; number?: string;
} = {}) {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: options.number ?? "BILL-1",
    billDate: "2026-05-10", paymentAccount: options.paymentAccount ?? "PAYABLES",
    ...(options.discountPaise === undefined ? {} : { discountPaise: options.discountPaise }),
    ...(options.extraChargePaise === undefined ? {} : { extraChargePaise: options.extraChargePaise }),
    ...(options.taxType === undefined ? {} : { taxType: options.taxType }),
    ...(options.taxRateBasisPoints === undefined ? {} : { taxRateBasisPoints: options.taxRateBasisPoints }),
    lines: [{
      itemId: options.itemId ?? w.bookId, description: "Novel",
      quantity: options.quantity ?? 10, unitPricePaise: options.unitPricePaise ?? 10000,
    }],
  });
  w.repository.finalizePurchaseBill(bill.id);
  return w.repository.getPurchaseBill(bill.id)!;
}

describe("R8: sending part of a bill back", () => {
  it("reduces the stock, the payable and the input GST, and keeps INVENTORY tied to the layers", () => {
    const w = setup();
    try {
      // 10 novels at Rs 100 plus 18% IGST = Rs 1,180 owed. Three go back.
      const bill = billFor(w, { taxType: "IGST", taxRateBasisPoints: 1800 });
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-118000);
      expect(stockValuePaise(w, w.bookId)).toBe(100000);

      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Damaged in transit", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 3, unitPricePaise: 10000 }],
      });
      expect(ret.status).toBe("DRAFT");
      expect(stockValuePaise(w, w.bookId)).toBe(100000); // a DRAFT moves nothing

      w.repository.finalizePurchaseReturn(ret.id);

      // Rs 300 of goods plus Rs 54 of IGST = Rs 354 comes off the payable.
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-(118000 - 35400));
      expect(balancePaise(w.repository, "INPUT_IGST")).toBe(18000 - 5400);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(70000);
      // THE TIE: seven novels left in the layers, and the ledger says the same.
      const valuation = w.repository.getInventoryValuation().find((row) => row.itemId === w.bookId);
      expect(valuation?.quantity).toBe(7);
      expect(valuation?.valuePaise).toBe(70000);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(valuation?.valuePaise);
      expect(ledgerBalances(w.repository)).toBe(true);
      // Nothing is owed back: the bill was still open, so the return just reduced it.
      expect(w.repository.getPurchaseReturnBalance(ret.id).outstandingPaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("posts the return on ITS OWN date, not the day it was entered", () => {
    const w = setup();
    try {
      const bill = billFor(w);
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Damaged", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 1, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      // S8-4 is the owner's open complaint that a credit note cannot be back-dated. A purchase
      // return is new, so it carries its own document date and does not inherit that problem.
      expect(w.repository.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(`je-purchase-return-${ret.id}`))
        .toEqual({ entry_date: "2026-05-15" });
    } finally {
      w.repository.close();
    }
  });

  it("puts a non-stock line back against EXPENSE rather than INVENTORY", () => {
    const w = setup();
    try {
      const bill = billFor(w, { itemId: w.serviceId, quantity: 2, unitPricePaise: 50000 });
      expect(balancePaise(w.repository, "EXPENSE")).toBe(100000);
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Not delivered",
        lines: [{ itemId: w.serviceId, description: "Design", quantity: 1, unitPricePaise: 50000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      expect(balancePaise(w.repository, "EXPENSE")).toBe(50000);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: returning a bill that has already been PAID", () => {
  it("leaves PAYABLES on zero and books the money as owed back, never as a negative liability", () => {
    const w = setup();
    try {
      const bill = billFor(w);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100000, paidOn: "2026-05-12" });
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);

      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 4, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);

      // THE POINT OF THIS TEST. Nothing was still owed, so the whole Rs 400 is money the supplier
      // owes US: an ASSET. PAYABLES stays exactly nil instead of going to a debit balance, where
      // it would read as a phantom receivable sitting inside a payables account.
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(40000);
      expect(w.repository.getPurchaseReturnBalance(ret.id)).toEqual({
        creditPaise: 40000, refundedPaise: 0, outstandingPaise: 40000,
      });
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("splits across the open balance when the bill is only part paid", () => {
    const w = setup();
    try {
      const bill = billFor(w); // Rs 1,000 owed
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 70000, paidOn: "2026-05-12" });
      // Rs 300 still open. Return Rs 500 of goods: Rs 300 comes off the bill, Rs 200 is owed back.
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 5, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(20000);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("a CASH bill hands the money straight back, with no credit left standing", () => {
    const w = setup();
    try {
      const bill = billFor(w, { paymentAccount: "CASH" });
      expect(balancePaise(w.repository, "CASH")).toBe(-100000);
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      // Across the counter: no open balance to reduce, so the return IS the refund.
      expect(balancePaise(w.repository, "CASH")).toBe(-80000);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: returning a DISCOUNTED bill", () => {
  it("gives back exactly what was owed when the whole bill goes back", () => {
    const w = setup();
    try {
      // Rs 1,000 of goods less a Rs 150 discount: Rs 850 was owed, and Rs 850 is what must come
      // back. Returning the undiscounted Rs 1,000 would credit the supplier Rs 150 they never got.
      const bill = billFor(w, { discountPaise: 15000 });
      expect(bill.totalPaise).toBe(85000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-85000);

      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "All faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 10, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);

      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(0);
      // The discount income is given back with the goods, so it does not linger as profit on a
      // purchase that no longer exists.
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(0);
      expect(stockValuePaise(w, w.bookId)).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("comes back to exactly nil over several returns, even when the share does not divide", () => {
    const w = setup();
    try {
      // Rs 100.03 off 7 units at Rs 100: no per-return share of the discount divides evenly, so
      // this is where rounding each return in isolation would strand a paisa.
      const bill = billFor(w, { quantity: 7, discountPaise: 10003 });
      expect(bill.totalPaise).toBe(70000 - 10003);
      for (const [index, quantity] of [3, 2, 2].entries()) {
        const ret = w.repository.createPurchaseReturn({
          billId: bill.id, number: `PR-${index + 1}`, reason: "Faulty",
          lines: [{ itemId: w.bookId, description: "Novel", quantity, unitPricePaise: 10000 }],
        });
        w.repository.finalizePurchaseReturn(ret.id);
      }
      // The last return takes whatever discount headroom is left, so the bill lands on zero.
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: the supplier hands the money back", () => {
  it("clears the credit and brings the cash in on the refund's own date", () => {
    const w = setup();
    try {
      const bill = billFor(w);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100000, paidOn: "2026-05-12" });
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 4, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);

      const entry = w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 25000, refundedOn: "2026-06-01", paymentAccount: "BANK",
      });
      expect(balancePaise(w.repository, "BANK")).toBe(25000);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(15000);
      expect(w.repository.getPurchaseReturnBalance(ret.id)).toEqual({
        creditPaise: 40000, refundedPaise: 25000, outstandingPaise: 15000,
      });
      // The money arrived in June, and the books say June -- not May, when the goods went back.
      expect(w.repository.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(entry.id))
        .toEqual({ entry_date: "2026-06-01" });

      w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 15000, refundedOn: "2026-06-02", paymentAccount: "CASH",
      });
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a refund bigger than the credit, or dated before the goods went back", () => {
    const w = setup();
    try {
      const bill = billFor(w);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100000, paidOn: "2026-05-12" });
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);

      expect(() => w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 20001, refundedOn: "2026-06-01", paymentAccount: "CASH",
      })).toThrow(/left to come back/);
      expect(() => w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 1000, refundedOn: "2026-05-14", paymentAccount: "CASH",
      })).toThrow(/cannot predate the return/);
      // "garbage" sorts after any ISO date, so a string compare alone would let it through.
      expect(() => w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 1000, refundedOn: "garbage", paymentAccount: "CASH",
      })).toThrow();
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(20000);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: what a purchase return is not allowed to be", () => {
  it("will not send back stock that has already been sold on", () => {
    const w = setup();
    try {
      const bill = billFor(w); // 10 novels in
      w.repository.saveDraft({
        id: "INV-1", number: "INV-1", businessId: w.businessId, customerId: w.customerId,
        invoiceDate: "2026-05-12", status: "DRAFT", paymentAccount: "RECEIVABLES",
        taxType: "NONE", taxRateBasisPoints: 0,
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 8, unitPricePaise: 20000 }],
      });
      w.repository.finalizeInvoice("INV-1"); // 8 sold, 2 left

      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 5, unitPricePaise: 10000 }],
      });
      // The books cannot be sent back twice. This is the same guard cancelPurchaseBill uses.
      expect(() => w.repository.finalizePurchaseReturn(ret.id)).toThrow(/has been sold/);
      // Two are genuinely still here, and those may go.
      const smaller = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-2", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      expect(() => w.repository.finalizePurchaseReturn(smaller.id)).not.toThrow();
      expect(stockValuePaise(w, w.bookId)).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("will not return more than the bill bought, nor at a price the bill never charged", () => {
    const w = setup();
    try {
      const bill = billFor(w, { quantity: 4 });
      expect(() => w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 5, unitPricePaise: 10000 }],
      })).toThrow(/exceeds what bill/);
      // The price must be the bill's, because that is exactly what the stock layer holds; a
      // different price would credit INVENTORY by something the layers never contained.
      expect(() => w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 1, unitPricePaise: 12000 }],
      })).toThrow(/must use the price the bill charged/);
      expect(() => w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-01",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 1, unitPricePaise: 10000 }],
      })).toThrow(/cannot predate the bill/);
    } finally {
      w.repository.close();
    }
  });

  it("counts earlier returns, so two half returns cannot together exceed the bill", () => {
    const w = setup();
    try {
      const bill = billFor(w, { quantity: 4 });
      const first = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 3, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(first.id);
      expect(() => w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-2", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      })).toThrow(/exceeds what bill/);
    } finally {
      w.repository.close();
    }
  });

  it("will not return against a draft bill", () => {
    const w = setup();
    try {
      const draft = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 1, unitPricePaise: 10000 }],
      });
      expect(() => w.repository.createPurchaseReturn({
        billId: draft.id, number: "PR-1", reason: "Faulty",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 1, unitPricePaise: 10000 }],
      })).toThrow(/finalized purchase bill/);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: cancelling a purchase return", () => {
  it("reverses it and puts the goods back in the layers, deleting nothing", () => {
    const w = setup();
    try {
      const bill = billFor(w, { taxType: "CGST_SGST", taxRateBasisPoints: 1800 });
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Mistake", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 3, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      expect(stockValuePaise(w, w.bookId)).toBe(70000);

      w.repository.cancelPurchaseReturn(ret.id);

      // Back exactly where the bill left things, by reversal rather than by deletion.
      expect(w.repository.getPurchaseReturn(ret.id).status).toBe("CANCELLED");
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-118000);
      expect(balancePaise(w.repository, "INPUT_CGST") + balancePaise(w.repository, "INPUT_SGST")).toBe(18000);
      expect(stockValuePaise(w, w.bookId)).toBe(100000);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(stockValuePaise(w, w.bookId));
      expect(w.repository.getPurchaseReturnBalance(ret.id).outstandingPaise).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
      // The original entry is still there, untouched, beside its reversal.
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE id LIKE ?").get(`je-purchase-return-${ret.id}%`))
        .toEqual({ n: 2 });
    } finally {
      w.repository.close();
    }
  });

  it("will not cancel a return the supplier has already refunded", () => {
    const w = setup();
    try {
      const bill = billFor(w);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100000, paidOn: "2026-05-12" });
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Faulty", returnDate: "2026-05-15",
        lines: [{ itemId: w.bookId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      w.repository.recordSupplierRefund({
        purchaseReturnId: ret.id, amountPaise: 20000, refundedOn: "2026-06-01", paymentAccount: "CASH",
      });
      expect(() => w.repository.cancelPurchaseReturn(ret.id)).toThrow(/already been refunded/);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: over HTTP", () => {
  it("runs a return and a refund end to end", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      const businessId = repository.createBusiness({ companyId, name: "Books" });
      const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
      const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: true });
      const bill = repository.createPurchaseBill({
        businessId, supplierId, number: "BILL-1", billDate: "2026-05-10", paymentAccount: "PAYABLES",
        lines: [{ itemId, description: "Novel", quantity: 10, unitPricePaise: 10000 }],
      });
      repository.finalizePurchaseBill(bill.id);
      repository.recordSupplierPayment({ billId: bill.id, amountPaise: 100000, paidOn: "2026-05-12" });

      const created = await app.inject({
        method: "POST", url: "/purchase-returns",
        payload: {
          billId: bill.id, reason: "Faulty", returnDate: "2026-05-15",
          lines: [{ itemId, description: "Novel", quantity: 4, unitPricePaise: 10000 }],
        },
      });
      expect(created.statusCode).toBe(201);
      const ret = created.json() as { id: string; status: string; valuePaise: number };
      expect(ret).toMatchObject({ status: "DRAFT", valuePaise: 40000, number: "PR-001/26-27" });

      expect((await app.inject({ method: "POST", url: `/purchase-returns/${ret.id}/finalize` })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/purchase-returns/${ret.id}/balance` })).json())
        .toEqual({ creditPaise: 40000, refundedPaise: 0, outstandingPaise: 40000 });

      const refund = await app.inject({
        method: "POST", url: `/purchase-returns/${ret.id}/refunds`,
        payload: { amountPaise: 40000, refundedOn: "2026-06-01", paymentAccount: "BANK" },
      });
      expect(refund.statusCode).toBe(201);
      expect(refund.json()).toMatchObject({ balance: { outstandingPaise: 0, refundedPaise: 40000 } });

      const listed = (await app.inject({ method: "GET", url: `/purchase-returns?billId=${bill.id}` })).json() as unknown[];
      expect(listed).toHaveLength(1);

      // An over-sized return is refused at the door with a 400, not a 500.
      const bad = await app.inject({
        method: "POST", url: "/purchase-returns",
        payload: {
          billId: bill.id, reason: "Faulty",
          lines: [{ itemId, description: "Novel", quantity: 99, unitPricePaise: 10000 }],
        },
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
