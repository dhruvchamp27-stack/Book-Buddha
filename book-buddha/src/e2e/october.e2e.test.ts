import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { resolveBackupFolder, restoreBackup } from "../backup/backup.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";

/**
 * ACCEPTANCE: October 2025 end to end (E2E-WORKINGS.md, ruling S16-5).
 *
 * The whole month is driven through the REAL HTTP routes of buildApi and every figure of the
 * approved workings is asserted. The figures are the truth: they were worked out by hand and
 * approved by the owner. If the app disagrees, the assertion stays and the disagreement is reported.
 *
 * Money is whole PAISE in the API; the rupee figure is always in the comment / the RS() call.
 * "Today" is pinned to 31 Oct 2025 (IST) with a Date-only fake clock, so every cancellation lands
 * on 31 Oct. Only Date is faked: Fastify inject and the SQLite backup need real timers.
 */

const RS = (rupees: number): number => rupees * 100;
const TIMEOUT = 120_000;

let repository: AccountingRepository;
let app: FastifyInstance;
let tmp: string;
let attachmentsRoot: string;
let backupsRoot: string;

async function call<T>(method: "GET" | "POST" | "PATCH", url: string, payload?: object, status = 200): Promise<T> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}

// ---- Shapes of the replies this file reads (only the fields used).
interface StatementLine { id: string; txnDate: string; amountPaise: number; status: string }
interface QueueEntry { line: StatementLine; links: Array<{ journalLineId: number; linkKind: string; documentId: string | null }>; suggestion: { ruleName: string; accountCode: string } | null }
interface RecDetail { header: { id: string; status: string }; candidates: Array<{ journalLineId: number; entryDate: string; inPaise: number; outPaise: number; ticked: boolean }>; clearedBalancePaise: number; differencePaise: number }
interface ReportRow { account: string; debitPaise: number; creditPaise: number; balancePaise: number }
interface PnL { gstOnSalesPaise: number; income: ReportRow[]; expenses: ReportRow[]; totalIncomePaise: number; totalExpensesPaise: number; netProfitPaise: number; basis: string }
interface TbRow { account: string; debitPaise: number; creditPaise: number }
interface RegisterRow { entryDate: string; inPaise: number; outPaise: number; runningBalancePaise: number }
interface Register { rows: RegisterRow[]; closingBalancePaise: number }
interface BalanceSheet { retainedEarnings: { totalPaise: number; split: { profitForYearPaise: number; broughtForwardPaise: number } | null }; assets: ReportRow[]; liabilities: ReportRow[]; equity: ReportRow[]; totalAssetsPaise: number; totalLiabilitiesPaise: number; totalEquityPaise: number }
interface StatementRow { date: string; type: string; reference: string; amountPaise: number; balancePaise: number }
interface CustomerStatement { rows: StatementRow[]; closingBalancePaise: number }
interface SalesTotalsRow { fairName?: string; fairId?: string | null; invoicedPaise: number; creditNotesPaise: number; netSalesPaise: number; invoiceCount: number; creditNoteCount: number }
interface ValuationLayer { itemName: string; quantity: number; unitCostPaise: number; valuePaise: number; sourceId: string | null }

// ---- World ids, filled by the first phase.
const w = {
  companyId: "", businessId: "", FY: "", HDFC: "",
  raman: "", sunrise: "", om: "", printHub: "", novel: "", notebook: "", fairId: "",
  openingRamanId: "", openingOmId: "", pb001: "", pb002: "", pr001: "", inv002PaymentCancelled: "",
};
// ---- Facts captured while the month runs, asserted in the `it` blocks below.
const facts: {
  fifoBeforeInv004: ValuationLayer[];
  stockAfterOpening: number;
  previewAdded?: number; previewWroteNothing?: boolean; commitAdded?: number; reimport?: { added: number; duplicates: number };
  booksUnchangedByStatement?: boolean; queueBefore?: Array<[string, number, string | null]>;
  transferMatchPostedNothing?: boolean; invoiceMatchPosted?: { debitHdfc: number; creditReceivables: number };
  receivablesAfterMatchRaman?: number; voucherNumbers?: string[]; queueAfter?: number;
  rec?: { tickedByStatement: Array<[string, number]>; differenceBefore: number; differenceAfter: number; clearedAfter: number; status: string; uncleared: Array<[string, number, number]> };
  attachmentListed?: string[];
  csvRows?: Record<string, [number, number]>;
} = { fifoBeforeInv004: [], stockAfterOpening: 0 };

const sumNet = (rows: readonly TbRow[]): number => rows.reduce((t, r) => t + r.debitPaise - r.creditPaise, 0);
const tbMap = (rows: readonly TbRow[]): Record<string, number> => {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const n = r.debitPaise - r.creditPaise;
    if (n !== 0) m[r.account] = n;
  }
  return m;
};
const journalLineCount = (): number => (repository.db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get() as { n: number }).n;
const tableCount = (table: string): number => (repository.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const getTb = (): Promise<TbRow[]> => call<TbRow[]>("GET", `/reports/trial-balance?businessId=${w.businessId}&asAtDate=2025-10-31`);

/** §3 Trial Balance: net balance per account, debit positive, in paise. */
function expectedTrialBalance(): Record<string, number> {
  return {
    [w.HDFC]: RS(71_966),
    CASH: RS(8_550),
    RECEIVABLES: RS(5_000),
    INVENTORY: RS(15_550),
    INPUT_CGST: RS(522),
    INPUT_SGST: RS(522),
    COGS: RS(18_450),
    EXPENSE: RS(2_000),
    PRINTING: RS(1_000),
    BANK_CHARGES: RS(300),
    OPENING_BALANCE_EQUITY: -RS(87_900),
    SALES: -RS(35_600),
    OUTPUT_CGST: -RS(180),
    OUTPUT_SGST: -RS(180),
  };
}

/** The October HDFC statement the owner approved: four lines, closing 84,066 (same file as the R12 set-two test, with ref UTR123). */
const STATEMENT = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "03/10/25,CASH DEPOSIT-FAIR,,03/10/25,,\"12,000.00\",\"62,000.00\"",
  "08/10/25,NEFT CR-RAMAN BOOKS,UTR123,08/10/25,,\"23,600.00\",\"85,600.00\"",
  "20/10/25,UPI-PRINTING HOUSE,UPI-20OCT,20/10/25,\"1,180.00\",,\"84,420.00\"",
  "31/10/25,CHGS INCL GST,,31/10/25,354.00,,\"84,066.00\"",
].join("\r\n");

beforeAll(async () => {
  // Date only: Fastify inject and the SQLite backup need real timers. 12:00 IST on 31 Oct 2025.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2025-10-31T06:30:00Z"));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-october-"));
  attachmentsRoot = path.join(tmp, "attachments");
  backupsRoot = path.join(tmp, "backups");
  repository = new AccountingRepository();
  app = buildApi(repository, { __unsafeDisableAuthForTests: true, attachmentStorageRoot: attachmentsRoot, backupsRoot });
  await app.ready();
});

afterAll(async () => {
  vi.useRealTimers();
  await app.close();
  repository.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ACCEPTANCE: October 2025 end to end (E2E-WORKINGS.md, ruling S16-5)", () => {
  // =============================================================================================
  // PHASE 1: the world (section 1) and the opening position (events 1-4)
  // =============================================================================================
  it("world and openings, events 1-4 (1 Oct)", async () => {
    w.companyId = (await call<{ id: string }>("POST", "/companies", { name: "Demo Books", accountingBasis: "ACCRUAL" }, 201)).id;
    w.businessId = (await call<{ id: string }>("POST", "/businesses", { companyId: w.companyId, name: "Book Fairs" }, 201)).id;
    w.FY = (await call<{ id: string }>("POST", "/financial-years", { businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" }, 201)).id;
    w.raman = (await call<{ id: string }>("POST", "/customers", { companyId: w.companyId, name: "Raman Books" }, 201)).id;
    w.sunrise = (await call<{ id: string }>("POST", "/customers", { companyId: w.companyId, name: "Sunrise School" }, 201)).id;
    w.om = (await call<{ id: string }>("POST", "/suppliers", { companyId: w.companyId, name: "Om Publishers" }, 201)).id;
    w.printHub = (await call<{ id: string }>("POST", "/suppliers", { companyId: w.companyId, name: "Print Hub" }, 201)).id;
    w.novel = (await call<{ id: string }>("POST", "/items", { companyId: w.companyId, name: "Novel A", unit: "each", trackStock: true }, 201)).id;
    w.notebook = (await call<{ id: string }>("POST", "/items", { companyId: w.companyId, name: "Notebook", unit: "each", trackStock: true }, 201)).id;
    await call("POST", "/accounts", { companyId: w.companyId, code: "PRINTING", name: "Printing", type: "EXPENSE" }, 201);
    await call("POST", "/accounts", { companyId: w.companyId, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" }, 201);
    w.HDFC = (await call<{ bankAccount: { code: string } }>("POST", "/bank-accounts", { companyId: w.companyId, name: "HDFC Current", kind: "CURRENT" }, 201)).bankAccount.code;
    expect(w.HDFC).toBe("BANK_HDFC_CURRENT");
    w.fairId = (await call<{ id: string }>("POST", "/fairs", { companyId: w.companyId, hostCustomerId: w.sunrise, name: "Pune Book Fair", startsAt: "2025-10-20", endsAt: "2025-10-22" }, 201)).id;

    // Event 1: HDFC 50,000 and Cash 20,000 (Opening Balance Equity 70,000).
    await call("POST", "/opening-balances", {
      businessId: w.businessId, asAt: "2025-10-01",
      lines: [{ account: w.HDFC, debitPaise: RS(50_000), creditPaise: 0 }, { account: "CASH", debitPaise: RS(20_000), creditPaise: 0 }],
    }, 201);
    // Event 2: Raman Books owes 5,900 (no income earned before the books began).
    w.openingRamanId = (await call<{ id: string }>("POST", "/opening-customer-balances", { businessId: w.businessId, customerId: w.raman, asAt: "2025-10-01", amountPaise: RS(5_900), incomePaise: 0 }, 201)).id;
    // Event 3: we owe Om Publishers 3,000.
    w.openingOmId = (await call<{ id: string }>("POST", "/opening-supplier-balances", { businessId: w.businessId, supplierId: w.om, asAt: "2025-10-01", amountPaise: RS(3_000) }, 201)).id;
    // Event 4: opening stock, Novel A 150 at Rs 100. Posted BEFORE any bill (FIFO is insertion order).
    await call("POST", "/inventory/movements", { itemId: w.novel, movementType: "OPENING", quantity: 150, unitCostPaise: RS(100), businessId: w.businessId, occurredOn: "2025-10-01" }, 201);

    const tb = tbMap(await call<TbRow[]>("GET", `/reports/trial-balance?businessId=${w.businessId}&asAtDate=2025-10-01`));
    facts.stockAfterOpening = tb["INVENTORY"] ?? 0;
    expect(tb[w.HDFC], "HDFC after event 1").toBe(RS(50_000));
    expect(tb["CASH"], "Cash after event 1").toBe(RS(20_000));
    expect(tb["RECEIVABLES"], "Receivables after event 2").toBe(RS(5_900));
    expect(tb["PAYABLES"], "Payables after event 3").toBe(-RS(3_000));
    expect(tb["INVENTORY"], "Inventory after event 4").toBe(RS(15_000));
    expect(tb["OPENING_BALANCE_EQUITY"], "Opening Balance Equity 70,000 + 5,900 - 3,000 + 15,000").toBe(-RS(87_900));
  }, TIMEOUT);

  // =============================================================================================
  // PHASE 2: events 5-12 (2 Oct - 18 Oct), plus the statement import
  // =============================================================================================
  it("events 5-7 (2-6 Oct): INV-001, Internal Transfer, opening supplier balance paid in cash", async () => {
    // Event 5 + 5a: INV-001 to Raman on credit, 118 Novel A at Rs 200.
    const inv1 = await call<{ id: string }>("POST", "/invoices", {
      id: "inv-001", businessId: w.businessId, customerId: w.raman, paymentAccount: "RECEIVABLES",
      invoiceDate: "2025-10-02", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 118, unitPricePaise: RS(200) }],
    }, 201);
    await call("POST", `/invoices/${inv1.id}/finalize`, {});
    // Event 6: fair cash banked, Internal Transfer Cash -> HDFC 12,000.
    await call("POST", "/internal-transfers", { businessId: w.businessId, date: "2025-10-03", fromAccount: "CASH", toAccount: w.HDFC, amountPaise: RS(12_000), memo: "Fair cash banked" }, 201);
    // Event 7: the opening supplier balance paid to Om Publishers in cash.
    await call("POST", `/opening-supplier-balances/${w.openingOmId}/settlements`, { amountPaise: RS(3_000), paidOn: "2025-10-06", moneyAccount: "CASH" }, 201);

    const tb = tbMap(await call<TbRow[]>("GET", `/reports/trial-balance?businessId=${w.businessId}&asAtDate=2025-10-07`));
    expect(tb["RECEIVABLES"], "Receivables 5,900 + 23,600").toBe(RS(29_500));
    expect(tb["COGS"], "Cost of the 118 books at Rs 100").toBe(RS(11_800));
    expect(tb["INVENTORY"], "15,000 - 11,800").toBe(RS(3_200));
    expect(tb["CASH"], "20,000 - 12,000 - 3,000").toBe(RS(5_000));
    expect(tb[w.HDFC], "50,000 + 12,000").toBe(RS(62_000));
    expect(tb["PAYABLES"], "Payables cleared by the settlement").toBeUndefined();
  }, TIMEOUT);

  it("bank statement, step 1 of section 5: inspect, preview writes nothing, commit adds 4, re-import adds 0 with 4 duplicates, books unchanged", async () => {
    const file = { fileName: "hdfc-oct.csv", contentBase64: Buffer.from(STATEMENT, "utf8").toString("base64") };
    const inspected = await call<{ suggestedMap: Record<string, string> }>("POST", "/bank-statements/inspect", file);
    const run = { ...file, companyId: w.companyId, accountCode: w.HDFC, businessId: w.businessId, columnMap: inspected.suggestedMap, dateFormat: "DD/MM/YYYY" };
    const journalBefore = journalLineCount();
    const preview = await call<{ added: number; totalInPaise: number; totalOutPaise: number; balanceBreaks: number[] }>("POST", "/bank-statements/preview", run);
    facts.previewAdded = preview.added;
    expect(preview).toMatchObject({ added: 4, totalInPaise: RS(35_600), totalOutPaise: RS(1_534), balanceBreaks: [] });
    facts.previewWroteNothing = tableCount("bank_statement_lines") === 0;
    expect(facts.previewWroteNothing, "the preview writes nothing").toBe(true);
    facts.commitAdded = (await call<{ added: number }>("POST", "/bank-statements/commit", run)).added;
    expect(facts.commitAdded).toBe(4);
    facts.reimport = await call<{ added: number; duplicates: number }>("POST", "/bank-statements/commit", run);
    expect(facts.reimport).toMatchObject({ added: 0, duplicates: 4 });
    expect(tableCount("bank_statement_lines")).toBe(4);
    facts.booksUnchangedByStatement = journalLineCount() === journalBefore;
    expect(facts.booksUnchangedByStatement, "a statement posts nothing").toBe(true);
  }, TIMEOUT);

  it("events 8-12 (8-18 Oct): Raman's NEFT matched to INV-001 from the bank feed, PB-001, cheque, PB-002 input, PR-001", async () => {
    // Bank rule "Bank charges" (pre-fill only): DESCRIPTION CONTAINS "chgs" -> ADD BANK_CHARGES.
    await call("POST", "/bank-rules", { companyId: w.companyId, name: "Bank charges", action: "ADD", targetAccount: "BANK_CHARGES", direction: "OUT", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "chgs" }] }, 201);

    // The review queue, oldest first. Only the 354 line is pre-filled by the rule.
    const queue = (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${w.companyId}&accountCode=${w.HDFC}`)).lines;
    facts.queueBefore = queue.map((q) => [q.line.txnDate, q.line.amountPaise, q.suggestion?.accountCode ?? null]);
    expect(facts.queueBefore).toEqual([
      ["2025-10-03", RS(12_000), null],
      ["2025-10-08", RS(23_600), null],
      ["2025-10-20", -RS(1_180), null],
      ["2025-10-31", -RS(354), "BANK_CHARGES"],
    ]);
    const [deposit, neft] = queue.map((q) => q.line.id) as [string, string];

    // Event 6 (bank side): the 12,000 line is matched to the EXISTING Internal Transfer: nothing posted.
    const depositMatches = await call<{ postedLines: Array<{ journalLineId: number; sourceType: string }> }>("GET", `/bank-feed/lines/${deposit}/matches`);
    expect(depositMatches.postedLines.map((p) => p.sourceType)).toEqual(["INTERNAL_TRANSFER"]);
    const before = journalLineCount();
    await call("POST", `/bank-feed/lines/${deposit}/match`, { journalLineIds: [depositMatches.postedLines[0]!.journalLineId] });
    facts.transferMatchPostedNothing = journalLineCount() === before;
    expect(facts.transferMatchPostedNothing, "matching the deposit to the transfer posts nothing").toBe(true);

    // Event 8: the 23,600 NEFT (ref UTR123) is matched to INV-001: this is the payment. Asked first (writes nothing), then done.
    const neftMatches = await call<{ documents: Array<{ id: string; number: string; outstandingPaise: number }> }>("GET", `/bank-feed/lines/${neft}/matches`);
    expect(neftMatches.documents.find((d) => d.number === "INV-001/25-26")).toMatchObject({ id: "inv-001", outstandingPaise: RS(23_600) });
    const docs = [{ kind: "INVOICE", id: "inv-001", amountPaise: RS(23_600) }];
    const asked = await call<{ confirmed: boolean; willPost: Array<{ lines: Array<{ account: string; debitPaise: number; creditPaise: number }> }> }>(
      "POST", `/bank-feed/lines/${neft}/match`, { documents: docs, paymentMode: "NEFT", confirm: false },
    );
    expect(asked.confirmed).toBe(false);
    const askedLines = asked.willPost[0]!.lines;
    facts.invoiceMatchPosted = {
      debitHdfc: askedLines.find((l) => l.account === w.HDFC)?.debitPaise ?? 0,
      creditReceivables: askedLines.find((l) => l.account === "RECEIVABLES")?.creditPaise ?? 0,
    };
    expect(facts.invoiceMatchPosted).toEqual({ debitHdfc: RS(23_600), creditReceivables: RS(23_600) });
    const done = await call<{ line: StatementLine }>("POST", `/bank-feed/lines/${neft}/match`, { documents: docs, paymentMode: "NEFT", confirm: true });
    expect(done.line.status).toBe("MATCHED");

    // Event 9: PB-001 from Om Publishers on credit, 120 Novel A at Rs 150.
    const pb001 = await call<{ id: string }>("POST", "/purchase-bills", {
      businessId: w.businessId, supplierId: w.om, number: "PB-001", billDate: "2025-10-10", paymentAccount: "PAYABLES",
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 120, unitPricePaise: RS(150) }],
    }, 201);
    w.pb001 = pb001.id;
    await call("POST", `/purchase-bills/${w.pb001}/finalize`, {});
    // Event 10: PB-001 paid by HDFC cheque CHQ 000451 (not yet presented).
    await call("POST", "/supplier-payments", { billId: w.pb001, amountPaise: RS(18_000), paidOn: "2025-10-15", moneyAccount: w.HDFC, paymentMode: "CHEQUE", paymentReference: "CHQ 000451" }, 201);
    // Event 11: PB-002 from Print Hub, paid in cash: 100 Notebooks at Rs 25 = 2,500 + GST 450.
    const pb002 = await call<{ id: string }>("POST", "/purchase-bills", {
      businessId: w.businessId, supplierId: w.printHub, number: "PB-002", billDate: "2025-10-16", paymentAccount: "CASH", moneyAccount: "CASH",
      taxType: "CGST_SGST", taxRateBasisPoints: 1800,
      lines: [{ itemId: w.notebook, description: "Notebook", quantity: 100, unitPricePaise: RS(25) }],
    }, 201);
    w.pb002 = pb002.id;
    await call("POST", `/purchase-bills/${w.pb002}/finalize`, {});
    // Event 12: PR-001, 10 Novel A returned to Om at Rs 150. PB-001 is already paid, so it becomes a supplier credit.
    const pr001 = await call<{ id: string }>("POST", "/purchase-returns", {
      billId: w.pb001, reason: "Damaged copies", returnDate: "2025-10-18",
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 10, unitPricePaise: RS(150) }],
    }, 201);
    w.pr001 = pr001.id;
    await call("POST", `/purchase-returns/${w.pr001}/finalize`, {});

    const tb = tbMap(await call<TbRow[]>("GET", `/reports/trial-balance?businessId=${w.businessId}&asAtDate=2025-10-18`));
    expect(tb["SUPPLIER_CREDITS"], "Supplier Credits 1,500 after event 12").toBe(RS(1_500));
    expect(tb["PAYABLES"], "Payables 0 after events 9, 10").toBeUndefined();
    expect(tb[w.HDFC], "HDFC 50,000 + 12,000 + 23,600 - 18,000").toBe(RS(67_600));
    expect(tb["CASH"], "Cash 5,000 - 2,950").toBe(RS(2_050));
  }, TIMEOUT);

  // =============================================================================================
  // PHASE 3: events 13-21 (20-28 Oct)
  // =============================================================================================
  it("events 13-21 (20-28 Oct): printer voucher, fair cash sales, stall rent, CN-001, INV-004, refund, receipts", async () => {
    const queue = (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${w.companyId}&accountCode=${w.HDFC}`)).lines;
    expect(queue.map((q) => q.line.txnDate)).toEqual(["2025-10-20", "2025-10-31"]);
    const [upi] = queue.map((q) => q.line.id) as [string];

    // Event 13 (20 Oct): UPI 1,180 added as Printing 1,000 + GST 180 (voucher PV-001).
    const upiDone = await call<{ line: StatementLine }>("POST", `/bank-feed/lines/${upi}/add`, {
      splits: [{ accountCode: "PRINTING", amountPaise: RS(1_000) }, { accountCode: "INPUT_CGST", amountPaise: RS(90) }, { accountCode: "INPUT_SGST", amountPaise: RS(90) }],
      partyName: "Printing House", paymentMode: "UPI", confirm: true,
    });
    expect(upiDone.line.status).toBe("ADDED");

    // Events 14 + 14a (21 Oct): INV-002, fair walk-in, paid in cash, 30 Novel A at Rs 200.
    await call("POST", "/invoices", {
      id: "inv-002", businessId: w.businessId, customerId: w.sunrise, buyerName: "Walk-in buyer", paymentAccount: "CASH", moneyAccount: "CASH", fairId: w.fairId,
      invoiceDate: "2025-10-21", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 30, unitPricePaise: RS(200) }],
    }, 201);
    await call("POST", "/invoices/inv-002/finalize", {});
    // Events 15 + 15a (21 Oct): INV-003, fair walk-in, paid in cash, 50 Notebooks at Rs 40 + GST 18%.
    await call("POST", "/invoices", {
      id: "inv-003", businessId: w.businessId, customerId: w.sunrise, buyerName: "Walk-in buyer", paymentAccount: "CASH", moneyAccount: "CASH", fairId: w.fairId,
      invoiceDate: "2025-10-21", taxType: "CGST_SGST", taxRateBasisPoints: 1800,
      lines: [{ itemId: w.notebook, description: "Notebook", quantity: 50, unitPricePaise: RS(40) }],
    }, 201);
    await call("POST", "/invoices/inv-003/finalize", {});
    // Event 16 (21 Oct): EXP-001 fair stall rent, paid in cash, 2,000 + GST 360.
    const exp = await call<{ id: string }>("POST", "/expenses", {
      businessId: w.businessId, number: "EXP-001", expenseDate: "2025-10-21", description: "Fair stall rent", amountPaise: RS(2_000),
      paymentAccount: "CASH", moneyAccount: "CASH", taxType: "CGST_SGST", taxRateBasisPoints: 1800, fairId: w.fairId,
    }, 201);
    await call("POST", `/expenses/${exp.id}/finalize`, {});

    // Events 17 + 17a (22 Oct): CN-001 on INV-002, 5 Novel A at Rs 200, cash given back at once.
    const cn = await call<{ id: string }>("POST", "/credit-notes", {
      invoiceId: "inv-002", reason: "Customer returned 5 books", noteDate: "2025-10-22",
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 5, unitPricePaise: RS(200) }],
    }, 201);
    await call("POST", `/credit-notes/${cn.id}/finalize`, {});
    // INV-002 was a cash sale, so finalizing the note itself gives the cash back at once: nothing is left to refund.
    expect(await call<{ refundablePaise: number; outstandingPaise: number }>("GET", `/credit-notes/${cn.id}/balance`)).toMatchObject({ refundablePaise: 0, outstandingPaise: 0 });

    // The FIFO queue before INV-004 (so an ordering mistake cannot hide behind the 2,900 cost):
    // the last 2 opening books at Rs 100, PB-001's lot (110 left) at Rs 150, CN-001's 5 returned books at Rs 100.
    const detail = await call<{ rows: ValuationLayer[] }>("GET", "/reports/inventory-valuation-detail?asAtDate=2025-10-22");
    facts.fifoBeforeInv004 = detail.rows.filter((r) => r.itemName === "Novel A");

    // Events 18 + 18a (22 Oct): INV-004 to Sunrise School on credit, at the fair, 20 Novel A at Rs 250.
    await call("POST", "/invoices", {
      id: "inv-004", businessId: w.businessId, customerId: w.sunrise, paymentAccount: "RECEIVABLES", fairId: w.fairId,
      invoiceDate: "2025-10-22", taxType: "NONE", taxRateBasisPoints: 0,
      lines: [{ itemId: w.novel, description: "Novel A", quantity: 20, unitPricePaise: RS(250) }],
    }, 201);
    await call("POST", "/invoices/inv-004/finalize", {});

    // Event 19 (24 Oct): Om Publishers refunds the PR-001 credit in cash.
    await call("POST", `/purchase-returns/${w.pr001}/refunds`, { amountPaise: RS(1_500), refundedOn: "2025-10-24", moneyAccount: "CASH" }, 201);
    // Event 20 (25 Oct): Sunrise pays INV-004 in cash (recorded in error; cancelled in event 22).
    const pay = await call<{ id: string }>("POST", "/invoices/inv-004/payments", { amountPaise: RS(5_000), paidOn: "2025-10-25", moneyAccount: "CASH" }, 201);
    w.inv002PaymentCancelled = pay.id;
    // Event 21 (28 Oct): Raman pays his opening balance by cheque into HDFC (not yet cleared).
    await call("POST", `/opening-customer-balances/${w.openingRamanId}/receipts`, { amountPaise: RS(5_900), receivedOn: "2025-10-28", moneyAccount: w.HDFC, paymentMode: "CHEQUE" }, 201);

    const tb = tbMap(await call<TbRow[]>("GET", `/reports/trial-balance?businessId=${w.businessId}&asAtDate=2025-10-28`));
    expect(tb["CASH"], "Cash on 28 Oct before the cancellation").toBe(RS(13_550));
    expect(tb["RECEIVABLES"], "Receivables 28 Oct: INV-004 'paid' (in error) and every other balance settled").toBeUndefined();
  }, TIMEOUT);

  // =============================================================================================
  // PHASE 4: events 22-23 (31 Oct), bank-feed charges, reconciliation
  // =============================================================================================
  it("events 22-23 (31 Oct): the 25 Oct payment cancelled by reversal; charges added from the bank feed; reconciliation to 84,066", async () => {
    // Event 22: the 25 Oct payment was recorded in error and is cancelled by reversal (dated today = 31 Oct).
    await call("POST", `/payments/${w.inv002PaymentCancelled}/cancel`, { reason: "Recorded in error" });

    // Event 23: charges 354 added as Bank Charges 300 + GST 54 (voucher PV-002), pre-filled by the rule.
    const queue = (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${w.companyId}&accountCode=${w.HDFC}`)).lines;
    expect(queue.map((q) => [q.line.txnDate, q.suggestion?.accountCode ?? null])).toEqual([["2025-10-31", "BANK_CHARGES"]]);
    await call("POST", `/bank-feed/lines/${queue[0]!.line.id}/add`, {
      splits: [{ accountCode: "BANK_CHARGES", amountPaise: RS(300) }, { accountCode: "INPUT_CGST", amountPaise: RS(27) }, { accountCode: "INPUT_SGST", amountPaise: RS(27) }],
      partyName: "HDFC Bank", confirm: true,
    });
    facts.queueAfter = (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${w.companyId}&accountCode=${w.HDFC}`)).lines.length;
    const vouchers = await call<Array<{ number: string; voucherDate: string }>>("GET", `/vouchers?companyId=${w.companyId}`);
    facts.voucherNumbers = vouchers.map((v) => `${v.voucherDate} ${v.number}`).sort();

    // Section 5 step 3: reconcile to 31 Oct, statement balance 84,066. The four statement lines arrive ticked.
    let rec = await call<RecDetail>("POST", "/reconciliations", { companyId: w.companyId, accountCode: w.HDFC, statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) }, 201);
    const tickedByStatement = rec.candidates.filter((c) => c.ticked).map((c): [string, number] => [c.entryDate, c.inPaise - c.outPaise]);
    const differenceBefore = rec.differencePaise;
    const openingLine = rec.candidates.find((c) => c.entryDate === "2025-10-01")!.journalLineId;
    rec = await call<RecDetail>("POST", `/reconciliations/${rec.header.id}/ticks`, { journalLineIds: [openingLine], ticked: true });
    const differenceAfter = rec.differencePaise;
    const finished = await call<RecDetail>("POST", `/reconciliations/${rec.header.id}/finish`, {});
    const report = await call<{ unclearedLines: Array<{ entryDate: string; inPaise: number; outPaise: number }> }>("GET", `/reconciliations/${rec.header.id}/report`);
    facts.rec = {
      tickedByStatement, differenceBefore, differenceAfter, clearedAfter: rec.clearedBalancePaise, status: finished.header.status,
      uncleared: report.unclearedLines.map((l): [string, number, number] => [l.entryDate, l.inPaise, l.outPaise]),
    };
  }, TIMEOUT);

  // =============================================================================================
  // ASSERTIONS
  // =============================================================================================
  it("FIFO queue before INV-004: Novel A has 2 at Rs 100, PB-001 lot 110 at Rs 150, CN-001 layer 5 at Rs 100 (events 5a, 14a, 17a)", () => {
    // In the order the report returns them: the queue order (oldest first), CN-001's returned books at the back.
    const layers = facts.fifoBeforeInv004.map((r) => `${r.quantity}@${r.unitCostPaise}`);
    expect(layers).toEqual([`2@${RS(100)}`, `110@${RS(150)}`, `5@${RS(100)}`]);
    const pbLayer = facts.fifoBeforeInv004.find((r) => r.quantity === 110);
    expect(pbLayer?.sourceId, "the 110-lot is PB-001's own lot").toBe(w.pb001);
  });

  it("bank statement and review queue (section 5, events 6, 8, 13, 23)", () => {
    expect(facts.previewAdded).toBe(4);
    expect(facts.previewWroteNothing).toBe(true);
    expect(facts.commitAdded).toBe(4);
    expect(facts.reimport).toMatchObject({ added: 0, duplicates: 4 });
    expect(facts.booksUnchangedByStatement).toBe(true);
    expect(facts.queueBefore?.map((q) => q[2])).toEqual([null, null, null, "BANK_CHARGES"]);
    expect(facts.transferMatchPostedNothing).toBe(true);
    expect(facts.invoiceMatchPosted).toEqual({ debitHdfc: RS(23_600), creditReceivables: RS(23_600) });
    expect(facts.queueAfter, "the queue is cleared").toBe(0);
    expect(facts.voucherNumbers).toEqual(["2025-10-20 PV-001/25-26", "2025-10-31 PV-002/25-26"]);
  });

  it("Trial Balance 31 Oct (section 3): every row, and nothing else is non-zero; payables, supplier and customer credits are zero", async () => {
    const tb = await getTb();
    expect(tbMap(tb)).toEqual(expectedTrialBalance());
    expect(sumNet(tb), "debits equal credits").toBe(0);
    const debit = tb.reduce((t, r) => t + r.debitPaise, 0);
    const credit = tb.reduce((t, r) => t + r.creditPaise, 0);
    expect(debit).toBe(RS(123_860));
    expect(credit).toBe(RS(123_860));
    const byAccount = tbMap(tb);
    for (const zero of ["PAYABLES", "SUPPLIER_CREDITS", "CUSTOMER_CREDITS"]) expect(byAccount[zero] ?? 0, zero).toBe(0);
    // GST (section 4): output 360, input 1,044, net 684 to claim back.
    const out = (byAccount["OUTPUT_CGST"] ?? 0) + (byAccount["OUTPUT_SGST"] ?? 0);
    const inp = (byAccount["INPUT_CGST"] ?? 0) + (byAccount["INPUT_SGST"] ?? 0);
    expect(-out).toBe(RS(360));
    expect(inp).toBe(RS(1_044));
    expect(inp + out).toBe(RS(684));
  });

  it("Profit & Loss 1-31 Oct, ACCRUAL: sales 35,600, COGS 18,450, rent 2,000, printing 1,000, bank charges 300, net 13,850", async () => {
    const pnl = await call<PnL>("GET", `/reports/profit-and-loss?businessId=${w.businessId}&fromDate=2025-10-01&toDate=2025-10-31&basis=ACCRUAL`);
    expect(pnl.basis).toBe("ACCRUAL");
    expect(pnl.totalIncomePaise).toBe(RS(35_600));
    expect(pnl.totalExpensesPaise).toBe(RS(21_750));
    expect(pnl.netProfitPaise).toBe(RS(13_850));
    expect(pnl.gstOnSalesPaise, "GST on sales: output 360").toBe(RS(360));
    // Accrual rows are gross sums with balancePaise = debit - credit: sales net credit 35,600.
    const income = Object.fromEntries(pnl.income.filter((r) => r.balancePaise !== 0).map((r) => [r.account, -r.balancePaise]));
    const expenses = Object.fromEntries(pnl.expenses.filter((r) => r.balancePaise !== 0).map((r) => [r.account, r.balancePaise]));
    expect(income).toEqual({ SALES: RS(35_600) });
    expect(expenses).toEqual({ COGS: RS(18_450), EXPENSE: RS(2_000), PRINTING: RS(1_000), BANK_CHARGES: RS(300) });
  });

  // Was a known disagreement (S16-6): the cash view refused these books with a 400 because of PR-001, a
  // purchase return against an already PAID bill. Fixed under ruling S16-7(1) (a return is treated like a
  // credit note; the paid part is recognised on the refund date). Figures are the approved ones, unchanged.
  it("Profit & Loss 1-31 Oct, CASH: sales 30,600, COGS 15,550, rent 2,000, printing 1,000, bank charges 300, net 11,750", async () => {
    const pnl = await call<PnL>("GET", `/reports/profit-and-loss?businessId=${w.businessId}&fromDate=2025-10-01&toDate=2025-10-31&basis=CASH`);
    expect(pnl.basis).toBe("CASH");
    expect(pnl.totalIncomePaise).toBe(RS(30_600));
    expect(pnl.totalExpensesPaise).toBe(RS(18_850));
    expect(pnl.netProfitPaise).toBe(RS(11_750));
    const income = Object.fromEntries(pnl.income.filter((r) => r.balancePaise !== 0).map((r) => [r.account, Math.abs(r.balancePaise)]));
    const expenses = Object.fromEntries(pnl.expenses.filter((r) => r.balancePaise !== 0).map((r) => [r.account, r.balancePaise]));
    expect(income).toEqual({ SALES: RS(30_600) });
    expect(expenses).toEqual({ COGS: RS(15_550), EXPENSE: RS(2_000), PRINTING: RS(1_000), BANK_CHARGES: RS(300) });
  });

  it("EXTRA, NOT IN THE APPROVED WORKINGS (my derivation from section 2): Pune Book Fair CASH basis sales 7,000, COGS 3,750, rent 2,000, net 1,250", async () => {
    // INV-002 6,000 - CN-001 1,000 + INV-003 2,000 = 7,000; cost 3,000 - 500 + 1,250 = 3,750; INV-004 is unpaid so it drops out.
    const pnl = await call<PnL>("GET", `/reports/profit-and-loss?businessId=${w.businessId}&fairId=${w.fairId}&fromDate=2025-10-01&toDate=2025-10-31&basis=CASH`);
    expect(pnl.totalIncomePaise).toBe(RS(7_000));
    expect(pnl.totalExpensesPaise).toBe(RS(5_750));
    expect(pnl.netProfitPaise).toBe(RS(1_250));
  });

  const pnlTo = (to: string, basis: string): Promise<PnL> =>
    call<PnL>("GET", `/reports/profit-and-loss?businessId=${w.businessId}&fromDate=2025-10-01&toDate=${to}&basis=${basis}`);

  it("Payment dates (R2): 1-7 Oct ACCRUAL profit is 11,800 (23,600 less 11,800 cost)", async () => {
    const accrual7 = await pnlTo("2025-10-07", "ACCRUAL");
    expect(accrual7.totalIncomePaise).toBe(RS(23_600));
    expect(accrual7.totalExpensesPaise).toBe(RS(11_800));
    expect(accrual7.netProfitPaise).toBe(RS(11_800));
    expect((await pnlTo("2025-10-08", "ACCRUAL")).netProfitPaise).toBe(RS(11_800));
  });

  // Was blocked by the same 400 as above; fixed under S16-7(1). Approved R2 cash figures, unchanged.
  it("Payment dates (R2): 1-7 Oct CASH profit is 0 (Raman paid on 8 Oct); to 8 Oct CASH profit is 11,800", async () => {
    expect((await pnlTo("2025-10-07", "CASH")).netProfitPaise).toBe(0);
    expect((await pnlTo("2025-10-08", "CASH")).netProfitPaise).toBe(RS(11_800));
  });

  it("Balance Sheet 31 Oct: assets 102,110; liabilities 360; equity 101,750 (OBE 87,900 + profit 13,850); balances", async () => {
    const bs = await call<BalanceSheet>("GET", `/reports/balance-sheet?businessId=${w.businessId}&asAtDate=2025-10-31`);
    const assets = Object.fromEntries(bs.assets.filter((r) => r.balancePaise !== 0).map((r) => [r.account, r.balancePaise]));
    expect(assets).toEqual({
      [w.HDFC]: RS(71_966), CASH: RS(8_550), RECEIVABLES: RS(5_000), INVENTORY: RS(15_550), INPUT_CGST: RS(522), INPUT_SGST: RS(522),
    });
    expect(bs.totalAssetsPaise).toBe(RS(102_110));
    const liabilities = Object.fromEntries(bs.liabilities.filter((r) => r.balancePaise !== 0).map((r) => [r.account, Math.abs(r.balancePaise)]));
    expect(liabilities).toEqual({ OUTPUT_CGST: RS(180), OUTPUT_SGST: RS(180) });
    expect(bs.totalLiabilitiesPaise).toBe(RS(360));
    const equity = Object.fromEntries(bs.equity.filter((r) => r.balancePaise !== 0).map((r) => [r.account, Math.abs(r.balancePaise)]));
    expect(equity["OPENING_BALANCE_EQUITY"]).toBe(RS(87_900));
    expect(bs.retainedEarnings.totalPaise, "Profit this year (accrual)").toBe(RS(13_850));
    expect(bs.retainedEarnings.split?.profitForYearPaise).toBe(RS(13_850));
    expect(bs.totalEquityPaise).toBe(RS(101_750));
    expect(bs.totalLiabilitiesPaise + bs.totalEquityPaise).toBe(RS(102_110));
    expect(bs.totalAssetsPaise).toBe(bs.totalLiabilitiesPaise + bs.totalEquityPaise);
  });

  it("Receivables, Payables, Inventory valuation agree with their accounts (section 4)", async () => {
    const receivables = await call<Array<{ invoiceNumber: string; customerId: string; outstandingPaise: number }>>("GET", `/reports/receivables?businessId=${w.businessId}`);
    expect(receivables.map((r) => [r.invoiceNumber, r.customerId, r.outstandingPaise])).toEqual([["INV-004/25-26", w.sunrise, RS(5_000)]]);
    expect(receivables.reduce((t, r) => t + r.outstandingPaise, 0)).toBe(RS(5_000));

    const payables = await call<unknown[]>("GET", `/reports/payables?businessId=${w.businessId}`);
    expect(payables).toEqual([]);

    const valuation = await call<Array<{ itemName: string; quantity: number; valuePaise: number }>>("GET", "/reports/inventory-valuation");
    const byItem = Object.fromEntries(valuation.map((r) => [r.itemName, [r.quantity, r.valuePaise]]));
    expect(byItem).toEqual({ "Novel A": [97, RS(14_300)], Notebook: [50, RS(1_250)] });
    expect(valuation.reduce((t, r) => t + r.valuePaise, 0)).toBe(RS(15_550));
  });

  it("Sales by fair and by item (section 4)", async () => {
    const byFair = await call<{ rows: SalesTotalsRow[]; totals: SalesTotalsRow }>("GET", `/reports/sales-by-fair?businessId=${w.businessId}`);
    const pune = byFair.rows.find((r) => r.fairName === "Pune Book Fair");
    expect(pune).toMatchObject({ invoicedPaise: RS(13_000), creditNotesPaise: RS(1_000), netSalesPaise: RS(12_000), invoiceCount: 3, creditNoteCount: 1 });
    const outside = byFair.rows.filter((r) => r.fairName !== "Pune Book Fair");
    expect(outside.reduce((t, r) => t + r.netSalesPaise, 0), "sales outside the fair: INV-001").toBe(RS(23_600));
    expect(byFair.totals.netSalesPaise, "fair 12,000 + 23,600 = Sales 35,600").toBe(RS(35_600));
    const fairSales = await call<Array<{ fairName: string; netSalesPaise: number; invoiceCount: number }>>("GET", `/reports/fair-sales?businessId=${w.businessId}`);
    expect(fairSales.find((r) => r.fairName === "Pune Book Fair")).toMatchObject({ netSalesPaise: RS(12_000), invoiceCount: 3 });

    const byItemReport = await call<{ rows?: unknown[] } | Array<Record<string, unknown>>>("GET", `/reports/sales-by-item?businessId=${w.businessId}`);
    const rows = (Array.isArray(byItemReport) ? byItemReport : (byItemReport.rows ?? [])) as Array<{ itemName: string; quantity: number; salesPaise: number; returnedQuantity: number; returnsPaise: number; netQuantity: number; netSalesPaise: number }>;
    expect(rows.find((r) => r.itemName === "Novel A")).toMatchObject({ quantity: 168, salesPaise: RS(34_600), returnedQuantity: 5, returnsPaise: RS(1_000), netQuantity: 163, netSalesPaise: RS(33_600) });
    expect(rows.find((r) => r.itemName === "Notebook")).toMatchObject({ quantity: 50, salesPaise: RS(2_000), netSalesPaise: RS(2_000) });
    expect(rows.reduce((t, r) => t + r.netSalesPaise, 0), "items together = Sales").toBe(RS(35_600));
  });

  it("Customer statements: Raman closes at 0, Sunrise at 5,000 with NO row for the cancelled payment (S13-1)", async () => {
    const raman = await call<CustomerStatement>("GET", `/reports/customer-statement?customerId=${w.raman}&businessId=${w.businessId}`);
    expect(raman.rows.map((r) => [r.date, r.type, r.amountPaise])).toEqual([
      ["2025-10-01", "OPENING", RS(5_900)],
      ["2025-10-02", "INVOICE", RS(23_600)],
      ["2025-10-08", "PAYMENT", -RS(23_600)],
      ["2025-10-28", "OPENING_RECEIPT", -RS(5_900)],
    ]);
    expect(raman.closingBalancePaise).toBe(0);
    const sunrise = await call<CustomerStatement>("GET", `/reports/customer-statement?customerId=${w.sunrise}&businessId=${w.businessId}`);
    expect(sunrise.rows.map((r) => [r.reference, r.type, r.amountPaise])).toEqual([["INV-004/25-26", "INVOICE", RS(5_000)]]);
    expect(sunrise.closingBalancePaise).toBe(RS(5_000));
  });

  it("HDFC register runs 50,000 > 62,000 > 85,600 > 67,600 > 66,420 > 72,320 > 71,966; Cash register closes 8,550", async () => {
    const hdfc = await call<Register>("GET", `/bank-accounts/${w.HDFC}/register?companyId=${w.companyId}`);
    expect(hdfc.rows.map((r) => r.runningBalancePaise)).toEqual([50_000, 62_000, 85_600, 67_600, 66_420, 72_320, 71_966].map(RS));
    expect(hdfc.closingBalancePaise).toBe(RS(71_966));
    const cash = await call<Register>("GET", `/bank-accounts/CASH/register?companyId=${w.companyId}`);
    expect(cash.closingBalancePaise).toBe(RS(8_550));
    const tb = tbMap(await getTb());
    expect(hdfc.closingBalancePaise).toBe(tb[w.HDFC]);
    expect(cash.closingBalancePaise).toBe(tb["CASH"]);
  });

  it("Reconciliation to 31 Oct (section 5 step 3): 4 lines arrive ticked, opening ticked by hand, difference 0, 2 cheques uncleared, 84,066 - 18,000 + 5,900 = 71,966", async () => {
    expect(facts.rec?.tickedByStatement).toEqual([
      ["2025-10-03", RS(12_000)], ["2025-10-08", RS(23_600)], ["2025-10-20", -RS(1_180)], ["2025-10-31", -RS(354)],
    ]);
    expect(facts.rec?.differenceBefore, "only the opening 50,000 is left to tick").toBe(RS(50_000));
    expect(facts.rec?.differenceAfter).toBe(0);
    expect(facts.rec?.status).toBe("FINISHED");
    expect(facts.rec?.uncleared).toEqual([["2025-10-15", 0, RS(18_000)], ["2025-10-28", RS(5_900), 0]]);
    expect(facts.rec?.clearedAfter, "cleared balance equals the statement").toBe(RS(84_066));
    // Proof: cleared + uncleared in - uncleared out = the books (84,066 - 18,000 + 5,900 = 71,966).
    const uncleared = (facts.rec?.uncleared ?? []).reduce((t, [, inn, out]) => t + inn - out, 0);
    const hdfc = await call<Register>("GET", `/bank-accounts/${w.HDFC}/register?companyId=${w.companyId}`);
    expect((facts.rec?.clearedAfter ?? 0) + uncleared).toBe(RS(71_966));
    expect((facts.rec?.clearedAfter ?? 0) + uncleared).toBe(hdfc.closingBalancePaise);
  });

  // =============================================================================================
  // STEP 8: files and backup
  // =============================================================================================
  it("Step 8: PDF attached to PB-001 is listed; Trial Balance CSV rows equal section 3; backup restores an identical Trial Balance", async () => {
    // Attach a PDF to PB-001 and list it.
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "utf8");
    const stored = await call<{ id: string }>("POST", "/attachments", { entityType: "PURCHASE_BILL", entityId: w.pb001, fileName: "PB-001.pdf", mimeType: "application/pdf", contentBase64: pdf.toString("base64") }, 201);
    const listed = await call<Array<{ id: string; originalFilename: string }>>("GET", `/attachments?entityType=PURCHASE_BILL&entityId=${w.pb001}`);
    facts.attachmentListed = listed.map((a) => a.originalFilename);
    expect(listed.map((a) => a.id)).toEqual([stored.id]);
    expect(facts.attachmentListed).toEqual(["PB-001.pdf"]);

    // Trial Balance as CSV: every row matches section 3 in rupees.
    const csv = await app.inject({ method: "GET", url: `/exports/trial-balance?format=csv&companyId=${w.companyId}&businessId=${w.businessId}` });
    expect(csv.statusCode, csv.body).toBe(200);
    const lines = csv.body.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
    expect(lines[0]).toBe("Account,Debit,Credit");
    const toPaise = (s: string): number => Math.round(Number(s.replace(/,/g, "").replace(/"/g, "") || "0") * 100);
    const csvNet: Record<string, number> = {};
    for (const line of lines.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")) ?? [];
      const [account, debit, credit] = cells as [string, string, string];
      if (account === "" || /^total/i.test(account)) continue;
      const net = toPaise(debit) - toPaise(credit);
      if (net !== 0) csvNet[account] = net;
    }
    expect(csvNet).toEqual(expectedTrialBalance());

    // Back up the database, restore it into a fresh file, reopen it: identical Trial Balance.
    const live = await getTb();
    const backup = await call<{ id: string; status: string }>("POST", "/backups", { scope: "DATABASE_ONLY", label: "October close" }, 201);
    expect(backup.status).toBe("OK");
    const target = path.join(tmp, "restored", "book-buddha.db");
    const result = await restoreBackup({ folder: resolveBackupFolder(backupsRoot, backup.id), targetDbPath: target });
    expect(result.verification.every((c) => c.ok)).toBe(true);
    const restored = new AccountingRepository(target);
    try {
      expect(restored.getTrialBalance({ businessId: w.businessId, asAtDate: "2025-10-31" })).toEqual(live);
      expect(tbMap([...restored.getTrialBalance({ businessId: w.businessId })])).toEqual(expectedTrialBalance());
    } finally {
      restored.close();
    }
  }, TIMEOUT);

  // =============================================================================================
  // STEP 9 (LAST): lock the year and verify the audit chain
  // =============================================================================================
  it("Step 9: lock FY 2025-26; a cash expense dated 31 Oct is refused; Trial Balance unchanged; audit chain verifies", async () => {
    const before = await getTb();
    await call("POST", `/financial-years/${w.FY}/lock`, { locked: true });
    const draft = await app.inject({
      method: "POST", url: "/expenses",
      payload: { id: "exp-locked", businessId: w.businessId, number: "EXP-LOCKED", expenseDate: "2025-10-31", description: "Late cash expense", amountPaise: RS(500), paymentAccount: "CASH", moneyAccount: "CASH" },
    });
    let refusal = draft;
    if (draft.statusCode === 201) {
      refusal = await app.inject({ method: "POST", url: "/expenses/exp-locked/finalize", payload: {} });
    }
    expect(refusal.statusCode, refusal.body).toBe(400);
    expect(refusal.body).toMatch(/lock/i);
    expect(await getTb(), "Trial Balance unchanged").toEqual(before);
    expect(tbMap(await getTb())).toEqual(expectedTrialBalance());
    expect(verifyAuditChain(repository.db).ok).toBe(true);
  }, TIMEOUT);
});
