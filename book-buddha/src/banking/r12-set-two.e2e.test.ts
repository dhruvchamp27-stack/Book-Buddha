import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";

/**
 * ACCEPTANCE R12 set two, END TO END (orchestrator, S15). The same HDFC October as set one, but the
 * bank's own statement now drives the books: statement import (12e) -> "For review" queue (12f) with
 * bank-rule pre-fill (12g) -> reconciliation (12d) that arrives pre-ticked. Only the real HTTP routes
 * of buildApi; migrations v23-v29 by the normal chain.
 *
 * Books typed by hand BEFORE the statement: opening 50,000 (1 Oct) · fair cash banked, an Internal
 * Transfer CASH -> HDFC 12,000 (3 Oct) · supplier cheque -18,000 (15 Oct, not presented) · customer
 * cheque deposited +5,900 (28 Oct, clears in Nov) · invoice INV-001 Rs 23,600 OPEN.
 * Statement 31 Oct: +12,000 deposit · +23,600 NEFT · -1,180 UPI printing · -354 charges = 84,066.
 * Through the queue: deposit = MATCH to the transfer already in the books (nothing posted) ·
 * NEFT = MATCH to INV-001 (posts the payment) · UPI = ADD 1,000 + 90 CGST + 90 SGST (rule pre-fills) ·
 * charges = ADD 300 + 27 + 27 (rule pre-fills). Books end at 71,966 = 84,066 - 18,000 + 5,900,
 * exactly set one's figure, and the reconciliation needs only the opening line ticked by hand.
 *
 * Money is whole PAISE; the rupee figure is in the comment.
 */

const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let app: FastifyInstance;

beforeEach(async () => {
  repository = new AccountingRepository();
  app = buildApi(repository, { __unsafeDisableAuthForTests: true });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  repository.close();
});

async function call<T>(method: "GET" | "POST" | "PATCH", url: string, payload?: object, status = 200): Promise<T> {
  const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res.json<T>();
}
const count = (table: string): number => (repository.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

interface StatementLine { id: string; txnDate: string; amountPaise: number; status: string; businessId: string | null }
interface QueueEntry { line: StatementLine; links: Array<{ journalLineId: number; linkKind: string; documentId: string | null; postedByFeed: boolean }>; suggestion: { ruleName: string; accountCode: string } | null }
interface Detail { header: { id: string; status: string }; candidates: Array<{ journalLineId: number; entryDate: string; inPaise: number; outPaise: number; ticked: boolean }>; clearedBalancePaise: number; differencePaise: number }

const STATEMENT = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "03/10/25,CASH DEPOSIT-FAIR,,03/10/25,,\"12,000.00\",\"62,000.00\"",
  "08/10/25,NEFT CR-ASHA SCHOOL,UTR8OCT,08/10/25,,\"23,600.00\",\"85,600.00\"",
  "20/10/25,UPI-PRINTING HOUSE,UPI-20OCT,20/10/25,\"1,180.00\",,\"84,420.00\"",
  "31/10/25,CHGS INCL GST,,31/10/25,354.00,,\"84,066.00\"",
].join("\r\n");

describe("ACCEPTANCE R12 set two: HDFC October from the bank's own statement, end to end over HTTP", () => {
  it("import 4 lines -> queue (2 matches, 2 rule-pre-filled adds) -> books 71,966 -> reconcile 84,066 with only the opening ticked by hand", async () => {
    // ---- Set-up (same world as set one).
    const { id: companyId } = await call<{ id: string }>("POST", "/companies", { name: "Fair Books", accountingBasis: "ACCRUAL" }, 201);
    const { id: businessId } = await call<{ id: string }>("POST", "/businesses", { companyId, name: "Book Fair" }, 201);
    const { id: customerId } = await call<{ id: string }>("POST", "/customers", { companyId, name: "Asha School" }, 201);
    const { id: supplierId } = await call<{ id: string }>("POST", "/suppliers", { companyId, name: "Paper Co" }, 201);
    await call("POST", "/accounts", { companyId, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" }, 201);
    await call("POST", "/accounts", { companyId, code: "PRINTING", name: "Printing", type: "EXPENSE" }, 201);
    const HDFC = (await call<{ bankAccount: { code: string } }>("POST", "/bank-accounts", { companyId, name: "HDFC Current", kind: "CURRENT" }, 201)).bankAccount.code;

    // ---- Books typed by hand before the statement arrives.
    await call("POST", "/opening-balances", {
      businessId, asAt: "2025-10-01",
      lines: [{ account: HDFC, debitPaise: RS(50_000), creditPaise: 0 }, { account: "CASH", debitPaise: RS(20_000), creditPaise: 0 }],
    }, 201);
    await call("POST", "/internal-transfers", { businessId, date: "2025-10-03", fromAccount: "CASH", toAccount: HDFC, amountPaise: RS(12_000), memo: "Fair cash banked" }, 201);
    await call("POST", "/invoices", { id: "inv-a",businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-10-02", taxType: "NONE", taxRateBasisPoints: 0, lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(23_600) }] }, 201);
    await call("POST", "/invoices/inv-a/finalize", {});
    const bill = await call<{ id: string }>("POST", "/purchase-bills", { businessId, supplierId, number: "PB-001", billDate: "2025-10-10", paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: RS(18_000) }] }, 201);
    await call("POST", `/purchase-bills/${bill.id}/finalize`, {});
    await call("POST", "/supplier-payments", { billId: bill.id, amountPaise: RS(18_000), paidOn: "2025-10-15", moneyAccount: HDFC, paymentMode: "CHEQUE", paymentReference: "CHQ 000451" }, 201);
    await call("POST", "/invoices", { id: "inv-b",businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2025-10-25", taxType: "NONE", taxRateBasisPoints: 0, lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(5_900) }] }, 201);
    await call("POST", "/invoices/inv-b/finalize", {});
    await call("POST", "/invoices/inv-b/payments", { amountPaise: RS(5_900), paidOn: "2025-10-28", moneyAccount: HDFC, paymentMode: "CHEQUE" }, 201);

    // ---- 12g: two bank rules (pre-fill only).
    await call("POST", "/bank-rules", { companyId, name: "Bank charges", action: "ADD", targetAccount: "BANK_CHARGES", direction: "OUT", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "chgs" }] }, 201);
    await call("POST", "/bank-rules", { companyId, name: "Printing", action: "ADD", targetAccount: "PRINTING", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "printing" }] }, 201);
    const rulesRefused = await app.inject({ method: "POST", url: "/bank-rules", payload: { companyId, name: "Park it", action: "ADD", targetAccount: "UNCATEGORIZED", conditions: [{ field: "DESCRIPTION", operator: "CONTAINS", valueText: "x" }] } });
    expect(rulesRefused.statusCode).toBe(400);

    // ---- 12e: inspect, preview (writes nothing), commit, re-import (nothing new).
    const file = { fileName: "hdfc-oct.csv", contentBase64: Buffer.from(STATEMENT, "utf8").toString("base64") };
    const inspected = await call<{ suggestedMap: Record<string, string> }>("POST", "/bank-statements/inspect", file);
    expect(inspected.suggestedMap).toMatchObject({ date: "Date", description: "Narration", reference: "Chq./Ref.No.", withdrawal: "Withdrawal Amt.", deposit: "Deposit Amt.", balance: "Closing Balance" });
    const run = { ...file, companyId, accountCode: HDFC, businessId, columnMap: inspected.suggestedMap, dateFormat: "DD/MM/YYYY" };
    const journalBefore = count("journal_lines");
    const preview = await call<{ added: number; totalInPaise: number; totalOutPaise: number; balanceBreaks: number[] }>("POST", "/bank-statements/preview", run);
    expect(preview).toMatchObject({ added: 4, totalInPaise: RS(35_600), totalOutPaise: RS(1_534), balanceBreaks: [] });
    expect(count("bank_statement_lines")).toBe(0);
    expect((await call<{ added: number }>("POST", "/bank-statements/commit", run)).added).toBe(4);
    expect(await call<{ added: number; duplicates: number }>("POST", "/bank-statements/commit", run)).toMatchObject({ added: 0, duplicates: 4 });
    expect(count("journal_lines")).toBe(journalBefore); // a statement is NOT in the books

    // ---- 12f + 12g: the queue, oldest first, with the rules' suggestions.
    const queue = (await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${companyId}&accountCode=${HDFC}`)).lines;
    expect(queue.map((q) => [q.line.txnDate, q.line.amountPaise, q.suggestion?.accountCode ?? null])).toEqual([
      ["2025-10-03", RS(12_000), null],
      ["2025-10-08", RS(23_600), null],
      ["2025-10-20", -RS(1_180), "PRINTING"],
      ["2025-10-31", -RS(354), "BANK_CHARGES"],
    ]);
    const [deposit, neft, upi, charges] = queue.map((q) => q.line.id) as [string, string, string, string];

    // Deposit: already in the books as the Internal Transfer -> link only, nothing posted.
    const depositMatches = await call<{ postedLines: Array<{ journalLineId: number; sourceType: string }> }>("GET", `/bank-feed/lines/${deposit}/matches`);
    expect(depositMatches.postedLines.map((p) => p.sourceType)).toEqual(["INTERNAL_TRANSFER"]);
    const journalBeforeLink = count("journal_lines");
    const linked = await call<{ line: StatementLine }>("POST", `/bank-feed/lines/${deposit}/match`, { journalLineIds: [depositMatches.postedLines[0]!.journalLineId] });
    expect(linked.line.status).toBe("TRANSFERRED");
    expect(count("journal_lines")).toBe(journalBeforeLink);
    // ...and that transfer line cannot be claimed twice (a second bank line would double-count it).
    const twice = await app.inject({ method: "POST", url: `/bank-feed/lines/${neft}/match`, payload: { journalLineIds: [depositMatches.postedLines[0]!.journalLineId] } });
    expect(twice.statusCode).toBe(400);
    expect(twice.body).toContain("already matched to another bank line");

    // NEFT: matched to the open invoice. Asked first (confirm false writes nothing), then posted.
    const neftMatches = await call<{ documents: Array<{ id: string; number: string; outstandingPaise: number }> }>("GET", `/bank-feed/lines/${neft}/matches`);
    expect(neftMatches.documents[0]).toMatchObject({ id: "inv-a",outstandingPaise: RS(23_600) });
    const counts = (): number[] => ["journal_lines", "payments", "bank_statement_line_links", "audit_events"].map(count);
    const beforeAsk = counts();
    const asked = await call<{ confirmed: boolean; willPost: Array<{ lines: Array<{ account: string; debitPaise: number; creditPaise: number }> }> }>(
      "POST", `/bank-feed/lines/${neft}/match`, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(23_600) }], paymentMode: "NEFT", confirm: false },
    );
    expect(asked.confirmed).toBe(false);
    expect(asked.willPost[0]!.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ account: HDFC, debitPaise: RS(23_600) }),
      expect.objectContaining({ account: "RECEIVABLES", creditPaise: RS(23_600) }),
    ]));
    expect(counts()).toEqual(beforeAsk);
    const neftDone = await call<{ line: StatementLine; links: QueueEntry["links"] }>(
      "POST", `/bank-feed/lines/${neft}/match`, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(23_600) }], paymentMode: "NEFT", confirm: true },
    );
    expect(neftDone.line.status).toBe("MATCHED");
    expect(repository.getReceivables({ businessId }).reduce((s, r) => s + r.outstandingPaise, 0)).toBe(0);
    const paymentId = neftDone.links[0]!.documentId!;
    // A payment that came from a bank line cannot be cancelled from the payment screen.
    const cancelRefused = await app.inject({ method: "POST", url: `/payments/${paymentId}/cancel`, payload: { reason: "test" } });
    expect(cancelRefused.statusCode).toBe(400);
    expect(cancelRefused.body).toContain("bank review queue");

    // UPI printing and the charges: the rules pre-filled the accounts; the user splits out the GST.
    const upiDone = await call<{ line: StatementLine }>("POST", `/bank-feed/lines/${upi}/add`, {
      splits: [{ accountCode: "PRINTING", amountPaise: RS(1_000) }, { accountCode: "INPUT_CGST", amountPaise: RS(90) }, { accountCode: "INPUT_SGST", amountPaise: RS(90) }],
      partyName: "Printing House", paymentMode: "UPI", confirm: true,
    });
    expect(upiDone.line.status).toBe("ADDED");
    await call("POST", `/bank-feed/lines/${charges}/add`, {
      splits: [{ accountCode: "BANK_CHARGES", amountPaise: RS(300) }, { accountCode: "INPUT_CGST", amountPaise: RS(27) }, { accountCode: "INPUT_SGST", amountPaise: RS(27) }],
      partyName: "HDFC Bank", confirm: true,
    });
    expect((await call<{ lines: QueueEntry[] }>("GET", `/bank-feed/lines?companyId=${companyId}&accountCode=${HDFC}`)).lines).toEqual([]);

    // Book balance 31 Oct = 50,000 + 12,000 + 23,600 - 18,000 - 1,180 + 5,900 - 354 = 71,966 (set one's figure).
    const register = await call<{ closingBalancePaise: number }>("GET", `/bank-accounts/${HDFC}/register?companyId=${companyId}`);
    expect(register.closingBalancePaise).toBe(RS(71_966));

    // ---- 12d: the reconciliation arrives with the four statement lines already ticked (C).
    let rec = await call<Detail>("POST", "/reconciliations", { companyId, accountCode: HDFC, statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) }, 201);
    expect(rec.candidates.filter((c) => c.ticked).map((c) => [c.entryDate, c.inPaise - c.outPaise])).toEqual([
      ["2025-10-03", RS(12_000)], ["2025-10-08", RS(23_600)], ["2025-10-20", -RS(1_180)], ["2025-10-31", -RS(354)],
    ]);
    expect(rec.clearedBalancePaise).toBe(RS(34_066));
    expect(rec.differencePaise).toBe(RS(50_000)); // only the opening line is left to tick by hand
    const openingLine = rec.candidates.find((c) => c.entryDate === "2025-10-01")!.journalLineId;
    rec = await call<Detail>("POST", `/reconciliations/${rec.header.id}/ticks`, { journalLineIds: [openingLine], ticked: true });
    expect(rec.differencePaise).toBe(0);
    expect((await call<Detail>("POST", `/reconciliations/${rec.header.id}/finish`, {})).header.status).toBe("FINISHED");
    const report = await call<{ unclearedLines: Array<{ entryDate: string; inPaise: number; outPaise: number }> }>("GET", `/reconciliations/${rec.header.id}/report`);
    expect(report.unclearedLines.map((l) => [l.entryDate, l.inPaise, l.outPaise])).toEqual([
      ["2025-10-15", 0, RS(18_000)],
      ["2025-10-28", RS(5_900), 0],
    ]);
    // A reconciled bank line can no longer be undone.
    const undoRefused = await app.inject({ method: "POST", url: `/bank-feed/lines/${charges}/undo`, payload: { reason: "oops", confirm: true } });
    expect(undoRefused.statusCode).toBe(400);
    expect(undoRefused.body).toMatch(/reconcil/i);

    // ---- The books hold: trial balance nets to 0; October P&L; cash basis = accrual; audit chain intact.
    const tb = repository.getTrialBalance({ businessId });
    expect(tb.reduce((s, r) => s + r.debitPaise - r.creditPaise, 0)).toBe(0);
    const october = { fromDate: "2025-10-01", toDate: "2025-10-31" };
    const accrual = repository.getProfitAndLoss({ ...october, basis: "ACCRUAL" });
    const cashBasis = repository.getProfitAndLoss({ ...october, basis: "CASH" });
    expect(accrual.totalIncomePaise).toBe(RS(29_500)); // 23,600 + 5,900
    expect(accrual.totalExpensesPaise).toBe(RS(19_300)); // paper bill 18,000 + printing 1,000 + bank charges 300 (GST is not an expense)
    expect(accrual.expenses.filter((r) => r.balancePaise !== 0).map((r) => [r.account, r.balancePaise]).sort()).toEqual([
      ["BANK_CHARGES", RS(300)], ["EXPENSE", RS(18_000)], ["PRINTING", RS(1_000)], // EXPENSE = the bill's default account
    ]);
    expect(cashBasis.totalIncomePaise).toBe(accrual.totalIncomePaise);
    expect(cashBasis.totalExpensesPaise).toBe(accrual.totalExpensesPaise);
    expect(verifyAuditChain(repository.db).ok).toBe(true);
  });
});
