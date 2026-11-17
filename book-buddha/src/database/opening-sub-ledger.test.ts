import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import { verifyAuditChain } from "./audit-log.js";
import { AccountingRepository } from "./repository.js";

/**
 * R4b - opening customer and supplier balances. Figures are PAISE in code; the rupee figure is in a
 * comment beside it.
 *
 */
function world(): {
  repository: AccountingRepository; companyId: string; businessId: string; customerId: string; supplierId: string;
} {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Book Fair Co" });
  const customerId = repository.createCustomer({ companyId, name: "Customer" });
  const supplierId = repository.createSupplier({ companyId, name: "Supplier" });
  return { repository, companyId, businessId, customerId, supplierId };
}

type W = ReturnType<typeof world>;
const AS_AT = "2025-03-31";
const APRIL = { fromDate: "2025-04-01", toDate: "2025-04-30" };
const MAY = { fromDate: "2025-05-01", toDate: "2025-05-31" };
const YEAR = { fromDate: "2025-04-01", toDate: "2026-03-31" };

const net = (w: W, account: string, asAt?: string): number => {
  const row = w.repository.getTrialBalance({ businessId: w.businessId, ...(asAt === undefined ? {} : { asAtDate: asAt }) }).find((x) => x.account === account);
  return row === undefined ? 0 : row.debitPaise - row.creditPaise;
};
const trialBalanceBalances = (w: W, asAt?: string): boolean => {
  const tb = w.repository.getTrialBalance({ businessId: w.businessId, ...(asAt === undefined ? {} : { asAtDate: asAt }) });
  return tb.reduce((t, x) => t + x.debitPaise, 0) === tb.reduce((t, x) => t + x.creditPaise, 0);
};
const cashIncome = (w: W, window: { fromDate?: string; toDate?: string }): number =>
  w.repository.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", ...window }).totalIncomePaise;
const receivableOutstanding = (w: W): number =>
  w.repository.getReceivables().reduce((t, r) => t + r.outstandingPaise, 0);

describe("opening customer balances", () => {
  it("ACCEPTANCE R4b (figures unconfirmed): no opening sales behind the balance is a balance-sheet movement only", () => {
    const w = world();
    try {
      const r = w.repository;
      // Rs 40,000 owed by the customer at 31 Mar, with NO income behind it (the sale predates the books).
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 4_000_000, incomePaise: 0 });
      expect(net(w, "RECEIVABLES")).toBe(4_000_000); // Rs 40,000 owed
      expect(net(w, "OPENING_BALANCE_EQUITY")).toBe(-4_000_000); // the WHOLE Rs 40,000, a credit
      expect(trialBalanceBalances(w)).toBe(true);
      expect(receivableOutstanding(w)).toBe(4_000_000);

      // Rs 25,000 collected 10 Apr (into Cash).
      r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 2_500_000, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      expect(receivableOutstanding(w)).toBe(1_500_000); // Rs 15,000 left
      expect(trialBalanceBalances(w)).toBe(true);
      // Rs 15,000 collected 20 May (into Bank).
      r.recordOpeningBalanceReceipt({ id: "rc2", openingCustomerBalanceId: "ocb1", amountPaise: 1_500_000, receivedOn: "2025-05-20", paymentAccount: "BANK" });
      expect(receivableOutstanding(w)).toBe(0); // Rs 0 left
      expect(trialBalanceBalances(w)).toBe(true);
      expect(net(w, "CASH")).toBe(2_500_000);
      expect(net(w, "BANK")).toBe(1_500_000);
      expect(net(w, "RECEIVABLES")).toBe(0);

      // CASH P&L: no income at all.
      expect(cashIncome(w, APRIL)).toBe(0); // Rs 0
      expect(cashIncome(w, MAY)).toBe(0); // Rs 0
      expect(cashIncome(w, YEAR)).toBe(0); // Rs 0
      expect(cashIncome(w, {})).toBe(0);
      expect(r.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL" }).totalIncomePaise).toBe(0);
      // OPENING_BALANCE_EQUITY carries the whole Rs 40,000.
      expect(net(w, "OPENING_BALANCE_EQUITY")).toBe(-4_000_000);

      const sheet = r.getBalanceSheet({ businessId: w.businessId });
      expect(sheet.totalAssetsPaise).toBe(4_000_000); // Rs 25,000 cash + Rs 15,000 bank
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
      expect(verifyAuditChain(r.db).ok).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("ACCEPTANCE R4b (figures unconfirmed): opening sales behind the balance recognise income in proportion", () => {
    const w = world();
    try {
      const r = w.repository;
      // Rs 40,000 owed, of which Rs 30,000 is income against Sales (the other Rs 10,000 is not).
      r.saveOpeningCustomerBalance({
        id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT,
        amountPaise: 4_000_000, incomePaise: 3_000_000, incomeAccount: "SALES",
      });
      expect(net(w, "RECEIVABLES")).toBe(4_000_000);
      expect(net(w, "SALES")).toBe(-3_000_000); // Rs 30,000 credit
      expect(net(w, "OPENING_BALANCE_EQUITY")).toBe(-1_000_000); // Rs 10,000 credit
      expect(trialBalanceBalances(w)).toBe(true);

      // Accrual income is the whole Rs 30,000, from the opening entry, on 31 March.
      expect(r.getProfitAndLoss({ businessId: w.businessId, basis: "ACCRUAL", toDate: AS_AT }).totalIncomePaise).toBe(3_000_000);
      // The opening entry's income must NOT also pass through as cash income on 31 March.
      expect(cashIncome(w, { fromDate: AS_AT, toDate: AS_AT })).toBe(0);
      expect(cashIncome(w, { toDate: AS_AT })).toBe(0);

      // Rs 10,000 on 10 Apr: income 30,000 x 10,000 / 40,000 = Rs 7,500.
      r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 1_000_000, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      expect(cashIncome(w, APRIL)).toBe(750_000); // Rs 7,500
      // Rs 30,000 on 20 May: income = the remaining Rs 22,500.
      r.recordOpeningBalanceReceipt({ id: "rc2", openingCustomerBalanceId: "ocb1", amountPaise: 3_000_000, receivedOn: "2025-05-20", paymentAccount: "BANK" });
      expect(cashIncome(w, MAY)).toBe(2_250_000); // Rs 22,500
      expect(cashIncome(w, YEAR)).toBe(3_000_000); // Rs 30,000 = X exactly
      // April is unmoved by the May receipt (S1-6: a reported month never moves).
      expect(cashIncome(w, APRIL)).toBe(750_000);
      expect(cashIncome(w, { toDate: AS_AT })).toBe(0);
      // Gross sales collected follows the income recognised (no GST on an opening balance).
      expect(r.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", ...YEAR }).grossSalesPaise).toBe(3_000_000);

      expect(receivableOutstanding(w)).toBe(0);
      expect(trialBalanceBalances(w)).toBe(true);
      const sheet = r.getBalanceSheet({ businessId: w.businessId });
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally {
      w.repository.close();
    }
  });

  it("trues up on the last receipt so odd-sized receipts never leak a paisa", () => {
    const w = world();
    try {
      const r = w.repository;
      // Rs 100.00 owed (10,000 paise), income 3,333 paise: no receipt divides evenly.
      r.saveOpeningCustomerBalance({
        id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT,
        amountPaise: 10_000, incomePaise: 3_333, incomeAccount: "SALES",
      });
      for (const [i, amount] of [1_111, 2_223, 3_333, 3_333].entries()) {
        r.recordOpeningBalanceReceipt({ id: `rc${i}`, openingCustomerBalanceId: "ocb1", amountPaise: amount, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      }
      expect(receivableOutstanding(w)).toBe(0);
      expect(cashIncome(w, YEAR)).toBe(3_333);
    } finally {
      w.repository.close();
    }
  });

  it("lists opening balances among the receivables, and refuses to over-collect", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 4_000_000, incomePaise: 0 });
      const rows = r.getReceivables();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: "OPENING", invoiceId: "ocb1", customerId: w.customerId, totalPaise: 4_000_000, outstandingPaise: 4_000_000 });
      // The shared open-items query R7 will read.
      expect(r.getOpenCustomerItems({ businessId: w.businessId })).toEqual([
        {
          documentId: "ocb1", kind: "OPENING", date: AS_AT, totalPaise: 4_000_000, settledPaise: 0,
          outstandingPaise: 4_000_000, customerId: w.customerId, businessId: w.businessId,
        },
      ]);
      expect(() =>
        r.recordOpeningBalanceReceipt({ id: "big", openingCustomerBalanceId: "ocb1", amountPaise: 4_000_001, receivedOn: "2025-04-10", paymentAccount: "CASH" }),
      ).toThrow(/outstanding|exceeds/i);
      r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 1_000_000, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      expect(r.getReceivables()[0]).toMatchObject({ paidPaise: 1_000_000, outstandingPaise: 3_000_000 });
      expect(() =>
        r.recordOpeningBalanceReceipt({ id: "big2", openingCustomerBalanceId: "ocb1", amountPaise: 3_000_001, receivedOn: "2025-04-11", paymentAccount: "CASH" }),
      ).toThrow(/outstanding|exceeds/i);
      // A receipt cannot predate the balance, and the account must be CASH or BANK.
      expect(() =>
        r.recordOpeningBalanceReceipt({ id: "early", openingCustomerBalanceId: "ocb1", amountPaise: 1, receivedOn: "2025-03-30", paymentAccount: "CASH" }),
      ).toThrow(/before|predate/i);
      expect(() =>
        r.recordOpeningBalanceReceipt({ id: "odd", openingCustomerBalanceId: "ocb1", amountPaise: 1, receivedOn: "2025-04-11", paymentAccount: "SALES" as "CASH" }),
      ).toThrow();
    } finally {
      w.repository.close();
    }
  });

  it("refuses a duplicate id and a second live balance for the same customer, and allows one after a reversal", () => {
    const w = world();
    try {
      const r = w.repository;
      const base = { businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 1_000_000, incomePaise: 0 };
      r.saveOpeningCustomerBalance({ id: "ocb1", ...base });
      expect(() => r.saveOpeningCustomerBalance({ id: "ocb1", ...base })).toThrow(/already exists/);
      expect(() => r.saveOpeningCustomerBalance({ id: "ocb2", ...base })).toThrow(/already has an opening balance/);
      r.reverseOpeningCustomerBalance({ id: "ocb1", reversedOn: "2025-04-02" });
      r.saveOpeningCustomerBalance({ id: "ocb2", ...base, amountPaise: 900_000 });
      expect(r.listOpeningCustomerBalances(w.businessId).map((b) => [b.id, b.reversedAt === null])).toEqual([["ocb1", false], ["ocb2", true]]);
    } finally {
      w.repository.close();
    }
  });

  it("reverses cleanly: the ledger nets to nothing, the Trial Balance balances, and it is audited", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveOpeningCustomerBalance({
        id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT,
        amountPaise: 4_000_000, incomePaise: 3_000_000, incomeAccount: "SALES",
      });
      const reversal = r.reverseOpeningCustomerBalance({ id: "ocb1", reversedOn: "2025-04-02" });
      expect(reversal.isReversal).toBe(true);
      for (const account of ["RECEIVABLES", "SALES", "OPENING_BALANCE_EQUITY"]) expect(net(w, account), account).toBe(0);
      expect(trialBalanceBalances(w)).toBe(true);
      expect(receivableOutstanding(w)).toBe(0);
      expect(r.getOpenCustomerItems({ businessId: w.businessId })).toEqual([]);
      expect(() => r.reverseOpeningCustomerBalance({ id: "ocb1", reversedOn: "2025-04-03" })).toThrow(/already been reversed/);
      expect(() => r.reverseOpeningCustomerBalance({ id: "nope", reversedOn: "2025-04-03" })).toThrow(/not found/);
      expect(r.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = 'ocb1'").get()).toEqual({ n: 2 });
      expect(verifyAuditChain(r.db).ok).toBe(true);
      // Nothing is recognised by a balance that was reversed before any money came in.
      expect(cashIncome(w, {})).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("refuses to reverse a balance that has already been collected against", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 1_000_000, incomePaise: 0 });
      r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 100, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      expect(() => r.reverseOpeningCustomerBalance({ id: "ocb1", reversedOn: "2025-04-11" })).toThrow(/receipt/i);
      expect(trialBalanceBalances(w)).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("is refused by the financial-year lock when dated inside a locked year", () => {
    const w = world();
    try {
      const r = w.repository;
      const year = r.createFinancialYear({ businessId: w.businessId, startsOn: "2024-04-01", endsOn: "2025-03-31" });
      r.setFinancialYearLocked(year, true);
      expect(() =>
        r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 1_000, incomePaise: 0 }),
      ).toThrow(/locked/);
      expect(r.listOpeningCustomerBalances(w.businessId)).toEqual([]);
      expect(() =>
        r.saveOpeningSupplierBalance({ id: "osb1", businessId: w.businessId, supplierId: w.supplierId, asAt: AS_AT, amountPaise: 1_000 }),
      ).toThrow(/locked/);
      expect(r.listOpeningSupplierBalances(w.businessId)).toEqual([]);
    } finally {
      w.repository.close();
    }
  });

  it("accepts a USER-CREATED income account, and refuses an account that is not income", () => {
    const w = world();
    try {
      const r = w.repository;
      r.createAccount({ companyId: w.companyId, code: "FAIR_SALES_PRE", name: "Pre-books fair sales", type: "INCOME" });
      r.saveOpeningCustomerBalance({
        id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT,
        amountPaise: 1_000_000, incomePaise: 600_000, incomeAccount: "FAIR_SALES_PRE",
      });
      expect(net(w, "FAIR_SALES_PRE")).toBe(-600_000);
      r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 1_000_000, receivedOn: "2025-04-10", paymentAccount: "CASH" });
      expect(cashIncome(w, YEAR)).toBe(600_000);
      const row = r.getProfitAndLoss({ businessId: w.businessId, basis: "CASH", ...YEAR }).income.find((x) => x.account === "FAIR_SALES_PRE");
      expect(row?.creditPaise).toBe(600_000);

      const w2 = world();
      try {
        const base = { businessId: w2.businessId, customerId: w2.customerId, asAt: AS_AT, amountPaise: 1_000, incomePaise: 500 };
        expect(() => w2.repository.saveOpeningCustomerBalance({ id: "a", ...base, incomeAccount: "BANK" })).toThrow(/income/i);
        expect(() => w2.repository.saveOpeningCustomerBalance({ id: "b", ...base, incomeAccount: "CAPITAL" })).toThrow(/income/i);
        expect(() => w2.repository.saveOpeningCustomerBalance({ id: "c", ...base, incomeAccount: "NO_SUCH" })).toThrow(/does not exist/);
        expect(() => w2.repository.saveOpeningCustomerBalance({ id: "d", ...base })).toThrow(/income account/i); // income with no account
        // Another company's account is refused.
        const other = w2.repository.createCompany({ name: "Other", accountingBasis: "ACCRUAL" });
        w2.repository.createAccount({ companyId: other, code: "THEIR_INCOME", name: "Theirs", type: "INCOME" });
        expect(() => w2.repository.saveOpeningCustomerBalance({ id: "e", ...base, incomeAccount: "THEIR_INCOME" })).toThrow(/another company/);
      } finally {
        w2.repository.close();
      }
    } finally {
      w.repository.close();
    }
  });

  it("refuses income above the balance, in the repository AND in the table", () => {
    const w = world();
    try {
      const r = w.repository;
      const base = { businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 1_000 };
      expect(() => r.saveOpeningCustomerBalance({ id: "x", ...base, incomePaise: 1_001, incomeAccount: "SALES" })).toThrow(/cannot exceed/);
      expect(() => r.saveOpeningCustomerBalance({ id: "x", ...base, incomePaise: -1, incomeAccount: "SALES" })).toThrow();
      expect(() => r.saveOpeningCustomerBalance({ id: "x", ...base, amountPaise: 0, incomePaise: 0 })).toThrow();
      expect(() => r.saveOpeningCustomerBalance({ id: "x", ...base, incomePaise: 0, incomeAccount: "SALES" })).toThrow(/income account/i);
      // The CHECK is the backstop when something bypasses the repository.
      r.saveOpeningCustomerBalance({ id: "ok", ...base, incomePaise: 0 });
      const insert = (income: number, amount: number): unknown =>
        r.db
          .prepare(
            `INSERT INTO opening_customer_balances (id, business_id, customer_id, as_at, amount_paise, income_paise, income_account, journal_entry_id, reversed_at, created_at)
             SELECT 'raw', business_id, customer_id, as_at, ?, ?, 'SALES', journal_entry_id, '2025-04-01', created_at FROM opening_customer_balances WHERE id = 'ok'`,
          )
          .run(amount, income);
      expect(() => insert(1_001, 1_000)).toThrow(/CHECK/);
      expect(() => insert(0, 0)).toThrow(/CHECK/);
      expect(() => insert(-1, 1_000)).toThrow(/CHECK/);
    } finally {
      w.repository.close();
    }
  });

  it("an opening entry and the general opening Trial Balance coexist, and the general one still refuses RECEIVABLES", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveOpeningBalances({
        id: "ob1", businessId: w.businessId, asAt: AS_AT,
        lines: [{ account: "BANK", debitPaise: 500_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 500_000 }],
      });
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: AS_AT, amountPaise: 400_000, incomePaise: 100_000, incomeAccount: "SALES" });
      expect(trialBalanceBalances(w)).toBe(true);
      // A general opening set reusing the SAME id as the sub-ledger balance must not be mistaken for it.
      const w2 = world();
      try {
        w2.repository.saveOpeningBalances({
          id: "same", businessId: w2.businessId, asAt: AS_AT,
          lines: [{ account: "BANK", debitPaise: 1_000_000, creditPaise: 0 }, { account: "SALES", debitPaise: 0, creditPaise: 1_000_000 }],
        });
        w2.repository.saveOpeningCustomerBalance({ id: "same", businessId: w2.businessId, customerId: w2.customerId, asAt: AS_AT, amountPaise: 400_000, incomePaise: 0 });
        w2.repository.recordOpeningBalanceReceipt({ id: "rc", openingCustomerBalanceId: "same", amountPaise: 400_000, receivedOn: "2025-04-10", paymentAccount: "CASH" });
        // X = 0: nothing recognised, and the general set's Rs 10,000 of income is still dropped (R4a pin).
        expect(w2.repository.getProfitAndLoss({ businessId: w2.businessId, basis: "CASH" }).totalIncomePaise).toBe(0);
      } finally {
        w2.repository.close();
      }
    } finally {
      w.repository.close();
    }
  });
});

describe("opening supplier balances", () => {
  it("posts Dr Opening Balance Equity / Cr Payables, settles it, and never produces income or expense", () => {
    const w = world();
    try {
      const r = w.repository;
      // Rs 20,000 owed to the supplier at 31 Mar.
      r.saveOpeningSupplierBalance({ id: "osb1", businessId: w.businessId, supplierId: w.supplierId, asAt: AS_AT, amountPaise: 2_000_000 });
      expect(net(w, "PAYABLES")).toBe(-2_000_000);
      expect(net(w, "OPENING_BALANCE_EQUITY")).toBe(2_000_000); // a DEBIT: equity is reduced
      expect(trialBalanceBalances(w)).toBe(true);
      expect(r.getPayables()).toMatchObject([{ documentType: "OPENING", documentId: "osb1", supplierId: w.supplierId, outstandingPaise: 2_000_000 }]);
      expect(r.getOpenSupplierItems({ businessId: w.businessId })).toEqual([
        {
          documentId: "osb1", kind: "OPENING", date: AS_AT, totalPaise: 2_000_000, settledPaise: 0,
          outstandingPaise: 2_000_000, supplierId: w.supplierId, businessId: w.businessId,
        },
      ]);

      // Rs 5,000 from Cash 10 Apr, Rs 15,000 from Bank 20 May.
      r.recordOpeningBalanceSettlement({ id: "st1", openingSupplierBalanceId: "osb1", amountPaise: 500_000, paidOn: "2025-04-10", paymentAccount: "CASH" });
      expect(r.getPayables()[0]).toMatchObject({ paidPaise: 500_000, outstandingPaise: 1_500_000 });
      expect(() =>
        r.recordOpeningBalanceSettlement({ id: "big", openingSupplierBalanceId: "osb1", amountPaise: 1_500_001, paidOn: "2025-04-11", paymentAccount: "CASH" }),
      ).toThrow(/outstanding|exceeds/i);
      r.recordOpeningBalanceSettlement({ id: "st2", openingSupplierBalanceId: "osb1", amountPaise: 1_500_000, paidOn: "2025-05-20", paymentAccount: "BANK" });
      expect(r.getPayables()).toEqual([]);
      expect(net(w, "PAYABLES")).toBe(0);
      expect(trialBalanceBalances(w)).toBe(true);

      for (const basis of ["CASH", "ACCRUAL"] as const) {
        const pl = r.getProfitAndLoss({ businessId: w.businessId, basis });
        expect(pl.totalIncomePaise, basis).toBe(0);
        expect(pl.totalExpensesPaise, basis).toBe(0);
      }
      const sheet = r.getBalanceSheet({ businessId: w.businessId });
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
      expect(verifyAuditChain(r.db).ok).toBe(true);
    } finally {
      w.repository.close();
    }
  });

  it("refuses duplicates, reverses cleanly, and refuses to reverse once settled against", () => {
    const w = world();
    try {
      const r = w.repository;
      const base = { businessId: w.businessId, supplierId: w.supplierId, asAt: AS_AT, amountPaise: 1_000_000 };
      r.saveOpeningSupplierBalance({ id: "osb1", ...base });
      expect(() => r.saveOpeningSupplierBalance({ id: "osb1", ...base })).toThrow(/already exists/);
      expect(() => r.saveOpeningSupplierBalance({ id: "osb2", ...base })).toThrow(/already has an opening balance/);
      r.reverseOpeningSupplierBalance({ id: "osb1", reversedOn: "2025-04-02" });
      for (const account of ["PAYABLES", "OPENING_BALANCE_EQUITY"]) expect(net(w, account), account).toBe(0);
      expect(trialBalanceBalances(w)).toBe(true);
      expect(r.getPayables()).toEqual([]);
      expect(() => r.reverseOpeningSupplierBalance({ id: "osb1", reversedOn: "2025-04-03" })).toThrow(/already been reversed/);
      r.saveOpeningSupplierBalance({ id: "osb2", ...base });
      r.recordOpeningBalanceSettlement({ id: "st1", openingSupplierBalanceId: "osb2", amountPaise: 1, paidOn: "2025-04-10", paymentAccount: "CASH" });
      expect(() => r.reverseOpeningSupplierBalance({ id: "osb2", reversedOn: "2025-04-11" })).toThrow(/settlement/i);
    } finally {
      w.repository.close();
    }
  });
});

describe("opening sub-ledger API", () => {
  it("saves, lists, receipts and reverses, with validation", async () => {
    const w = world();
    const app = buildApi(w.repository);
    try {
      const { businessId, customerId, supplierId } = w;
      const bad = await app.inject({
        method: "POST", url: "/opening-customer-balances",
        payload: { businessId, customerId, asAt: "31/03/2025", amountPaise: 100, incomePaise: 0 },
      });
      expect(bad.statusCode).toBe(400);
      const over = await app.inject({
        method: "POST", url: "/opening-customer-balances",
        payload: { businessId, customerId, asAt: AS_AT, amountPaise: 100, incomePaise: 200, incomeAccount: "SALES" },
      });
      expect(over.statusCode).toBe(400);

      const created = await app.inject({
        method: "POST", url: "/opening-customer-balances",
        payload: { businessId, customerId, asAt: AS_AT, amountPaise: 4_000_000, incomePaise: 3_000_000, incomeAccount: "SALES" },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json<{ id: string }>();
      expect((await app.inject({ method: "GET", url: "/opening-customer-balances" })).statusCode).toBe(400);
      const listed = (await app.inject({ method: "GET", url: `/opening-customer-balances?businessId=${businessId}` })).json<Array<{ id: string; amountPaise: number; incomePaise: number }>>();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id, amountPaise: 4_000_000, incomePaise: 3_000_000 });

      const badReceipt = await app.inject({ method: "POST", url: `/opening-customer-balances/${id}/receipts`, payload: { amountPaise: 100, receivedOn: "2025-04-10", paymentAccount: "SALES" } });
      expect(badReceipt.statusCode).toBe(400);
      const receipt = await app.inject({ method: "POST", url: `/opening-customer-balances/${id}/receipts`, payload: { amountPaise: 1_000_000, receivedOn: "2025-04-10", paymentAccount: "BANK" } });
      expect(receipt.statusCode).toBe(201);
      const tooMuch = await app.inject({ method: "POST", url: `/opening-customer-balances/${id}/receipts`, payload: { amountPaise: 9_000_000, receivedOn: "2025-04-11", paymentAccount: "CASH" } });
      expect(tooMuch.statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: `/opening-customer-balances/${id}/reverse`, payload: { reversedOn: "2025-04-12" } })).statusCode).toBe(400); // collected against

      const sup = await app.inject({ method: "POST", url: "/opening-supplier-balances", payload: { businessId, supplierId, asAt: AS_AT, amountPaise: 500_000 } });
      expect(sup.statusCode).toBe(201);
      const supId = sup.json<{ id: string }>().id;
      expect((await app.inject({ method: "GET", url: `/opening-supplier-balances?businessId=${businessId}` })).json<unknown[]>()).toHaveLength(1);
      const settle = await app.inject({ method: "POST", url: `/opening-supplier-balances/${supId}/settlements`, payload: { amountPaise: 100_000, paidOn: "2025-04-10", paymentAccount: "CASH" } });
      expect(settle.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `/opening-supplier-balances/${supId}/reverse`, payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: `/opening-supplier-balances/${supId}/reverse`, payload: { reversedOn: "2025-04-12" } })).statusCode).toBe(400); // settled against

      expect((await app.inject({ method: "GET", url: "/reports/receivables" })).json<unknown[]>()).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/reports/payables" })).json<unknown[]>()).toHaveLength(1);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
