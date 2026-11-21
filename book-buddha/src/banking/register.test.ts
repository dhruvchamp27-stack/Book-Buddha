import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postJournalEntry } from "../database/ledger.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { createBankAccount } from "./bank-accounts.js";
import { applyBankAccountsSchema } from "./bank-accounts-schema.js";
import { getAccountRegister } from "./register.js";

let r: AccountingRepository;
let companyId: string;
let businessId: string;
let otherCompanyId: string;
let otherBusinessId: string;
let seq = 0;

beforeEach(() => {
  r = new AccountingRepository();
  applyBankAccountsSchema(r.db);
  companyId = r.createCompany({ name: "Co X", accountingBasis: "ACCRUAL" });
  businessId = r.createBusiness({ companyId, name: "Biz X" });
  otherCompanyId = r.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
  otherBusinessId = r.createBusiness({ companyId: otherCompanyId, name: "Biz Y" });
});
afterEach(() => r.close());

function post(debit: string, credit: string, paise: number, entryDate: string, bizId = businessId): void {
  seq += 1;
  postJournalEntry(
    r.db,
    {
      id: `je-reg-${seq}`, sourceId: `src-${seq}`, sourceType: "MONEY_VOUCHER", description: `Entry ${seq}`, isReversal: false,
      lines: [{ account: debit, debitPaise: paise, creditPaise: 0 }, { account: credit, debitPaise: 0, creditPaise: paise }],
    },
    { businessId: bizId, entryDate },
  );
}

/** HDFC, October: the hand-worked figures. */
function hdfcOctober(): string {
  const hdfc = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT" });
  post(hdfc, "CAPITAL", 5_000_000, "2026-10-01"); // opening Rs 50,000
  post(hdfc, "SALES", 1_200_000, "2026-10-03"); // + Rs 12,000
  post(hdfc, "SALES", 2_360_000, "2026-10-08"); // + Rs 23,600
  post("EXPENSE", hdfc, 1_800_000, "2026-10-15"); // - Rs 18,000
  post("EXPENSE", hdfc, 118_000, "2026-10-20"); // - Rs 1,180
  post(hdfc, "SALES", 590_000, "2026-10-28"); // + Rs 5,900
  return hdfc;
}

describe("account register", () => {
  it("7. HDFC October: running balances 50,000 / 62,000 / 85,600 / 67,600 / 66,420 / 72,320; from 10 Oct the opening is 85,600", () => {
    const hdfc = hdfcOctober();
    const full = getAccountRegister(r.db, { companyId, accountCode: hdfc });
    expect(full.openingBalancePaise).toBe(0);
    expect(full.rows.map((x) => x.runningBalancePaise)).toEqual([5_000_000, 6_200_000, 8_560_000, 6_760_000, 6_642_000, 7_232_000]);
    expect(full.rows.map((x) => [x.inPaise, x.outPaise])).toEqual([
      [5_000_000, 0], [1_200_000, 0], [2_360_000, 0], [0, 1_800_000], [0, 118_000], [590_000, 0],
    ]);
    expect(full.closingBalancePaise).toBe(7_232_000); // Rs 72,320
    expect(full.account).toMatchObject({ code: hdfc, role: "BANK", type: "ASSET" });
    expect(full.rows[0]).toMatchObject({ entryDate: "2026-10-01", sourceType: "MONEY_VOUCHER", businessId, isReversal: false });

    const fromTenth = getAccountRegister(r.db, { companyId, accountCode: hdfc, fromDate: "2026-10-10" });
    expect(fromTenth.openingBalancePaise).toBe(8_560_000); // Rs 85,600
    expect(fromTenth.rows.map((x) => x.runningBalancePaise)).toEqual([6_760_000, 6_642_000, 7_232_000]);
    expect(fromTenth.closingBalancePaise).toBe(7_232_000);

    const window = getAccountRegister(r.db, { companyId, accountCode: hdfc, fromDate: "2026-10-10", toDate: "2026-10-20" });
    expect(window.rows).toHaveLength(2);
    expect(window.closingBalancePaise).toBe(6_642_000);
    // Same-day entries keep posting order.
    post(hdfc, "SALES", 100, "2026-10-28");
    post("EXPENSE", hdfc, 50, "2026-10-28");
    const tail = getAccountRegister(r.db, { companyId, accountCode: hdfc, fromDate: "2026-10-28" }).rows.map((x) => x.runningBalancePaise);
    expect(tail).toEqual([7_232_000, 7_232_100, 7_232_050]);
    // Bad input is a validation error.
    expect(() => getAccountRegister(r.db, { companyId, accountCode: hdfc, fromDate: "2026-13-40" })).toThrow(RepositoryValidationError);
    expect(() => getAccountRegister(r.db, { companyId, accountCode: hdfc, fromDate: "2026-11-01", toDate: "2026-10-01" })).toThrow(RepositoryValidationError);
    expect(() => getAccountRegister(r.db, { companyId: otherCompanyId, accountCode: hdfc })).toThrow(RepositoryValidationError);
    expect(() => getAccountRegister(r.db, { companyId, accountCode: hdfc, businessId: otherBusinessId })).toThrow(RepositoryValidationError);
  });

  it("8. the seeded BANK register for company X shows none of company Y's lines", () => {
    post("BANK", "CAPITAL", 1_000_000, "2026-10-01"); // X: Rs 10,000
    post("BANK", "CAPITAL", 9_000_000, "2026-10-02", otherBusinessId); // Y: Rs 90,000
    post("EXPENSE", "BANK", 200_000, "2026-10-03", otherBusinessId); // Y: out Rs 2,000
    const x = getAccountRegister(r.db, { companyId, accountCode: "BANK" });
    expect(x.rows).toHaveLength(1);
    expect(x.rows.every((row) => row.businessId === businessId)).toBe(true);
    expect(x.closingBalancePaise).toBe(1_000_000);
    const y = getAccountRegister(r.db, { companyId: otherCompanyId, accountCode: "BANK" });
    expect(y.rows).toHaveLength(2);
    expect(y.closingBalancePaise).toBe(8_800_000);
  });

  it("filters by business inside the company", () => {
    const second = r.createBusiness({ companyId, name: "Biz X2" });
    const hdfc = createBankAccount(r.db, { companyId, name: "HDFC", kind: "CURRENT" });
    post(hdfc, "CAPITAL", 100_000, "2026-10-01");
    post(hdfc, "CAPITAL", 300_000, "2026-10-02", second);
    expect(getAccountRegister(r.db, { companyId, accountCode: hdfc }).closingBalancePaise).toBe(400_000);
    expect(getAccountRegister(r.db, { companyId, accountCode: hdfc, businessId: second }).closingBalancePaise).toBe(300_000);
  });
});
