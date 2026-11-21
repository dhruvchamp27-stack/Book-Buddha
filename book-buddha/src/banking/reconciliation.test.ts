import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../database/audit-log.js";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import {
  discardReconciliation,
  editStatement,
  finishReconciliation,
  finishedReconciliationsTouchingEntry,
  formatRupees,
  getReconciliation,
  getReconciliationReport,
  listReconciliations,
  reconciliationStatusOf,
  setTicked,
  startReconciliation,
  undoReconciliation,
} from "./reconciliation.js";
import { applyReconciliationSchema } from "./reconciliation-schema.js";
import { insertStatementLine } from "./statement-lines.js";

/**
 * R12d. Figures are PAISE in code; the rupee figure is in a comment. Balances are debit - credit.
 */
const RS = (rupees: number): number => rupees * 100;

let repository: AccountingRepository;
let db: Database.Database;
let companyId: string;
let businessId: string;
let seq = 0;

function addAccount(code: string, name: string, type: string, role: string | null, owner: string | null): void {
  db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)",
  ).run(code, owner, name, type, role, "2025-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z");
}

/** Dr account / Cr counter when amount > 0 (money in); the reverse when < 0 (money out). */
function post(account: string, date: string, amountPaise: number, opts: { biz?: string; counter?: string; reversal?: boolean; sourceId?: string; id?: string } = {}): number {
  seq += 1;
  const counter = opts.counter ?? "CAPITAL";
  const abs = Math.abs(amountPaise);
  const inbound = amountPaise > 0;
  const id = opts.id ?? `je-r-${seq}`;
  postJournalEntry(
    db,
    {
      id,
      sourceId: opts.sourceId ?? `src-${seq}`,
      sourceType: "MONEY_VOUCHER",
      description: `Entry ${seq}`,
      isReversal: opts.reversal ?? false,
      lines: [
        { account, debitPaise: inbound ? abs : 0, creditPaise: inbound ? 0 : abs },
        { account: counter, debitPaise: inbound ? 0 : abs, creditPaise: inbound ? abs : 0 },
      ],
    },
    { businessId: opts.biz ?? businessId, entryDate: date },
  );
  const row = db
    .prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = ?")
    .get(id, account) as { id: number };
  return row.id;
}

const balanceOf = (account: string): number => {
  const r = db.prepare("SELECT COALESCE(SUM(debit_paise - credit_paise), 0) AS b FROM journal_lines WHERE account = ?").get(account) as { b: number };
  return r.b;
};

/** The HDFC October world from the plan. Returns the line ids in posting order. */
function octoberWorld(): { opening: number; in12: number; in23: number; out18: number; out1180: number; in59: number } {
  return {
    opening: post("HDFC", "2025-10-01", RS(50_000)),
    in12: post("HDFC", "2025-10-03", RS(12_000)),
    in23: post("HDFC", "2025-10-08", RS(23_600)),
    out18: post("HDFC", "2025-10-15", -RS(18_000)),
    out1180: post("HDFC", "2025-10-20", -RS(1_180)),
    in59: post("HDFC", "2025-10-28", RS(5_900)),
  };
}

const message = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

beforeEach(() => {
  repository = new AccountingRepository();
  db = repository.db;
  applyReconciliationSchema(db);
  companyId = repository.createCompany({ name: "Co X", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Fair Co" });
  addAccount("HDFC", "HDFC Current", "ASSET", "BANK", companyId);
  addAccount("HDFC_OD", "HDFC Overdraft", "LIABILITY", "BANK", companyId);
  addAccount("BANK_CHARGES", "Bank Charges", "EXPENSE", null, companyId);
  seq = 0;
});
afterEach(() => repository.close());

describe("bank reconciliation", () => {
  it("1. ACCEPTANCE R12-RECON: October on HDFC reconciles to 84,066 only after the Rs 354 bank charge is posted and ticked", () => {
    const l = octoberWorld();
    expect(applyReconciliationSchema(db)).toBeUndefined(); // idempotent: a second call is harmless
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) });
    expect(rec.beginningBalancePaise).toBe(0);
    expect(getReconciliation(db, rec.id).candidates).toHaveLength(6);

    const partial = setTicked(db, rec.id, [l.opening, l.in12, l.in23, l.out1180], true);
    expect(partial.clearedBalancePaise).toBe(RS(84_420)); // 50,000 + 12,000 + 23,600 - 1,180
    expect(partial.differencePaise).toBe(-RS(354));
    const refused = message(() => finishReconciliation(db, rec.id));
    expect(refused).toContain("Rs 354");
    expect(getReconciliation(db, rec.id).header.status).toBe("IN_PROGRESS");

    const charge = post("HDFC", "2025-10-31", -RS(354), { counter: "BANK_CHARGES" }); // Rs 354 bank charge
    const withCharge = setTicked(db, rec.id, [charge], true);
    expect(withCharge.differencePaise).toBe(0);
    expect(finishReconciliation(db, rec.id).status).toBe("FINISHED");

    expect(balanceOf("HDFC")).toBe(RS(71_966)); // book balance
    const report = getReconciliationReport(db, rec.id);
    expect(report.beginningBalancePaise).toBe(0);
    expect(report.clearedInPaise).toBe(RS(85_600)); // 50,000 + 12,000 + 23,600
    expect(report.clearedOutPaise).toBe(RS(1_534)); // 1,180 + 354
    expect(report.endingBalancePaise).toBe(RS(84_066));
    expect(report.unclearedLines.map((x) => x.inPaise - x.outPaise)).toEqual([-RS(18_000), RS(5_900)]);
    expect(RS(84_066) - RS(18_000) + RS(5_900)).toBe(balanceOf("HDFC"));
    expect(report.changedAfterFinishing).toHaveLength(0);
  });

  it("2. November starts from 84,066, offers the two uncleared October lines and none of October's cleared ones", () => {
    const l = octoberWorld();
    const oct = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) });
    const charge = post("HDFC", "2025-10-31", -RS(354), { counter: "BANK_CHARGES" });
    setTicked(db, oct.id, [l.opening, l.in12, l.in23, l.out1180, charge], true);
    finishReconciliation(db, oct.id);

    const nov = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-11-30", statementEndingBalancePaise: RS(71_966) });
    expect(nov.beginningBalancePaise).toBe(RS(84_066));
    const ids = getReconciliation(db, nov.id).candidates.map((c) => c.journalLineId);
    expect(ids).toEqual([l.out18, l.in59]);
    const done = setTicked(db, nov.id, ids, true);
    expect(done.differencePaise).toBe(0); // 84,066 - 18,000 + 5,900 = 71,966
    expect(finishReconciliation(db, nov.id).status).toBe("FINISHED");
  });

  it("3. undo: latest only, reason required, history kept; October only after November is undone", () => {
    const l = octoberWorld();
    const oct = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) });
    const charge = post("HDFC", "2025-10-31", -RS(354), { counter: "BANK_CHARGES" });
    setTicked(db, oct.id, [l.opening, l.in12, l.in23, l.out1180, charge], true);
    finishReconciliation(db, oct.id);
    const nov = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-11-30", statementEndingBalancePaise: RS(71_966) });
    setTicked(db, nov.id, [l.out18, l.in59], true);
    finishReconciliation(db, nov.id);

    expect(() => undoReconciliation(db, nov.id, "  ")).toThrow(/reason/i);
    expect(() => undoReconciliation(db, oct.id, "wrong statement")).toThrow(/latest/i);
    expect(undoReconciliation(db, nov.id, "wrong statement").status).toBe("UNDONE");
    expect(getReconciliation(db, nov.id).header.undoReason).toBe("wrong statement");
    // November's lines are candidates again.
    expect(reconciliationStatusOf(db, [l.out18, l.in59]).size).toBe(0);
    expect(undoReconciliation(db, oct.id, "redo October").status).toBe("UNDONE");
    const history = listReconciliations(db, companyId, "HDFC");
    expect(history.map((h) => h.status)).toEqual(["UNDONE", "UNDONE"]);
    expect(history.map((h) => h.statementEndDate)).toEqual(["2025-11-30", "2025-10-31"]); // newest first
    expect(() => undoReconciliation(db, oct.id, "again")).toThrow(/finished/i);
  });

  it("4. one in progress per account; end date must move forward; later lines are not offered; non-candidates cannot be ticked", () => {
    const l = octoberWorld();
    const late = post("HDFC", "2025-11-02", RS(100));
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(84_066) });
    expect(() => startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-11-30", statementEndingBalancePaise: 0 })).toThrow(/in progress/);
    expect(getReconciliation(db, rec.id).candidates.map((c) => c.journalLineId)).not.toContain(late);
    expect(() => setTicked(db, rec.id, [late], true)).toThrow(/cannot be ticked/);
    expect(() => setTicked(db, rec.id, [999_999], true)).toThrow(/cannot be ticked/);
    expect(() => setTicked(db, rec.id, [], true)).toThrow(RepositoryValidationError);

    setTicked(db, rec.id, [l.opening, l.in12, l.in23, l.out18, l.out1180, l.in59], true);
    editStatement(db, rec.id, { statementEndingBalancePaise: RS(72_320) });
    expect(finishReconciliation(db, rec.id).status).toBe("FINISHED");
    expect(() => startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 })).toThrow(/must be after 2025-10-31/);
    expect(() => startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-09-30", statementEndingBalancePaise: 0 })).toThrow(/must be after/);
    // a line cleared in a finished reconciliation cannot be ticked in a new one
    const next = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-11-30", statementEndingBalancePaise: 0 });
    expect(() => setTicked(db, next.id, [l.opening], true)).toThrow(/cannot be ticked/);
    // a cash account and a non-money account cannot be reconciled
    expect(() => startReconciliation(db, { companyId, accountCode: "CASH", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 })).toThrow(/not a bank account/);
    expect(() => startReconciliation(db, { companyId, accountCode: "RECEIVABLES", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 })).toThrow(/not a cash or bank/);
    expect(() => startReconciliation(db, { companyId, accountCode: "HDFC_OD", statementEndDate: "2025-13-31", statementEndingBalancePaise: 0 })).toThrow(/YYYY-MM-DD/);
    expect(() => startReconciliation(db, { companyId, accountCode: "HDFC_OD", statementEndDate: "2025-10-31", statementEndingBalancePaise: 10.5 })).toThrow(/whole number/);
  });

  it("5. a cancelled payment pair (original + reversal) is offered in full and ticking both changes the cleared balance by 0", () => {
    const orig = post("HDFC", "2025-10-05", RS(10_000), { sourceId: "pay-1" });
    const rev = post("HDFC", "2025-10-06", -RS(10_000), { sourceId: "pay-1", reversal: true });
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 });
    const offered = getReconciliation(db, rec.id).candidates;
    expect(offered.map((c) => c.journalLineId)).toEqual([orig, rev]);
    expect(offered[1]?.isReversal).toBe(true);
    const both = setTicked(db, rec.id, [orig, rev], true);
    expect(both.clearedBalancePaise).toBe(0);
    expect(both.differencePaise).toBe(0);
  });

  it("6. the shared seeded BANK never offers another company's lines", () => {
    const companyY = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
    const businessY = repository.createBusiness({ companyId: companyY, name: "Y Biz" });
    const x = post("BANK", "2025-10-03", RS(1_000));
    const y = post("BANK", "2025-10-04", RS(7_777), { biz: businessY });
    const recX = startReconciliation(db, { companyId, accountCode: "BANK", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(1_000) });
    const recY = startReconciliation(db, { companyId: companyY, accountCode: "BANK", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(7_777) });
    expect(getReconciliation(db, recX.id).candidates.map((c) => c.journalLineId)).toEqual([x]);
    expect(getReconciliation(db, recY.id).candidates.map((c) => c.journalLineId)).toEqual([y]);
    expect(() => setTicked(db, recX.id, [y], true)).toThrow(/cannot be ticked/);
    setTicked(db, recX.id, [x], true);
    expect(finishReconciliation(db, recX.id).status).toBe("FINISHED");
    // company Y is unaffected by X finishing
    expect(getReconciliation(db, recY.id).candidates.map((c) => c.journalLineId)).toEqual([y]);
  });

  it("7. an overdraft in use is negative: statement -1,50,000 reconciles to 0", () => {
    const draw = post("HDFC_OD", "2025-10-10", -RS(150_000), { counter: "BANK_CHARGES" }); // Cr OD 1,50,000
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC_OD", statementEndDate: "2025-10-31", statementEndingBalancePaise: -RS(150_000) });
    expect(getReconciliation(db, rec.id).differencePaise).toBe(-RS(150_000));
    expect(message(() => finishReconciliation(db, rec.id))).toContain("-Rs 1,50,000");
    expect(setTicked(db, rec.id, [draw], true).differencePaise).toBe(0);
    expect(finishReconciliation(db, rec.id).status).toBe("FINISHED");
  });

  it("8. a line dated 25 Oct posted AFTER October is finished shows under 'changed after finishing'", () => {
    const l = octoberWorld();
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(72_320) });
    setTicked(db, rec.id, Object.values(l), true);
    finishReconciliation(db, rec.id);
    const back = post("HDFC", "2025-10-25", RS(500));
    const november = post("HDFC", "2025-11-05", RS(900));
    const report = getReconciliationReport(db, rec.id);
    expect(report.changedAfterFinishing.map((c) => c.journalLineId)).toEqual([back]);
    expect(report.changedAfterFinishing).not.toContainEqual(expect.objectContaining({ journalLineId: november }));
    expect(report.unclearedLines).toHaveLength(0);
    // the new line is still available to the next reconciliation
    const nov = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-11-30", statementEndingBalancePaise: RS(72_320 + 500 + 900) });
    expect(getReconciliation(db, nov.id).candidates.map((c) => c.journalLineId)).toEqual([back, november]);
    expect(finishedReconciliationsTouchingEntry(db, "je-r-1").map((r) => r.id)).toEqual([rec.id]);
  });

  it("9. ticks survive re-reading, discard works and is audited, and statuses read C then R then nothing", () => {
    const l = octoberWorld();
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(72_320) });
    setTicked(db, rec.id, [l.opening, l.in12], true);
    setTicked(db, rec.id, [l.in12], false);
    const reread = getReconciliation(db, rec.id);
    expect(reread.candidates.filter((c) => c.ticked).map((c) => c.journalLineId)).toEqual([l.opening]);
    expect(reconciliationStatusOf(db, [l.opening, l.in12])).toEqual(new Map([[l.opening, "C"]]));

    setTicked(db, rec.id, Object.values(l), true);
    finishReconciliation(db, rec.id);
    expect(reconciliationStatusOf(db, [l.opening, 12345])).toEqual(new Map([[l.opening, "R"]]));
    expect(() => setTicked(db, rec.id, [l.opening], false)).toThrow(/in progress/);
    undoReconciliation(db, rec.id, "test");
    expect(reconciliationStatusOf(db, [l.opening]).size).toBe(0);

    const scratch = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 });
    setTicked(db, scratch.id, [l.opening], true);
    discardReconciliation(db, scratch.id);
    expect(() => getReconciliation(db, scratch.id)).toThrow(/not found/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM bank_reconciliation_lines WHERE reconciliation_id = ?").get(scratch.id)).toEqual({ n: 0 });
    expect(() => discardReconciliation(db, rec.id)).toThrow(/in progress/);
  });

  it("10. start / finish / undo / discard are audited and the audit chain verifies; posted lines are untouched", () => {
    const l = octoberWorld();
    const linesBefore = db.prepare("SELECT * FROM journal_lines ORDER BY id").all();
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(72_320) });
    setTicked(db, rec.id, Object.values(l), true);
    finishReconciliation(db, rec.id);
    undoReconciliation(db, rec.id, "check");
    const again = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: 1 });
    editStatement(db, again.id, { statementEndingBalancePaise: 2 });
    discardReconciliation(db, again.id);
    const actions = (db.prepare("SELECT action FROM audit_events WHERE action LIKE 'RECONCILIATION_%' ORDER BY id").all() as Array<{ action: string }>).map((r) => r.action);
    expect(actions).toEqual([
      "RECONCILIATION_STARTED",
      "RECONCILIATION_FINISHED",
      "RECONCILIATION_UNDONE",
      "RECONCILIATION_STARTED",
      "RECONCILIATION_EDITED",
      "RECONCILIATION_DISCARDED",
    ]);
    const finished = db.prepare("SELECT after_values FROM audit_events WHERE action = 'RECONCILIATION_FINISHED'").get() as { after_values: string };
    expect(JSON.parse(finished.after_values)).toMatchObject({ endingBalancePaise: RS(72_320), clearedLines: 6 });
    expect(verifyAuditChain(db).ok).toBe(true);
    expect(db.prepare("SELECT * FROM journal_lines ORDER BY id").all()).toEqual(linesBefore);
  });

  it("12. a reconciled payment cancelled after finishing is reported, though its reversal is dated later", () => {
    const l = octoberWorld(); // the 23,600 line is posted with sourceId src-3
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(72_320) });
    setTicked(db, rec.id, Object.values(l), true);
    finishReconciliation(db, rec.id);
    const in23Entry = (db.prepare("SELECT journal_entry_id AS e FROM journal_lines WHERE id = ?").get(l.in23) as { e: string }).e;
    // A reversal carries the codebase's convention: `<original entry id>-reversal`.
    const reversal = post("HDFC", "2025-12-05", -RS(23_600), { sourceId: "src-3", reversal: true, id: `${in23Entry}-reversal` });
    const added = post("HDFC", "2025-10-25", RS(500));
    const changed = getReconciliationReport(db, rec.id).changedAfterFinishing;
    expect(changed.find((c) => c.journalLineId === reversal)).toMatchObject({ change: "CANCELLED", entryDate: "2025-12-05", isReversal: true });
    expect(changed.find((c) => c.journalLineId === added)).toMatchObject({ change: "ADDED" });
    expect(changed).toHaveLength(2);
  });

  it("12b. a SECOND, uncleared payment sharing the cleared one's source id is NOT reported as cancelled when it is cancelled", () => {
    // Every payment on one invoice carries the invoice's id as source_id; only the entry id tells them apart.
    const first = post("HDFC", "2025-10-08", RS(10_000), { sourceId: "inv-1", id: "je-payment-p1" });
    post("HDFC", "2025-11-03", RS(5_000), { sourceId: "inv-1", id: "je-payment-p2" }); // after the end date: never cleared here
    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(10_000) });
    setTicked(db, rec.id, [first], true);
    finishReconciliation(db, rec.id);
    post("HDFC", "2025-12-05", -RS(5_000), { sourceId: "inv-1", reversal: true, id: "je-payment-p2-reversal" });
    expect(getReconciliationReport(db, rec.id).changedAfterFinishing).toEqual([]);
    const firstCancel = post("HDFC", "2025-12-06", -RS(10_000), { sourceId: "inv-1", reversal: true, id: "je-payment-p1-reversal" });
    expect(getReconciliationReport(db, rec.id).changedAfterFinishing.map((c) => [c.journalLineId, c.change])).toEqual([[firstCancel, "CANCELLED"]]);
  });

  it("13. (R12 set two) a book line matched from a statement line dated on/before the end date arrives ticked; later or other-company links do not", () => {
    const companyY = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
    const businessY = repository.createBusiness({ companyId: companyY, name: "Y Biz" });
    const link = (lineId: string, journalLineId: number): void => {
      const je = (db.prepare("SELECT journal_entry_id AS e FROM journal_lines WHERE id = ?").get(journalLineId) as { e: string }).e;
      db.prepare(
        "INSERT INTO bank_statement_line_links (line_id, journal_line_id, journal_entry_id, link_kind, document_id, posted_by_feed, created_at) VALUES (?, ?, ?, 'EXISTING', NULL, 0, '2025-11-01T00:00:00Z')",
      ).run(lineId, journalLineId, je);
    };
    const matched = post("HDFC", "2025-10-08", RS(23_600));
    const bankedLater = post("HDFC", "2025-10-28", RS(5_900)); // the bank shows it on 2 Nov
    const unmatched = post("HDFC", "2025-10-20", -RS(1_180));
    const yLine = post("BANK", "2025-10-09", RS(700), { biz: businessY });
    link(insertStatementLine(db, { companyId, accountCode: "HDFC", txnDate: "2025-10-08", description: "NEFT", amountPaise: RS(23_600) }).id, matched);
    link(insertStatementLine(db, { companyId, accountCode: "HDFC", txnDate: "2025-11-02", description: "CHQ", amountPaise: RS(5_900) }).id, bankedLater);
    link(insertStatementLine(db, { companyId: companyY, accountCode: "BANK", txnDate: "2025-10-09", description: "Y", amountPaise: RS(700) }).id, yLine);

    const rec = startReconciliation(db, { companyId, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(23_600) });
    const detail = getReconciliation(db, rec.id);
    expect(detail.candidates.filter((c) => c.ticked).map((c) => c.journalLineId)).toEqual([matched]);
    expect(detail.candidates.map((c) => c.journalLineId)).toEqual([matched, unmatched, bankedLater]);
    expect(detail.differencePaise).toBe(0);
    expect(reconciliationStatusOf(db, [matched, bankedLater, unmatched]).get(matched)).toBe("C");
    // Company X's reconciliation of the shared BANK pre-ticks nothing of company Y's.
    const recX = startReconciliation(db, { companyId, accountCode: "BANK", statementEndDate: "2025-10-31", statementEndingBalancePaise: 0 });
    expect(getReconciliation(db, recX.id).candidates).toEqual([]);
    const recY = startReconciliation(db, { companyId: companyY, accountCode: "BANK", statementEndDate: "2025-10-31", statementEndingBalancePaise: RS(700) });
    expect(getReconciliation(db, recY.id).differencePaise).toBe(0);
  });

  it("formats rupees with Indian grouping", () => {
    expect(formatRupees(35_400)).toBe("Rs 354");
    expect(formatRupees(-15_000_000)).toBe("-Rs 1,50,000");
    expect(formatRupees(1_234_567_890)).toBe("Rs 1,23,45,678.90");
    expect(formatRupees(50)).toBe("Rs 0.50");
  });
});
