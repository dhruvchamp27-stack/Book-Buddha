import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import type { Invoice } from "../accounting/types.js";
import { registerExportRoutes } from "./export-routes.js";
import { buildApi } from "./server.js";
import { todayAt } from "../database/test-clock.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;

beforeEach(async () => {
  repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  // A bare Fastify app with the same RepositoryValidationError -> 400 mapping as buildApi's handler.
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerExportRoutes(app, { repository });
  await app.ready();

  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Biz" });
  const customerId = repository.createCustomer({ companyId, name: "=Evil School", numberingCategory: "SCH" });
  const itemId = repository.createItem({ companyId, name: "Atlas", unit: "each", sellingPricePaise: 123450 });
  const invoice: Invoice = {
    id: "inv1", number: "INV-1", businessId, customerId, invoiceDate: "2026-04-15", status: "DRAFT", paymentAccount: "RECEIVABLES",
    lines: [{ itemId, description: "Atlas", quantity: 2, unitPricePaise: 123450 }, { description: "Delivery", quantity: 1, unitPricePaise: 5000 }],
  };
  repository.saveDraft(invoice);
});
afterEach(async () => {
  await app.close();
  repository.close();
});

describe("export routes", () => {
  it("serves CSV by default with a BOM, CRLF and a dated attachment name", async () => {
    const res = await app.inject({ method: "GET", url: "/exports/items" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-type"])).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment; filename="items-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect([...res.rawPayload.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = res.body.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("Name,Unit,Track stock,Description,Selling price,Cost price,MRP,Reorder level,Active");
    expect(lines[1]).toBe("Atlas,each,No,,1234.50,,,,Yes");
  });

  it("neutralises a formula-looking name in the CSV", async () => {
    const res = await app.inject({ method: "GET", url: `/exports/customers?companyId=${companyId}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("'=Evil School");
  });

  it("serves JSON with the same rows as the CSV", async () => {
    const res = await app.inject({ method: "GET", url: "/exports/invoices?format=json" });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers["content-disposition"])).toMatch(/invoices-\d{4}-\d{2}-\d{2}\.json"$/);
    const json = res.json<{ dataset: string; exportedAt: string; columns: string[]; rows: Array<Record<string, string>> }>();
    expect(json.dataset).toBe("invoices");
    expect(Number.isNaN(Date.parse(json.exportedAt))).toBe(false);
    expect(json.rows).toHaveLength(2); // one row per line
    expect(json.rows.map((r) => r["Number"])).toEqual(["INV-1", "INV-1"]);
    expect(json.rows[0]?.["Unit price"]).toBe("1234.50");

    const csv = await app.inject({ method: "GET", url: "/exports/invoices" });
    const lines = csv.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]?.split(",")).toEqual(json.columns);
  });

  it("an unknown dataset is 400", async () => {
    const res = await app.inject({ method: "GET", url: "/exports/everything" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toContain("Unknown export");
  });

  it("an unknown format or an empty id is 400", async () => {
    expect((await app.inject({ method: "GET", url: "/exports/items?format=xlsx" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/exports/items?companyId=" })).statusCode).toBe(400);
  });

  it("every dataset is reachable", async () => {
    for (const dataset of ["customers", "suppliers", "items", "invoices", "credit-notes", "payments", "purchase-bills", "supplier-payments", "stock-movements", "journal-entries", "trial-balance", "profit-and-loss", "balance-sheet", "customer-balance-detail", "collections", "stock-ageing", "inventory-valuation-detail", "item-profitability"]) {
      const res = await app.inject({ method: "GET", url: `/exports/${dataset}` });
      expect(res.statusCode, dataset).toBe(200);
    }
  });
});

describe("export routes through buildApi (R10-E)", () => {
  it("are behind auth: 401 without a session, 400 for an unknown dataset with one", async () => {
    const repo = new AccountingRepository(":memory:", todayAt("2026-01-01"));
    const built = buildApi(repo);
    try {
      expect((await built.inject({ method: "POST", url: "/auth/setup", payload: { password: "Secret123" } })).statusCode).toBe(201);
      const token = (await built.inject({ method: "POST", url: "/auth/login", payload: { password: "Secret123" } })).json<{ token: string }>().token;
      const headers = { authorization: `Bearer ${token}` };
      expect((await built.inject({ method: "GET", url: "/exports/customers" })).statusCode).toBe(401);
      expect((await built.inject({ method: "GET", url: "/exports/everything" })).statusCode).toBe(401);
      expect((await built.inject({ method: "GET", url: "/exports/everything", headers })).statusCode).toBe(400);
      expect((await built.inject({ method: "GET", url: "/exports/customers", headers })).statusCode).toBe(200);
    } finally {
      await built.close();
      repo.close();
    }
  });
});

describe("report exports (Q18)", () => {
  let repo: AccountingRepository;
  let server: FastifyInstance;
  let businessId: string;
  let customerId: string;
  let itemId: string;

  beforeEach(async () => {
    repo = new AccountingRepository(":memory:", todayAt("2026-01-01"));
    server = Fastify();
    server.setErrorHandler((error, _request, reply) => {
      if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
      return reply.code(500).send({ error: "Internal server error." });
    });
    registerExportRoutes(server, { repository: repo });
    await server.ready();
    const company = repo.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
    businessId = repo.createBusiness({ companyId: company, name: "Biz" });
    customerId = repo.createCustomer({ companyId: company, name: "Acme Books" });
    itemId = repo.createItem({ companyId: company, name: "Atlas", unit: "each", trackStock: true });
    repo.addStockMovement({ itemId, movementType: "OPENING", quantity: 10, unitCostPaise: 40_000, businessId, occurredOn: "2026-01-01" });
    // Sells 2 Atlas at Rs 1,000 on 15 April, due 1 May; Rs 500 comes in on 20 April.
    repo.saveDraft({
      id: "r-inv1", number: "INV-1", businessId, customerId, invoiceDate: "2026-04-15", dueDate: "2026-05-01", status: "DRAFT",
      paymentAccount: "RECEIVABLES", lines: [{ itemId, description: "Atlas", quantity: 2, unitPricePaise: 100_000 }],
    });
    repo.finalizeInvoice("r-inv1");
    repo.recordPayment("r-inv1", 50_000, "2026-04-20");
  });
  afterEach(async () => {
    await server.close();
    repo.close();
  });

  const csvOf = async (url: string): Promise<{ header: string[]; lines: string[][]; contentType: string }> => {
    const res = await server.inject({ method: "GET", url });
    expect(res.statusCode, url).toBe(200);
    const rows = res.body.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","));
    return { header: rows[0] ?? [], lines: rows.slice(1), contentType: String(res.headers["content-type"]) };
  };
  const jsonOf = async (url: string): Promise<{ columns: string[]; rows: Array<Record<string, string>>; contentType: string }> => {
    const res = await server.inject({ method: "GET", url: `${url}${url.includes("?") ? "&" : "?"}format=json` });
    expect(res.statusCode, url).toBe(200);
    return { ...res.json<{ columns: string[]; rows: Array<Record<string, string>> }>(), contentType: String(res.headers["content-type"]) };
  };
  const rupees = (paise: number): string => `${Math.trunc(paise / 100)}.${String(Math.abs(paise % 100)).padStart(2, "0")}`;

  it("profit-and-loss: header, both formats, and the report's own net profit and basis filter", async () => {
    const report = repo.getProfitAndLoss({ businessId, fromDate: "2026-04-01", toDate: "2026-04-30" });
    const url = `/exports/profit-and-loss?businessId=${businessId}&fromDate=2026-04-01&toDate=2026-04-30`;
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["Section", "Account", "Debit", "Credit", "Amount"]);
    expect(csv.lines.find((l) => l[1] === "Net profit")?.[4]).toBe(rupees(report.netProfitPaise));
    expect(csv.lines.find((l) => l[1] === "Total income")?.[4]).toBe(rupees(report.totalIncomePaise));
    expect(csv.lines.find((l) => l[0] === "Basis")?.[1]).toBe("ACCRUAL");
    const json = await jsonOf(url);
    expect(json.contentType).toContain("application/json");
    expect(json.rows.find((r) => r["Account"] === "Net profit")?.["Amount"]).toBe(rupees(report.netProfitPaise));
    // The cash view of the same period is a different report: Rs 500 has been collected, not Rs 2,000.
    const cash = repo.getProfitAndLoss({ businessId, fromDate: "2026-04-01", toDate: "2026-04-30", basis: "CASH" });
    expect(cash.totalIncomePaise).not.toBe(report.totalIncomePaise);
    const cashJson = await jsonOf(`${url}&basis=CASH`);
    expect(cashJson.rows.find((r) => r["Account"] === "Total income")?.["Amount"]).toBe(rupees(cash.totalIncomePaise));
    expect(cashJson.rows.find((r) => r["Section"] === "Basis")?.["Account"]).toBe("CASH");
  });

  it("balance-sheet: header and the report's totals; a fairId is refused like the report refuses it", async () => {
    const report = repo.getBalanceSheet({ businessId, asAtDate: "2026-04-30" });
    const url = `/exports/balance-sheet?businessId=${businessId}&asAtDate=2026-04-30`;
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["Section", "Account", "Debit", "Credit", "Amount"]);
    expect(csv.lines.find((l) => l[1] === "Total assets")?.[4]).toBe(rupees(report.totalAssetsPaise));
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Account"] === "Total equity")?.["Amount"]).toBe(rupees(report.totalEquityPaise));
    expect((await server.inject({ method: "GET", url: `/exports/balance-sheet?fairId=x` })).statusCode).toBe(400);
  });

  it("customer-statement: header, the closing balance, and 400 without a customer", async () => {
    const report = repo.getCustomerStatement({ customerId });
    const url = `/exports/customer-statement?customerId=${customerId}`;
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["Customer", "Date", "Type", "Reference", "Reversal", "Amount", "Balance"]);
    expect(report.closingBalancePaise).toBe(150_000);
    expect(csv.lines.find((l) => l[2] === "INVOICE")?.[5]).toBe("2000.00");
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Type"] === "TOTAL" && r["Reference"]?.startsWith("Closing") === true)?.["Balance"]).toBe(rupees(report.closingBalancePaise));
    expect((await server.inject({ method: "GET", url: "/exports/customer-statement" })).statusCode).toBe(400);
  });

  it("customer-balance-detail: header, subtotal and total equal the report", async () => {
    const report = repo.getCustomerBalanceDetail({ businessId, asAtDate: "2026-06-01" });
    const url = `/exports/customer-balance-detail?businessId=${businessId}&asAtDate=2026-06-01`;
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["Customer", "Kind", "Number", "Date", "Due date", "Fair", "Total", "Settled", "Outstanding"]);
    expect(csv.lines.find((l) => l[1] === "INVOICE")?.slice(2, 5)).toEqual(["INV-1", "2026-04-15", "2026-05-01"]);
    expect(csv.lines.find((l) => l[1] === "SUBTOTAL")?.[8]).toBe(rupees(report.groups[0]?.subtotalPaise ?? -1));
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Kind"] === "TOTAL" && r["Number"] === "Report total")?.["Outstanding"]).toBe(rupees(report.totalPaise));
  });

  it("collections: header, days overdue and the total overdue equal the report", async () => {
    const report = repo.getCollections({ asAtDate: "2026-05-11" });
    const url = "/exports/collections?asAtDate=2026-05-11";
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header.slice(0, 2)).toEqual(["As at", "Customer"]);
    expect(report.rows[0]?.daysOverdue).toBe(10);
    expect(csv.lines.find((l) => l[5] === "INVOICE")?.[10]).toBe("10");
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Number"] === "Total overdue")?.["Outstanding"]).toBe(rupees(report.totalOverduePaise));
  });

  it("stock-ageing: header with the age bands, the totals equal the report, businessId is refused", async () => {
    const report = repo.getStockAgeing({ asAtDate: "2026-04-30" });
    const url = "/exports/stock-ageing?asAtDate=2026-04-30";
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header.slice(0, 3)).toEqual(["As at", "Item", "Unit"]);
    expect(csv.header.slice(-2)).toEqual(["Quantity", "Value"]);
    expect(csv.header).toContain(`${report.totals.buckets[0]?.label} quantity`);
    expect(csv.lines.find((l) => l[1] === "Total")?.at(-1)).toBe(rupees(report.totals.valuePaise));
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Item"] === "Atlas")?.["Value"]).toBe(rupees(report.rows[0]?.valuePaise ?? -1));
    expect((await server.inject({ method: "GET", url: `/exports/stock-ageing?businessId=${businessId}` })).statusCode).toBe(400);
  });

  it("inventory-valuation-detail: header, the lot and the total value equal the report", async () => {
    const report = repo.getInventoryValuationDetail({ asAtDate: "2026-04-30" });
    const url = "/exports/inventory-valuation-detail?asAtDate=2026-04-30";
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["As at", "Item", "Unit", "Received on", "Date basis", "Age days", "Quantity", "Unit cost", "Value", "Source ID"]);
    expect(csv.lines.find((l) => l[1] === "Total")?.[8]).toBe(rupees(report.totals.valuePaise));
    const json = await jsonOf(url);
    expect(json.rows.filter((r) => r["Item"] === "Atlas")).toHaveLength(report.rows.length);
    expect(json.rows.find((r) => r["Item"] === "Atlas")?.["Unit cost"]).toBe("400.00");
  });

  it("item-profitability: header, and sales, cost and margin equal the report", async () => {
    const report = repo.getItemProfitability({ businessId, fromDate: "2026-04-01", toDate: "2026-04-30" });
    const url = `/exports/item-profitability?businessId=${businessId}&fromDate=2026-04-01&toDate=2026-04-30`;
    const csv = await csvOf(url);
    expect(csv.contentType).toContain("text/csv");
    expect(csv.header).toEqual(["Item", "Unit", "Net quantity", "Net sales", "Cost of goods sold", "Gross margin"]);
    expect(report.totals).toEqual({ netSalesPaise: 200_000, cogsPaise: 80_000, grossMarginPaise: 120_000 });
    expect(csv.lines.find((l) => l[0] === "Atlas")?.slice(2)).toEqual(["2", "2000.00", "800.00", "1200.00"]);
    const json = await jsonOf(url);
    expect(json.rows.find((r) => r["Item"] === "Total")?.["Gross margin"]).toBe(rupees(report.totals.grossMarginPaise));
    expect((await server.inject({ method: "GET", url: "/exports/item-profitability?fromDate=2026-13-45" })).statusCode).toBe(400);
  });

  it("trial-balance now takes its route's asAtDate", async () => {
    const before = await jsonOf("/exports/trial-balance?asAtDate=2026-03-01");
    const after = await jsonOf("/exports/trial-balance?asAtDate=2026-04-30");
    expect(before.rows.length).toBeLessThan(after.rows.length);
  });
});
