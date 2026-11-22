import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../database/audit-log.js";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import {
  createBankAccount,
  deactivateBankAccount,
  formatRupees,
  listBankAccounts,
  reactivateBankAccount,
  updateBankAccount,
} from "./bank-accounts.js";
import { applyBankAccountsSchema } from "./bank-accounts-schema.js";
import { assertMoneyAccount } from "./money-accounts.js";
import { todayAt } from "../database/test-clock.js";

/** Figures are PAISE in code; the rupee figure is in a comment. */
let r: AccountingRepository;
let companyId: string;
let businessId: string;
let otherCompanyId: string;
let seq = 0;

beforeEach(() => {
  r = new AccountingRepository(":memory:", todayAt("2026-10-01"));
  applyBankAccountsSchema(r.db); // v25 later; the orchestrator registers it in migrations.ts
  companyId = r.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = r.createBusiness({ companyId, name: "Book Fair Co" });
  otherCompanyId = r.createCompany({ name: "Other Co", accountingBasis: "ACCRUAL" });
  r.createBusiness({ companyId: otherCompanyId, name: "Other Biz" });
});
afterEach(() => r.close());

/** Dr `debit` / Cr `credit` for `paise`, posted through the one door. */
function post(debit: string, credit: string, paise: number, entryDate: string, bizId = businessId): void {
  seq += 1;
  postJournalEntry(
    r.db,
    {
      id: `je-test-${seq}`, sourceId: `src-${seq}`, sourceType: "MONEY_VOUCHER", description: `Test ${seq}`, isReversal: false,
      lines: [{ account: debit, debitPaise: paise, creditPaise: 0 }, { account: credit, debitPaise: 0, creditPaise: paise }],
    },
    { businessId: bizId, entryDate },
  );
}

const typeOf = (code: string) => r.db.prepare("SELECT type, role, company_id FROM chart_accounts WHERE code = ?").get(code);

describe("bank accounts", () => {
  it("1. a current account is ASSET/BANK with the cash-management flag on; OD and CC are LIABILITY/BANK with it off; an OD created with the flag on keeps it", () => {
    const current = createBankAccount(r.db, { companyId, name: "HDFC Current", kind: "CURRENT" });
    const savings = createBankAccount(r.db, { companyId, name: "SBI Savings", kind: "SAVINGS" });
    const od = createBankAccount(r.db, { companyId, name: "ICICI OD", kind: "OVERDRAFT", sanctionedLimitPaise: 50_000_000 }); // Rs 5,00,000
    const cc = createBankAccount(r.db, { companyId, name: "Axis CC", kind: "CASH_CREDIT" });
    const odOn = createBankAccount(r.db, { companyId, name: "Kotak OD", kind: "OVERDRAFT", partOfCashManagement: true });
    expect(current).toBe("BANK_HDFC_CURRENT");
    expect(typeOf(current)).toEqual({ type: "ASSET", role: "BANK", company_id: companyId });
    expect(typeOf(savings)).toMatchObject({ type: "ASSET", role: "BANK" });
    expect(typeOf(od)).toMatchObject({ type: "LIABILITY", role: "BANK" });
    expect(typeOf(cc)).toMatchObject({ type: "LIABILITY", role: "BANK" });
    const byCode = new Map(listBankAccounts(r.db, companyId).map((a) => [a.code, a]));
    expect(byCode.get(current)?.partOfCashManagement).toBe(true);
    expect(byCode.get(savings)?.partOfCashManagement).toBe(true);
    expect(byCode.get(od)?.partOfCashManagement).toBe(false);
    expect(byCode.get(cc)?.partOfCashManagement).toBe(false);
    expect(byCode.get(odOn)?.partOfCashManagement).toBe(true);
    expect(byCode.get(od)?.sanctionedLimitPaise).toBe(50_000_000);
    // A limit makes no sense on a current account.
    expect(() => createBankAccount(r.db, { companyId, name: "Bad", kind: "CURRENT", sanctionedLimitPaise: 100 })).toThrow(RepositoryValidationError);
    // A given code follows createAccount's rules, and a clash gets a numbered code when generated.
    expect(createBankAccount(r.db, { companyId, name: "Own Code", kind: "CURRENT", code: "my_bank" })).toBe("MY_BANK");
    expect(() => createBankAccount(r.db, { companyId, name: "Clash", kind: "CURRENT", code: "BANK" })).toThrow(/built-in/);
    expect(() => createBankAccount(r.db, { companyId, name: "Clash2", kind: "CURRENT", code: "1bad" })).toThrow(RepositoryValidationError);
  });

  it("2. a new bank passes assertMoneyAccount; another company's bank fails it; a deactivated one fails it", () => {
    const code = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT" });
    expect(assertMoneyAccount(r.db, code, companyId)).toMatchObject({ code, role: "BANK", type: "ASSET", active: true });
    expect(() => assertMoneyAccount(r.db, code, otherCompanyId)).toThrow(RepositoryValidationError);
    deactivateBankAccount(r.db, companyId, code);
    expect(() => assertMoneyAccount(r.db, code, companyId)).toThrow(/no longer active/);
  });

  it("3. an overdraft in use shows under liabilities, the sheet balances, and the cash P&L never shows the OD itself", () => {
    const od = createBankAccount(r.db, { companyId, name: "ICICI OD", kind: "OVERDRAFT" });
    post("EXPENSE", od, 15_000_000, "2026-10-05"); // Dr expense / Cr OD, Rs 1,50,000
    const sheet = r.getBalanceSheet({ businessId });
    const odRow = sheet.liabilities.find((l) => l.account === od);
    expect(odRow?.balancePaise).toBe(15_000_000); // Rs 1,50,000 owed
    expect(sheet.assets.find((a) => a.account === od)).toBeUndefined();
    expect(sheet.totalLiabilitiesPaise).toBe(15_000_000);
    // The expense is a cost, so retained earnings is -1,50,000 and the sheet still balances.
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    const accrual = r.getProfitAndLoss({ businessId, basis: "ACCRUAL" });
    expect(accrual.expenses.find((e) => e.account === "EXPENSE")?.balancePaise).toBe(15_000_000);
    // Cash view: the OD is a money account (settlement), so it never appears as income or expense.
    const cash = r.getProfitAndLoss({ businessId, basis: "CASH" });
    expect([...cash.income, ...cash.expenses].some((row) => row.account === od)).toBe(false);
    expect(cash.expenses.find((e) => e.account === "EXPENSE")?.balancePaise).toBe(15_000_000); // the expense is shown
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === od)?.balancePaise).toBe(-15_000_000);
  });

  it("4. rename keeps the type; kind cannot change; bad last4 and IFSC are rejected; duplicate names are per company", () => {
    const code = createBankAccount(r.db, { companyId, name: "HDFC", kind: "OVERDRAFT", accountNumberLast4: "1234", ifsc: "hdfc0001234" });
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === code)).toMatchObject({ ifsc: "HDFC0001234", accountNumberLast4: "1234" });
    updateBankAccount(r.db, companyId, code, { name: "HDFC Overdraft", branch: "Fort" });
    const after = listBankAccounts(r.db, companyId).find((a) => a.code === code);
    expect(after).toMatchObject({ name: "HDFC Overdraft", branch: "Fort", type: "LIABILITY", kind: "OVERDRAFT" });
    // Kind and type are not even in the update shape; a smuggled one changes nothing.
    updateBankAccount(r.db, companyId, code, { kind: "CURRENT", type: "ASSET" } as never);
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === code)).toMatchObject({ type: "LIABILITY", kind: "OVERDRAFT" });
    expect(() => updateBankAccount(r.db, companyId, code, { accountNumberLast4: "12345" })).toThrow(/last 4 digits/);
    expect(() => updateBankAccount(r.db, companyId, code, { accountNumberLast4: "12a4" })).toThrow(/last 4 digits/);
    expect(() => createBankAccount(r.db, { companyId, name: "X", kind: "CURRENT", accountNumberLast4: "123456789012" })).toThrow(RepositoryValidationError);
    expect(() => updateBankAccount(r.db, companyId, code, { ifsc: "HDFC1001234" })).toThrow(/IFSC/);
    expect(() => updateBankAccount(r.db, companyId, code, { ifsc: "HDF0001234" })).toThrow(/IFSC/);
    // Clearing is allowed (null); the earlier good values stay where not touched.
    updateBankAccount(r.db, companyId, code, { ifsc: null });
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === code)).toMatchObject({ ifsc: null, accountNumberLast4: "1234" });
    // Duplicate name, case-insensitively, in the same company; fine in another company.
    createBankAccount(r.db, { companyId, name: "SBI", kind: "CURRENT" });
    expect(() => createBankAccount(r.db, { companyId, name: "sbi", kind: "SAVINGS" })).toThrow(/already exists/);
    expect(() => updateBankAccount(r.db, companyId, code, { name: " SBI " })).toThrow(/already exists/);
    expect(createBankAccount(r.db, { companyId: otherCompanyId, name: "SBI", kind: "CURRENT" })).toBe("BANK_SBI_2");
    // The seeded BANK is listed, but cannot be edited or deactivated here; nor another company's bank.
    expect(listBankAccounts(r.db, companyId)[0]).toMatchObject({ code: "BANK", isSystem: true, kind: null });
    expect(() => updateBankAccount(r.db, companyId, "BANK", { name: "Mine" })).toThrow(/built-in/);
    expect(() => deactivateBankAccount(r.db, companyId, "BANK")).toThrow(/built-in/);
    expect(() => updateBankAccount(r.db, otherCompanyId, code, { name: "Steal" })).toThrow(RepositoryValidationError);
  });

  it("5. deactivate is refused with a balance (naming it in rupees), allowed at zero; reactivate works", () => {
    const code = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT" });
    post(code, "CAPITAL", 15_000_000, "2026-10-01"); // Rs 1,50,000
    expect(() => deactivateBankAccount(r.db, companyId, code)).toThrow(/Rs 1,50,000/);
    post("EXPENSE", code, 15_000_000, "2026-10-02"); // back to zero
    deactivateBankAccount(r.db, companyId, code);
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === code)?.active).toBe(false);
    expect(() => deactivateBankAccount(r.db, companyId, code)).toThrow(/already inactive/);
    reactivateBankAccount(r.db, companyId, code);
    expect(listBankAccounts(r.db, companyId).find((a) => a.code === code)?.active).toBe(true);
    expect(() => reactivateBankAccount(r.db, companyId, code)).toThrow(/already active/);
    // An overdraft in use names its balance too.
    const od = createBankAccount(r.db, { companyId, name: "OD", kind: "OVERDRAFT" });
    post("EXPENSE", od, 12_345_050, "2026-10-03");
    expect(() => deactivateBankAccount(r.db, companyId, od)).toThrow(/Rs 1,23,450\.50/);
  });

  it("6. an opening balance of Rs 50,000 on a new bank, saved with saveOpeningBalances, is the register's first row", async () => {
    const { getAccountRegister } = await import("./register.js");
    const code = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT" });
    r.saveOpeningBalances({
      id: "ob-bank", businessId, asAt: "2026-10-01",
      lines: [{ account: code, debitPaise: 5_000_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 5_000_000 }], // Rs 50,000
    });
    const reg = getAccountRegister(r.db, { companyId, accountCode: code });
    expect(reg.openingBalancePaise).toBe(0);
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({ entryDate: "2026-10-01", sourceType: "OPENING_BALANCE", inPaise: 5_000_000, outPaise: 0, runningBalancePaise: 5_000_000 });
    expect(reg.closingBalancePaise).toBe(5_000_000);
  });

  it("10. create, update and deactivate each write an audit event, and the chain verifies", () => {
    const code = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT", ifsc: "HDFC0001234" });
    updateBankAccount(r.db, companyId, code, { branch: "Fort" });
    deactivateBankAccount(r.db, companyId, code);
    reactivateBankAccount(r.db, companyId, code);
    const events = r.db
      .prepare("SELECT action, entity_type, company_id, before_values, after_values FROM audit_events WHERE entity_id = ? ORDER BY id")
      .all(code) as Array<{ action: string; entity_type: string; company_id: string; before_values: string | null; after_values: string | null }>;
    expect(events.map((e) => e.action)).toEqual([
      "BANK_ACCOUNT_CREATED", "BANK_ACCOUNT_UPDATED", "BANK_ACCOUNT_DEACTIVATED", "BANK_ACCOUNT_REACTIVATED",
    ]);
    expect(events.every((e) => e.entity_type === "bank_account" && e.company_id === companyId)).toBe(true);
    expect(JSON.parse(events[0]?.after_values ?? "{}")).toMatchObject({ code, kind: "CURRENT", ifsc: "HDFC0001234", partOfCashManagement: true });
    expect(JSON.parse(events[1]?.before_values ?? "{}")).toMatchObject({ branch: null });
    expect(JSON.parse(events[1]?.after_values ?? "{}")).toMatchObject({ branch: "Fort" });
    expect(verifyAuditChain(r.db).ok).toBe(true);
  });

  it("formats rupees with Indian grouping", () => {
    expect(formatRupees(15_000_000)).toBe("Rs 1,50,000");
    expect(formatRupees(150_050)).toBe("Rs 1,500.50");
    expect(formatRupees(-500)).toBe("-Rs 5");
    expect(formatRupees(0)).toBe("Rs 0");
  });
});
