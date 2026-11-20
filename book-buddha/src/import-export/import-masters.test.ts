import { describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { parseTabular, type DateFormat } from "./codec.js";
import { buildExport, toCsv } from "./exports.js";
import { runImport, suggestColumnMap, type ImportMode, type ImportResult } from "./import-engine.js";
import { MASTER_IMPORT_KINDS } from "./import-masters.js";

/**
 * R10-C: the master-data import kinds. Each "Must pass" item of the design has a named test.
 * Files are built as CSV text and go through the real codec, column suggestion and engine.
 */

function world(): { repository: AccountingRepository; companyId: string; businessId: string } {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  return { repository, companyId, businessId };
}

const quote = (cell: string): string => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
const csv = (rows: readonly (readonly string[])[]): string => `${rows.map((r) => r.map(quote).join(",")).join("\r\n")}\r\n`;

function run(
  w: { repository: AccountingRepository; companyId: string; businessId: string },
  kind: string,
  text: string,
  options: { mode?: ImportMode; dateFormat?: DateFormat; noBusiness?: boolean } = {},
): ImportResult {
  const parsed = parseTabular({ fileName: "file.csv", bytes: new TextEncoder().encode(text) });
  return runImport({
    repository: w.repository,
    kind,
    parsed,
    columnMap: suggestColumnMap(kind, parsed.headers),
    companyId: w.companyId,
    ...(options.noBusiness === true ? {} : { businessId: w.businessId }),
    dateFormat: options.dateFormat ?? "YYYY-MM-DD",
    mode: options.mode ?? "COMMIT",
  });
}

const statuses = (r: ImportResult): string[] => r.outcomes.map((o) => o.status);

describe("master data import kinds", () => {
  it("lists the six kinds with the export headers as their labels", () => {
    expect(MASTER_IMPORT_KINDS.map((k) => k.kind)).toEqual([
      "customers", "suppliers", "items", "opening-balances", "opening-customer-balances", "opening-supplier-balances",
    ]);
    const labels = (kind: string): string[] => (MASTER_IMPORT_KINDS.find((k) => k.kind === kind)?.fields ?? []).map((f) => f.label);
    expect(labels("customers")).toEqual([
      "Name", "Email", "Phone", "Phone 2", "Classification", "GSTIN", "Website", "Billing address", "Shipping address", "Notes",
      "Customer number", "Active",
    ]);
    expect(labels("suppliers")).not.toContain("Customer number");
    expect(labels("items").slice(0, 9)).toEqual([
      "Name", "Unit", "Track stock", "Description", "Selling price", "Cost price", "MRP", "Reorder level", "Active",
    ]);
  });

  it("creates customers with every field, a number, and an audit event", () => {
    const w = world();
    const result = run(w, "customers", csv([
      ["Name", "Email", "Phone", "Classification", "GSTIN", "Billing address", "Notes", "Customer number", "Active"],
      ["Greenfield School", "g@x.in", "99999", "trust", "07AAAAA0000A1Z5", "1 Main Rd, Delhi", "good payer", "ZZZ999", "yes"],
      ["Old Library", "", "", "", "", "", "", "", "no"],
      ["St Mary School", "", "", "", "", "", "", "SCH0007", "yes"],
    ]));
    expect([result.created, result.failed]).toEqual([3, 0]);
    const customers = w.repository.listCustomers(w.companyId);
    const green = customers.find((c) => c.name === "Greenfield School");
    expect(green).toMatchObject({
      email: "g@x.in", phone: "99999", classification: "Trust", gstin: "07AAAAA0000A1Z5",
      billingAddress: "1 Main Rd, Delhi", internalNotes: "good payer", active: true,
    });
    // The number is never copied, it is allocated - but its category prefix is kept: SCH0007 -> the
    // next SCH number; an unknown prefix (ZZZ999) -> GEN; a blank cell -> no number at all.
    const numberOf = (name: string) => customers.find((c) => c.name === name)?.customerNumber ?? null;
    expect([numberOf("Greenfield School"), numberOf("Old Library"), numberOf("St Mary School")]).toEqual(["GEN0001", null, "SCH0001"]);
    expect(customers.find((c) => c.name === "Old Library")?.active).toBe(false);
    for (const c of customers) {
      expect(w.repository.listAuditEvents(c.id).map((e) => e.action)).toContain("customer.created");
    }
  });

  it("skips a duplicate customer by name (any case or spacing) and by GSTIN, and is safe to re-run", () => {
    const w = world();
    const file = csv([["Name", "GSTIN"], ["Greenfield School", "07AAAAA0000A1Z5"]]);
    expect(statuses(run(w, "customers", file))).toEqual(["CREATED"]);
    const again = run(w, "customers", csv([
      ["Name", "GSTIN"],
      ["  GREENFIELD   school ", ""],
      ["A Different Name", "07aaaaa0000a1z5"],
      ["Brand New", ""],
    ]));
    expect(statuses(again)).toEqual(["SKIPPED", "SKIPPED", "CREATED"]);
    expect(again.outcomes[0]?.message).toBe("already exists");
    expect(again.outcomes[1]?.message).toBe("already exists");
    expect(w.repository.listCustomers(w.companyId)).toHaveLength(2);
    expect(statuses(run(w, "customers", file))).toEqual(["SKIPPED"]);
  });

  it("collects a bad customer row without stopping the rest", () => {
    const w = world();
    const result = run(w, "customers", csv([
      ["Name", "Classification"], ["Good One", ""], ["Bad One", "Wizard"], ["", "Trust"], ["Good Two", ""],
    ]));
    expect(statuses(result)).toEqual(["CREATED", "FAILED", "FAILED", "CREATED"]);
    expect(result.outcomes[1]?.message).toMatch(/Classification must be one of/);
    expect(result.outcomes[2]?.message).toMatch(/"Name" is required/);
    expect(w.repository.listCustomers(w.companyId).map((c) => c.name).sort()).toEqual(["Good One", "Good Two"]);
  });

  it("creates suppliers, skips duplicates by name and GSTIN, with an audit event", () => {
    const w = world();
    const result = run(w, "suppliers", csv([
      ["Name", "Phone", "GSTIN", "Active"], ["Paper Mill", "111", "29BBBBB1111B1Z5", "yes"], ["Ink Co", "", "", "no"],
    ]));
    expect(statuses(result)).toEqual(["CREATED", "CREATED"]);
    const suppliers = w.repository.listSuppliers(w.companyId);
    expect(suppliers.find((s) => s.name === "Ink Co")?.active).toBe(false);
    for (const s of suppliers) expect(w.repository.listAuditEvents(s.id).map((e) => e.action).join(",")).toMatch(/supplier/);
    const again = run(w, "suppliers", csv([["Name", "GSTIN"], ["paper mill", ""], ["Other", "29bbbbb1111b1z5"]]));
    expect(statuses(again)).toEqual(["SKIPPED", "SKIPPED"]);
    expect(w.repository.listSuppliers(w.companyId)).toHaveLength(2);
  });

  it("creates items with prices in paise and an audit event", () => {
    const w = world();
    const result = run(w, "items", csv([
      ["Name", "Unit", "Track stock", "Description", "Selling price", "Cost price", "MRP", "Reorder level", "Active"],
      ["Atlas", "each", "yes", "World atlas", "1,234.50", "800", "1500.00", "10", "yes"],
    ]));
    expect(statuses(result)).toEqual(["CREATED"]);
    const item = w.repository.listItems(w.companyId)[0];
    expect(item).toMatchObject({
      name: "Atlas", unit: "each", trackStock: true, description: "World atlas", sellingPricePaise: 123450,
      costPricePaise: 80000, mrpPaise: 150000, reorderThreshold: 10, active: true,
    });
    expect(w.repository.listAuditEvents(item?.id).map((e) => e.action)).toContain("item.created");
  });

  it("updates an existing item's price on re-import instead of making a second item", () => {
    const w = world();
    run(w, "items", csv([["Name", "Unit", "Selling price", "Description"], ["Atlas", "each", "500", "keep me"]]));
    const again = run(w, "items", csv([["Name", "Selling price"], ["  atlas ", "650.25"]]));
    expect(statuses(again)).toEqual(["UPDATED"]);
    const items = w.repository.listItems(w.companyId);
    expect(items).toHaveLength(1);
    // Blank cells leave other fields alone.
    expect(items[0]).toMatchObject({ sellingPricePaise: 65025, unit: "each", description: "keep me" });
    // The same price again changes nothing.
    expect(statuses(run(w, "items", csv([["Name", "Selling price"], ["Atlas", "650.25"]])))).toEqual(["SKIPPED"]);
  });

  it("refuses to change Track stock on an existing item", () => {
    const w = world();
    run(w, "items", csv([["Name", "Unit", "Track stock"], ["Atlas", "each", "no"]]));
    const again = run(w, "items", csv([["Name", "Track stock"], ["Atlas", "yes"]]));
    expect(statuses(again)).toEqual(["FAILED"]);
    expect(again.outcomes[0]?.message).toMatch(/Track stock/);
    expect(w.repository.listItems(w.companyId)[0]?.trackStock).toBe(false);
  });

  it("posts opening stock for a new stock-tracked item, visible in getStockBalances", () => {
    const w = world();
    const result = run(w, "items", csv([
      ["Name", "Unit", "Track stock", "Opening quantity", "Opening unit cost"], ["Atlas", "each", "yes", "40", "300.50"],
    ]));
    expect(statuses(result)).toEqual(["CREATED"]);
    expect(w.repository.getStockBalances()).toMatchObject([{ itemName: "Atlas", quantity: 40, valuePaise: 40 * 30050 }]);
    // ... and it reaches the ledger.
    expect(w.repository.getTrialBalance({ businessId: w.businessId }).find((r) => r.account === "INVENTORY")?.debitPaise).toBe(40 * 30050);
  });

  it("fails opening stock with no business, and leaves no half-made item", () => {
    const w = world();
    const parsed = parseTabular({
      fileName: "i.csv",
      bytes: new TextEncoder().encode(csv([["Name", "Unit", "Track stock", "Opening quantity", "Opening unit cost"], ["Atlas", "each", "yes", "4", "10"]])),
    });
    const result = runImport({
      repository: w.repository, kind: "items", parsed, columnMap: suggestColumnMap("items", parsed.headers),
      companyId: w.companyId, dateFormat: "YYYY-MM-DD", mode: "COMMIT",
    });
    expect(statuses(result)).toEqual(["FAILED"]);
    expect(w.repository.listItems(w.companyId)).toHaveLength(0);
  });

  it("fails an opening quantity without a cost, or on an item that is not stock-tracked", () => {
    const w = world();
    const result = run(w, "items", csv([
      ["Name", "Unit", "Track stock", "Opening quantity", "Opening unit cost"],
      ["One", "each", "yes", "4", ""], ["Two", "each", "no", "4", "10"],
    ]));
    expect(statuses(result)).toEqual(["FAILED", "FAILED"]);
    expect(w.repository.listItems(w.companyId)).toHaveLength(0);
  });

  it("ignores the opening cells on an existing item and says so in the message", () => {
    const w = world();
    run(w, "items", csv([["Name", "Unit", "Track stock"], ["Atlas", "each", "yes"]]));
    const again = run(w, "items", csv([["Name", "Selling price", "Opening quantity", "Opening unit cost"], ["Atlas", "90", "5", "10"]]));
    expect(statuses(again)).toEqual(["UPDATED"]);
    expect(again.outcomes[0]?.message).toMatch(/opening quantity and cost ignored/);
    expect(w.repository.getStockBalances()[0]?.quantity).toBe(0);
  });

  it("posts one balanced opening-balance set per As-at date, accounts by code or name, and skips a re-run", () => {
    const w = world();
    const file = csv([
      ["As at", "Account", "Debit", "Credit"],
      ["01/04/2026", "BANK", "10,000.00", ""],
      ["01/04/2026", "CAPITAL", "", "6000"],
    ]);
    const result = run(w, "opening-balances", file, { dateFormat: "DD/MM/YYYY" });
    expect(result).toMatchObject({ created: 1, units: 1, totalRows: 2 });
    expect(result.outcomes[0]).toMatchObject({ rowNumbers: [2, 3], reference: "2026-04-01" });
    const sets = w.repository.getOpeningBalances(w.businessId);
    expect(sets).toHaveLength(1);
    expect(sets[0]?.asAt).toBe("2026-04-01");
    expect(sets[0]?.balancingLine).toMatchObject({ account: "OPENING_BALANCE_EQUITY", creditPaise: 400000 });
    const tb = w.repository.getTrialBalance({ businessId: w.businessId });
    expect(tb.reduce((t, r) => t + r.debitPaise, 0)).toBe(tb.reduce((t, r) => t + r.creditPaise, 0));
    expect(statuses(run(w, "opening-balances", file, { dateFormat: "DD/MM/YYYY" }))).toEqual(["SKIPPED"]);
    // an unknown account fails the set
    const bad = run(w, "opening-balances", csv([["As at", "Account", "Debit", "Credit"], ["2026-05-01", "NOPE", "5", ""]]));
    expect(statuses(bad)).toEqual(["FAILED"]);
    expect(bad.outcomes[0]?.message).toMatch(/no account "NOPE"/);
  });

  it("rejects a Business-scoped kind with no business before any row runs", () => {
    const w = world();
    expect(() => run(w, "opening-balances", csv([["As at", "Account", "Debit"], ["2026-04-01", "BANK", "5"]]), { noBusiness: true })).toThrow(/needs a business/);
  });

  it("creates opening customer balances (with and without income) and fails an unknown customer", () => {
    const w = world();
    run(w, "customers", csv([["Name"], ["Greenfield School"], ["Hill College"]]));
    const file = csv([
      ["Customer", "As at", "Amount", "Income amount", "Income account"],
      ["Greenfield School", "2026-03-31", "5,000.00", "", ""],
      ["hill college", "2026-03-31", "3000", "1000", "SALES"],
      ["Nobody", "2026-03-31", "10", "", ""],
    ]);
    const result = run(w, "opening-customer-balances", file);
    expect(statuses(result)).toEqual(["CREATED", "CREATED", "FAILED"]);
    expect(result.outcomes[2]?.message).toMatch(/no customer named "Nobody"/);
    const balances = w.repository.listOpeningCustomerBalances(w.businessId);
    expect(balances.map((b) => [b.amountPaise, b.incomePaise, b.incomeAccount]).sort()).toEqual([[300000, 100000, "SALES"], [500000, 0, null]]);
    expect(statuses(run(w, "opening-customer-balances", file))).toEqual(["SKIPPED", "SKIPPED", "FAILED"]);
  });

  it("creates opening supplier balances and fails an unknown supplier", () => {
    const w = world();
    run(w, "suppliers", csv([["Name"], ["Paper Mill"]]));
    const file = csv([["Supplier", "As at", "Amount"], ["Paper Mill", "2026-03-31", "7500.50"], ["Ghost", "2026-03-31", "1"]]);
    const result = run(w, "opening-supplier-balances", file);
    expect(statuses(result)).toEqual(["CREATED", "FAILED"]);
    expect(w.repository.listOpeningSupplierBalances(w.businessId)[0]).toMatchObject({ amountPaise: 750050 });
    expect(statuses(run(w, "opening-supplier-balances", file))).toEqual(["SKIPPED", "FAILED"]);
  });

  it("a bad amount or date fails that row and names the row and column", () => {
    const w = world();
    run(w, "suppliers", csv([["Name"], ["Paper Mill"]]));
    const result = run(w, "opening-supplier-balances", csv([
      ["Supplier", "As at", "Amount"], ["Paper Mill", "31/02/2026", "5"], ["Paper Mill", "2026-03-31", "12.345"],
    ]));
    expect(statuses(result)).toEqual(["FAILED", "FAILED"]);
    expect(result.outcomes[0]?.message).toMatch(/Row 2: As at/);
    expect(result.outcomes[1]?.message).toMatch(/Row 3: Amount/);
  });

  it("round trip: customers and items exported, then imported into a fresh database, export the same", () => {
    const a = world();
    a.repository.createCustomer({
      companyId: a.companyId, name: "Greenfield School", email: "g@x.in", phone: "999", classification: "Trust",
      gstin: "07AAAAA0000A1Z5", billingAddress: "1 Main Rd, Delhi", internalNotes: "line1\nline2 \"quoted\"", numberingCategory: "GEN",
    });
    const hidden = a.repository.createCustomer({ companyId: a.companyId, name: "Retired, Ltd", numberingCategory: "GEN" });
    a.repository.setCustomerActive(hidden, false);
    a.repository.createItem({
      companyId: a.companyId, name: "Atlas", unit: "each", trackStock: true, description: "World atlas",
      sellingPricePaise: 123450, costPricePaise: 80000, mrpPaise: 150000, reorderThreshold: 10,
    });
    a.repository.createItem({ companyId: a.companyId, name: "Free Poster", unit: "sheet" });

    const customersCsv = toCsv(buildExport(a.repository, "customers", { companyId: a.companyId }));
    const itemsCsv = toCsv(buildExport(a.repository, "items", { companyId: a.companyId }));

    const b = world();
    const customersResult = run(b, "customers", customersCsv);
    const itemsResult = run(b, "items", itemsCsv);
    expect([customersResult.created, customersResult.failed]).toEqual([2, 0]);
    expect([itemsResult.created, itemsResult.failed]).toEqual([2, 0]);

    expect(toCsv(buildExport(b.repository, "customers", { companyId: b.companyId }))).toBe(customersCsv);
    expect(toCsv(buildExport(b.repository, "items", { companyId: b.companyId }))).toBe(itemsCsv);
    // and re-importing the same files into the fresh database changes nothing
    expect(statuses(run(b, "customers", customersCsv))).toEqual(["SKIPPED", "SKIPPED"]);
    expect(statuses(run(b, "items", itemsCsv))).toEqual(["SKIPPED", "SKIPPED"]);
  });
});
