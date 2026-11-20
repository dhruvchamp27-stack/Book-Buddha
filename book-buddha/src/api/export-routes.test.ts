import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import type { Invoice } from "../accounting/types.js";
import { registerExportRoutes } from "./export-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;

beforeEach(async () => {
  repository = new AccountingRepository();
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
    for (const dataset of ["customers", "suppliers", "items", "invoices", "credit-notes", "payments", "purchase-bills", "supplier-payments", "stock-movements", "journal-entries", "trial-balance"]) {
      const res = await app.inject({ method: "GET", url: `/exports/${dataset}` });
      expect(res.statusCode, dataset).toBe(200);
    }
  });
});
