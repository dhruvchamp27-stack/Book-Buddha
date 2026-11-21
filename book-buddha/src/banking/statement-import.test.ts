import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { createBankAccount, deactivateBankAccount } from "./bank-accounts.js";
import {
  commitStatement,
  inspectStatement,
  listStatementImports,
  parseStatementDate,
  previewStatement,
  type StatementImportInput,
} from "./statement-import.js";
import { listStatementLines } from "./statement-lines.js";

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

const bytes = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const auditCount = (): number => (db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'BANK_STATEMENT_IMPORTED'").get() as { n: number }).n;

const HDFC = [
  "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
  "03/10/25,CASH DEPOSIT,,03/10/25,,\"12,000.00\",\"62,000.00\"",
  "08/10/25,NEFT CR-RAMAN BOOKS,UTR123,08/10/25,,\"23,600.00\",\"85,600.00\"",
  "20/10/25,UPI-OFFICE SUPPLIES,,20/10/25,\"1,180.00\",,\"84,420.00\"",
  "31/10/25,CHGS INCL GST,,31/10/25,354.00,,\"84,066.00\"",
].join("\n");

const HDFC_MAP = {
  date: "Date", description: "Narration", reference: "Chq./Ref.No.", withdrawal: "Withdrawal Amt.", deposit: "Deposit Amt.", balance: "Closing Balance",
};

function input(text: string, columnMap: Record<string, string> = HDFC_MAP, extra: Partial<StatementImportInput> = {}): StatementImportInput {
  return { companyId, accountCode: "BANK", businessId, fileName: "stmt.csv", bytes: bytes(text), columnMap, dateFormat: "DD/MM/YYYY", ...extra };
}

describe("statement import (R12e)", () => {
  it("1. HDFC NetBanking CSV: suggested map, rolled-back preview, commit to FOR_REVIEW, books untouched", () => {
    const inspection = inspectStatement({ fileName: "stmt.csv", bytes: bytes(HDFC) });
    expect(inspection.rowCount).toBe(4);
    expect(inspection.suggestedMap).toEqual(HDFC_MAP);

    const journalBefore = count("journal_lines");
    const preview = previewStatement(db, input(HDFC));
    expect(preview).toMatchObject({ mode: "PREVIEW", added: 4, duplicates: 0, failed: 0, totalInPaise: 3_560_000, totalOutPaise: 153_400, order: "OLDEST_FIRST", balanceBreaks: [] });
    expect(count("bank_statement_lines")).toBe(0);
    expect(count("bank_statement_imports")).toBe(0);

    const result = commitStatement(db, input(HDFC));
    expect(result.added).toBe(4);
    const lines = listStatementLines(db, { companyId, accountCode: "BANK" });
    expect(lines.map((l) => l.amountPaise)).toEqual([1_200_000, 2_360_000, -118_000, -35_400]);
    expect(lines.map((l) => l.txnDate)).toEqual(["2025-10-03", "2025-10-08", "2025-10-20", "2025-10-31"]);
    expect(lines.every((l) => l.status === "FOR_REVIEW" && l.businessId === businessId)).toBe(true);
    expect(lines[1]?.reference).toBe("UTR123");
    expect(count("journal_lines")).toBe(journalBefore);
    expect(listStatementImports(db, companyId, "BANK")).toHaveLength(1);
  });

  it("2. the same file again adds nothing: 4 duplicates", () => {
    commitStatement(db, input(HDFC));
    const again = commitStatement(db, input(HDFC));
    expect(again).toMatchObject({ added: 0, duplicates: 4 });
    expect(again.outcomes.every((o) => o.status === "DUPLICATE")).toBe(true);
    expect(count("bank_statement_lines")).toBe(4);
  });

  it("3. identical lines on one day are both kept; re-import is safe; a later file with three adds one", () => {
    const two = "Date,Narration,Amount\n05/10/25,SMS ALERT CHG,-59\n05/10/25,SMS ALERT CHG,-59";
    const map = { date: "Date", description: "Narration", amount: "Amount" };
    expect(commitStatement(db, input(two, map)).added).toBe(2);
    expect(commitStatement(db, input(two, map))).toMatchObject({ added: 0, duplicates: 2 });
    const three = `${two}\n05/10/25,SMS ALERT CHG,-59`;
    expect(commitStatement(db, input(three, map))).toMatchObject({ added: 1, duplicates: 2 });
    expect(count("bank_statement_lines")).toBe(3);
  });

  it("4. an EXCLUDED line is still a duplicate", () => {
    commitStatement(db, input(HDFC));
    db.prepare("UPDATE bank_statement_lines SET status = 'EXCLUDED'").run();
    expect(commitStatement(db, input(HDFC))).toMatchObject({ added: 0, duplicates: 4 });
  });

  it("5. signed, signed with Dr/Cr suffix, and Amount + Dr/Cr give the same amounts as test 1", () => {
    const want = [1_200_000, 2_360_000, -118_000, -35_400];
    const run = (text: string, map: Record<string, string>): number[] => {
      repository.close();
      repository = new AccountingRepository();
      db = repository.db;
      companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
      businessId = repository.createBusiness({ companyId, name: "B" });
      commitStatement(db, input(text, map));
      return listStatementLines(db, { companyId, accountCode: "BANK" }).map((l) => l.amountPaise);
    };
    const head = (extra: string): string => `Date,Narration,Amount${extra}\n`;
    const signed = `${head("")}03/10/25,CASH DEPOSIT,"12,000.00"\n08/10/25,NEFT,"23,600.00"\n20/10/25,UPI,"-1,180.00"\n31/10/25,CHGS,-354`;
    expect(run(signed, { date: "Date", description: "Narration", amount: "Amount" })).toEqual(want);
    const suffix = `${head("")}03/10/25,CASH DEPOSIT,"12,000.00 Cr"\n08/10/25,NEFT,"23,600.00 cr"\n20/10/25,UPI,"1,180.00 Dr"\n31/10/25,CHGS,354 DR`;
    expect(run(suffix, { date: "Date", description: "Narration", amount: "Amount" })).toEqual(want);
    const split = `${head(",Dr/Cr")}03/10/25,CASH DEPOSIT,"12,000.00",CR\n08/10/25,NEFT,"23,600.00",Credit\n20/10/25,UPI,"1,180.00",DR\n31/10/25,CHGS,354,Withdrawal`;
    expect(run(split, { date: "Date", description: "Narration", amount: "Amount", direction: "Dr/Cr" })).toEqual(want);
  });

  it("6. bad rows FAIL with a message; good rows are still added", () => {
    const text = [
      "Date,Narration,Withdrawal,Deposit",
      ",Opening Balance,,100.00",
      "01/10/25,BOTH FILLED,10.00,20.00",
      "02/10/25,NEITHER,,",
      "03/10/25,ZERO,0.00,",
      "31/02/25,BAD DATE,5.00,",
      "05/10/25,BAD AMOUNT,12,00x,",
      "06/10/25,GOOD OUT,50.00,",
      "07/10/25,GOOD IN,,75.50",
    ].join("\n").replace("12,00x,", '"12,00x",');
    const map = { date: "Date", description: "Narration", withdrawal: "Withdrawal", deposit: "Deposit" };
    const r = previewStatement(db, input(text, map));
    expect(r).toMatchObject({ rowsInFile: 8, added: 2, failed: 6, duplicates: 0 });
    expect(r.outcomes.filter((o) => o.status === "FAILED").map((o) => o.rowNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(r.outcomes.filter((o) => o.status === "FAILED").every((o) => (o.message ?? "").length > 0)).toBe(true);
    expect(r.totalInPaise).toBe(7_550);
    expect(r.totalOutPaise).toBe(5_000);
  });

  it("7. request-level refusals write nothing", () => {
    const refuse = (patch: Partial<StatementImportInput>, columnMap?: Record<string, string>): void => {
      expect(() => commitStatement(db, input(HDFC, columnMap ?? HDFC_MAP, patch))).toThrow(RepositoryValidationError);
    };
    refuse({}, { ...HDFC_MAP, date: "Nope" }); // unknown header
    refuse({}, { date: "Date", description: "Narration" }); // no amount layout
    refuse({}, { ...HDFC_MAP, amount: "Closing Balance" }); // mixed layouts
    refuse({}, { description: "Narration", withdrawal: "Withdrawal Amt.", deposit: "Deposit Amt." }); // date unmapped
    refuse({}, { date: "Date", withdrawal: "Withdrawal Amt.", deposit: "Deposit Amt." }); // description unmapped
    refuse({ accountCode: "CASH" }); // CASH has no statement
    refuse({ accountCode: "NO_SUCH" });
    const otherCompany = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
    const otherBank = createBankAccount(db, { companyId: otherCompany, name: "Other Bank", kind: "CURRENT" });
    refuse({ accountCode: otherBank }); // another company's bank
    const otherBiz = repository.createBusiness({ companyId: otherCompany, name: "Y Biz" });
    refuse({ businessId: otherBiz }); // business of another company
    const mine = createBankAccount(db, { companyId, name: "Old Bank", kind: "CURRENT" });
    deactivateBankAccount(db, companyId, mine);
    refuse({ accountCode: mine }); // inactive
    expect(count("bank_statement_lines")).toBe(0);
    expect(count("bank_statement_imports")).toBe(0);
    expect(auditCount()).toBe(0);
  });

  it("8. a missing line shows in balanceBreaks; a newest-first file is stored oldest first", () => {
    const gap = HDFC.split("\n").filter((l) => !l.startsWith("20/10/25")).join("\n"); // the 1,180 line is missing
    const r = previewStatement(db, input(gap));
    expect(r.order).toBe("OLDEST_FIRST");
    expect(r.balanceBreaks).toEqual([4]);

    const [head, ...rows] = HDFC.split("\n");
    const reversed = [head, ...rows.reverse()].join("\n");
    const rev = commitStatement(db, input(reversed));
    expect(rev.order).toBe("NEWEST_FIRST");
    expect(rev.balanceBreaks).toEqual([]);
    const lines = listStatementLines(db, { companyId, accountCode: "BANK" });
    expect(lines.map((l) => l.txnDate)).toEqual(["2025-10-03", "2025-10-08", "2025-10-20", "2025-10-31"]);
    expect(lines.map((l) => l.amountPaise)).toEqual([1_200_000, 2_360_000, -118_000, -35_400]);
  });

  it("9. the shared BANK: company Y's identical line does not make company X's a duplicate", () => {
    const y = repository.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
    const text = "Date,Narration,Amount\n05/10/25,SAME LINE,-100";
    const map = { date: "Date", description: "Narration", amount: "Amount" };
    expect(commitStatement(db, input(text, map, { companyId: y, businessId: undefined })).added).toBe(1);
    expect(commitStatement(db, input(text, map)).added).toBe(1);
    expect(commitStatement(db, input(text, map))).toMatchObject({ added: 0, duplicates: 1 });
  });

  it("10. BOM and semicolon files import; DD-MMM-YYYY and DD/MM/YY dates parse; a bad month fails the row", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Date;Narration;Amount\n05/10/25;SEMI;-10,50\n")]);
    // "-10,50" is not a valid amount (comma decimal); use a plain amount for the real import.
    const ok = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes("Date;Narration;Amount\n05/10/25;SEMI;-10.50\n")]);
    const map = { date: "Date", description: "Narration", amount: "Amount" };
    expect(commitStatement(db, { ...input("", map), bytes: ok }).added).toBe(1);
    expect(previewStatement(db, { ...input("", map), bytes: bom }).failed).toBe(1);
    expect(listStatementLines(db, { companyId, accountCode: "BANK" })[0]).toMatchObject({ txnDate: "2025-10-05", amountPaise: -1_050 });

    expect(parseStatementDate("05-Oct-2025", "DD/MM/YYYY")).toBe("2025-10-05");
    expect(parseStatementDate("05 Oct 2025", "DD/MM/YYYY")).toBe("2025-10-05");
    expect(parseStatementDate("05/10/25", "DD/MM/YYYY")).toBe("2025-10-05");
    expect(parseStatementDate("2025-10-05", "DD/MM/YYYY")).toBe("2025-10-05");
    expect(() => parseStatementDate("05-Abc-2025", "DD/MM/YYYY")).toThrow();
    const text = "Date,Narration,Amount\n05-Abc-2025,BAD MONTH,-5\n05-Oct-2025,GOOD,-5";
    const r = previewStatement(db, input(text, map));
    expect(r).toMatchObject({ added: 1, failed: 1 });
  });

  it("11. one audit event per commit, none for preview; the audit chain verifies", () => {
    previewStatement(db, input(HDFC));
    expect(auditCount()).toBe(0);
    commitStatement(db, input(HDFC));
    expect(auditCount()).toBe(1);
    commitStatement(db, input(HDFC));
    expect(auditCount()).toBe(2);
    expect(verifyAuditChain(db).ok).toBe(true);
  });
});
