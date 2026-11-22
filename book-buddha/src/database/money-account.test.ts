import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildApi } from "../api/server.js";
import type { Invoice, JournalEntry } from "../accounting/types.js";
import { verifyAuditChain } from "./audit-log.js";
import { postJournalEntry } from "./ledger.js";
import { migrations, runMigrations } from "./migrations.js";
import { AccountingRepository } from "./repository.js";
import { buildExport } from "../import-export/exports.js";

/**
 * R12b - every money movement can go through ANY cash or bank account, with a payment mode and a
 * reference. The default stays CASH, so no accepted figure moves.
 *
 * Money is whole PAISE in code, the rupee figure beside it.
 */

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  supplierId: string;
  otherCompanyId: string;
}

const NOW = "2026-01-01T00:00:00.000Z";

function addAccount(repository: AccountingRepository, code: string, companyId: string | null, type: "ASSET" | "LIABILITY", role: string | null, active = 1): void {
  repository.db
    .prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)")
    .run(code, companyId, `${code} account`, type, role, active, NOW, NOW);
}

function world(): World {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const otherCompanyId = repository.createCompany({ name: "Other Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper Co" });
  // Bank accounts inserted by SQL, exactly as 12a would create them.
  addAccount(repository, "HDFC", companyId, "ASSET", "BANK");
  addAccount(repository, "HDFC_OD", companyId, "LIABILITY", "BANK");
  addAccount(repository, "AXIS_OTHER", otherCompanyId, "ASSET", "BANK");
  addAccount(repository, "OLD_BANK", companyId, "ASSET", "BANK", 0);
  return { repository, companyId, businessId, customerId, supplierId, otherCompanyId };
}

/** Debits less credits for one account, straight off the journal. */
function balance(repository: AccountingRepository, account: string): number {
  const row = repository.db
    .prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS b FROM journal_lines WHERE account = ?")
    .get(account) as { b: number };
  return row.b;
}

function ledgerBalances(repository: AccountingRepository): boolean {
  const row = repository.db.prepare("SELECT COALESCE(SUM(debit_paise), 0) AS dr, COALESCE(SUM(credit_paise), 0) AS cr FROM journal_lines").get() as { dr: number; cr: number };
  return row.dr === row.cr;
}

function entryLines(repository: AccountingRepository, entryId: string): Array<{ account: string; debit: number; credit: number }> {
  return (repository.db.prepare("SELECT account, debit_paise, credit_paise FROM journal_lines WHERE journal_entry_id = ? ORDER BY id").all(entryId) as Array<{
    account: string; debit_paise: number; credit_paise: number;
  }>).map((l) => ({ account: l.account, debit: l.debit_paise, credit: l.credit_paise }));
}

function invoice(w: World, id: string, paymentAccount: "CASH" | "RECEIVABLES", totalPaise: number, extra: Record<string, unknown> = {}): Invoice & Record<string, unknown> {
  return {
    id, number: `INV-${id}`, businessId: w.businessId, customerId: w.customerId, invoiceDate: "2025-10-10",
    taxType: "NONE", taxRateBasisPoints: 0, paymentAccount, status: "DRAFT",
    lines: [{ description: "Books", quantity: 1, unitPricePaise: totalPaise }],
    ...extra,
  };
}

/** A finalized credit invoice for Rs 23,600. */
function creditInvoice(w: World, id = "i1", totalPaise = 2_360_000): void {
  w.repository.saveDraft(invoice(w, id, "RECEIVABLES", totalPaise));
  w.repository.finalizeInvoice(id);
}

function creditBill(w: World, totalPaise = 2_000_000): { id: string } {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: "BILL-CR", billDate: "2025-10-05", paymentAccount: "PAYABLES",
    lines: [{ description: "Paper", quantity: 1, unitPricePaise: totalPaise }],
  });
  w.repository.finalizePurchaseBill(bill.id);
  return bill;
}

const HDFC_FIELDS = { moneyAccount: "HDFC", paymentMode: "NEFT", paymentReference: "UTR123" } as const;

describe("R12b money through any cash/bank account", () => {
  it("DEFAULT: a payment with no money account posts Dr CASH exactly as before and stores money_account CASH", () => {
    const w = world();
    try {
      creditInvoice(w);
      const payment = w.repository.recordPayment("i1", 1_000_000, "2025-10-12");
      expect(payment.moneyAccount).toBe("CASH");
      expect(payment.paymentMode).toBeNull();
      expect(payment.paymentReference).toBeNull();
      expect(entryLines(w.repository, `je-payment-${payment.id}`)).toEqual([
        { account: "CASH", debit: 1_000_000, credit: 0 },
        { account: "RECEIVABLES", debit: 0, credit: 1_000_000 },
      ]);
      expect(w.repository.db.prepare("SELECT money_account, payment_account FROM payments WHERE id = ?").get(payment.id)).toEqual({ money_account: "CASH", payment_account: "CASH" });
    } finally { w.repository.close(); }
  });

  it("customer payment of Rs 23,600 into HDFC by NEFT with reference UTR123 posts Dr HDFC / Cr RECEIVABLES and returns the fields", () => {
    const w = world();
    try {
      creditInvoice(w);
      const payment = w.repository.recordPayment("i1", 2_360_000, "2025-10-12", HDFC_FIELDS);
      expect(payment).toMatchObject(HDFC_FIELDS);
      expect(entryLines(w.repository, `je-payment-${payment.id}`)).toEqual([
        { account: "HDFC", debit: 2_360_000, credit: 0 },
        { account: "RECEIVABLES", debit: 0, credit: 2_360_000 },
      ]);
      expect(w.repository.listPayments("i1")[0]).toMatchObject({ moneyAccount: "HDFC", paymentMode: "NEFT", paymentReference: "UTR123" });
      expect(balance(w.repository, "CASH")).toBe(0);
      expect(ledgerBalances(w.repository)).toBe(true);
    } finally { w.repository.close(); }
  });

  it("supplier payment out of HDFC posts Dr PAYABLES / Cr HDFC", () => {
    const w = world();
    try {
      const bill = creditBill(w);
      const payment = w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 2_000_000, paidOn: "2025-10-15", ...HDFC_FIELDS });
      expect(payment).toMatchObject(HDFC_FIELDS);
      expect(entryLines(w.repository, `je-supplier-payment-${payment.id}`)).toEqual([
        { account: "PAYABLES", debit: 2_000_000, credit: 0 },
        { account: "HDFC", debit: 0, credit: 2_000_000 },
      ]);
      expect(w.repository.listSupplierPayments({ billId: bill.id })[0]).toMatchObject(HDFC_FIELDS);
    } finally { w.repository.close(); }
  });

  it("a cash invoice received into HDFC debits HDFC; payment_account stays CASH (paid at once)", () => {
    const w = world();
    try {
      w.repository.saveDraft(invoice(w, "c1", "CASH", 500_000, HDFC_FIELDS));
      expect(w.repository.getInvoice("c1")).toMatchObject({ paymentAccount: "CASH", ...HDFC_FIELDS });
      const entry = w.repository.finalizeInvoice("c1");
      expect(entry.lines[0]).toMatchObject({ account: "HDFC", debitPaise: 500_000 });
      expect(entryLines(w.repository, "je-c1")).toEqual([
        { account: "HDFC", debit: 500_000, credit: 0 },
        { account: "SALES", debit: 0, credit: 500_000 },
      ]);
      expect(w.repository.listInvoices(w.businessId)[0]).toMatchObject({ moneyAccount: "HDFC", paymentAccount: "CASH" });
      // Cancelling reverses onto the SAME account.
      w.repository.cancelInvoice("c1");
      expect(balance(w.repository, "HDFC")).toBe(0);
      expect(balance(w.repository, "CASH")).toBe(0);
    } finally { w.repository.close(); }
  });

  it("a cash bill and a cash expense paid from HDFC credit HDFC", () => {
    const w = world();
    try {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: "B1", billDate: "2025-10-05", paymentAccount: "CASH", ...HDFC_FIELDS,
        lines: [{ description: "Paper", quantity: 1, unitPricePaise: 300_000 }],
      });
      expect(bill).toMatchObject({ paymentAccount: "CASH", ...HDFC_FIELDS });
      w.repository.finalizePurchaseBill(bill.id);
      expect(entryLines(w.repository, `je-bill-${bill.id}`)).toEqual([
        { account: "EXPENSE", debit: 300_000, credit: 0 },
        { account: "HDFC", debit: 0, credit: 300_000 },
      ]);
      const expense = w.repository.createExpense({
        businessId: w.businessId, number: "E1", expenseDate: "2025-10-06", description: "Tea", amountPaise: 40_000, paymentAccount: "CASH", ...HDFC_FIELDS,
      });
      expect(expense).toMatchObject(HDFC_FIELDS);
      w.repository.finalizeExpense(expense.id);
      expect(balance(w.repository, "HDFC")).toBe(-340_000);
      expect(balance(w.repository, "CASH")).toBe(0);
      // Cancelling reverses onto HDFC too.
      w.repository.cancelExpense(expense.id);
      expect(balance(w.repository, "HDFC")).toBe(-300_000);
      expect(w.repository.listPurchaseBills()[0]).toMatchObject({ moneyAccount: "HDFC" });
      expect(w.repository.listExpenses()[0]).toMatchObject({ moneyAccount: "HDFC" });
    } finally { w.repository.close(); }
  });

  it("a credit-note refund, a supplier refund, an opening receipt and an opening settlement can use HDFC", () => {
    const w = world();
    try {
      const r = w.repository;
      // Credit-note refund: a credit invoice that is fully paid, then credited, leaves CUSTOMER_CREDITS to refund.
      creditInvoice(w, "i1", 1_000_000);
      r.recordPayment("i1", 1_000_000, "2025-10-12");
      r.saveCreditNote({ id: "cn1", invoiceId: "i1", number: "CN-1", reason: "Return", status: "DRAFT", noteDate: "2025-10-20", lines: [{ description: "Back", quantity: 1, unitPricePaise: 400_000 }] });
      r.finalizeCreditNote("cn1", { confirmBackdatedMonth: true });
      const refund = r.recordCreditNoteRefund({ id: "rf1", creditNoteId: "cn1", amountPaise: 400_000, refundedOn: "2025-10-25", ...HDFC_FIELDS });
      expect(refund.lines).toContainEqual({ account: "HDFC", debitPaise: 0, creditPaise: 400_000 });
      expect(r.db.prepare("SELECT payment_account, money_account, payment_mode, payment_reference FROM credit_note_refunds WHERE id = 'rf1'").get())
        .toEqual({ payment_account: "BANK", money_account: "HDFC", payment_mode: "NEFT", payment_reference: "UTR123" });

      // Supplier refund: a bill paid, part returned.
      const bill = r.createPurchaseBill({ businessId: w.businessId, supplierId: w.supplierId, number: "B2", billDate: "2025-10-05", paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 10, unitPricePaise: 10_000 }] });
      r.finalizePurchaseBill(bill.id);
      r.recordSupplierPayment({ billId: bill.id, amountPaise: 100_000, paidOn: "2025-10-06" });
      const ret = r.createPurchaseReturn({ billId: bill.id, number: "PR-1", reason: "Damaged", returnDate: "2025-10-10", lines: [{ description: "Paper", quantity: 4, unitPricePaise: 10_000 }] });
      r.finalizePurchaseReturn(ret.id);
      const supplierRefund = r.recordSupplierRefund({ id: "sr1", purchaseReturnId: ret.id, amountPaise: 40_000, refundedOn: "2025-10-11", ...HDFC_FIELDS });
      expect(supplierRefund.lines).toContainEqual({ account: "HDFC", debitPaise: 40_000, creditPaise: 0 });
      expect(r.db.prepare("SELECT payment_account, money_account FROM supplier_refunds WHERE id = 'sr1'").get()).toEqual({ payment_account: "BANK", money_account: "HDFC" });

      // Opening receipt and settlement.
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: "2025-03-31", amountPaise: 500_000, incomePaise: 0 });
      const receipt = r.recordOpeningBalanceReceipt({ id: "rc1", openingCustomerBalanceId: "ocb1", amountPaise: 500_000, receivedOn: "2025-04-10", ...HDFC_FIELDS });
      expect(receipt.lines).toContainEqual({ account: "HDFC", debitPaise: 500_000, creditPaise: 0 });
      r.saveOpeningSupplierBalance({ id: "osb1", businessId: w.businessId, supplierId: w.supplierId, asAt: "2025-03-31", amountPaise: 300_000 });
      const settlement = r.recordOpeningBalanceSettlement({ id: "st1", openingSupplierBalanceId: "osb1", amountPaise: 300_000, paidOn: "2025-04-12", ...HDFC_FIELDS });
      expect(settlement.lines).toContainEqual({ account: "HDFC", debitPaise: 0, creditPaise: 300_000 });
      expect(r.db.prepare("SELECT money_account, payment_mode, payment_reference FROM opening_balance_receipts WHERE id = 'rc1'").get()).toEqual({ money_account: "HDFC", payment_mode: "NEFT", payment_reference: "UTR123" });

      expect(ledgerBalances(r)).toBe(true);
      expect(verifyAuditChain(r.db).ok).toBe(true);
    } finally { w.repository.close(); }
  });

  it("the old paymentAccount BANK alone maps to the seeded BANK; agreeing values pass; disagreeing values are refused", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: "2025-03-31", amountPaise: 900_000, incomePaise: 0 });
      const viaBank = r.recordOpeningBalanceReceipt({ id: "a", openingCustomerBalanceId: "ocb1", amountPaise: 100_000, receivedOn: "2025-04-10", paymentAccount: "BANK" });
      expect(viaBank.lines[0]).toMatchObject({ account: "BANK" });
      const agree = r.recordOpeningBalanceReceipt({ id: "b", openingCustomerBalanceId: "ocb1", amountPaise: 100_000, receivedOn: "2025-04-10", paymentAccount: "BANK", moneyAccount: "BANK" });
      expect(agree.lines[0]).toMatchObject({ account: "BANK" });
      expect(() => r.recordOpeningBalanceReceipt({ id: "c", openingCustomerBalanceId: "ocb1", amountPaise: 100_000, receivedOn: "2025-04-10", paymentAccount: "BANK", moneyAccount: "HDFC" })).toThrow(/disagree/);
    } finally { w.repository.close(); }
  });

  it("REJECTED in the repository: unknown code, RECEIVABLES, another company's bank, an inactive bank, unknown or inactive mode", () => {
    const w = world();
    try {
      const r = w.repository;
      creditInvoice(w);
      const pay = (fields: Record<string, string>) => () => r.recordPayment("i1", 1_000, "2025-10-12", fields);
      expect(pay({ moneyAccount: "NOPE" })).toThrow(/not a cash or bank account/);
      expect(pay({ moneyAccount: "RECEIVABLES" })).toThrow(/not a cash or bank account/);
      expect(pay({ moneyAccount: "AXIS_OTHER" })).toThrow(/not a cash or bank account/);
      expect(pay({ moneyAccount: "OLD_BANK" })).toThrow(/no longer active/);
      expect(pay({ moneyAccount: "HDFC", paymentMode: "CARRIER_PIGEON" })).toThrow(/not a payment mode/);
      r.db.prepare("UPDATE payment_modes SET active = 0 WHERE code = 'OTHER'").run();
      expect(pay({ moneyAccount: "HDFC", paymentMode: "OTHER" })).toThrow(/no longer active/);
      // A credit document has no money account yet.
      expect(() => r.saveDraft(invoice(w, "x", "RECEIVABLES", 1_000, { moneyAccount: "HDFC" }))).toThrow(/paid at once/);
      // Nothing was posted by any refused call.
      expect(r.listPayments("i1")).toHaveLength(0);
      expect(balance(r, "HDFC")).toBe(0);
    } finally { w.repository.close(); }
  });

  it("REJECTED over HTTP with 400, and accepted with 201 carrying the fields", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      creditInvoice(w);
      const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as Record<string, unknown> });
      for (const bad of [
        { moneyAccount: "NOPE" }, { moneyAccount: "RECEIVABLES" }, { moneyAccount: "AXIS_OTHER" }, { moneyAccount: "OLD_BANK" },
        { moneyAccount: "HDFC", paymentMode: "CARRIER_PIGEON" },
      ]) {
        const response = await post("/invoices/i1/payments", { amountPaise: 1_000, ...bad });
        expect(response.statusCode, JSON.stringify(bad)).toBe(400);
      }
      const ok = await post("/invoices/i1/payments", { amountPaise: 1_000, paidOn: "2025-10-12", ...HDFC_FIELDS });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject(HDFC_FIELDS);
      expect((await app.inject({ method: "GET", url: "/invoices/i1/payments" })).json()[0]).toMatchObject(HDFC_FIELDS);

      // Disagreeing paymentAccount / moneyAccount on a refund route.
      w.repository.saveOpeningCustomerBalance({ id: "ocb1", businessId: w.businessId, customerId: w.customerId, asAt: "2025-03-31", amountPaise: 900_000, incomePaise: 0 });
      const disagree = await post("/opening-customer-balances/ocb1/receipts", { amountPaise: 1_000, receivedOn: "2025-04-10", paymentAccount: "CASH", moneyAccount: "HDFC" });
      expect(disagree.statusCode).toBe(400);
      const fine = await post("/opening-customer-balances/ocb1/receipts", { amountPaise: 1_000, receivedOn: "2025-04-10", moneyAccount: "HDFC", paymentMode: "UPI", paymentReference: "UPI-9" });
      expect(fine.statusCode).toBe(201);
      const supplierBill = creditBill(w);
      const sp = await post("/supplier-payments", { billId: supplierBill.id, amountPaise: 5_000, ...HDFC_FIELDS });
      expect(sp.statusCode).toBe(201);
      expect(sp.json()).toMatchObject(HDFC_FIELDS);
      expect((await post("/supplier-payments", { billId: supplierBill.id, amountPaise: 5_000, moneyAccount: "AXIS_OTHER" })).statusCode).toBe(400);
      // Cash invoice, bill and expense through the routes.
      const cashInvoice = await post("/invoices", {
        businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", moneyAccount: "HDFC", paymentMode: "UPI",
        lines: [{ description: "Books", quantity: 1, unitPricePaise: 10_000 }],
      });
      expect(cashInvoice.statusCode).toBe(201);
      expect(cashInvoice.json()).toMatchObject({ moneyAccount: "HDFC", paymentMode: "UPI", paymentReference: null });
      const badInvoice = await post("/invoices", {
        businessId: w.businessId, customerId: w.customerId, paymentAccount: "CASH", moneyAccount: "NOPE",
        lines: [{ description: "Books", quantity: 1, unitPricePaise: 10_000 }],
      });
      expect(badInvoice.statusCode).toBe(400);
      const expense = await post("/expenses", { businessId: w.businessId, number: "E9", description: "Tea", amountPaise: 1_000, paymentAccount: "CASH", moneyAccount: "HDFC" });
      expect(expense.statusCode).toBe(201);
      expect(expense.json()).toMatchObject({ moneyAccount: "HDFC" });
      const bill = await post("/purchase-bills", {
        businessId: w.businessId, supplierId: w.supplierId, number: "B9", paymentAccount: "CASH", moneyAccount: "HDFC", paymentReference: "CHQ 55",
        lines: [{ description: "Paper", quantity: 1, unitPricePaise: 1_000 }],
      });
      expect(bill.statusCode).toBe(201);
      expect(bill.json()).toMatchObject({ moneyAccount: "HDFC", paymentReference: "CHQ 55" });
    } finally { await app.close(); w.repository.close(); }
  });

  it("CASH VIEW: an invoice paid into HDFC gives the SAME cash-basis income, COGS and GST as the same invoice paid into CASH", () => {
    const run = (moneyAccount: string | undefined) => {
      const w = world();
      try {
        const r = w.repository;
        const itemId = r.createItem({ companyId: w.companyId, name: "Novel", unit: "each", trackStock: true });
        const stock = r.createPurchaseBill({ businessId: w.businessId, supplierId: w.supplierId, number: "STK", billDate: "2025-09-01", paymentAccount: "PAYABLES", lines: [{ itemId, description: "Novel", quantity: 10, unitPricePaise: 10_000 }] });
        r.finalizePurchaseBill(stock.id);
        r.saveDraft({
          ...invoice(w, "s1", "CASH", 0), taxType: "CGST_SGST", taxRateBasisPoints: 1800, invoiceDate: "2025-10-10",
          lines: [{ itemId, description: "Novel", quantity: 2, unitPricePaise: 30_000 }],
          ...(moneyAccount === undefined ? {} : { moneyAccount, paymentMode: "UPI" }),
        });
        r.finalizeInvoice("s1");
        const pnl = r.getProfitAndLoss({ businessId: w.businessId, basis: "CASH" });
        const recognitions = r.deriveCashView({ businessId: w.businessId }).recognitions.map((x) => `${x.date}|${x.account}|${x.amountPaise}`).sort();
        return { income: pnl.totalIncomePaise, expenses: pnl.totalExpensesPaise, gst: pnl.gstOnSalesPaise, gross: pnl.grossSalesPaise, recognitions };
      } finally { w.repository.close(); }
    };
    const viaCash = run(undefined);
    const viaBank = run("HDFC");
    expect(viaBank).toEqual(viaCash);
    expect(viaCash.income).toBe(60_000); // Rs 600 of sales
    expect(viaCash.gst).toBeGreaterThan(0);
    expect(viaCash.expenses).toBe(20_000); // COGS of 2 novels at Rs 100
  });

  it("VOUCHER PASS: a MONEY_VOUCHER is cash on its own date; its reversal is negative on ITS date; an INTERNAL_TRANSFER moves no P&L figure", () => {
    const w = world();
    try {
      const r = w.repository;
      const dims = (entryDate: string) => ({ businessId: w.businessId, entryDate });
      const voucher: JournalEntry = {
        id: "je-v1", sourceId: "v1", sourceType: "MONEY_VOUCHER", description: "Interest received", isReversal: false,
        lines: [{ account: "HDFC", debitPaise: 41_200, creditPaise: 0 }, { account: "OTHER_INCOME", debitPaise: 0, creditPaise: 41_200 }],
      };
      postJournalEntry(r.db, voucher, dims("2025-10-20"));
      const income = (basis: "CASH" | "ACCRUAL", fromDate: string, toDate: string) =>
        r.getProfitAndLoss({ businessId: w.businessId, basis, fromDate, toDate }).totalIncomePaise;
      const OCT = ["2025-10-01", "2025-10-31"] as const;
      const NOV = ["2025-11-01", "2025-11-30"] as const;
      expect(income("CASH", ...OCT)).toBe(41_200); // Rs 412
      expect(income("ACCRUAL", ...OCT)).toBe(41_200);

      postJournalEntry(r.db, {
        id: "je-v1-rev", sourceId: "v1", sourceType: "MONEY_VOUCHER", description: "Reversal of interest received", isReversal: true,
        lines: [{ account: "HDFC", debitPaise: 0, creditPaise: 41_200 }, { account: "OTHER_INCOME", debitPaise: 41_200, creditPaise: 0 }],
      }, dims("2025-11-05"));
      expect(income("CASH", ...NOV)).toBe(-41_200);
      expect(income("ACCRUAL", ...NOV)).toBe(-41_200);
      expect(income("CASH", ...OCT)).toBe(41_200); // October did not move

      const figures = () => [OCT, NOV].flatMap((p) => (["CASH", "ACCRUAL"] as const).map((b) => {
        const pnl = r.getProfitAndLoss({ businessId: w.businessId, basis: b, fromDate: p[0], toDate: p[1] });
        return [pnl.totalIncomePaise, pnl.totalExpensesPaise, pnl.netProfitPaise, pnl.gstOnSalesPaise, pnl.grossSalesPaise];
      }));
      const before = figures();
      postJournalEntry(r.db, {
        id: "je-t1", sourceId: "t1", sourceType: "INTERNAL_TRANSFER", description: "Cash to HDFC", isReversal: false,
        lines: [{ account: "HDFC", debitPaise: 1_200_000, creditPaise: 0 }, { account: "CASH", debitPaise: 0, creditPaise: 1_200_000 }],
      }, dims("2025-10-25"));
      expect(figures()).toEqual(before);
      expect(ledgerBalances(r)).toBe(true);
    } finally { w.repository.close(); }
  });

  it("OD AS MONEY ACCOUNT: an LIABILITY/BANK account pays a supplier, its liability rises and the Balance Sheet balances", () => {
    const w = world();
    try {
      const r = w.repository;
      const bill = creditBill(w, 5_000_000);
      r.recordSupplierPayment({ billId: bill.id, amountPaise: 5_000_000, paidOn: "2025-10-15", moneyAccount: "HDFC_OD", paymentMode: "RTGS" });
      expect(balance(r, "HDFC_OD")).toBe(-5_000_000); // a credit: the bank is owed Rs 50,000
      const sheet = r.getBalanceSheet({ businessId: w.businessId });
      expect(sheet.liabilities.find((row) => row.account === "HDFC_OD")?.balancePaise).toBe(5_000_000);
      expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise + sheet.totalEquityPaise);
    } finally { w.repository.close(); }
  });

  it("CANCEL: cancelling a payment made into HDFC reverses Dr/Cr on HDFC, not CASH; a supplier payment likewise", () => {
    const w = world();
    try {
      const r = w.repository;
      creditInvoice(w);
      const payment = r.recordPayment("i1", 2_360_000, "2025-10-12", HDFC_FIELDS);
      const reversal = r.cancelPayment(payment.id, "wrong");
      expect(reversal.lines).toEqual([
        { account: "HDFC", debitPaise: 0, creditPaise: 2_360_000 },
        { account: "RECEIVABLES", debitPaise: 2_360_000, creditPaise: 0 },
      ]);
      expect(balance(r, "HDFC")).toBe(0);
      expect(balance(r, "CASH")).toBe(0);

      const bill = creditBill(w);
      const sp = r.recordSupplierPayment({ billId: bill.id, amountPaise: 100_000, paidOn: "2025-10-15", moneyAccount: "HDFC" });
      const spReversal = r.cancelSupplierPayment(sp.id);
      expect(spReversal.lines).toContainEqual({ account: "HDFC", debitPaise: 100_000, creditPaise: 0 });
      expect(balance(r, "HDFC")).toBe(0);
      expect(balance(r, "CASH")).toBe(0);
      expect(verifyAuditChain(r.db).ok).toBe(true);
    } finally { w.repository.close(); }
  });

  it("a credit note on an invoice paid at once into HDFC goes back out of HDFC, and a bill return comes back into it", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveDraft(invoice(w, "c1", "CASH", 500_000, { moneyAccount: "HDFC" }));
      r.finalizeInvoice("c1");
      r.saveCreditNote({ id: "cn1", invoiceId: "c1", number: "CN-1", reason: "Return", status: "DRAFT", lines: [{ description: "Back", quantity: 1, unitPricePaise: 100_000 }] });
      r.finalizeCreditNote("cn1");
      expect(balance(r, "HDFC")).toBe(400_000);
      expect(balance(r, "CASH")).toBe(0);

      const bill = r.createPurchaseBill({ businessId: w.businessId, supplierId: w.supplierId, number: "B1", billDate: "2025-10-05", paymentAccount: "CASH", moneyAccount: "HDFC", lines: [{ description: "Paper", quantity: 10, unitPricePaise: 10_000 }] });
      r.finalizePurchaseBill(bill.id);
      const ret = r.createPurchaseReturn({ billId: bill.id, number: "PR-1", reason: "Damaged", returnDate: "2025-10-10", lines: [{ description: "Paper", quantity: 2, unitPricePaise: 10_000 }] });
      r.finalizePurchaseReturn(ret.id);
      expect(balance(r, "HDFC")).toBe(400_000 - 100_000 + 20_000);
      expect(balance(r, "CASH")).toBe(0);
      expect(ledgerBalances(r)).toBe(true);
    } finally { w.repository.close(); }
  });

  it("S17 REFUND DEFAULT: with no account named, a refund goes back through the document's original money account; a named one wins", () => {
    const w = world();
    try {
      const r = w.repository;
      // Hand figure: Rs 10,000 credit invoice, paid Rs 6,000 into CASH then Rs 4,000 into HDFC
      // (the latest live payment), Rs 5,000 credit note -> Rs 5,000 owed back to the customer.
      // (A document paid at once has nothing left to refund: its note goes straight out of the bank.)
      creditInvoice(w, "i1", 1_000_000);
      r.recordPayment("i1", 600_000, "2025-10-20");
      r.recordPayment("i1", 400_000, "2025-10-21", { moneyAccount: "HDFC" });
      r.saveCreditNote({ id: "cn2", invoiceId: "i1", number: "CN-2", reason: "Return", status: "DRAFT", lines: [{ description: "Back", quantity: 1, unitPricePaise: 500_000 }] });
      r.finalizeCreditNote("cn2");
      const hdfc = balance(r, "HDFC");
      const cash = balance(r, "CASH");
      r.recordCreditNoteRefund({ id: "rf1", creditNoteId: "cn2", amountPaise: 400_000, refundedOn: "2027-01-01" });
      expect(balance(r, "HDFC")).toBe(hdfc - 400_000); // the BANK, not CASH
      expect(balance(r, "CASH")).toBe(cash);
      r.recordCreditNoteRefund({ id: "rf2", creditNoteId: "cn2", amountPaise: 100_000, refundedOn: "2027-01-01", moneyAccount: "CASH" });
      expect(balance(r, "CASH")).toBe(cash - 100_000); // a named account wins
      expect(ledgerBalances(r)).toBe(true);
    } finally { w.repository.close(); }
  });

  it("S17 EDIT KEEPS MONEY: updating a draft saved with HDFC does not turn it back into CASH; a new choice does", () => {
    const w = world();
    try {
      const r = w.repository;
      r.saveDraft(invoice(w, "d1", "CASH", 500_000, { moneyAccount: "HDFC", paymentMode: "NEFT", paymentReference: "UTR1" }));
      const stored = () => r.db.prepare("SELECT money_account, payment_mode, payment_reference FROM invoices WHERE id = 'd1'").get();
      r.updateDraft(invoice(w, "d1", "CASH", 600_000));
      expect(stored()).toEqual({ money_account: "HDFC", payment_mode: "NEFT", payment_reference: "UTR1" });
      r.updateDraft(invoice(w, "d1", "CASH", 600_000, { moneyAccount: "CASH" }));
      expect(stored()).toMatchObject({ money_account: "CASH" });
      r.updateDraft(invoice(w, "d1", "RECEIVABLES", 600_000));
      expect(stored()).toEqual({ money_account: "CASH", payment_mode: null, payment_reference: null });
    } finally { w.repository.close(); }
  });

  it("exports carry Money account, Payment mode and Reference on payments and supplier payments", () => {
    const w = world();
    try {
      creditInvoice(w);
      w.repository.recordPayment("i1", 1_000, "2025-10-12", HDFC_FIELDS);
      const bill = creditBill(w);
      w.repository.recordSupplierPayment({ billId: bill.id, amountPaise: 1_000, paidOn: "2025-10-12", ...HDFC_FIELDS });
      for (const kind of ["payments", "supplier-payments"] as const) {
        const table = buildExport(w.repository, kind);
        const row = table.rows[0] as string[];
        expect(row[table.columns.indexOf("Money account")]).toBe("HDFC");
        expect(row[table.columns.indexOf("Payment mode")]).toBe("NEFT");
        expect(row[table.columns.indexOf("Reference")]).toBe("UTR123");
      }
    } finally { w.repository.close(); }
  });

  it("MIGRATION v24: a v23 database with payments, a BANK refund and a BANK opening receipt migrates, backfills, and the trial balance is identical", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    try {
      runMigrations(db, migrations.filter((m) => m.version <= 23));
      const columns = (table: string): string[] => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
      expect(columns("payments")).not.toContain("money_account");
      db.exec(`
        INSERT INTO companies (id, name, created_at) VALUES ('co', 'Co', '${NOW}');
        INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu', 'co', 'Cust', '${NOW}');
        INSERT INTO businesses (id, company_id, name, created_at) VALUES ('bu', 'co', 'Biz', '${NOW}');
        INSERT INTO invoices (id, number, business_id, customer_id, invoice_date, status, payment_account, created_at)
          VALUES ('inv', 'INV-1', 'bu', 'cu', '2026-01-05', 'FINALIZED', 'RECEIVABLES', '${NOW}');
        INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at) VALUES ('pay1', 'inv', 12345, 'CASH', '2026-01-06T12:00:00.000Z');
        INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES ('cn', 'inv', 'CN-1', 'r', 'FINALIZED', '${NOW}');
        INSERT INTO credit_note_refunds (id, credit_note_id, amount_paise, refunded_on, payment_account, created_at) VALUES ('rf-bank', 'cn', 500, '2026-01-09', 'BANK', '${NOW}');
        INSERT INTO credit_note_refunds (id, credit_note_id, amount_paise, refunded_on, payment_account, created_at) VALUES ('rf-cash', 'cn', 700, '2026-01-09', 'CASH', '${NOW}');
      `);
      const post = (id: string, lines: Array<[string, number, number]>, source: NonNullable<JournalEntry["sourceType"]> = "INVOICE") =>
        postJournalEntry(db, {
          id, sourceId: "inv", sourceType: source, description: id, isReversal: false,
          lines: lines.map(([account, debitPaise, creditPaise]) => ({ account, debitPaise, creditPaise })),
        }, { businessId: "bu", entryDate: "2026-01-06" });
      post("je-inv", [["RECEIVABLES", 20000, 0], ["SALES", 0, 20000]]);
      post("je-payment-pay1", [["CASH", 12345, 0], ["RECEIVABLES", 0, 12345]]);
      post("je-refund-rf-bank", [["CUSTOMER_CREDITS", 500, 0], ["BANK", 0, 500]]);
      post("je-ob", [["RECEIVABLES", 90000, 0], ["OPENING_BALANCE_EQUITY", 0, 90000]], "OPENING_BALANCE");
      db.exec(`
        INSERT INTO opening_customer_balances (id, business_id, customer_id, as_at, amount_paise, income_paise, journal_entry_id, created_at)
          VALUES ('ocb', 'bu', 'cu', '2025-03-31', 90000, 0, 'je-ob', '${NOW}');
        INSERT INTO opening_balance_receipts (id, opening_customer_balance_id, amount_paise, received_on, payment_account, created_at)
          VALUES ('rc-bank', 'ocb', 1000, '2025-04-10', 'BANK', '${NOW}');
      `);
      const trialBalance = () => db.prepare("SELECT account, SUM(debit_paise) AS dr, SUM(credit_paise) AS cr FROM journal_lines GROUP BY account ORDER BY account").all();
      const before = trialBalance();

      const ran = runMigrations(db, migrations);
      // v24 runs first; later migrations (v25+) may follow it and must not break this test.
      expect(ran[0]).toBe(24);
      expect(ran).toEqual(migrations.filter((m) => m.version >= 24).map((m) => m.version));
      expect(trialBalance()).toEqual(before);

      expect(db.prepare("SELECT money_account, payment_mode, payment_reference FROM payments WHERE id = 'pay1'").get()).toEqual({ money_account: "CASH", payment_mode: null, payment_reference: null });
      expect(db.prepare("SELECT id, money_account, payment_account FROM credit_note_refunds ORDER BY id").all()).toEqual([
        { id: "rf-bank", money_account: "BANK", payment_account: "BANK" },
        { id: "rf-cash", money_account: "CASH", payment_account: "CASH" },
      ]);
      expect(db.prepare("SELECT money_account FROM opening_balance_receipts WHERE id = 'rc-bank'").get()).toEqual({ money_account: "BANK" });
      expect(db.prepare("SELECT money_account FROM invoices WHERE id = 'inv'").get()).toEqual({ money_account: "CASH" });
      // The old column keeps its CHECK and meaning: a credit invoice is still RECEIVABLES.
      expect(db.prepare("SELECT payment_account FROM invoices WHERE id = 'inv'").get()).toEqual({ payment_account: "RECEIVABLES" });

      // The guards.
      expect(() => db.prepare("UPDATE payments SET money_account = 'SALES' WHERE id = 'pay1'").run()).toThrow(/cash or bank/);
      expect(() => db.prepare("UPDATE payments SET payment_mode = 'NOPE' WHERE id = 'pay1'").run()).toThrow(/payment mode/);
      expect(() => db.prepare("INSERT INTO payments (id, invoice_id, amount_paise, payment_account, paid_at, money_account) VALUES ('p2', 'inv', 1, 'CASH', '2026-01-07T12:00:00.000Z', 'RECEIVABLES')").run()).toThrow(/cash or bank/);
      db.prepare("UPDATE payments SET payment_mode = 'UPI', money_account = 'BANK' WHERE id = 'pay1'").run();
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });
});
