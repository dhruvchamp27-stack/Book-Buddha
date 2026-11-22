import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerCashFlowRoutes } from "../api/cash-flow-routes.js";
import { buildApi } from "../api/server.js";
import { applyCashFlowSectionSchema } from "./cash-flow-section-schema.js";
import { allocateProRata, getCashFlow, sectionOf } from "./cash-flow.js";
import { AccountingRepository } from "./repository.js";

/**
 * Cash Flow Statement (direct method, S17-6), a small hand-worked world. Every figure below was
 * worked out on paper in rupees (RS) before it was asserted. Business "B", period 1-31 Oct 2025.
 */
const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let app: FastifyInstance;
let businessId: string;
let companyId: string;
let od: string;

let seq = 0;
function post(date: string, lines: Array<[string, number, number]>, opts: { source?: string; reversal?: boolean; id?: string } = {}): void {
  seq += 1;
  const id = opts.id ?? `je-cf-${seq}`;
  repository.db
    .prepare(
      "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date, fair_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .run(id, id, `hand entry ${seq}`, opts.reversal === true ? 1 : 0, new Date().toISOString(), opts.source ?? "MANUAL", businessId, date);
  const ins = repository.db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES (?, ?, ?, ?)");
  for (const [account, debit, credit] of lines) ins.run(id, account, RS(debit), RS(credit));
}

async function call<T>(method: "GET" | "PUT" | "POST", url: string, payload?: object, status = 200): Promise<T> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}

beforeAll(async () => {
  repository = new AccountingRepository();
  applyCashFlowSectionSchema(repository.db);
  applyCashFlowSectionSchema(repository.db); // idempotent
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  if (!app.hasRoute({ method: "GET", url: "/reports/cash-flow" })) registerCashFlowRoutes(app, { repository });
  await app.ready();

  companyId = (await call<{ id: string }>("POST", "/companies", { name: "Demo Books", accountingBasis: "ACCRUAL" }, 201)).id;
  businessId = (await call<{ id: string }>("POST", "/businesses", { companyId, name: "Book Fairs" }, 201)).id;
  await call("POST", "/accounts", { companyId, code: "FURNITURE", name: "Furniture", type: "ASSET" }, 201);
  od = (
    await call<{ bankAccount: { code: string } }>(
      "POST", "/bank-accounts", { companyId, name: "HDFC OD", kind: "OVERDRAFT", partOfCashManagement: false }, 201,
    )
  ).bankAccount.code;

  post("2025-09-15", [["CASH", 1000, 0], ["SALES", 0, 1000]]); // before the period: part of opening cash
  post("2025-10-01", [["CASH", 20000, 0], ["BANK", 50000, 0], ["OPENING_BALANCE_EQUITY", 0, 70000]], { source: "OPENING_BALANCE", id: "je-opening-balance-set1" });
  post("2025-10-03", [["CASH", 11800, 0], ["SALES", 0, 10000], ["OUTPUT_CGST", 0, 900], ["OUTPUT_SGST", 0, 900]]); // cash sale with GST
  post("2025-10-05", [["RECEIVABLES", 5900, 0], ["SALES", 0, 5000], ["OUTPUT_CGST", 0, 450], ["OUTPUT_SGST", 0, 450]]); // credit sale: no cash
  post("2025-10-08", [["BANK", 5900, 0], ["RECEIVABLES", 0, 5900]]); // ... paid by bank
  post("2025-10-10", [["INVENTORY", 3000, 0], ["PAYABLES", 0, 3000]]); // supplier bill: no cash
  post("2025-10-12", [["PAYABLES", 3000, 0], ["BANK", 0, 3000]]); // ... paid
  post("2025-10-14", [["EXPENSE", 1000, 0], ["INPUT_CGST", 90, 0], ["INPUT_SGST", 90, 0], ["CASH", 0, 1180]]); // expense with GST, cash
  post("2025-10-15", [["EXPENSE", 400, 0], ["CASH", 0, 400]]);
  post("2025-10-16", [["BANK", 25000, 0], ["CAPITAL", 0, 25000]]); // capital introduced
  post("2025-10-17", [["BANK", 40000, 0], ["LOANS", 0, 40000]]); // loan received
  post("2025-10-18", [["BANK", 2000, 0], ["CASH", 0, 2000]]); // internal transfer: not a flow
  post("2025-10-20", [["CASH", 1180, 0], ["EXPENSE", 0, 1000], ["INPUT_CGST", 0, 90], ["INPUT_SGST", 0, 90]], { reversal: true }); // cancels the 14 Oct expense
  post("2025-10-21", [["FURNITURE", 7000, 0], ["BANK", 0, 7000]]); // furniture bought
  post("2025-10-22", [["BANK", 10000, 0], [od, 0, 10000]]); // overdraft drawn: OD is NOT cash
  post("2025-11-02", [["CASH", 500, 0], ["SALES", 0, 500]]); // after the period
});

afterAll(async () => {
  await app.close();
  repository.close();
});

describe("allocateProRata and sectionOf", () => {
  it("splits to the paise", () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProRata(118, [100, 9, 9])).toEqual([100, 9, 9]);
    expect(allocateProRata(7, [3, 3, 1]).reduce((a, b) => a + b, 0)).toBe(7);
    expect(allocateProRata(10_000_000_000_00, [333, 333, 334]).reduce((a, b) => a + b, 0)).toBe(10_000_000_000_00);
  });
  it("derives the section by the rule", () => {
    expect(sectionOf({ code: "CAPITAL", role: null, company_id: null, cash_flow_section: null })).toBe("FINANCING");
    expect(sectionOf({ code: "LOANS", role: null, company_id: null, cash_flow_section: null })).toBe("FINANCING");
    expect(sectionOf({ code: "SALES", role: null, company_id: null, cash_flow_section: null })).toBe("OPERATING");
    // a system account ignores a stored value; a user account obeys it
    expect(sectionOf({ code: "SALES", role: null, company_id: null, cash_flow_section: "INVESTING" })).toBe("OPERATING");
    expect(sectionOf({ code: "X", role: null, company_id: "c", cash_flow_section: "INVESTING" })).toBe("INVESTING");
  });
});

describe("Cash Flow Statement: hand world, 1-31 Oct 2025", () => {
  it("section route: refuses a system account and a cash account, audits a user account", async () => {
    await call("PUT", "/chart-accounts/CAPITAL/cash-flow-section", { section: "OPERATING" }, 400);
    await call("PUT", "/chart-accounts/CASH/cash-flow-section", { section: "OPERATING" }, 400);
    const cur = (await call<{ bankAccount: { code: string } }>("POST", "/bank-accounts", { companyId, name: "ICICI Current", kind: "CURRENT" }, 201)).bankAccount.code;
    const refused = await app.inject({ method: "PUT", url: `/chart-accounts/${cur}/cash-flow-section`, payload: { section: "OPERATING" } });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toMatch(/cash account/);
    await call("PUT", `/chart-accounts/${od}/cash-flow-section`, { section: "FINANCING" }, 200); // OD is a user BANK account, not cash: allowed
    await call("PUT", "/chart-accounts/NOPE/cash-flow-section", { section: "INVESTING" }, 400);
    await call("PUT", "/chart-accounts/FURNITURE/cash-flow-section", { section: "BOGUS" }, 400);
    const before = (repository.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'CASH_FLOW_SECTION_SET'").get() as { n: number }).n;
    const ok = await call<{ cashFlowSection: string }>("PUT", "/chart-accounts/FURNITURE/cash-flow-section", { section: "INVESTING" });
    expect(ok.cashFlowSection).toBe("INVESTING");
    const rows = repository.db.prepare("SELECT entity_id FROM audit_events WHERE action = 'CASH_FLOW_SECTION_SET'").all() as Array<{ entity_id: string }>;
    expect(rows.length).toBe(before + 1);
    expect(rows.map((r) => r.entity_id)).toContain("FURNITURE");
    const stored = repository.db.prepare("SELECT cash_flow_section AS s FROM chart_accounts WHERE code = 'FURNITURE'").get() as { s: string };
    expect(stored.s).toBe("INVESTING");
    // system accounts untouched
    const sys = repository.db.prepare("SELECT cash_flow_section AS s FROM chart_accounts WHERE code = 'CAPITAL'").get() as { s: string | null };
    expect(sys.s).toBeNull();
  });

  it("every line, the totals and the tie", async () => {
    const r = await call<ReturnType<typeof getCashFlow>>("GET", `/reports/cash-flow?businessId=${businessId}&from=2025-10-01&to=2025-10-31`);
    expect(r.openingCashPaise).toBe(RS(71_000)); // 1,000 (Sep) + 70,000 opening balances dated 1 Oct
    expect(r.sections.operating).toEqual([
      { label: "Cash received from customers", inflowPaise: RS(17_700), outflowPaise: 0, netPaise: RS(17_700) }, // cash sale 11,800 + bank receipt 5,900
      { label: "Cash paid to suppliers", inflowPaise: 0, outflowPaise: RS(3_000), netPaise: -RS(3_000) }, // supplier payment only
      { label: "Cash paid for expenses", inflowPaise: RS(1_180), outflowPaise: RS(1_580), netPaise: -RS(400) }, // 1,180 (with its GST) + 400; the cancellation gives 1,180 back, GST included
    ]);
    expect(r.sections.investing).toEqual([{ label: "Furniture", inflowPaise: 0, outflowPaise: RS(7_000), netPaise: -RS(7_000) }]);
    expect(r.sections.financing).toEqual([
      { label: "Capital", inflowPaise: RS(25_000), outflowPaise: 0, netPaise: RS(25_000) },
      { label: "Loans", inflowPaise: RS(40_000), outflowPaise: 0, netPaise: RS(40_000) },
      { label: "HDFC OD", inflowPaise: RS(10_000), outflowPaise: 0, netPaise: RS(10_000) },
    ]);
    expect(r.totals.operating.netPaise).toBe(RS(14_300));
    expect(r.totals.investing.netPaise).toBe(-RS(7_000));
    expect(r.totals.financing.netPaise).toBe(RS(75_000));
    expect(r.netChangePaise).toBe(RS(82_300));
    expect(r.closingCashPaise).toBe(RS(153_300));
    expect(r.tie).toEqual({ closingFromLedgerPaise: RS(153_300), ok: true });
  });

  it("the internal transfer and the opening-balance entry appear in no line; a later period ties on its own", () => {
    const labels = (r: ReturnType<typeof getCashFlow>) =>
      [...r.sections.operating, ...r.sections.investing, ...r.sections.financing].map((l) => l.label);
    const oct = getCashFlow(repository.db, { businessId, from: "2025-10-01", to: "2025-10-31" });
    expect(labels(oct)).not.toContain("Opening Balance Equity");
    const nov = getCashFlow(repository.db, { businessId, from: "2025-11-01", to: "2025-11-30" });
    expect(nov.openingCashPaise).toBe(RS(153_300));
    expect(nov.netChangePaise).toBe(RS(500));
    expect(nov.tie.ok).toBe(true);
  });

  it("rejects a bad date", async () => {
    await call("GET", "/reports/cash-flow?from=2025-13-01", undefined, 400);
    await call("GET", "/reports/cash-flow?from=2025-10-31&to=2025-10-01", undefined, 400);
  });
});
