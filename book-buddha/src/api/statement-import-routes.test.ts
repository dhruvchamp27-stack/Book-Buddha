import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { registerStatementImportRoutes } from "./statement-import-routes.js";

let repository: AccountingRepository;
let app: FastifyInstance;
let companyId: string;

beforeEach(async () => {
  repository = new AccountingRepository();
  // Same RepositoryValidationError -> 400 mapping as buildApi's handler (the orchestrator wires these routes in server.ts).
  app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RepositoryValidationError) return reply.code(400).send({ error: error.message });
    return reply.code(500).send({ error: "Internal server error." });
  });
  registerStatementImportRoutes(app, { repository });
  await app.ready();
  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
});
afterEach(async () => {
  await app.close();
  repository.close();
});

const CSV = "Date,Narration,Withdrawal,Deposit\n03/10/25,CASH DEPOSIT,,\"12,000.00\"\n20/10/25,UPI,\"1,180.00\",";
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");
const map = { date: "Date", description: "Narration", withdrawal: "Withdrawal", deposit: "Deposit" };
const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  companyId, accountCode: "BANK", fileName: "s.csv", contentBase64: b64(CSV), columnMap: map, dateFormat: "DD/MM/YYYY", ...extra,
});

describe("statement import routes", () => {
  it("12. inspect, preview, commit, imports: each once 200 and once 400", async () => {
    const inspect = await app.inject({ method: "POST", url: "/bank-statements/inspect", payload: { fileName: "s.csv", contentBase64: b64(CSV) } });
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json<{ rowCount: number; suggestedMap: Record<string, string> }>()).toMatchObject({ rowCount: 2, suggestedMap: map });
    expect((await app.inject({ method: "POST", url: "/bank-statements/inspect", payload: { fileName: "s.csv", contentBase64: "***" } })).statusCode).toBe(400);

    const preview = await app.inject({ method: "POST", url: "/bank-statements/preview", payload: body() });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ added: number; mode: string }>()).toMatchObject({ added: 2, mode: "PREVIEW" });
    expect((await app.inject({ method: "POST", url: "/bank-statements/preview", payload: body({ accountCode: "CASH" }) })).statusCode).toBe(400);

    const commit = await app.inject({ method: "POST", url: "/bank-statements/commit", payload: body() });
    expect(commit.statusCode).toBe(200);
    expect(commit.json<{ added: number; mode: string }>()).toMatchObject({ added: 2, mode: "COMMIT" });
    expect((await app.inject({ method: "POST", url: "/bank-statements/commit", payload: body({ columnMap: { date: "Date" } }) })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/bank-statements/commit", payload: { companyId } })).statusCode).toBe(400);

    const imports = await app.inject({ method: "GET", url: `/bank-statements/imports?companyId=${companyId}&accountCode=BANK` });
    expect(imports.statusCode).toBe(200);
    expect(imports.json<{ imports: Array<{ linesAdded: number }> }>().imports).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/bank-statements/imports" })).statusCode).toBe(400);
  });
});
