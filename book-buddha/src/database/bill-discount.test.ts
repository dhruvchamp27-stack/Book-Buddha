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
 * It does because the discount is NOT spread into the goods cost - it credits PURCHASE_DISCOUNT.
 * Pushing it into the layers cannot be made exact (a layer holds an integer unit cost), and on a
 * bill of nothing but stock there is no expense debit to net it against. Full reasoning sits on
 * V18_ADDED_ACCOUNTS in chart-accounts-schema.ts.
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
      // The stock is carried at FULL cost: Rs 1,000, not Rs 850.
      expect(valuation?.valuePaise).toBe(100000);
      // THE ACCEPTANCE CHECK.
      expect(balancePaise(w.repository, "INVENTORY")).toBe(valuation?.valuePaise);

      // The discount is real money and is recorded as such, just not inside the stock.
      expect(balancePaise(w.repository, "PURCHASE_DISCOUNT")).toBe(-15000); // credit
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
      expect(valuation?.valuePaise).toBe(70000);
      expect(balancePaise(w.repository, "INVENTORY")).toBe(valuation?.valuePaise);
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
        lines: [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
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
      expect(balancePaise(w.repository, "EXPENSE")).toBe(100000);
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
        lines: [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
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
        lines: [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
      });
      w.repository.finalizePurchaseBill(bill.id);
      w.repository.cancelPurchaseBill(bill.id);

      // Cancel-with-reversal: every account the bill touched is back to nil, and nothing was
      // deleted to get there.
      for (const account of ["PAYABLES", "EXPENSE", "PURCHASE_DISCOUNT", "PURCHASE_EXTRA_CHARGES"]) {
        expect(balancePaise(w.repository, account), account).toBe(0);
      }
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines WHERE account = 'PURCHASE_DISCOUNT'").get())
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
        lines: [{ itemId: w.serviceItemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
      })).toThrow(/cannot exceed the bill subtotal/);
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
      expect(response.statusCode).toBe(400);
      expect(response.body).toMatch(/discountPaise/);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
