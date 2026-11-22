import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { postJournalEntry } from "../database/ledger.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { istDateOf } from "../database/ist-date.js";
import { applyMoneyMovementsSchema } from "./money-movements-schema.js";
import { cancelInternalTransfer, createInternalTransfer, listInternalTransfers } from "./internal-transfers.js";
import { todayAt } from "../database/test-clock.js";

/** Rupees to paise. */
const rs = (n: number): number => Math.round(n * 100);

interface World {
  r: AccountingRepository;
  companyX: string;
  companyY: string;
  bizX: string;
  bizY: string;
}

function addBank(r: AccountingRepository, code: string, companyId: string, type: "ASSET" | "LIABILITY", active = 1): void {
  const now = new Date().toISOString();
  r.db
    .prepare(
      "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, 'BANK', NULL, ?, ?, ?)",
    )
    .run(code, companyId, code, type, active, now, now);
}

function world(): World {
  const r = new AccountingRepository(":memory:", todayAt("2025-04-01"));
  applyMoneyMovementsSchema(r.db);
  const companyX = r.createCompany({ name: "X Co", accountingBasis: "ACCRUAL" });
  const companyY = r.createCompany({ name: "Y Co", accountingBasis: "ACCRUAL" });
  const bizX = r.createBusiness({ companyId: companyX, name: "X Biz" });
  const bizY = r.createBusiness({ companyId: companyY, name: "Y Biz" });
  addBank(r, "HDFC", companyX, "ASSET");
  addBank(r, "SBI_CC", companyX, "LIABILITY");
  addBank(r, "YBANK", companyY, "ASSET");
  addBank(r, "OLDBANK", companyX, "ASSET", 0);
  return { r, companyX, companyY, bizX, bizY };
}

/** Seeds an opening balance through the one posting door: Dr `debit` / Cr `credit`. */
function seed(w: World, id: string, debit: string, credit: string, paise: number, date = "2025-04-01"): void {
  postJournalEntry(
    w.r.db,
    {
      id, sourceId: id, sourceType: "OPENING_BALANCE", description: id, isReversal: false,
      lines: [
        { account: debit, debitPaise: paise, creditPaise: 0 },
        { account: credit, debitPaise: 0, creditPaise: paise },
      ],
    },
    { businessId: w.bizX, entryDate: date },
  );
}

function balance(r: AccountingRepository, account: string): number {
  const row = r.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS b FROM journal_lines WHERE account = ?")
    .get(account) as { b: number };
  return row.b;
}

function trialBalanceBalances(r: AccountingRepository): boolean {
  const tb = r.getTrialBalance();
  return tb.reduce((s, row) => s + row.debitPaise, 0) === tb.reduce((s, row) => s + row.creditPaise, 0);
}

let w: World;
beforeEach(() => { w = world(); });
afterEach(() => { vi.useRealTimers(); w.r.close(); });

describe("internal transfers (R12c)", () => {
  it("fair cash banked: CASH to HDFC Rs 12,000 moves the two balances and no profit figure", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const accrualBefore = w.r.getProfitAndLoss({ basis: "ACCRUAL" });
    const cashBefore = w.r.getProfitAndLoss({ basis: "CASH" });

    const t = createInternalTransfer(w.r.db, {
      businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(12_000),
      paymentMode: "CASH", memo: "Fair takings banked",
    });

    expect(balance(w.r, "CASH")).toBe(rs(50_000 - 12_000));
    expect(balance(w.r, "HDFC")).toBe(rs(12_000));
    expect(w.r.getProfitAndLoss({ basis: "ACCRUAL" })).toEqual(accrualBefore);
    expect(w.r.getProfitAndLoss({ basis: "CASH" })).toEqual(cashBefore);
    expect(trialBalanceBalances(w.r)).toBe(true);
    expect(t).toMatchObject({ number: "TRF-001/25-26", status: "POSTED", fromAccount: "CASH", toAccount: "HDFC", paymentMode: "CASH" });
    const entry = w.r.db.prepare("SELECT source_type, entry_date, business_id FROM journal_entries WHERE id = ?").get(t.journalEntryId);
    expect(entry).toEqual({ source_type: "INTERNAL_TRANSFER", entry_date: "2025-10-10", business_id: w.bizX });
  });

  it("paying down cash credit: HDFC to SBI CC Rs 50,000 leaves Rs 1,50,000 owed and the Balance Sheet balanced", () => {
    seed(w, "seed-hdfc", "HDFC", "CAPITAL", rs(100_000));
    seed(w, "seed-cc", "EXPENSE", "SBI_CC", rs(200_000)); // Rs 2,00,000 owed on the cash credit
    expect(balance(w.r, "SBI_CC")).toBe(-rs(200_000));

    createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-10-10", fromAccount: "HDFC", toAccount: "SBI_CC", amountPaise: rs(50_000), paymentMode: "NEFT" });

    expect(balance(w.r, "SBI_CC")).toBe(-rs(150_000)); // 1,50,000 still owed
    expect(balance(w.r, "HDFC")).toBe(rs(50_000)); // 1,00,000 - 50,000
    const sheet = w.r.getBalanceSheet({ businessId: w.bizX });
    expect(sheet.liabilities.find((l) => l.account === "SBI_CC")?.balancePaise).toBe(rs(150_000));
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    expect(trialBalanceBalances(w.r)).toBe(true);
  });

  it("refuses: same account, a non-money account, another company's bank, an inactive bank, bad amounts, a locked year, an unknown business, an unknown mode", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const base = { businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(100) };
    const refused = (patch: Record<string, unknown>, message: RegExp): void =>
      expect(() => createInternalTransfer(w.r.db, { ...base, ...patch }), JSON.stringify(patch)).toThrow(message);

    refused({ toAccount: "CASH" }, /two different accounts/);
    refused({ toAccount: "RECEIVABLES" }, /not a cash or bank account/);
    refused({ fromAccount: "SALES" }, /not a cash or bank account/);
    refused({ toAccount: "YBANK" }, /not a cash or bank account/); // company Y's bank, used by company X
    refused({ toAccount: "OLDBANK" }, /no longer active/);
    refused({ amountPaise: 0 }, /above zero/);
    refused({ amountPaise: -500 }, /above zero/);
    refused({ amountPaise: 10.5 }, /whole number/);
    refused({ businessId: "no-such-business" }, /not found/);
    refused({ paymentMode: "CARRIER_PIGEON" }, /not known/);
    refused({ date: "2025-13-45" }, /real date/);

    const yearId = w.r.createFinancialYear({ businessId: w.bizX, startsOn: "2025-04-01", endsOn: "2026-03-31" });
    w.r.setFinancialYearLocked(yearId, true);
    refused({ date: "2025-10-10" }, /locked/);

    // Nothing was written by any refused attempt: no document, no journal entry.
    expect(listInternalTransfers(w.r.db, w.companyX)).toEqual([]);
    expect(w.r.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'INTERNAL_TRANSFER'").get()).toEqual({ n: 0 });
    // A refused attempt did not use up number 001.
    w.r.setFinancialYearLocked(yearId, false);
    expect(createInternalTransfer(w.r.db, base).number).toBe("TRF-001/25-26");
  });

  it("numbers per company per financial year: TRF-001/25-26, TRF-002/25-26, 1 April starts TRF-001/26-27, company Y has its own", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const make = (businessId: string, date: string, from: string, to: string): string =>
      createInternalTransfer(w.r.db, { businessId, date, fromAccount: from, toAccount: to, amountPaise: rs(10) }).number;

    expect(make(w.bizX, "2025-10-10", "CASH", "HDFC")).toBe("TRF-001/25-26");
    expect(make(w.bizX, "2026-03-31", "CASH", "HDFC")).toBe("TRF-002/25-26");
    expect(make(w.bizX, "2026-04-01", "CASH", "HDFC")).toBe("TRF-001/26-27");
    expect(make(w.bizX, "2025-04-01", "CASH", "HDFC")).toBe("TRF-003/25-26");
    expect(make(w.bizY, "2025-10-10", "CASH", "YBANK")).toBe("TRF-001/25-26");
    expect(listInternalTransfers(w.r.db, w.companyX).map((t) => t.number)).toEqual([
      "TRF-003/25-26", "TRF-001/25-26", "TRF-002/25-26", "TRF-001/26-27",
    ]);
    expect(listInternalTransfers(w.r.db, w.companyX, { fromDate: "2026-01-01", toDate: "2026-12-31" }).map((t) => t.number)).toEqual([
      "TRF-002/25-26", "TRF-001/26-27",
    ]);
    expect(listInternalTransfers(w.r.db, w.companyY)).toHaveLength(1);
  });

  it("numbers keep growing past 999 without wrapping", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const now = new Date().toISOString();
    w.r.db.prepare(
      `INSERT INTO internal_transfers (id, company_id, business_id, number, transfer_date, from_account, to_account, amount_paise, status, journal_entry_id, created_at)
       VALUES ('old', ?, ?, 'TRF-999/25-26', '2025-05-05', 'CASH', 'HDFC', 100, 'POSTED', 'je-old', ?)`,
    ).run(w.companyX, w.bizX, now);
    const t = createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(10) });
    expect(t.number).toBe("TRF-1000/25-26");
  });

  it("cancel: balances return, the reversal is dated today (IST), a reason is required, a second cancel is refused", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const t = createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(12_000) });
    // Lock the transfer's own year: the reversal is dated TODAY, in the open period, so cancelling still works.
    const yearId = w.r.createFinancialYear({ businessId: w.bizX, startsOn: "2025-04-01", endsOn: "2026-03-31" });
    w.r.setFinancialYearLocked(yearId, true);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-20T10:00:00+05:30"));

    expect(() => cancelInternalTransfer(w.r.db, t.id, "")).toThrow(/reason is required/);
    expect(() => cancelInternalTransfer(w.r.db, t.id, "   ")).toThrow(/reason is required/);
    expect(() => cancelInternalTransfer(w.r.db, "nope", "x")).toThrow(/not found/);
    expect(balance(w.r, "HDFC")).toBe(rs(12_000)); // still posted after the refusals

    const cancelled = cancelInternalTransfer(w.r.db, t.id, "Banked the wrong day");

    expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationReason: "Banked the wrong day", number: t.number });
    expect(cancelled.reversalEntryId).toBe(`${t.journalEntryId}-reversal`);
    expect(balance(w.r, "CASH")).toBe(rs(50_000));
    expect(balance(w.r, "HDFC")).toBe(0);
    const reversal = w.r.db.prepare("SELECT is_reversal, source_type, source_id, entry_date FROM journal_entries WHERE id = ?").get(cancelled.reversalEntryId);
    // Dated TODAY in IST, exactly as cancelPayment does (repository.ts:2913), not the transfer's own date.
    expect(istDateOf()).toBe("2026-05-20");
    expect(reversal).toEqual({ is_reversal: 1, source_type: "INTERNAL_TRANSFER", source_id: t.id, entry_date: "2026-05-20" });
    // The original entry is untouched.
    expect(w.r.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(t.journalEntryId)).toEqual({ entry_date: "2025-10-10" });
    expect(trialBalanceBalances(w.r)).toBe(true);

    expect(() => cancelInternalTransfer(w.r.db, t.id, "again")).toThrow(/already been cancelled/);
    // The number of a cancelled transfer is never reused (the year is reopened so a new one can be dated in it).
    w.r.setFinancialYearLocked(yearId, false);
    expect(createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-12-01", fromAccount: "CASH", toAccount: "HDFC", amountPaise: 1000, confirmBackdatedMonth: true }).number).toBe("TRF-002/25-26");
    // The audit trail holds the post, the cancel (with its reason), and still verifies.
    const actions = w.r.db.prepare("SELECT action, reason FROM audit_events WHERE entity_id = ? ORDER BY id").all(t.id);
    expect(actions).toEqual([
      { action: "INTERNAL_TRANSFER_POSTED", reason: null },
      { action: "INTERNAL_TRANSFER_CANCELLED", reason: "Banked the wrong day" },
    ]);
    expect(verifyAuditChain(w.r.db).ok).toBe(true);
  });

  it("cancelling is refused when TODAY falls in a locked financial year", () => {
    seed(w, "seed-cash", "CASH", "CAPITAL", rs(50_000));
    const t = createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(100) });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-11-20T10:00:00+05:30"));
    const yearId = w.r.createFinancialYear({ businessId: w.bizX, startsOn: "2025-04-01", endsOn: "2026-03-31" });
    w.r.setFinancialYearLocked(yearId, true);
    expect(() => cancelInternalTransfer(w.r.db, t.id, "late")).toThrow(/locked/);
    expect(balance(w.r, "HDFC")).toBe(rs(100));
  });
});
