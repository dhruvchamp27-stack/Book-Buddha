import { describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { buildApi } from "./server.js";
import { todayAt } from "../database/test-clock.js";

/**
 * R10-C: import routes over HTTP. The app is built by `buildApi` with authentication ON and the
 * import routes registered on it before it is ready (`server.ts` does not carry the one wiring
 * line yet), so the global fail-closed hook applies to them exactly as it will in production.
 */

const PASSWORD = "Secret123";

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

async function setUp(): Promise<{
  app: ReturnType<typeof buildApi>; repository: AccountingRepository; token: string; companyId: string; businessId: string;
}> {
  const repository = new AccountingRepository(":memory:", todayAt("2026-04-01"));
  const app = buildApi(repository);
  expect((await app.inject({ method: "POST", url: "/auth/setup", payload: { password: PASSWORD } })).statusCode).toBe(201);
  const token = (await app.inject({ method: "POST", url: "/auth/login", payload: { password: PASSWORD } })).json<{ token: string }>().token;
  const companyId = repository.createCompany({ name: "Co" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  return { app, repository, token, companyId, businessId };
}

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

describe("import routes", () => {
  it("are all behind auth: 401 without a session, for all four", async () => {
    const { app, repository } = await setUp();
    try {
      const body = { kind: "customers", fileName: "c.csv", contentBase64: b64("Name\r\nA\r\n") };
      const calls: Array<[string, string, unknown?]> = [
        ["GET", "/imports/kinds"],
        ["POST", "/imports/inspect", body],
        ["POST", "/imports/preview", { ...body, columnMap: { name: "Name" }, companyId: "x", dateFormat: "YYYY-MM-DD" }],
        ["GET", "/imports/last"],
        ["POST", "/imports/commit", { ...body, columnMap: { name: "Name" }, companyId: "x", dateFormat: "YYYY-MM-DD" }],
      ];
      for (const [method, url, payload] of calls) {
        const response = payload === undefined
          ? await app.inject({ method: "GET", url })
          : await app.inject({ method: "POST", url, payload: payload as object });
        expect(response.statusCode, `${method} ${url}`).toBe(401);
      }
      // and the same route does work with a session
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { password: PASSWORD } });
      const token = login.json<{ token: string }>().token;
      expect((await app.inject({ method: "GET", url: "/imports/kinds", headers: auth(token) })).statusCode).toBe(200);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("lists the kinds with their fields", async () => {
    const { app, repository, token } = await setUp();
    try {
      const response = await app.inject({ method: "GET", url: "/imports/kinds", headers: auth(token) });
      const { kinds } = response.json<{ kinds: Array<{ kind: string; scope: string; fields: Array<{ key: string; label: string; required: boolean }> }> }>();
      const customers = kinds.find((k) => k.kind === "customers");
      expect(customers?.scope).toBe("COMPANY");
      expect(customers?.fields[0]).toMatchObject({ key: "name", label: "Name", required: true });
      expect(kinds.map((k) => k.kind)).toEqual(expect.arrayContaining(["suppliers", "items", "opening-balances"]));
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("inspects a file: format, delimiter, headers, row count, first 10 rows and a suggested map", async () => {
    const { app, repository, token } = await setUp();
    try {
      const lines = ["Customer;E-mail"];
      for (let i = 1; i <= 25; i += 1) lines.push(`Person ${i};p${i}@x.in`);
      const response = await app.inject({
        method: "POST", url: "/imports/inspect", headers: auth(token),
        payload: { kind: "customers", fileName: "people.csv", contentBase64: b64(`${lines.join("\r\n")}\r\n`) },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<{
        format: string; delimiter: string; headers: string[]; rowCount: number; sampleRows: Array<{ rowNumber: number; cells: string[] }>;
        suggestedColumnMap: Record<string, string>;
      }>();
      expect(body).toMatchObject({ format: "CSV", delimiter: ";", headers: ["Customer", "E-mail"], rowCount: 25 });
      expect(body.sampleRows).toHaveLength(10);
      expect(body.sampleRows[0]).toEqual({ rowNumber: 2, cells: ["Person 1", "p1@x.in"] });
      expect(body.suggestedColumnMap).toEqual({ name: "Customer", email: "E-mail" });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("previews then commits over HTTP: the preview writes nothing, the commit gives the same outcomes", async () => {
    const { app, repository, token, companyId } = await setUp();
    try {
      const payload = {
        kind: "customers", fileName: "c.csv", companyId, dateFormat: "YYYY-MM-DD",
        columnMap: { name: "Name", phone: "Phone" },
        contentBase64: b64("Name,Phone\r\nGreenfield School,999\r\nHill College,888\r\n"),
      };
      const preview = await app.inject({ method: "POST", url: "/imports/preview", headers: auth(token), payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ mode: "PREVIEW", kind: "customers", created: 2, failed: 0 });
      expect(repository.listCustomers(companyId)).toHaveLength(0);

      const commit = await app.inject({ method: "POST", url: "/imports/commit", headers: auth(token), payload });
      expect(commit.statusCode).toBe(200);
      expect(commit.json()).toMatchObject({ mode: "COMMIT", created: 2 });
      expect(commit.json<{ outcomes: unknown[] }>().outcomes).toEqual(preview.json<{ outcomes: unknown[] }>().outcomes);
      expect(repository.listCustomers(companyId).map((c) => c.name).sort()).toEqual(["Greenfield School", "Hill College"]);

      const again = await app.inject({ method: "POST", url: "/imports/commit", headers: auth(token), payload });
      expect(again.json()).toMatchObject({ created: 0, skipped: 2 });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("accepts a CSV over 1 MB (the per-route body limit)", { timeout: 60_000 }, async () => {
    const { app, repository, token, companyId } = await setUp();
    try {
      const lines = ["Name,Notes"];
      const filler = "x".repeat(200);
      for (let i = 0; i < 6000; i += 1) lines.push(`Customer ${i},${filler}`);
      const text = `${lines.join("\r\n")}\r\n`;
      const contentBase64 = b64(text);
      expect(text.length).toBeGreaterThan(1024 * 1024);
      expect(contentBase64.length).toBeGreaterThan(1024 * 1024);
      const response = await app.inject({
        method: "POST", url: "/imports/preview", headers: auth(token),
        payload: { kind: "customers", fileName: "big.csv", contentBase64, columnMap: { name: "Name", notes: "Notes" }, companyId, dateFormat: "YYYY-MM-DD" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ totalRows: 6000, created: 6000, failed: 0 });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("refuses bad requests with 400: unknown kind, bad base64, unparseable file, bad map, missing business, bad body", async () => {
    const { app, repository, token, companyId } = await setUp();
    try {
      const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, headers: auth(token), payload: payload as object });
      const file = { fileName: "c.csv", contentBase64: b64("Name\r\nA\r\n") };
      const run = { ...file, companyId, dateFormat: "YYYY-MM-DD", columnMap: { name: "Name" } };

      const unknown = await post("/imports/inspect", { kind: "pizzas", ...file });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json<{ error: string }>().error).toMatch(/not something that can be imported/);

      expect((await post("/imports/inspect", { kind: "customers", fileName: "c.csv", contentBase64: "!!not base64!!" })).statusCode).toBe(400);
      // a duplicate header is a codec error
      const dup = await post("/imports/inspect", { kind: "customers", fileName: "c.csv", contentBase64: b64("Name,name\r\nA,B\r\n") });
      expect(dup.statusCode).toBe(400);
      expect(dup.json<{ error: string }>().error).toMatch(/c\.csv/);

      expect((await post("/imports/preview", { kind: "customers", ...run, columnMap: { name: "Nope" } })).statusCode).toBe(400);
      expect((await post("/imports/preview", { kind: "customers", ...run, columnMap: {} })).statusCode).toBe(400);
      expect((await post("/imports/preview", { kind: "customers", ...run, dateFormat: "MM/DD/YYYY" })).statusCode).toBe(400);
      expect((await post("/imports/preview", { kind: "customers", ...run, companyId: "ghost" })).statusCode).toBe(400);
      expect((await post("/imports/preview", { kind: "customers", ...run, businessId: "ghost" })).statusCode).toBe(400);
      expect((await post("/imports/commit", { kind: "customers" })).statusCode).toBe(400);
      expect((await post("/imports/commit", { kind: "opening-balances", ...run, columnMap: { asAt: "Name", account: "Name" } })).json<{ error: string }>().error)
        .toMatch(/needs a business/);
      expect(repository.listCustomers(companyId)).toHaveLength(0);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("imports a JSON file, and a business-scoped kind with a business", async () => {
    const { app, repository, token, companyId, businessId } = await setUp();
    try {
      const rows = JSON.stringify({ rows: [{ "As at": "01/04/2026", Account: "BANK", Debit: "100.00", Credit: "" }, { "As at": "01/04/2026", Account: "CAPITAL", Debit: "", Credit: "100.00" }] });
      const response = await app.inject({
        method: "POST", url: "/imports/commit", headers: auth(token),
        payload: {
          kind: "opening-balances", fileName: "ob.json", contentBase64: b64(rows), companyId, businessId, dateFormat: "DD/MM/YYYY",
          columnMap: { asAt: "As at", account: "Account", debit: "Debit", credit: "Credit" },
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ created: 1, failed: 0 });
      expect(repository.getOpeningBalances(businessId)).toHaveLength(1);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("repeated payments import, a re-import skips them, and GET /imports/last reports each kind's latest commit", async () => {
    const { app, repository, token, companyId, businessId } = await setUp();
    try {
      repository.createCustomer({ companyId, name: "Acme Books" });
      const commit = async (kind: string, fileName: string, csv: string, columnMap: Record<string, string>) =>
        (await app.inject({
          method: "POST", url: "/imports/commit", headers: auth(token),
          payload: { kind, fileName, contentBase64: b64(csv), companyId, businessId, dateFormat: "YYYY-MM-DD", columnMap },
        })).json<{ created: number; skipped: number; failed: number }>();
      expect(await app.inject({ method: "GET", url: `/imports/last?companyId=${companyId}`, headers: auth(token) }).then((r) => r.json())).toEqual({ imports: [] });

      const inv = await commit("invoices", "inv.csv", "Number,Invoice date,Customer,Description,Quantity,Unit price\r\nINV-1,2026-11-01,Acme Books,Binding,1,5000\r\n",
        { number: "Number", invoiceDate: "Invoice date", customer: "Customer", description: "Description", quantity: "Quantity", unitPrice: "Unit price" });
      expect(inv).toMatchObject({ created: 1, failed: 0 });

      const pays = "Invoice number,Amount,Paid on\r\nINV-1,1000,2026-11-10\r\nINV-1,1000,2026-11-10\r\n";
      const map = { invoiceNumber: "Invoice number", amount: "Amount", paidOn: "Paid on" };
      expect(await commit("payments", "pay.csv", pays, map)).toMatchObject({ created: 2, skipped: 0, failed: 0 });
      expect(await commit("payments", "pay.csv", pays, map)).toMatchObject({ created: 0, skipped: 2, failed: 0 });

      const last = (await app.inject({ method: "GET", url: `/imports/last?companyId=${companyId}`, headers: auth(token) })).json<{ imports: Array<Record<string, unknown>> }>();
      expect(last.imports).toHaveLength(2);
      const byKind = Object.fromEntries(last.imports.map((i) => [i.kind as string, i]));
      expect(byKind["payments"]).toMatchObject({ kind: "payments", fileName: "pay.csv", created: 0, skipped: 2, failed: 0 });
      expect(typeof byKind["payments"]?.committedAt).toBe("string");
      expect(byKind["invoices"]).toMatchObject({ fileName: "inv.csv", created: 1 });
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("GET /imports/last is per company: each company sees only its own last import; a company with none sees an empty list; a bad company is 400", async () => {
    const { app, repository, token, companyId: coA } = await setUp();
    try {
      const coB = repository.createCompany({ name: "Co B" });
      const coC = repository.createCompany({ name: "Co C" });
      const commit = async (companyId: string, fileName: string) =>
        app.inject({
          method: "POST", url: "/imports/commit", headers: auth(token),
          payload: { kind: "customers", fileName, contentBase64: b64("Name\r\nAcme\r\n"), companyId, dateFormat: "YYYY-MM-DD", columnMap: { name: "Name" } },
        });
      expect((await commit(coA, "a.csv")).statusCode).toBe(200);
      expect((await commit(coB, "b.csv")).statusCode).toBe(200);
      const last = async (companyId: string) =>
        (await app.inject({ method: "GET", url: `/imports/last?companyId=${companyId}`, headers: auth(token) })).json<{ imports: Array<Record<string, unknown>> }>();

      const a = await last(coA);
      expect(a.imports).toHaveLength(1);
      expect(a.imports[0]).toMatchObject({ kind: "customers", fileName: "a.csv" });
      const b = await last(coB);
      expect(b.imports).toHaveLength(1);
      expect(b.imports[0]).toMatchObject({ kind: "customers", fileName: "b.csv" });
      expect(await last(coC)).toEqual({ imports: [] });

      const missing = await app.inject({ method: "GET", url: "/imports/last?companyId=nope", headers: auth(token) });
      expect(missing.statusCode).toBe(400);
      const noParam = await app.inject({ method: "GET", url: "/imports/last", headers: auth(token) });
      expect(noParam.statusCode).toBe(400);
    } finally {
      await app.close();
      repository.close();
    }
  });

  it("imports expenses: preview then commit posts each journal, a re-import skips, an unknown category fails only its row", async () => {
    const { app, repository, token, companyId, businessId } = await setUp();
    try {
      repository.createSupplier({ companyId, name: "Paper House" });
      repository.createExpenseCategory({ companyId, name: "Courier" });
      repository.createExpenseCategory({ companyId, name: "Stationery" });
      const columnMap = {
        number: "Number", expenseDate: "Date", supplier: "Supplier", category: "Category", description: "Description",
        amount: "Amount", paymentAccount: "Payment account",
      };
      const csv = [
        "Number,Date,Supplier,Category,Description,Amount,Payment account",
        "EXP-1,2026-11-03,Paper House,Stationery,Pens,300,PAYABLES",
        "EXP-1,2026-11-03,Paper House,Stationery,Files,200,PAYABLES",
        "EXP-2,2026-11-04,,Courier,Parcel to Pune,150,CASH",
        "",
      ].join("\r\n");
      const payload = { kind: "expenses", fileName: "exp.csv", companyId, businessId, dateFormat: "YYYY-MM-DD", columnMap, contentBase64: b64(csv) };
      const preview = await app.inject({ method: "POST", url: "/imports/preview", headers: auth(token), payload });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ mode: "PREVIEW", kind: "expenses", created: 2, skipped: 0, failed: 0 });
      expect(repository.listExpenses({ businessId })).toHaveLength(0);

      const commit = await app.inject({ method: "POST", url: "/imports/commit", headers: auth(token), payload });
      expect(commit.json()).toMatchObject({ mode: "COMMIT", created: 2, failed: 0 });
      const expenses = repository.listExpenses({ businessId });
      expect(expenses.map((e) => [e.number, e.status, e.expenseDate, e.description, e.amountPaise, e.paymentAccount])).toEqual([
        ["EXP-1", "FINALIZED", "2026-11-03", "Pens; Files", 50_000, "PAYABLES"],
        ["EXP-2", "FINALIZED", "2026-11-04", "Parcel to Pune", 15_000, "CASH"],
      ]);
      const journalOf = (number: string): Array<[string, number, number]> => {
        const id = expenses.find((e) => e.number === number)?.id;
        const entry = repository.listJournalEntries().find((j) => j.sourceId === id);
        return (entry?.lines ?? []).map((l) => [l.account, l.debitPaise, l.creditPaise]);
      };
      expect(journalOf("EXP-1")).toEqual([["EXPENSE", 50_000, 0], ["PAYABLES", 0, 50_000]]);
      expect(journalOf("EXP-2")).toEqual([["EXPENSE", 15_000, 0], ["CASH", 0, 15_000]]);

      const again = await app.inject({ method: "POST", url: "/imports/commit", headers: auth(token), payload });
      expect(again.json()).toMatchObject({ created: 0, skipped: 2, failed: 0 });
      expect(repository.listExpenses({ businessId })).toHaveLength(2);

      const mixed = [
        "Number,Date,Supplier,Category,Description,Amount,Payment account",
        "EXP-3,2026-11-05,,Courier,Tape,80,CASH",
        "EXP-4,2026-11-05,,Postage,Stamps,40,CASH",
        "",
      ].join("\r\n");
      const result = await app.inject({ method: "POST", url: "/imports/commit", headers: auth(token), payload: { ...payload, contentBase64: b64(mixed) } });
      expect(result.json()).toMatchObject({ created: 1, failed: 1 });
      const failedMessage = result.json<{ outcomes: Array<{ status: string; message?: string }> }>().outcomes.find((o) => o.status === "FAILED")?.message;
      expect(failedMessage).toContain("Postage");
      expect(repository.listExpenses({ businessId }).map((e) => e.number)).toEqual(["EXP-1", "EXP-2", "EXP-3"]);
    } finally {
      await app.close();
      repository.close();
    }
  });
});
