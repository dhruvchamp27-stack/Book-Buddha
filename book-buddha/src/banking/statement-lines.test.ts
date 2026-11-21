import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { fingerprintOf, getStatementLine, insertStatementLine, linksOfLine, listStatementLines } from "./statement-lines.js";

/** R12 set two shared contract: the statement-line tables (v28) and their helpers. */
let repository: AccountingRepository;
let db: Database.Database;
let companyId: string;
let businessId: string;

beforeEach(() => {
  repository = new AccountingRepository();
  db = repository.db;
  companyId = repository.createCompany({ name: "Co X", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Fair Co" });
});
afterEach(() => repository.close());

describe("statement-line contract (v28)", () => {
  it("inserts a FOR_REVIEW line, outside the books", () => {
    const before = (db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get() as { n: number }).n;
    const line = insertStatementLine(db, {
      companyId, accountCode: "BANK", txnDate: "2025-10-31", description: "  CHGS INCL GST ", amountPaise: -35_400, businessId,
    });
    expect(line.status).toBe("FOR_REVIEW");
    expect(line.description).toBe("CHGS INCL GST");
    expect(line.amountPaise).toBe(-35_400);
    expect(getStatementLine(db, line.id)).toEqual(line);
    expect((db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get() as { n: number }).n).toBe(before);
  });

  it("refuses a zero amount, a bad date and a blank description", () => {
    const base = { companyId, accountCode: "BANK", txnDate: "2025-10-31", description: "X", amountPaise: 100 };
    expect(() => insertStatementLine(db, { ...base, amountPaise: 0 })).toThrow(RepositoryValidationError);
    expect(() => insertStatementLine(db, { ...base, amountPaise: 10.5 })).toThrow(RepositoryValidationError);
    expect(() => insertStatementLine(db, { ...base, txnDate: "31/10/2025" })).toThrow(RepositoryValidationError);
    expect(() => insertStatementLine(db, { ...base, description: "  " })).toThrow(RepositoryValidationError);
  });

  it("fingerprint ignores case and spacing, not the amount or date; identical lines may both be held", () => {
    const a = fingerprintOf({ accountCode: "BANK", txnDate: "2025-10-05", amountPaise: -5_900, description: "SMS  Alert chg" });
    expect(fingerprintOf({ accountCode: "BANK", txnDate: "2025-10-05", amountPaise: -5_900, description: "sms alert CHG" })).toBe(a);
    expect(fingerprintOf({ accountCode: "BANK", txnDate: "2025-10-05", amountPaise: 5_900, description: "SMS Alert chg" })).not.toBe(a);
    expect(fingerprintOf({ accountCode: "BANK", txnDate: "2025-10-06", amountPaise: -5_900, description: "SMS Alert chg" })).not.toBe(a);
    const base = { companyId, accountCode: "BANK", txnDate: "2025-10-05", description: "SMS Alert chg", amountPaise: -5_900 };
    insertStatementLine(db, base);
    insertStatementLine(db, base);
    expect(listStatementLines(db, { companyId, accountCode: "BANK" })).toHaveLength(2);
  });

  it("lists by company and account, oldest first, with status and date filters", () => {
    const companyY = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
    insertStatementLine(db, { companyId, accountCode: "BANK", txnDate: "2025-10-20", description: "B", amountPaise: -100 });
    insertStatementLine(db, { companyId, accountCode: "BANK", txnDate: "2025-10-03", description: "A", amountPaise: 100 });
    insertStatementLine(db, { companyId: companyY, accountCode: "BANK", txnDate: "2025-10-04", description: "Y", amountPaise: 100 });
    expect(listStatementLines(db, { companyId, accountCode: "BANK" }).map((l) => l.description)).toEqual(["A", "B"]);
    expect(listStatementLines(db, { companyId, accountCode: "BANK", fromDate: "2025-10-10" }).map((l) => l.description)).toEqual(["B"]);
    expect(listStatementLines(db, { companyId, accountCode: "BANK", status: "EXCLUDED" })).toEqual([]);
  });

  it("one journal line can be linked to at most one statement line", () => {
    postJournalEntry(
      db,
      {
        id: "je-c-1", sourceId: "s-1", sourceType: "MONEY_VOUCHER", description: "x", isReversal: false,
        lines: [{ account: "BANK", debitPaise: 100, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 100 }],
      },
      { businessId, entryDate: "2025-10-03" },
    );
    const jl = (db.prepare("SELECT id FROM journal_lines WHERE journal_entry_id = 'je-c-1' AND account = 'BANK'").get() as { id: number }).id;
    const l1 = insertStatementLine(db, { companyId, accountCode: "BANK", txnDate: "2025-10-03", description: "A", amountPaise: 100 });
    const l2 = insertStatementLine(db, { companyId, accountCode: "BANK", txnDate: "2025-10-03", description: "A", amountPaise: 100 });
    const link = db.prepare(
      "INSERT INTO bank_statement_line_links (line_id, journal_line_id, journal_entry_id, link_kind, document_id, posted_by_feed, created_at) VALUES (?, ?, 'je-c-1', 'EXISTING', NULL, 0, '2025-10-03T00:00:00Z')",
    );
    link.run(l1.id, jl);
    expect(() => link.run(l2.id, jl)).toThrow(/UNIQUE/);
    expect(linksOfLine(db, l1.id)).toEqual([
      { lineId: l1.id, journalLineId: jl, journalEntryId: "je-c-1", linkKind: "EXISTING", documentId: null, postedByFeed: false, createdAt: "2025-10-03T00:00:00Z" },
    ]);
  });
});
