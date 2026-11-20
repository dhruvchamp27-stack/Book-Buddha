import { describe, expect, it, vi } from "vitest";
import type { Invoice } from "../accounting/types.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";
import { buildApi } from "../api/server.js";

/**
 * R10-E: integration checks through the real `buildApi` with a session (auth ON, both route sets
 * registered by `buildApi` itself). Each test is one of the six gaps the unit tests did not cover.
 */

const PASSWORD = "Secret123";
const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

interface Rig {
  readonly app: ReturnType<typeof buildApi>;
  readonly repository: AccountingRepository;
  readonly token: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly auth: { authorization: string };
  close(): Promise<void>;
}

async function setUp(): Promise<Rig> {
  const repository = new AccountingRepository();
  const app = buildApi(repository);
  expect((await app.inject({ method: "POST", url: "/auth/setup", payload: { password: PASSWORD } })).statusCode).toBe(201);
  const token = (await app.inject({ method: "POST", url: "/auth/login", payload: { password: PASSWORD } })).json<{ token: string }>().token;
  const companyId = repository.createCompany({ name: "Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  return {
    app, repository, token, companyId, businessId, auth: { authorization: `Bearer ${token}` },
    close: async () => { await app.close(); repository.close(); },
  };
}

interface Inspected { headers: string[]; rowCount: number; suggestedColumnMap: Record<string, string> }

async function exportText(rig: Rig, dataset: string, query = ""): Promise<string> {
  const res = await rig.app.inject({ method: "GET", url: `/exports/${dataset}${query}`, headers: rig.auth });
  expect(res.statusCode, dataset).toBe(200);
  return res.body;
}

async function inspect(rig: Rig, kind: string, fileName: string, text: string): Promise<Inspected> {
  const res = await rig.app.inject({
    method: "POST", url: "/imports/inspect", headers: rig.auth,
    payload: { kind, fileName, contentBase64: b64(text) },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Inspected>();
}

interface Run {
  mode: string; totalRows: number; units: number; created: number; updated: number; skipped: number; failed: number;
  outcomes: Array<{ rowNumbers: number[]; reference: string; status: string; message?: string }>;
}

async function run(
  rig: Rig, action: "preview" | "commit", kind: string, fileName: string, text: string,
  columnMap: Record<string, string>, extra: { businessId?: string } = {},
): Promise<Run> {
  const res = await rig.app.inject({
    method: "POST", url: `/imports/${action}`, headers: rig.auth,
    payload: { kind, fileName, contentBase64: b64(text), columnMap, companyId: rig.companyId, dateFormat: "YYYY-MM-DD", ...extra },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<Run>();
}

/** inspect -> take the suggested map -> run. Returns the inspection too. */
async function importSuggested(
  rig: Rig, action: "preview" | "commit", kind: string, fileName: string, text: string, extra: { businessId?: string } = {},
): Promise<{ inspected: Inspected; result: Run }> {
  const inspected = await inspect(rig, kind, fileName, text);
  const result = await run(rig, action, kind, fileName, text, inspected.suggestedColumnMap, extra);
  return { inspected, result };
}

describe("R10-E integration", () => {
  it("(1) export two interleaved multi-line invoices + customers + items, then inspect -> preview -> commit into a fresh database", async () => {
    const source = await setUp();
    const target = await setUp();
    try {
      const repo = source.repository;
      const school = repo.createCustomer({ companyId: source.companyId, name: "Greenfield School", numberingCategory: "SCH", phone: "9876500001" });
      const college = repo.createCustomer({ companyId: source.companyId, name: "Hill College", numberingCategory: "SCH", email: "hill@x.in" });
      const atlas = repo.createItem({ companyId: source.companyId, name: "Atlas", unit: "each", sellingPricePaise: 123450 });
      const pen = repo.createItem({ companyId: source.companyId, name: "Pen", unit: "box", sellingPricePaise: 5000 });
      const make = (id: string, number: string, customerId: string, date: string, extra: Partial<Invoice>, lines: Invoice["lines"]): void => {
        repo.saveDraft({ id, number, businessId: source.businessId, customerId, invoiceDate: date, status: "DRAFT", paymentAccount: "RECEIVABLES", lines, ...extra } as Invoice);
        repo.finalizeInvoice(id);
      };
      make("i1", "INV-1", school, "2026-04-10", { dueDate: "2026-05-10", discountPaise: 1000 }, [
        { itemId: atlas, description: "Atlas", quantity: 2, unitPricePaise: 123450 },
        { itemId: pen, description: "Pen", quantity: 10, unitPricePaise: 5000 },
      ]);
      make("i2", "INV-2", college, "2026-04-12", { taxType: "CGST_SGST", taxRateBasisPoints: 1800, extraChargePaise: 2500 }, [
        { itemId: pen, description: "Pen", quantity: 3, unitPricePaise: 5000 },
        { description: "Delivery", quantity: 1, unitPricePaise: 7500 },
        { itemId: atlas, description: "Atlas", quantity: 1, unitPricePaise: 123450 },
      ]);

      const customersCsv = await exportText(source, "customers", `?companyId=${source.companyId}`);
      const itemsCsv = await exportText(source, "items", `?companyId=${source.companyId}`);
      const invoicesCsv = await exportText(source, "invoices", `?businessId=${source.businessId}`);

      // Interleave the two invoices' lines: A1 B1 A2 B2 B3.
      const [head, ...body] = invoicesCsv.replace(/^﻿/, "").split("\r\n").filter((l) => l !== "");
      expect(body).toHaveLength(5);
      const byNumber = (n: string): string[] => body.filter((l) => l.startsWith(`${n},`));
      const a = byNumber("INV-1");
      const b = byNumber("INV-2");
      expect([a.length, b.length]).toEqual([2, 3]);
      const interleaved = `${[head, a[0], b[0], a[1], b[1], b[2]].join("\r\n")}\r\n`;

      // Masters first (preview then commit), then the documents.
      for (const [kind, text] of [["customers", customersCsv], ["items", itemsCsv]] as const) {
        const { inspected, result } = await importSuggested(target, "preview", kind, `${kind}.csv`, text);
        const exportedHeaders = text.replace(/^﻿/, "").split("\r\n")[0]?.split(",") ?? [];
        expect(new Set(Object.values(inspected.suggestedColumnMap)), `${kind} map`).toEqual(new Set(exportedHeaders));
        expect(result.failed, JSON.stringify(result.outcomes)).toBe(0);
        const committed = await importSuggested(target, "commit", kind, `${kind}.csv`, text);
        expect(committed.result.created).toBe(kind === "customers" ? 2 : 2);
      }

      const invoiceInspected = await inspect(target, "invoices", "invoices.csv", interleaved);
      const allHeaders = (head ?? "").split(",");
      expect(allHeaders).toHaveLength(15);
      // Every export header maps to a field, none twice.
      expect(Object.values(invoiceInspected.suggestedColumnMap).sort()).toEqual([...allHeaders].sort());
      expect(invoiceInspected.rowCount).toBe(5);

      const extra = { businessId: target.businessId };
      const preview = await run(target, "preview", "invoices", "invoices.csv", interleaved, invoiceInspected.suggestedColumnMap, extra);
      expect(target.repository.listInvoices(target.businessId)).toHaveLength(0);
      expect(preview).toMatchObject({ units: 2, created: 2, failed: 0, totalRows: 5 });
      const commit = await run(target, "commit", "invoices", "invoices.csv", interleaved, invoiceInspected.suggestedColumnMap, extra);
      expect(commit.outcomes).toEqual(preview.outcomes);
      expect(commit.outcomes.map((o) => [o.reference, o.rowNumbers])).toEqual([["INV-1", [2, 4]], ["INV-2", [3, 5, 6]]]);

      // Grouping and totals: the re-export equals the original, and the ledgers agree.
      expect(await exportText(target, "invoices", `?businessId=${target.businessId}`)).toBe(invoicesCsv);
      expect(await exportText(target, "customers", `?companyId=${target.companyId}`)).toBe(customersCsv);
      expect(await exportText(target, "items", `?companyId=${target.companyId}`)).toBe(itemsCsv);
      expect(target.repository.getTrialBalance({ businessId: target.businessId })).toEqual(source.repository.getTrialBalance({ businessId: source.businessId }));
      // Totals: the whole trial balance matches the source; spot-check the receivable explicitly too.
      const receivables = (r: AccountingRepository, businessId: string): number =>
        r.getTrialBalance({ businessId }).find((row) => row.account === "RECEIVABLES")?.debitPaise ?? -1;
      expect(receivables(target.repository, target.businessId)).toBeGreaterThan(0);
      expect(receivables(target.repository, target.businessId)).toBe(receivables(source.repository, source.businessId));
      expect(verifyAuditChain(target.repository.db).ok).toBe(true);
    } finally {
      await source.close();
      await target.close();
    }
  });

  it("(2) the audit chain verifies after a preview then a real write, and after a commit containing one failed unit", async () => {
    const rig = await setUp();
    try {
      const csv = "Name,Phone\r\nGreenfield School,999\r\nHill College,888\r\n";
      const before = verifyAuditChain(rig.repository.db);
      expect(before.ok).toBe(true);
      const preview = await importSuggested(rig, "preview", "customers", "c.csv", csv);
      expect(preview.result.created).toBe(2);
      expect(verifyAuditChain(rig.repository.db)).toMatchObject({ ok: true, checked: before.checked }); // the preview left no audit rows
      rig.repository.createCustomer({ companyId: rig.companyId, name: "Typed By Hand" });
      const afterWrite = verifyAuditChain(rig.repository.db);
      expect(afterWrite.ok).toBe(true);
      expect(afterWrite.checked).toBeGreaterThan(0);

      // A commit with one bad unit (an item with no Unit) among good ones.
      const items = "Name,Unit,Selling price\r\nAtlas,each,10.00\r\nNo Unit Item,,5.00\r\nPen,box,2.00\r\n";
      const commit = await importSuggested(rig, "commit", "items", "i.csv", items);
      expect(commit.result).toMatchObject({ created: 2, failed: 1 });
      expect(commit.result.outcomes.find((o) => o.status === "FAILED")?.rowNumbers).toEqual([3]);
      const chain = verifyAuditChain(rig.repository.db);
      expect(chain.ok).toBe(true);
      expect(chain.checked).toBeGreaterThan(afterWrite.checked);
    } finally {
      await rig.close();
    }
  });

  it("(3) a phone +91 98765 43210 and a name starting = survive export -> import with the stored field equal", async () => {
    const source = await setUp();
    const target = await setUp();
    try {
      const tricky = {
        name: "=Evil School", phone: "+91 98765 43210", phone2: "-5551234", internalNotes: "@mention me", billingAddress: "+Plot 4, Main Road",
      };
      source.repository.createCustomer({ companyId: source.companyId, ...tricky });
      source.repository.createSupplier({ companyId: source.companyId, ...tricky });
      source.repository.createItem({ companyId: source.companyId, name: "-Dash Item", unit: "each", description: "=SUM(A1)" });

      const csv = await exportText(source, "customers", `?companyId=${source.companyId}`);
      expect(csv).toContain("'=Evil School");
      expect(csv).toContain("'+91 98765 43210");
      const imported = await importSuggested(target, "commit", "customers", "c.csv", csv);
      expect(imported.result).toMatchObject({ created: 1, failed: 0 });
      const stored = target.repository.listCustomers(target.companyId)[0];
      expect(stored).toMatchObject({ name: tricky.name, phone: tricky.phone, phone2: tricky.phone2, internalNotes: tricky.internalNotes, billingAddress: tricky.billingAddress });

      const suppliers = await importSuggested(target, "commit", "suppliers", "s.csv", await exportText(source, "suppliers", `?companyId=${source.companyId}`));
      expect(suppliers.result.created).toBe(1);
      expect(target.repository.listSuppliers(target.companyId)[0]).toMatchObject({ name: tricky.name, phone: tricky.phone });

      await importSuggested(target, "commit", "items", "i.csv", await exportText(source, "items", `?companyId=${source.companyId}`));
      expect(target.repository.listItems(target.companyId)[0]).toMatchObject({ name: "-Dash Item", description: "=SUM(A1)" });

      // A value that merely starts with an apostrophe is NOT touched.
      const plain = await importSuggested(target, "commit", "customers", "p.csv", "Name,Phone\r\n'Quoted Name,'12345\r\n");
      expect(plain.result.created).toBe(1);
      expect(target.repository.listCustomers(target.companyId).find((c) => c.name === "'Quoted Name")?.phone).toBe("'12345");
    } finally {
      await source.close();
      await target.close();
    }
  });

  it("(4) 2,000 single-line invoices commit in well under 10 seconds", { timeout: 180_000 }, async () => {
    const rig = await setUp();
    try {
      rig.repository.createCustomer({ companyId: rig.companyId, name: "Greenfield School" });
      rig.repository.createItem({ companyId: rig.companyId, name: "Atlas", unit: "each", sellingPricePaise: 10000 });
      const lines = ["Number,Invoice date,Customer,Item,Quantity,Unit price"];
      for (let i = 1; i <= 2000; i += 1) lines.push(`INV-${String(i).padStart(5, "0")},2026-04-${String((i % 28) + 1).padStart(2, "0")},Greenfield School,Atlas,1,100.00`);
      const text = `${lines.join("\r\n")}\r\n`;
      const started = Date.now();
      const { result } = await importSuggested(rig, "commit", "invoices", "big.csv", text, { businessId: rig.businessId });
      const seconds = (Date.now() - started) / 1000;
      console.log(`R10-E timing: 2000 invoices committed in ${seconds.toFixed(2)} s`);
      expect(result).toMatchObject({ units: 2000, created: 2000, failed: 0 });
      expect(rig.repository.listInvoices(rig.businessId)).toHaveLength(2000);
      expect(seconds).toBeLessThan(10);
      // re-running is all SKIPPED, and quick too
      const again = await importSuggested(rig, "commit", "invoices", "big.csv", text, { businessId: rig.businessId });
      expect(again.result).toMatchObject({ created: 0, skipped: 2000 });
    } finally {
      await rig.close();
    }
  });

  it("(5) /exports/:dataset is 401 without a session and 400 for an unknown dataset, through buildApi", async () => {
    const rig = await setUp();
    try {
      expect((await rig.app.inject({ method: "GET", url: "/exports/customers" })).statusCode).toBe(401);
      expect((await rig.app.inject({ method: "GET", url: "/exports/nonsense" })).statusCode).toBe(401);
      const bad = await rig.app.inject({ method: "GET", url: "/exports/nonsense", headers: rig.auth });
      expect(bad.statusCode).toBe(400);
      expect(bad.json<{ error: string }>().error).toContain("Unknown export");
      expect((await rig.app.inject({ method: "GET", url: "/exports/customers", headers: rig.auth })).statusCode).toBe(200);
    } finally {
      await rig.close();
    }
  });

  describe("(6) no ghost in any per-run index: a unit that fails after its record was written leaves no entry", () => {
    it("customers: failure after createCustomer, then the same name valid -> CREATED", async () => {
      const rig = await setUp();
      try {
        const spy = vi.spyOn(rig.repository, "setCustomerActive").mockImplementationOnce(() => { throw new Error("forced failure after create"); });
        const csv = "Name,GSTIN,Active\r\nGhost School,27AAAAA0000A1Z5,No\r\nGhost School,27AAAAA0000A1Z5,Yes\r\n";
        const { result } = await importSuggested(rig, "commit", "customers", "c.csv", csv);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.outcomes.map((o) => o.status)).toEqual(["FAILED", "CREATED"]);
        expect(rig.repository.listCustomers(rig.companyId).map((c) => c.name)).toEqual(["Ghost School"]);
      } finally {
        await rig.close();
      }
    });

    it("suppliers: failure after createSupplier, then the same name valid -> CREATED", async () => {
      const rig = await setUp();
      try {
        vi.spyOn(rig.repository, "setSupplierActive").mockImplementationOnce(() => { throw new Error("forced failure after create"); });
        const { result } = await importSuggested(rig, "commit", "suppliers", "s.csv", "Name,Active\r\nGhost Supplies,No\r\nGhost Supplies,Yes\r\n");
        expect(result.outcomes.map((o) => o.status)).toEqual(["FAILED", "CREATED"]);
        expect(rig.repository.listSuppliers(rig.companyId)).toHaveLength(1);
      } finally {
        await rig.close();
      }
    });

    it("items: opening stock with no business, then the same item with valid data -> CREATED", async () => {
      const rig = await setUp();
      try {
        const csv = "Name,Unit,Track stock,Opening quantity,Opening unit cost\r\nGhost Item,each,Yes,5,10.00\r\n";
        const failing = await importSuggested(rig, "commit", "items", "i.csv", csv);
        expect(failing.result).toMatchObject({ failed: 1, created: 0 });
        expect(rig.repository.listItems(rig.companyId)).toHaveLength(0);
        const fixed = await importSuggested(rig, "commit", "items", "i2.csv", "Name,Unit\r\nGhost Item,each\r\n");
        expect(fixed.result).toMatchObject({ created: 1, skipped: 0, updated: 0 });

        // and within ONE file: a failing row after the write, then the same name again
        vi.spyOn(rig.repository, "addStockMovement").mockImplementationOnce(() => { throw new Error("forced failure after create"); });
        const one = "Name,Unit,Track stock,Opening quantity,Opening unit cost\r\nGhost Two,each,Yes,5,10.00\r\nGhost Two,each,Yes,5,10.00\r\n";
        const { result } = await importSuggested(rig, "commit", "items", "i3.csv", one, { businessId: rig.businessId });
        expect(result.outcomes.map((o) => o.status)).toEqual(["FAILED", "CREATED"]);
      } finally {
        await rig.close();
      }
    });

    it("invoices: failure after the draft was saved, then the same number valid -> CREATED, not SKIPPED", async () => {
      const rig = await setUp();
      try {
        rig.repository.createCustomer({ companyId: rig.companyId, name: "Greenfield School" });
        vi.spyOn(rig.repository, "finalizeInvoice").mockImplementationOnce(() => { throw new Error("forced failure after create"); });
        const csv = "Number,Invoice date,Customer,Description,Quantity,Unit price\r\nINV-9,2026-04-10,Greenfield School,Atlas,1,100.00\r\nINV-9,2026-04-10,Greenfield School,Atlas,1,100.00\r\n";
        // Same number twice in one file is ONE unit (grouped), so use two files' worth: first unit fails, then a second run.
        const first = await importSuggested(rig, "commit", "invoices", "a.csv", csv.split("\r\n").slice(0, 2).join("\r\n") + "\r\n", { businessId: rig.businessId });
        expect(first.result).toMatchObject({ failed: 1, created: 0 });
        expect(rig.repository.listInvoices(rig.businessId)).toHaveLength(0);
        const second = await importSuggested(rig, "commit", "invoices", "b.csv", csv.split("\r\n").slice(0, 2).join("\r\n") + "\r\n", { businessId: rig.businessId });
        expect(second.result).toMatchObject({ created: 1, skipped: 0 });
      } finally {
        await rig.close();
      }
    });

    it("purchase bills: a unit failing after the bill was written leaves no entry; the next distinct bill still posts", async () => {
      const rig = await setUp();
      try {
        rig.repository.createSupplier({ companyId: rig.companyId, name: "Paper Co" });
        vi.spyOn(rig.repository, "finalizePurchaseBill").mockImplementationOnce(() => { throw new Error("forced failure after create"); });
        const csv = "Number,Bill date,Supplier,Description,Quantity,Unit price\r\nB-1,2026-04-10,Paper Co,Paper,1,100.00\r\nB-2,2026-04-11,Paper Co,Paper,1,100.00\r\n";
        const { result } = await importSuggested(rig, "commit", "purchase-bills", "b.csv", csv, { businessId: rig.businessId });
        expect(result.outcomes.map((o) => o.status)).toEqual(["FAILED", "CREATED"]);
        expect(rig.repository.listPurchaseBills({ businessId: rig.businessId }).map((b) => b.number)).toEqual(["B-2"]);
        // the failed number can be imported afterwards: it was never indexed
        const again = await importSuggested(rig, "commit", "purchase-bills", "b2.csv", csv.split("\r\n").slice(0, 2).join("\r\n") + "\r\n", { businessId: rig.businessId });
        expect(again.result).toMatchObject({ created: 1, skipped: 0 });
      } finally {
        await rig.close();
      }
    });
  });
});
