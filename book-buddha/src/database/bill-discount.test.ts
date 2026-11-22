import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { migrations, runMigrations } from "./migrations.js";
import { applyBillDiscountSchema } from "./bill-discount-schema.js";
import { AccountingRepository } from "./repository.js";

/**
 * R8 - a header-level discount and extra charge on a purchase bill (migration v18).
 *
 * An invoice has had both since the baseline; a bill had neither, so a supplier discount could
 * only be faked by editing line prices, which silently falsified the cost of the stock.
 *
 * THE ACCEPTANCE CHECK, and the reason the design looks the way it does: on a bill with
 * stock-tracked lines the INVENTORY ledger must still equal the stock-layer value afterwards.
 * S17-7 (owner rulings Q1/Q2) REPLACED the original rule. The discount is assumed to be on stock
 * items only, so it is spread INTO the stock lots (whole paise, remainder on the last unit) and
 * INVENTORY is debited the net cost; a bill with no stock lines still credits PURCHASE_DISCOUNT.
 * A discount taken at PAYMENT is "Discount received" income. The hand figures are asserted at the
 * bottom of this file.
 */

const at = (version: number) => migrations.filter((m) => m.version <= version);

describe("migration v18 adds the discount columns and accounts without touching anything else", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });
  afterEach(() => db.close());

  const columns = (database: Database.Database, table: string): string[] =>
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

  it("applies to a v17 database that already holds bills, and leaves them at nil discount", () => {
    // Build to v17 ONLY, so v18's own body is what runs below. Running the whole chain on an
    // empty database would test nothing: the columns would be there before the rows were.
    runMigrations(db, at(17));
    expect((db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: number }).version).toBe(17);
    expect(columns(db, "purchase_bills")).not.toContain("discount_paise");
    expect(db.prepare("SELECT COUNT(*) AS n FROM chart_accounts WHERE code = 'PURCHASE_DISCOUNT'").get()).toEqual({ n: 0 });

    // A survivor, inserted by raw SQL exactly as a real v17 database would hold it.
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO suppliers (id, company_id, name, created_at) VALUES ('su', 'co', 'Paper Co', '2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO businesses (id, company_id, name, created_at) VALUES ('bu', 'co', 'Biz', '2026-01-01T00:00:00.000Z')").run();
    db.prepare(
      "INSERT INTO purchase_bills (id, business_id, supplier_id, number, bill_date, status, payment_account, tax_type, tax_rate_basis_points, created_at)"
      + " VALUES ('bill', 'bu', 'su', 'BILL-1', '2026-01-05', 'FINALIZED', 'PAYABLES', 'NONE', 0, '2026-01-05T00:00:00.000Z')",
    ).run();
    const before = db.prepare("SELECT id, number, bill_date, status FROM purchase_bills").all();

    // Apply v18's body DIRECTLY. A second runMigrations would be a no-op on an up-to-date db.
    applyBillDiscountSchema(db);

    expect(columns(db, "purchase_bills")).toContain("discount_paise");
    expect(columns(db, "purchase_bills")).toContain("extra_charge_paise");
    expect(db.prepare("SELECT id, number, bill_date, status FROM purchase_bills").all()).toEqual(before);
    // The bill that was already there reads back 0/0, which is exactly what it always was.
    expect(db.prepare("SELECT discount_paise, extra_charge_paise FROM purchase_bills WHERE id = 'bill'").get())
      .toEqual({ discount_paise: 0, extra_charge_paise: 0 });

    // Both accounts land, under the class the engine posts them to.
    expect(db.prepare("SELECT code, name, type, role FROM chart_accounts WHERE code IN ('PURCHASE_DISCOUNT', 'PURCHASE_EXTRA_CHARGES') ORDER BY code").all())
      .toEqual([
        { code: "PURCHASE_DISCOUNT", name: "Discount Received", type: "INCOME", role: null },
        { code: "PURCHASE_EXTRA_CHARGES", name: "Purchase Extra Charges", type: "EXPENSE", role: null },
      ]);

    // Re-running is a no-op rather than an error, and adds no second copy of either column.
    expect(() => applyBillDiscountSchema(db)).not.toThrow();
    expect(columns(db, "purchase_bills").filter((c) => c === "discount_paise")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM chart_accounts WHERE code = 'PURCHASE_DISCOUNT'").get()).toEqual({ n: 1 });
  });

  it("is registered as v18 and rebuilds no table, so no trigger needs replaying", () => {
    const v18 = migrations.find((m) => m.version === 18);
    expect(v18?.name).toBe("bill_discount");
    expect(migrations.filter((m) => m.version === 18)).toHaveLength(1);

    runMigrations(db, at(17));
    const triggersBefore = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    applyBillDiscountSchema(db);
    expect(db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all()).toEqual(triggersBefore);
  });

  it("refuses to run, and rolls itself back, if either code has been reused for something else", () => {
    runMigrations(db, at(17));
    db.prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, active, created_at, updated_at)"
      + " VALUES ('PURCHASE_DISCOUNT', NULL, 'Someone Elses Account', 'EXPENSE', NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() => applyBillDiscountSchema(db)).toThrow(/PURCHASE_DISCOUNT found as EXPENSE|found account PURCHASE_DISCOUNT/);
    // Rolled back whole: the second account did not sneak in beside the clash.
    expect(db.prepare("SELECT COUNT(*) AS n FROM chart_accounts WHERE code = 'PURCHASE_EXTRA_CHARGES'").get()).toEqual({ n: 0 });
  });
});

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  supplierId: string;
  stockItemId: string;
  serviceItemId: string;
}

function setup(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  const stockItemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: true });
  const serviceItemId = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  return { repository, companyId, businessId, supplierId, stockItemId, serviceItemId };
}

/** An account's balance straight off the journal: debits less credits. */
function balancePaise(repository: AccountingRepository, account: string): number {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS balance FROM journal_lines WHERE account = ?")
    .get(account) as { balance: number };
  return row.balance;
}

/** Every posted line, so a test can prove the whole entry balances rather than one side of it. */
function entryBalances(repository: AccountingRepository): boolean {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) AS dr, COALESCE(SUM(credit_paise), 0) AS cr FROM journal_lines")
    .get() as { dr: number; cr: number };
  return row.dr === row.cr;
}

describe("R8: a discount on a bill of stock", () => {
  it("leaves INVENTORY equal to the stock-layer value, to the paise", () => {
    const w = setup();
    try {
      // 10 novels at Rs 100 = Rs 1,000, less a Rs 150 discount. Rs 150 across 10 units is Rs 15
      // each and WOULD divide evenly -- deliberately, so that the test is not passing only
      // because the arithmetic was awkward. The next test takes the case that does not divide.
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", discountPaise: 15000,
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 10, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);

      const valuation = w.repository.getInventoryValuation().find((row) => row.itemId === w.stockItemId);
      expect(valuation?.quantity).toBe(10);
      // S17-7: the discount is spread INTO the stock: carried at Rs 850, not Rs 1,000.
      expect(valuation?.valuePaise).toBe(85000);
      // THE ACCEPTANCE CHECK.
      expect(balancePaise(w.repository, "INVENTORY")).toBe(valuation?.valuePaise);

      // Nothing is credited to Discount Received: the discount sits inside the stock cost.
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-85000); // Rs 850 is what is owed
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("holds the tie even when the discount does NOT divide evenly across the units", () => {
    const w = setup();
    try {
      // Rs 100.03 off 7 units at Rs 100: 10003 / 7 = 1429.0, with a remainder. Spread into an
      // integer unit cost this is exactly where INVENTORY and the layers would drift apart.
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", discountPaise: 10003,
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);

      const valuation = w.repository.getInventoryValuation().find((row) => row.itemId === w.stockItemId);
      // S17-7: spread into the stock, so the layers carry Rs 599.97 (70000 - 10003 = 59997).
      expect(valuation?.valuePaise).toBe(59997);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(valuation?.valuePaise);
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-(70000 - 10003));
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("posts nothing to the discount account when there is no discount", () => {
    const w = setup();
    try {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES",
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      // Not a zero-value line: no line at all. A nil line is noise in a ledger he has to read.
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account IN ('PURCHASE_DISCOUNT', 'PURCHASE_EXTRA_CHARGES')").get())
        .toEqual({ n: 0 });
      expect(w.repository.getPurchaseBill(bill.id)?.totalPaise).toBe(20000);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: what the bill now totals", () => {
  it("charges GST on the discounted value, as a sale does", () => {
    const w = setup();
    try {
      // Rs 1,000 of goods, Rs 200 off, Rs 50 freight on. Taxable = 1,000 - 200 + 50 = Rs 850.
      // GST at 18% on Rs 850 = Rs 153. Owed = Rs 1,003.
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
        discountPaise: 20000, extraChargePaise: 5000,
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 1, unitPricePaise: 100000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);

      const saved = w.repository.getPurchaseBill(bill.id);
      expect(saved?.subtotalPaise).toBe(100000);
      expect(saved?.discountPaise).toBe(20000);
      expect(saved?.extraChargePaise).toBe(5000);
      expect(saved?.taxablePaise).toBe(85000);
      expect(saved?.taxPaise).toBe(15300);
      expect(saved?.totalPaise).toBe(100300);

      // The read side and the posted entry agree -- the bug class that produced the fair-sales
      // discrepancy was exactly a second copy of a formula drifting from the first.
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-100300);
      expect(balancePaise(w.repository, "PURCHASE_EXTRA_CHARGES")).toBe(5000);
      // S17-10: the discount is on stock, so INVENTORY carries the net Rs 800 and EXPENSE stays nil.
      expect(balancePaise(w.repository, "INVENTORY")).toBe(80000);
      expect(balancePaise(w.repository, "INPUT_CGST") + balancePaise(w.repository, "INPUT_SGST")).toBe(15300);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("follows the bill through to what is owed and what is paid", () => {
    const w = setup();
    try {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", discountPaise: 25000,
        lines: [{ itemId: w.stockItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);

      // Payables must show Rs 750, the discounted figure -- not the Rs 1,000 on the lines.
      const payable = w.repository.getPayables().find((row) => row.documentId === bill.id);
      expect(payable?.totalPaise).toBe(75000);
      expect(payable?.outstandingPaise).toBe(75000);

      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 75000, paidOn: "2026-05-20" });
      expect(w.repository.getPayables().find((row) => row.documentId === bill.id)).toBeUndefined();
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("reverses the discount too when the bill is cancelled", () => {
    const w = setup();
    try {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", discountPaise: 25000, extraChargePaise: 5000,
        lines: [{ itemId: w.stockItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      w.repository.cancelPurchaseBill(bill.id);

      // Cancel-with-reversal: every account the bill touched is back to nil, and nothing was
      // deleted to get there.
      for (const account of ["PAYABLES", "INVENTORY", "PURCHASE_DISCOUNT", "PURCHASE_EXTRA_CHARGES"]) {
        expect(balancePaise(w.repository, account), account).toBe(0);
      }
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account = 'INVENTORY'").get())
        .toEqual({ n: 2 });
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: what a bill discount is not allowed to be", () => {
  it("refuses a discount bigger than the bill", () => {
    const w = setup();
    try {
      expect(() => w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES", discountPaise: 100001,
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 1, unitPricePaise: 100000 }],
      })).toThrow(/The bill discount \(Rs 1000\.01\) is more than the value of the stock items on this bill \(Rs 1000\.00\)/);
    } finally {
      w.repository.close();
    }
  });

  it("refuses a negative or fractional discount", () => {
    const w = setup();
    try {
      const line = { itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 };
      const base = {
        businessId: w.businessId, supplierId: w.supplierId, number: "BILL-1", billDate: "2026-05-10",
        paymentAccount: "PAYABLES" as const, lines: [line],
      };
      expect(() => w.repository.createPurchaseBill({ ...base, discountPaise: -1 })).toThrow(/non-negative whole/);
      expect(() => w.repository.createPurchaseBill({ ...base, discountPaise: 10.5 })).toThrow(/non-negative whole/);
      expect(() => w.repository.createPurchaseBill({ ...base, extraChargePaise: -1 })).toThrow(/non-negative whole/);
    } finally {
      w.repository.close();
    }
  });
});

describe("R8: over HTTP", () => {
  it("takes the two fields on the body and gives back the discounted total", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      const businessId = repository.createBusiness({ companyId, name: "Books" });
      const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
      const itemId = repository.createItem({ companyId, name: "Novel", unit: "each", trackStock: true });

      const created = await app.inject({
        method: "POST", url: "/purchase-bills",
        payload: {
          businessId, supplierId, number: "BILL-1", billDate: "2026-05-10", paymentAccount: "PAYABLES",
          discountPaise: 15000, extraChargePaise: 2000,
          lines: [{ itemId, description: "Novel", quantity: 10, unitPricePaise: 10000 }],
        },
      });
      expect(created.statusCode).toBe(201);
      const bill = created.json() as { id: string; discountPaise: number; extraChargePaise: number; totalPaise: number };
      expect(bill.discountPaise).toBe(15000);
      expect(bill.extraChargePaise).toBe(2000);
      expect(bill.totalPaise).toBe(100000 - 15000 + 2000);

      const fetched = await app.inject({ method: "GET", url: `/purchase-bills/${bill.id}` });
      expect(fetched.json()).toMatchObject({ discountPaise: 15000, extraChargePaise: 2000, taxablePaise: 87000 });

      // Omitting both is still a valid body: every caller written before v18 keeps working.
      const plain = await app.inject({
        method: "POST", url: "/purchase-bills",
        payload: {
          businessId, supplierId, number: "BILL-2", billDate: "2026-05-10", paymentAccount: "PAYABLES",
          lines: [{ itemId, description: "Novel", quantity: 1, unitPricePaise: 10000 }],
        },
      });
      expect(plain.statusCode).toBe(201);
      expect(plain.json()).toMatchObject({ discountPaise: 0, extraChargePaise: 0, totalPaise: 10000 });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("rejects a discount bigger than the bill with a 400 naming the field", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      const businessId = repository.createBusiness({ companyId, name: "Books" });
      const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });

      const response = await app.inject({
        method: "POST", url: "/purchase-bills",
        payload: {
          businessId, supplierId, number: "BILL-1", billDate: "2026-05-10", paymentAccount: "PAYABLES",
          discountPaise: 20001,
          lines: [{ description: "Novel", quantity: 2, unitPricePaise: 10000 }],
        },
      });
      // S17-10: a bill with no stock lines cannot carry any discount; the message is the repository's.
      expect(response.statusCode).toBe(400);
      expect(response.body).toMatch(/no stock items, so it cannot carry a bill discount/);
    } finally {
      await app.close();
      repository.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// S17-7 (owner rulings Q1 + Q2): the hand figures.
// ---------------------------------------------------------------------------------------------

function lotsOf(repository: AccountingRepository, itemId: string): Array<{ quantity: number; cost: number; type: string }> {
  return (repository.db
    .prepare("SELECT quantity_delta AS quantity, unit_cost_paise AS cost, movement_type AS type FROM stock_movements WHERE item_id = ? ORDER BY rowid")
    .all(itemId) as Array<{ quantity: number; cost: number; type: string }>);
}

function newBill(w: World, number: string, discountPaise: number, lines: Array<{ itemId?: string; description: string; quantity: number; unitPricePaise: number }>, extra: Record<string, unknown> = {}) {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number, billDate: "2026-05-10",
    paymentAccount: "PAYABLES", discountPaise, lines, ...extra,
  });
  w.repository.finalizePurchaseBill(bill.id);
  return bill;
}

describe("S17-7 Q1: the bill discount is spread over STOCK lines only", () => {
  it("7 x Rs 100, discount Rs 150: lots 6 @ 78.57 + 1 @ 78.58, INVENTORY 550.00, no Discount Received", () => {
    const w = setup();
    try {
      newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }]);
      expect(lotsOf(w.repository, w.stockItemId)).toEqual([
        { quantity: 6, cost: 7857, type: "PURCHASE" },
        { quantity: 1, cost: 7858, type: "PURCHASE" },
      ]);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-55000);
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account = 'PURCHASE_DISCOUNT'").get()).toEqual({ n: 0 });
      expect(w.repository.getInventoryValuation().find((r) => r.itemId === w.stockItemId)?.valuePaise).toBe(55000);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("adds a non-stock Packing line of Rs 50 at full price: INVENTORY 550, EXPENSE 50, Payables 600", () => {
    const w = setup();
    try {
      newBill(w, "B1", 15000, [
        { itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 },
        { description: "Packing", quantity: 1, unitPricePaise: 5000 },
      ]);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000);
      expect(balancePaise(w.repository, "EXPENSE")).toBe(5000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-60000);
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("two stock lines 4 x 50 and 3 x 100, discount 50: shares 20 / 30, lots 4 @ 45 and 3 @ 90, INVENTORY 450", () => {
    const w = setup();
    try {
      const other = w.repository.createItem({ companyId: w.companyId, name: "Atlas", unit: "each", trackStock: true });
      newBill(w, "B1", 5000, [
        { itemId: w.stockItemId, description: "Novel", quantity: 4, unitPricePaise: 5000 },
        { itemId: other, description: "Atlas", quantity: 3, unitPricePaise: 10000 },
      ]);
      expect(lotsOf(w.repository, w.stockItemId)).toEqual([{ quantity: 4, cost: 4500, type: "PURCHASE" }]);
      expect(lotsOf(w.repository, other)).toEqual([{ quantity: 3, cost: 9000, type: "PURCHASE" }]);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(45000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-45000);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("GST 5% stays on (subtotal - discount): 27.50 on 550, Payables 577.50", () => {
    const w = setup();
    try {
      newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }],
        { taxType: "CGST_SGST", taxRateBasisPoints: 500 });
      expect(balancePaise(w.repository, "INPUT_CGST") + balancePaise(w.repository, "INPUT_SGST")).toBe(2750);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-57750);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("S17-10: a discounted bill with NO stock lines is now refused (no Discount Received credit from a bill)", () => {
    const w = setup();
    try {
      expect(() => newBill(w, "B1", 15000, [{ description: "Design", quantity: 1, unitPricePaise: 100000 }]))
        .toThrow(/no stock items, so it cannot carry a bill discount/);
    } finally {
      w.repository.close();
    }
  });

  it("S17-10: a discount bigger than the stock value is refused, not split into stock and Discount Received", () => {
    const w = setup();
    try {
      expect(() => newBill(w, "B1", 30000, [
        { itemId: w.stockItemId, description: "Novel", quantity: 1, unitPricePaise: 10000 },
        { description: "Design", quantity: 1, unitPricePaise: 50000 },
      ])).toThrow(/The bill discount \(Rs 300\.00\) is more than the value of the stock items on this bill \(Rs 100\.00\)/);
    } finally {
      w.repository.close();
    }
  });

  it("cancelling the bill reverses BOTH stock rows of the line and every account", () => {
    const w = setup();
    try {
      const bill = newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }]);
      w.repository.cancelPurchaseBill(bill.id);
      expect(lotsOf(w.repository, w.stockItemId).filter((r) => r.type === "PURCHASE_REVERSAL")).toEqual([
        { quantity: -6, cost: 7857, type: "PURCHASE_REVERSAL" },
        { quantity: -1, cost: 7858, type: "PURCHASE_REVERSAL" },
      ]);
      expect(w.repository.getInventoryValuation().find((r) => r.itemId === w.stockItemId)?.quantity ?? 0).toBe(0);
      for (const account of ["INVENTORY", "PAYABLES"]) expect(balancePaise(w.repository, account), account).toBe(0);
    } finally {
      w.repository.close();
    }
  });
});

describe("S17-7: returning discounted stock goes out at the bill's own lot cost", () => {
  it("returns 2 of the 7 units at 78.57 each: credit 157.14, stock 5 @ 78.57 + 1 @ 78.58, ledger = layers", () => {
    const w = setup();
    try {
      const bill = newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }]);
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "Damaged", returnDate: "2026-05-12",
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-(55000 - 15714));
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000 - 15714);
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      const valuation = w.repository.getInventoryValuation().find((r) => r.itemId === w.stockItemId);
      expect(valuation?.quantity).toBe(5);
      expect(valuation?.valuePaise).toBe(balancePaise(w.repository, "INVENTORY"));
      expect(entryBalances(w.repository)).toBe(true);

      // Cancelling the return puts the same cost back.
      w.repository.cancelPurchaseReturn(ret.id);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-55000);
      const after = w.repository.getInventoryValuation().find((r) => r.itemId === w.stockItemId);
      expect(after?.quantity).toBe(7);
      expect(after?.valuePaise).toBe(55000);
    } finally {
      w.repository.close();
    }
  });

  it("returns of the whole bill in two steps bring INVENTORY and Payables to nil, GST included", () => {
    const w = setup();
    try {
      const bill = newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }],
        { taxType: "CGST_SGST", taxRateBasisPoints: 500 });
      const first = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "x", returnDate: "2026-05-12",
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(first.id);
      // 157.14 + 5% GST (7.857 -> 7.86) owed back.
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-(57750 - 15714 - 786));
      const second = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-2", reason: "x", returnDate: "2026-05-13",
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 5, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(second.id);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(0);
      expect(w.repository.getInventoryValuation().find((r) => r.itemId === w.stockItemId)?.quantity ?? 0).toBe(0);
      expect(entryBalances(w.repository)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("a return on a paid bill becomes a supplier refund at the discounted figure", () => {
    const w = setup();
    try {
      const bill = newBill(w, "B1", 15000, [{ itemId: w.stockItemId, description: "Novel", quantity: 7, unitPricePaise: 10000 }]);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 55000, paidOn: "2026-05-11" });
      const ret = w.repository.createPurchaseReturn({
        billId: bill.id, number: "PR-1", reason: "x", returnDate: "2026-05-12",
        lines: [{ itemId: w.stockItemId, description: "Novel", quantity: 2, unitPricePaise: 10000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id);
      expect(w.repository.getPurchaseReturnBalance(ret.id).outstandingPaise).toBe(15714);
      w.repository.recordSupplierRefund({ purchaseReturnId: ret.id, amountPaise: 15714, refundedOn: "2026-05-14" });
      expect(w.repository.getPurchaseReturnBalance(ret.id).outstandingPaise).toBe(0);
      expect(balancePaise(w.repository, "SUPPLIER_CREDITS")).toBe(0);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(55000 - 15714);
    } finally {
      w.repository.close();
    }
  });
});

describe("S17-7 Q2: a settlement discount taken at payment is Discount received", () => {
  it("Rs 1,000 bill, pay 980 + discount 20: settled, money -980, Discount received 20 credit", () => {
    const w = setup();
    try {
      const bill = newBill(w, "B1", 0, [{ description: "Design", quantity: 1, unitPricePaise: 100000 }]);
      const payment = w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 98000, settlementDiscountPaise: 2000, paidOn: "2026-05-20" });
      expect(payment.settlementDiscountPaise).toBe(2000);
      expect(w.repository.getPurchaseBill(bill.id).paidPaise).toBe(100000);
      expect(w.repository.getPayables().find((r) => r.documentId === bill.id)).toBeUndefined();
      expect(balancePaise(w.repository, "CASH")).toBe(-98000);
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(-2000);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(0);
      expect(w.repository.listSupplierPayments({ billId: bill.id })[0]?.settlementDiscountPaise).toBe(2000);
      expect(w.repository.getSupplierStatement(w.supplierId).closingBalancePaise).toBe(0);
      expect(entryBalances(w.repository)).toBe(true);

      // The cap counts amount + discount.
      const other = newBill(w, "B2", 0, [{ description: "Design", quantity: 1, unitPricePaise: 100000 }]);
      expect(() => w.repository.recordSupplierPayment({ billId: other.id, amountPaise: 99000, settlementDiscountPaise: 2000 }))
        .toThrow(/cannot exceed the outstanding/);

      // Cash view: the discount settles the bill like a payment and is income that day.
      const cash = w.repository.getProfitAndLoss({ basis: "CASH", fromDate: "2026-05-01", toDate: "2026-05-31", businessId: w.businessId });
      expect(cash.income.find((r) => r.account === "PURCHASE_DISCOUNT")?.creditPaise).toBe(2000);
      expect(cash.expenses.find((r) => r.account === "EXPENSE")?.balancePaise).toBe(100000);
      expect(cash.netProfitPaise).toBe(-98000);

      // Cancelling reverses every line.
      w.repository.cancelSupplierPayment(payment.id, "test");
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(0);
      expect(balancePaise(w.repository, "CASH")).toBe(0);
      expect(balancePaise(w.repository, "PAYABLES")).toBe(-200000); // both bills owed again
      expect(w.repository.getPurchaseBill(bill.id).paidPaise).toBe(0);
      expect(() => w.repository.getProfitAndLoss({ basis: "CASH", businessId: w.businessId })).not.toThrow();
    } finally {
      w.repository.close();
    }
  });

  it("is accepted over HTTP and refused when negative", async () => {
    const repository = new AccountingRepository();
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    try {
      const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      const businessId = repository.createBusiness({ companyId, name: "Books" });
      const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
      const bill = repository.createPurchaseBill({
        businessId, supplierId, number: "B1", billDate: "2026-05-10", paymentAccount: "PAYABLES",
        lines: [{ description: "Design", quantity: 1, unitPricePaise: 100000 }],
      });
      repository.finalizePurchaseBill(bill.id);
      const ok = await app.inject({ method: "POST", url: "/supplier-payments", payload: { billId: bill.id, amountPaise: 98000, settlementDiscountPaise: 2000 } });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ amountPaise: 98000, settlementDiscountPaise: 2000 });
      const bad = await app.inject({ method: "POST", url: "/supplier-payments", payload: { billId: bill.id, amountPaise: 100, settlementDiscountPaise: -1 } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
