import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations, runMigrations } from "./migrations.js";
import { AccountingRepository } from "./repository.js";

/** Every version after v, derived from the list: 'upgrading a vN database applies the rest'.
 *  Adding a migration must never require editing a literal here. */
const versionsAfter = (v: number): number[] => migrations.filter((m) => m.version > v).map((m) => m.version);

function setup() {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Test Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  return { repository, companyId, businessId };
}

function journalCount(repository: AccountingRepository): number {
  return (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;
}

describe("customer numbering", () => {
  it("allocates SCH0001, SCH0002 per category and restarts for another category", () => {
    const { repository, companyId } = setup();
    try {
      const a = repository.createCustomer({ companyId, name: "A School", numberingCategory: "SCH" });
      const b = repository.createCustomer({ companyId, name: "B School", numberingCategory: "SCH" });
      const l = repository.createCustomer({ companyId, name: "A Library", numberingCategory: "LIB" });
      const plain = repository.createCustomer({ companyId, name: "Walk-in" });
      const byId = new Map(repository.listCustomers(companyId).map((c) => [c.id, c]));
      expect(byId.get(a)?.customerNumber).toBe("SCH0001");
      expect(byId.get(b)?.customerNumber).toBe("SCH0002");
      expect(byId.get(l)?.customerNumber).toBe("LIB0001");
      expect(byId.get(plain)?.customerNumber).toBeNull();
      expect(byId.get(plain)?.active).toBe(true);
    } finally {
      repository.close();
    }
  });

  it("keeps separate sequences per company", () => {
    const { repository, companyId } = setup();
    try {
      const other = repository.createCompany({ name: "Other Co" });
      repository.createCustomer({ companyId, name: "One", numberingCategory: "SCH" });
      const second = repository.createCustomer({ companyId: other, name: "Two", numberingCategory: "SCH" });
      expect(repository.listCustomers(other).find((c) => c.id === second)?.customerNumber).toBe("SCH0001");
    } finally {
      repository.close();
    }
  });

  it("rejects invalid classification or numbering category", () => {
    const { repository, companyId } = setup();
    try {
      expect(() => repository.createCustomer({ companyId, name: "X", classification: "Wizard" })).toThrow("Classification");
      expect(() => repository.createCustomer({ companyId, name: "X", numberingCategory: "ZZZ" })).toThrow("Numbering category");
      expect(repository.listCustomers(companyId)).toHaveLength(0);
    } finally {
      repository.close();
    }
  });
});

describe("customer profile, duplicates, active, delete", () => {
  it("updates profile fields and audits, without touching the customer number", () => {
    const { repository, companyId } = setup();
    try {
      const id = repository.createCustomer({ companyId, name: "Old", numberingCategory: "GEN", classification: "Business" });
      repository.updateCustomer(id, { name: "New", gstin: "27AAAAA0000A1Z5", classification: "Trust", phone: null });
      const row = repository.listCustomers(companyId).find((c) => c.id === id);
      expect(row).toMatchObject({ name: "New", gstin: "27AAAAA0000A1Z5", classification: "Trust", phone: null, customerNumber: "GEN0001" });
      expect(repository.listAuditEvents(id).map((e) => e.action)).toContain("customer.updated");
      expect(() => repository.updateCustomer(id, { classification: "Nope" })).toThrow("Classification");
      expect(() => repository.updateCustomer("missing", { name: "x" })).toThrow("not found");
    } finally {
      repository.close();
    }
  });

  it("finds duplicates by name/phone/email/gstin and never blocks create", () => {
    const { repository, companyId } = setup();
    try {
      const first = repository.createCustomer({ companyId, name: "Delhi Public School", phone: "9990001111", email: "dps@example.com", gstin: "07AAAAA0000A1Z5" });
      const dup = repository.createCustomer({ companyId, name: "delhi public school", phone: "9990001111", email: "dps@example.com", gstin: "07AAAAA0000A1Z5" });
      expect(dup).not.toBe(first);
      expect(repository.findDuplicateCustomers({ companyId, name: "Delhi Public School" })).toHaveLength(2);
      expect(repository.findDuplicateCustomers({ companyId, phone: "9990001111" })).toHaveLength(2);
      expect(repository.findDuplicateCustomers({ companyId, email: "DPS@example.com" })).toHaveLength(2);
      expect(repository.findDuplicateCustomers({ companyId, gstin: "07aaaaa0000a1z5" })).toHaveLength(2);
      expect(repository.findDuplicateCustomers({ companyId, name: "Someone Else" })).toHaveLength(0);
      expect(repository.findDuplicateCustomers({ companyId })).toHaveLength(0);
    } finally {
      repository.close();
    }
  });

  it("toggles active, filters the list, and audits", () => {
    const { repository, companyId } = setup();
    try {
      const id = repository.createCustomer({ companyId, name: "Toggle" });
      repository.setCustomerActive(id, false);
      expect(repository.listCustomers(companyId, { activeOnly: true })).toHaveLength(0);
      expect(repository.listCustomers(companyId)).toHaveLength(1);
      repository.setCustomerActive(id, true);
      expect(repository.listCustomers(companyId, { activeOnly: true })).toHaveLength(1);
      expect(repository.listAuditEvents(id).map((e) => e.action)).toEqual(
        expect.arrayContaining(["customer.deactivated", "customer.activated"]),
      );
    } finally {
      repository.close();
    }
  });

  it("deletes an unlinked customer but refuses one with an invoice", () => {
    const { repository, companyId, businessId } = setup();
    try {
      const unlinked = repository.createCustomer({ companyId, name: "Unlinked" });
      const linked = repository.createCustomer({ companyId, name: "Linked" });
      repository.saveDraft({
        id: "inv-1", number: "INV-1", businessId, customerId: linked, paymentAccount: "CASH", status: "DRAFT",
        lines: [{ description: "Thing", quantity: 1, unitPricePaise: 100 }],
      });
      expect(() => repository.deleteCustomer(linked)).toThrow("inactive");
      repository.deleteCustomer(unlinked);
      expect(repository.listCustomers(companyId).map((c) => c.id)).toEqual([linked]);
      expect(repository.listAuditEvents(unlinked).map((e) => e.action)).toContain("customer.deleted");
    } finally {
      repository.close();
    }
  });

  it("refuses to delete a customer hosting a fair", () => {
    const { repository, companyId } = setup();
    try {
      const host = repository.createCustomer({ companyId, name: "Host" });
      repository.createFair({ companyId, hostCustomerId: host, name: "Fair" });
      expect(() => repository.deleteCustomer(host)).toThrow("inactive");
    } finally {
      repository.close();
    }
  });
});

describe("items", () => {
  it("enriches, updates, toggles active and validates paise", () => {
    const { repository, companyId } = setup();
    try {
      const id = repository.createItem({
        companyId, name: "Atlas", unit: "each", description: "World atlas",
        sellingPricePaise: 50000, costPricePaise: 30000, mrpPaise: 55000, reorderThreshold: 5,
      });
      expect(repository.listItems(companyId)[0]).toMatchObject({
        sellingPricePaise: 50000, costPricePaise: 30000, mrpPaise: 55000, reorderThreshold: 5, description: "World atlas", active: true,
      });
      repository.updateItem(id, { sellingPricePaise: 60000, mrpPaise: null, name: "Atlas 2" });
      expect(repository.listItems(companyId)[0]).toMatchObject({ name: "Atlas 2", sellingPricePaise: 60000, mrpPaise: null });
      repository.setItemActive(id, false);
      expect(repository.listItems(companyId, { activeOnly: true })).toHaveLength(0);
      expect(repository.listAuditEvents(id).map((e) => e.action)).toEqual(
        expect.arrayContaining(["item.updated", "item.deactivated"]),
      );
      expect(() => repository.createItem({ companyId, name: "Bad", unit: "each", sellingPricePaise: -1 })).toThrow("non-negative");
      expect(() => repository.createItem({ companyId, name: "Bad", unit: "each", costPricePaise: 1.5 })).toThrow("non-negative");
      expect(() => repository.createItem({ companyId, name: "Bad", unit: "each", reorderThreshold: -2 })).toThrow("non-negative");
      expect(() => repository.updateItem(id, { mrpPaise: -5 })).toThrow("non-negative");
    } finally {
      repository.close();
    }
  });
});

describe("inventory reports (read-only; the OPENING movements themselves now post - R4c)", () => {
  it("values stock FIFO, flags low stock, and totals sales by item", () => {
    const { repository, companyId, businessId } = setup();
    try {
      const customerId = repository.createCustomer({ companyId, name: "Buyer" });
      const tracked = repository.createItem({ companyId, name: "Notebook", unit: "each", trackStock: true, reorderThreshold: 5 });
      const noThreshold = repository.createItem({ companyId, name: "Pen", unit: "each", trackStock: true });
      const plain = repository.createItem({ companyId, name: "Service", unit: "each" });
      repository.addStockMovement({ itemId: tracked, movementType: "OPENING", quantity: 10, unitCostPaise: 100 });
      repository.addStockMovement({ itemId: tracked, movementType: "PURCHASE", quantity: 5, unitCostPaise: 120 });
      repository.addStockMovement({ itemId: noThreshold, movementType: "OPENING", quantity: 1, unitCostPaise: 10 });
      // CHANGED BY R4c, DELIBERATELY. This used to assert 0: hand-entered stock moved inventory
      // with no GL effect at all, which is the carry-over R4c retires (owner ruling S5-3). The two
      // OPENING movements now post Dr INVENTORY / Cr OPENING_BALANCE_EQUITY; the bare PURCHASE
      // still posts nothing, because a real purchase posts its GL on the bill.
      expect(journalCount(repository)).toBe(2);
      expect(repository.getTrialBalance({ businessId }).find((r) => r.account === "OPENING_BALANCE_EQUITY"))
        .toMatchObject({ debitPaise: 0, creditPaise: 1000 + 10 });

      const before = repository.getInventoryValuation();
      expect(before).toEqual([
        { itemId: tracked, itemName: "Notebook", unit: "each", quantity: 15, valuePaise: 1000 + 600 },
        { itemId: noThreshold, itemName: "Pen", unit: "each", quantity: 1, valuePaise: 10 },
      ]);
      expect(repository.getLowStockItems()).toEqual([]);
      // The REPORTS still post nothing of their own: reading never writes.
      expect(journalCount(repository)).toBe(2);

      repository.saveDraft({
        id: "inv-1", number: "INV-1", businessId, customerId, paymentAccount: "CASH", status: "DRAFT",
        lines: [
          { itemId: tracked, description: "Notebook", quantity: 12, unitPricePaise: 500 },
          { itemId: plain, description: "Service", quantity: 2, unitPricePaise: 1000 },
        ],
      });
      repository.finalizeInvoice("inv-1");
      repository.saveDraft({
        id: "inv-2", number: "INV-2", businessId, customerId, paymentAccount: "CASH", status: "DRAFT",
        lines: [{ itemId: tracked, description: "Notebook", quantity: 1, unitPricePaise: 450 }],
      });
      repository.finalizeInvoice("inv-2");
      // Draft invoice must not count.
      repository.saveDraft({
        id: "inv-3", number: "INV-3", businessId, customerId, paymentAccount: "CASH", status: "DRAFT",
        lines: [{ itemId: tracked, description: "Notebook", quantity: 1, unitPricePaise: 450 }],
      });

      // 15 on hand - 12 - 1 = 2 left; FIFO: 10@100 and 2@120 consumed by inv-1, 1@120 by inv-2 -> 2@120 left.
      const after = repository.getInventoryValuation().find((r) => r.itemId === tracked);
      expect(after).toMatchObject({ quantity: 2, valuePaise: 240 });
      expect(repository.getLowStockItems()).toEqual([
        { itemId: tracked, itemName: "Notebook", unit: "each", quantity: 2, reorderThreshold: 5 },
      ]);
      expect(repository.getSalesByItem()).toEqual([
        { itemId: tracked, itemName: "Notebook", unit: "each", quantity: 13, salesPaise: 12 * 500 + 450 },
        { itemId: plain, itemName: "Service", unit: "each", quantity: 2, salesPaise: 2000 },
      ]);
    } finally {
      repository.close();
    }
  });

  it("low stock includes items exactly at the threshold", () => {
    const { repository, companyId } = setup();
    try {
      const item = repository.createItem({ companyId, name: "Edge", unit: "each", trackStock: true, reorderThreshold: 3 });
      repository.addStockMovement({ itemId: item, movementType: "OPENING", quantity: 3, unitCostPaise: 1 });
      expect(repository.getLowStockItems().map((r) => r.itemId)).toEqual([item]);
    } finally {
      repository.close();
    }
  });
});

describe("migration v3", () => {
  it("records version 3, adds columns and counter table, and is a no-op on re-run", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE version = 3").get()).toEqual({ name: "customer_item_inventory" });
    const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols("customers")).toEqual(expect.arrayContaining(["customer_number", "classification", "gstin", "website", "phone2", "billing_address", "shipping_address", "internal_notes", "numbering_category", "active"]));
    expect(cols("items")).toEqual(expect.arrayContaining(["description", "selling_price_paise", "cost_price_paise", "mrp_paise", "reorder_threshold", "active"]));
    expect(cols("customer_number_counters")).toEqual(["company_id", "category", "next_seq"]);
    expect(runMigrations(db)).toEqual([]);
  });

  it("keeps existing customer and item rows when upgrading from v2", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db, migrations.filter((m) => m.version <= 2));
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Co', '2026-01-01')").run();
    db.prepare("INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu1', 'c1', 'Old Customer', '2026-01-01')").run();
    db.prepare("INSERT INTO items (id, company_id, name, unit, created_at) VALUES ('i1', 'c1', 'Old Item', 'each', '2026-01-01')").run();
    expect(runMigrations(db)).toEqual(versionsAfter(2));
    expect(db.prepare("SELECT name, active, customer_number FROM customers WHERE id = 'cu1'").get()).toEqual({ name: "Old Customer", active: 1, customer_number: null });
    expect(db.prepare("SELECT name, active, selling_price_paise FROM items WHERE id = 'i1'").get()).toEqual({ name: "Old Item", active: 1, selling_price_paise: null });
  });
});
