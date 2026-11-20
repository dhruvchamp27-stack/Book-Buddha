import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import type { Invoice } from "../accounting/types.js";
import { EXPORT_DATASETS, buildExport, formatBasisPoints, formatPaise, toCsv, toJsonExport } from "./exports.js";

/** Minimal RFC 4180 reader, local to the test so it does not depend on the codec. */
function readCsv(csv: string): string[][] {
  const text = csv.startsWith("﻿") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; }
    else cell += ch;
  }
  return rows;
}

let repo: AccountingRepository;
let companyId: string;
let businessId: string;

beforeEach(() => {
  repo = new AccountingRepository();
  companyId = repo.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = repo.createBusiness({ companyId, name: "Biz" });
});
afterEach(() => repo.close());

function seedBooks(): void {
  const customerId = repo.createCustomer({ companyId, name: "Greenfield, \"The\" School", numberingCategory: "SCH", phone: "999", internalNotes: "line1\nline2" });
  const supplierId = repo.createSupplier({ companyId, name: "Paper Co" });
  const itemId = repo.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true, sellingPricePaise: 123450, costPricePaise: 50000, reorderThreshold: 5 });
  repo.addStockMovement({ itemId, movementType: "OPENING", quantity: 20, unitCostPaise: 4000, businessId, occurredOn: "2026-04-02" });
  const bill = repo.createPurchaseBill({
    businessId, supplierId, number: "PB-1", billDate: "2026-04-10", paymentAccount: "PAYABLES", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
    lines: [{ itemId, description: "Atlas", quantity: 10, unitPricePaise: 5000 }],
  });
  repo.finalizePurchaseBill(bill.id);
  const invoice: Invoice = {
    id: "inv1", number: "INV-1", businessId, customerId, invoiceDate: "2026-04-15", dueDate: "2026-05-15", status: "DRAFT",
    paymentAccount: "RECEIVABLES", taxType: "CGST_SGST", taxRateBasisPoints: 250, discountPaise: 100,
    lines: [
      { itemId, description: "Atlas", quantity: 6, unitPricePaise: 123450 },
      { description: "Delivery, \"special\"", quantity: 1, unitPricePaise: 5000 },
    ],
  };
  repo.saveDraft(invoice);
  repo.finalizeInvoice("inv1");
  repo.recordPayment("inv1", 20000, "2026-04-20");
  repo.saveCreditNote({ id: "cn1", invoiceId: "inv1", number: "CN-1", reason: "Return", status: "DRAFT", lines: [{ itemId, description: "Returned", quantity: 1, unitPricePaise: 123450 }] });
  repo.finalizeCreditNote("cn1");
  repo.recordSupplierPayment({ billId: bill.id, amountPaise: 10000, paidOn: "2026-04-25" });
}

describe("money and percent formatting", () => {
  it("writes Rs 1,234.50 as 1234.50 and keeps signs, with no float arithmetic", () => {
    expect(formatPaise(123450)).toBe("1234.50");
    expect(formatPaise(-1200)).toBe("-12.00");
    expect(formatPaise(5)).toBe("0.05");
    expect(formatPaise(0)).toBe("0.00");
    expect(formatPaise(Number.MAX_SAFE_INTEGER)).toBe("90071992547409.91");
    expect(() => formatPaise(1.5)).toThrow();
  });
  it("writes basis points as a plain percent", () => {
    expect([1800, 250, 125, 0, 5].map(formatBasisPoints)).toEqual(["18", "2.5", "1.25", "0", "0.05"]);
  });
});

describe("fixed headers", () => {
  it("customers, suppliers, items and invoices use the importer's labels exactly", () => {
    const party = ["Name", "Email", "Phone", "Phone 2", "Classification", "GSTIN", "Website", "Billing address", "Shipping address", "Notes"];
    expect(buildExport(repo, "customers").columns).toEqual([...party, "Customer number", "Active"]);
    expect(buildExport(repo, "suppliers").columns).toEqual([...party, "Active"]);
    expect(buildExport(repo, "items").columns).toEqual(["Name", "Unit", "Track stock", "Description", "Selling price", "Cost price", "MRP", "Reorder level", "Active"]);
    expect(buildExport(repo, "invoices").columns).toEqual([
      "Number", "Invoice date", "Due date", "Customer", "Status", "Item", "Description", "Quantity", "Unit price", "Discount", "Extra charge",
      "Tax type", "Tax rate", "Fair", "Notes",
    ]);
  });

  it("every dataset builds on an empty book, and every row is as wide as its header", () => {
    for (const dataset of EXPORT_DATASETS) {
      const t = buildExport(repo, dataset);
      expect(t.columns.length).toBeGreaterThan(0);
      expect(t.rows).toEqual([]);
    }
    seedBooks();
    for (const dataset of EXPORT_DATASETS) {
      const t = buildExport(repo, dataset);
      expect(t.rows.length, dataset).toBeGreaterThan(0);
      for (const row of t.rows) expect(row).toHaveLength(t.columns.length);
    }
  });
});

describe("values", () => {
  it("items export money as rupees with two decimals", () => {
    seedBooks();
    const t = buildExport(repo, "items");
    const row = t.rows[0] as string[];
    expect(row[t.columns.indexOf("Selling price")]).toBe("1234.50");
    expect(row[t.columns.indexOf("Cost price")]).toBe("500.00");
    expect(row[t.columns.indexOf("MRP")]).toBe("");
    expect(row[t.columns.indexOf("Reorder level")]).toBe("5");
    expect(row[t.columns.indexOf("Track stock")]).toBe("Yes");
  });

  it("invoices export one row per line with the header fields repeated", () => {
    seedBooks();
    const t = buildExport(repo, "invoices");
    expect(t.rows).toHaveLength(2);
    const col = (name: string): number => t.columns.indexOf(name);
    const [a, b] = t.rows as [string[], string[]];
    for (const name of ["Number", "Invoice date", "Due date", "Customer", "Status", "Discount", "Tax type", "Tax rate"]) {
      expect(a[col(name)], name).toBe(b[col(name)]);
    }
    expect(a[col("Number")]).toBe("INV-1");
    expect(a[col("Invoice date")]).toBe("2026-04-15");
    expect(a[col("Discount")]).toBe("1.00");
    expect(a[col("Tax rate")]).toBe("2.5");
    expect(a[col("Unit price")]).toBe("1234.50");
    expect(a[col("Item")]).toBe("Atlas");
    expect(b[col("Item")]).toBe("");
    expect(b[col("Description")]).toBe("Delivery, \"special\"");
  });

  it("the other documents, stock, journal and trial balance carry the posted figures", () => {
    seedBooks();
    const payments = buildExport(repo, "payments");
    expect(payments.rows[0]?.[payments.columns.indexOf("Amount")]).toBe("200.00");
    expect(payments.rows[0]?.[payments.columns.indexOf("Status")]).toBe("Active");
    expect(buildExport(repo, "credit-notes").rows).toHaveLength(1);
    expect(buildExport(repo, "purchase-bills").rows).toHaveLength(1);
    expect(buildExport(repo, "supplier-payments").rows[0]?.[4]).toBe("100.00");
    const stock = buildExport(repo, "stock-movements");
    const valueCol = stock.columns.indexOf("Value");
    expect(stock.rows.some((r) => r[valueCol] === "800.00")).toBe(true); // 20 x Rs 40.00
    const journal = buildExport(repo, "journal-entries");
    const dr = journal.columns.indexOf("Debit");
    const cr = journal.columns.indexOf("Credit");
    const sum = (i: number): number => journal.rows.reduce((s, r) => s + Math.round(Number(r[i]) * 100), 0);
    expect(sum(dr)).toBe(sum(cr));
    expect(buildExport(repo, "trial-balance").rows.length).toBeGreaterThan(0);
  });

  it("scope: another company sees nothing of this one", () => {
    seedBooks();
    const other = repo.createCompany({ name: "Other", accountingBasis: "ACCRUAL" });
    expect(buildExport(repo, "customers", { companyId: other }).rows).toEqual([]);
    expect(buildExport(repo, "invoices", { companyId: other }).rows).toEqual([]);
    expect(buildExport(repo, "invoices", { companyId }).rows).toHaveLength(2);
    expect(buildExport(repo, "invoices", { businessId: "nope" }).rows).toEqual([]);
    expect(buildExport(repo, "stock-movements", { companyId: other }).rows).toEqual([]);
  });
});

describe("journal entries", () => {
  it("carry the entry date and honour the business filter", () => {
    seedBooks();
    const otherBusiness = repo.createBusiness({ companyId, name: "Biz 2" });
    const itemId = repo.listItems(companyId)[0]?.id as string;
    repo.addStockMovement({ itemId, movementType: "OPENING", quantity: 3, unitCostPaise: 1000, businessId: otherBusiness, occurredOn: "2026-03-01" });

    const all = buildExport(repo, "journal-entries");
    expect(all.columns).toEqual(["Entry date", "Entry ID", "Source type", "Source ID", "Description", "Reversal", "Account", "Debit", "Credit"]);
    const dateCol = all.columns.indexOf("Entry date");
    expect(all.rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[dateCol] as string))).toBe(true);
    const dates = all.rows.map((r) => r[dateCol] as string);
    expect([...dates].sort()).toEqual(dates); // entry-date order
    expect(dates).toContain("2026-04-15");

    const idCol = all.columns.indexOf("Entry ID");
    const mine = buildExport(repo, "journal-entries", { businessId });
    const theirs = buildExport(repo, "journal-entries", { businessId: otherBusiness });
    expect(theirs.rows.length).toBeGreaterThan(0);
    expect(theirs.rows.every((r) => r[dateCol] === "2026-03-01")).toBe(true);
    const theirIds = new Set(theirs.rows.map((r) => r[idCol]));
    expect(mine.rows.some((r) => theirIds.has(r[idCol]))).toBe(false);
    expect(mine.rows.length + theirs.rows.length).toBe(all.rows.length);
    // company scope = all of its businesses; another company sees nothing
    expect(buildExport(repo, "journal-entries", { companyId }).rows).toHaveLength(all.rows.length);
    const other = repo.createCompany({ name: "Other", accountingBasis: "ACCRUAL" });
    expect(buildExport(repo, "journal-entries", { companyId: other }).rows).toEqual([]);
  });
});

describe("CSV", () => {
  it("starts with a UTF-8 BOM and uses CRLF line ends", () => {
    seedBooks();
    const csv = toCsv(buildExport(repo, "customers"));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect([...Buffer.from(csv, "utf8").subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.endsWith("\r\n")).toBe(true);
    // Every record ends CRLF; the only bare LF left is the one inside the quoted Notes cell.
    const withoutRecordEnds = csv.replace(/\r\n/g, "");
    expect(withoutRecordEnds.split("\n")).toHaveLength(2);
    expect(withoutRecordEnds).toContain("line1\nline2");
  });

  it("quotes commas, quotes and newlines per RFC 4180 and reads back to the same cells", () => {
    seedBooks();
    const t = buildExport(repo, "customers");
    const back = readCsv(toCsv(t));
    expect(back[0]).toEqual([...t.columns]);
    expect(back[1]?.[0]).toBe("Greenfield, \"The\" School");
    expect(back[1]?.[t.columns.indexOf("Notes")]).toBe("line1\nline2");
    expect(back.slice(1)).toEqual(t.rows.map((r) => [...r]));
  });

  it("neutralises a name starting with =, +, -, @, tab or CR; leaves numbers and plain text alone", () => {
    for (const name of ["=HYPERLINK(\"x\")", "+1", "-2", "@sum", "\tx", "\rx", "Plain = fine"]) {
      repo.createCustomer({ companyId, name });
    }
    const names = readCsv(toCsv(buildExport(repo, "customers"))).slice(1).map((r) => r[0]);
    expect(names).toContain("'=HYPERLINK(\"x\")");
    expect(names).toContain("'+1");
    expect(names).toContain("'-2");
    expect(names).toContain("'@sum");
    expect(names).toContain("'\tx");
    expect(names).toContain("'\rx");
    expect(names).toContain("Plain = fine");
    // A numeric column is never prefixed: a negative amount stays -12.00.
    const csv2 = toCsv({ columns: ["Name", "Amount"], rows: [["-x", "-12.00"]], nonTextColumns: [1] });
    expect(readCsv(csv2 + "")[1]).toEqual(["'-x", "-12.00"]);
  });
});

describe("JSON", () => {
  it("rows equal the CSV rows, keyed by the CSV headers", () => {
    seedBooks();
    for (const dataset of ["customers", "items", "invoices"] as const) {
      const t = buildExport(repo, dataset);
      const json = toJsonExport(dataset, t, "2026-11-20T00:00:00.000Z");
      const csvRows = readCsv(toCsv(t));
      expect(json.dataset).toBe(dataset);
      expect(json.exportedAt).toBe("2026-11-20T00:00:00.000Z");
      expect([...json.columns]).toEqual(csvRows[0]);
      expect(json.rows.map((r) => json.columns.map((c) => r[c]))).toEqual(csvRows.slice(1));
    }
  });

  it("is not formula-prefixed: it stays exactly what is in the books", () => {
    repo.createCustomer({ companyId, name: "=cmd" });
    const json = toJsonExport("customers", buildExport(repo, "customers"), "x");
    expect(json.rows[0]?.["Name"]).toBe("=cmd");
  });
});
