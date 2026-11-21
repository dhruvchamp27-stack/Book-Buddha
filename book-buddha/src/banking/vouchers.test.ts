import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { postJournalEntry } from "../database/ledger.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { applyMoneyMovementsSchema } from "./money-movements-schema.js";
import { cancelInternalTransfer, createInternalTransfer } from "./internal-transfers.js";
import { cancelVoucher, createVoucher, getVoucher, listVouchers } from "./vouchers.js";

const rs = (n: number): number => Math.round(n * 100);

interface World { r: AccountingRepository; companyX: string; companyY: string; bizX: string; bizY: string }

function world(): World {
  const r = new AccountingRepository();
  applyMoneyMovementsSchema(r.db);
  const companyX = r.createCompany({ name: "X Co", accountingBasis: "ACCRUAL" });
  const companyY = r.createCompany({ name: "Y Co", accountingBasis: "ACCRUAL" });
  const bizX = r.createBusiness({ companyId: companyX, name: "X Biz" });
  const bizY = r.createBusiness({ companyId: companyY, name: "Y Biz" });
  const now = new Date().toISOString();
  const insert = r.db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, 'ASSET', 'BANK', NULL, 1, ?, ?)",
  );
  insert.run("HDFC", companyX, "HDFC", now, now);
  insert.run("YBANK", companyY, "YBANK", now, now);
  r.createAccount({ companyId: companyX, code: "BANK_CHARGES", name: "Bank Charges", type: "EXPENSE" });
  r.createAccount({ companyId: companyY, code: "Y_ONLY", name: "Y only", type: "EXPENSE" });
  return { r, companyX, companyY, bizX, bizY };
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

function incomeOf(r: AccountingRepository, account: string): number {
  const found = r.getProfitAndLoss({ basis: "ACCRUAL" }).income.find((row) => row.account === account);
  return found === undefined ? 0 : Math.abs(found.balancePaise); // balancePaise is debit - credit, so income is negative
}

let w: World;
beforeEach(() => { w = world(); });
afterEach(() => { vi.useRealTimers(); w.r.close(); });

describe("receipt and payment vouchers (R12c)", () => {
  it("receipt voucher: Rs 412 interest into HDFC to OTHER_INCOME raises income and HDFC by Rs 412", () => {
    const v = createVoucher(w.r.db, {
      kind: "RECEIPT", businessId: w.bizX, date: "2025-10-20", moneyAccount: "HDFC",
      lines: [{ account: "OTHER_INCOME", amountPaise: rs(412), description: "Savings interest" }],
      paymentMode: "NEFT", paymentReference: "UTR-9", partyName: "HDFC Bank", narration: "Q2 interest",
    });
    expect(v).toMatchObject({
      number: "RV-001/25-26", kind: "RECEIPT", totalPaise: rs(412), status: "POSTED", paymentMode: "NEFT",
      paymentReference: "UTR-9", partyName: "HDFC Bank", narration: "Q2 interest",
    });
    expect(v.lines).toEqual([{ lineNo: 1, account: "OTHER_INCOME", amountPaise: rs(412), description: "Savings interest" }]);
    expect(balance(w.r, "HDFC")).toBe(rs(412));
    expect(incomeOf(w.r, "OTHER_INCOME")).toBe(rs(412));
    expect(w.r.getProfitAndLoss({ basis: "ACCRUAL" }).totalIncomePaise).toBe(rs(412));
    expect(trialBalanceBalances(w.r)).toBe(true);
    const entry = w.r.db.prepare("SELECT source_type, entry_date FROM journal_entries WHERE id = ?").get(v.journalEntryId);
    expect(entry).toEqual({ source_type: "MONEY_VOUCHER", entry_date: "2025-10-20" });
  });

  it("payment voucher split: bank charges Rs 300 plus input GST Rs 54 out of HDFC", () => {
    const v = createVoucher(w.r.db, {
      kind: "PAYMENT", businessId: w.bizX, date: "2025-10-21", moneyAccount: "HDFC",
      lines: [
        { account: "BANK_CHARGES", amountPaise: rs(300) },
        { account: "INPUT_CGST", amountPaise: rs(27) },
        { account: "INPUT_SGST", amountPaise: rs(27) },
      ],
    });
    expect(v.number).toBe("PV-001/25-26");
    expect(v.totalPaise).toBe(rs(354));
    expect(balance(w.r, "HDFC")).toBe(-rs(354));
    expect(balance(w.r, "BANK_CHARGES")).toBe(rs(300));
    expect(balance(w.r, "INPUT_CGST") + balance(w.r, "INPUT_SGST")).toBe(rs(54));
    expect(w.r.getProfitAndLoss({ basis: "ACCRUAL" }).totalExpensesPaise).toBe(rs(300)); // GST is an asset, not an expense
    expect(trialBalanceBalances(w.r)).toBe(true);
    // Receipts and payments have their own sequences, and so does each financial year.
    const second = createVoucher(w.r.db, { kind: "PAYMENT", businessId: w.bizX, date: "2026-04-01", moneyAccount: "CASH", lines: [{ account: "BANK_CHARGES", amountPaise: 100 }] });
    expect(second.number).toBe("PV-001/26-27");
    const receipt = createVoucher(w.r.db, { kind: "RECEIPT", businessId: w.bizX, date: "2025-10-22", moneyAccount: "CASH", lines: [{ account: "CAPITAL", amountPaise: 100 }] });
    expect(receipt.number).toBe("RV-001/25-26");
    expect(listVouchers(w.r.db, w.companyX, { kind: "PAYMENT" }).map((x) => x.number)).toEqual(["PV-001/25-26", "PV-001/26-27"]);
    expect(listVouchers(w.r.db, w.companyX, { fromDate: "2026-01-01" }).map((x) => x.number)).toEqual(["PV-001/26-27"]);
  });

  it("refuses a line to RECEIVABLES, CASH, BANK, INVENTORY, PAYABLES, SUPPLIER_CREDITS, a zero or float line, no lines, and bad accounts", () => {
    const base = { kind: "PAYMENT" as const, businessId: w.bizX, date: "2025-10-21", moneyAccount: "HDFC" };
    const one = (account: string, amountPaise = 100): { lines: Array<{ account: string; amountPaise: number }> } => ({ lines: [{ account, amountPaise }] });
    const refused = (patch: Record<string, unknown>, message: RegExp): void =>
      expect(() => createVoucher(w.r.db, { ...base, ...one("BANK_CHARGES"), ...patch }), JSON.stringify(patch)).toThrow(message);

    refused(one("RECEIVABLES"), /cannot be used on a voucher/);
    refused(one("CASH"), /Internal Transfer/);
    refused(one("BANK"), /Internal Transfer/);
    refused(one("HDFC"), /Internal Transfer/);
    refused(one("INVENTORY"), /cannot be used on a voucher/);
    refused(one("PAYABLES"), /cannot be used on a voucher/);
    refused(one("SUPPLIER_CREDITS"), /cannot be used on a voucher/);
    refused(one("CUSTOMER_CREDITS"), /cannot be used on a voucher/);
    refused(one("Y_ONLY"), /not an account of this company/);
    refused(one("NO_SUCH_ACCOUNT"), /not an account of this company/);
    refused(one("BANK_CHARGES", 0), /above zero/);
    refused(one("BANK_CHARGES", -5), /above zero/);
    refused(one("BANK_CHARGES", 10.5), /whole number/);
    refused({ lines: [] }, /at least one line/);
    refused({ lines: [{ account: "BANK_CHARGES", amountPaise: 100 }, { account: "BANK_CHARGES", amountPaise: 0 }] }, /Line 2/);
    refused({ moneyAccount: "BANK_CHARGES" }, /not a cash or bank account/);
    refused({ moneyAccount: "YBANK" }, /not a cash or bank account/);
    refused({ paymentMode: "CARRIER_PIGEON" }, /not known/);
    refused({ businessId: "nope" }, /not found/);
    refused({ kind: "TRANSFER" }, /RECEIPT or a PAYMENT/);
    expect(listVouchers(w.r.db, w.companyX)).toEqual([]);
    expect(w.r.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get()).toEqual({ n: 0 });
  });

  it("a locked financial year refuses a voucher dated inside it", () => {
    const yearId = w.r.createFinancialYear({ businessId: w.bizX, startsOn: "2025-04-01", endsOn: "2026-03-31" });
    w.r.setFinancialYearLocked(yearId, true);
    expect(() => createVoucher(w.r.db, { kind: "RECEIPT", businessId: w.bizX, date: "2025-10-20", moneyAccount: "HDFC", lines: [{ account: "OTHER_INCOME", amountPaise: 100 }] })).toThrow(/locked/);
    expect(listVouchers(w.r.db, w.companyX)).toEqual([]);
  });

  it("cancel: a reversing entry dated today, balances and income return, reason required, no double cancel", () => {
    const v = createVoucher(w.r.db, { kind: "RECEIPT", businessId: w.bizX, date: "2025-10-20", moneyAccount: "HDFC", lines: [{ account: "OTHER_INCOME", amountPaise: rs(412) }] });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-11-05T09:00:00+05:30"));
    expect(() => cancelVoucher(w.r.db, v.id, "")).toThrow(/reason is required/);
    const cancelled = cancelVoucher(w.r.db, v.id, "Wrong account");
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationReason: "Wrong account", reversalEntryId: `${v.journalEntryId}-reversal` });
    expect(getVoucher(w.r.db, v.id).status).toBe("CANCELLED");
    expect(balance(w.r, "HDFC")).toBe(0);
    expect(incomeOf(w.r, "OTHER_INCOME")).toBe(0);
    expect(w.r.db.prepare("SELECT is_reversal, source_type, entry_date FROM journal_entries WHERE id = ?").get(cancelled.reversalEntryId))
      .toEqual({ is_reversal: 1, source_type: "MONEY_VOUCHER", entry_date: "2025-11-05" });
    expect(() => cancelVoucher(w.r.db, v.id, "again")).toThrow(/already been cancelled/);
    expect(() => cancelVoucher(w.r.db, "nope", "x")).toThrow(/not found/);
    expect(trialBalanceBalances(w.r)).toBe(true);
  });

  it("audit: every post and cancel is logged with its reason and the chain verifies", () => {
    postJournalEntry(w.r.db, {
      id: "seed", sourceId: "seed", sourceType: "OPENING_BALANCE", description: "seed", isReversal: false,
      lines: [{ account: "CASH", debitPaise: rs(1000), creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: rs(1000) }],
    }, { businessId: w.bizX, entryDate: "2025-04-01" });
    const t = createInternalTransfer(w.r.db, { businessId: w.bizX, date: "2025-10-10", fromAccount: "CASH", toAccount: "HDFC", amountPaise: rs(500) });
    const v = createVoucher(w.r.db, { kind: "PAYMENT", businessId: w.bizX, date: "2025-10-11", moneyAccount: "HDFC", lines: [{ account: "BANK_CHARGES", amountPaise: rs(50) }] });
    cancelInternalTransfer(w.r.db, t.id, "t reason");
    cancelVoucher(w.r.db, v.id, "v reason");
    const events = w.r.db.prepare(
      "SELECT action, entity_id, entity_type, company_id, reason FROM audit_events WHERE action LIKE 'INTERNAL_TRANSFER_%' OR action LIKE 'VOUCHER_%' ORDER BY id",
    ).all();
    expect(events).toEqual([
      { action: "INTERNAL_TRANSFER_POSTED", entity_id: t.id, entity_type: "internal_transfer", company_id: w.companyX, reason: null },
      { action: "VOUCHER_POSTED", entity_id: v.id, entity_type: "voucher", company_id: w.companyX, reason: null },
      { action: "INTERNAL_TRANSFER_CANCELLED", entity_id: t.id, entity_type: "internal_transfer", company_id: w.companyX, reason: "t reason" },
      { action: "VOUCHER_CANCELLED", entity_id: v.id, entity_type: "voucher", company_id: w.companyX, reason: "v reason" },
    ]);
    expect(verifyAuditChain(w.r.db).ok).toBe(true);
  });

  it("the schema function is idempotent", () => {
    expect(() => { applyMoneyMovementsSchema(w.r.db); applyMoneyMovementsSchema(w.r.db); }).not.toThrow();
  });
});
