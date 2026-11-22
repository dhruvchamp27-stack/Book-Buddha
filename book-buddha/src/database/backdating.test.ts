import { afterEach, describe, expect, it } from "vitest";
import type { Invoice } from "../accounting/types.js";
import { buildApi } from "../api/server.js";
import { createInternalTransfer } from "../banking/internal-transfers.js";
import { addLine, matchLine, transferLine, uncategoriseLine } from "../banking/review-queue.js";
import { insertStatementLine } from "../banking/statement-lines.js";
import { createVoucher } from "../banking/vouchers.js";
import { BACKDATED_MESSAGE, DOCUMENT_IMPORT_KINDS } from "../import-export/import-documents.js";
import type { ImportContext, MappedRow } from "../import-export/import-engine.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * G (rulings Q12, S16-2(d), S17-13(1)): an entry dated in an EARLIER CALENDAR MONTH than "today"
 * needs an explicit `confirmBackdatedMonth: true`. "Today" is the repository's one settable clock,
 * pinned here to 15 March 2026, so nothing in this file depends on the day the suite runs.
 *
 *   OLD  = 10 February 2026  -> an earlier month: refused without the confirm.
 *   SAME = 5 March 2026      -> this month: posts freely.
 *
 * Every door is driven through the same four checks (see `describe.each` below):
 *   1. refused without the confirm, with the exact message, and nothing is posted;
 *   2. posts with the confirm;
 *   3. the same month posts freely;
 *   4. a locked financial year refuses even WITH the confirm (the lock is checked first and is absolute).
 */

const TODAY = "2026-03-15";
const OLD = "2026-02-10";
const SAME = "2026-03-05";
const BASE = "2026-02-01"; // dated before OLD, so a base document never post-dates the dated act under test
const C = { confirmBackdatedMonth: true } as const;

/** The exact wording, for 10 February 2026. */
const refusal = (noun: string, verb: string): string =>
  `This ${noun} is dated 10 February 2026, in a month that has already passed. Posting it will change the figures already reported for February 2026. If that is what you want, confirm and ${verb} it again.`;

interface World {
  readonly repository: AccountingRepository;
  readonly companyId: string;
  readonly businessId: string;
  readonly customerId: string;
  readonly supplierId: string;
  readonly designId: string;
  readonly atlasId: string;
}

const open: AccountingRepository[] = [];
afterEach(() => {
  for (const repository of open.splice(0)) repository.close();
});

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt(TODAY));
  open.push(repository);
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Host School" });
  const supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  const designId = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  const atlasId = repository.createItem({ companyId, name: "Atlas", unit: "each", trackStock: true });
  const now = new Date().toISOString();
  repository.db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, 'ASSET', 'BANK', NULL, 1, ?, ?)",
  ).run("HDFC", companyId, "HDFC Current", now, now);
  repository.db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, 'ASSET', 'BANK', NULL, 1, ?, ?)",
  ).run("SBI", companyId, "SBI Savings", now, now);
  repository.createAccount({ companyId, code: "OFFICE_EXPENSES", name: "Office Expenses", type: "EXPENSE" });
  return { repository, companyId, businessId, customerId, supplierId, designId, atlasId };
}

const entries = (w: World): number =>
  (w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n;

let counter = 0;
const next = (prefix: string): string => `${prefix}-${++counter}`;

/** A finalized receivable invoice, paid in full, with a credit note on it: the whole note is refundable. */
function refundableNote(w: World): string {
  const invoiceId = invoiceOn(w, BASE, "RECEIVABLES");
  w.repository.recordPayment(invoiceId, 100_000, BASE, {}, C);
  return noteOn(w, invoiceId, BASE);
}

/** A finalized invoice (posted with the confirm, so it may be dated before today). */
function invoiceOn(w: World, date: string, paymentAccount: "CASH" | "RECEIVABLES", paise = 100_000): string {
  const id = next("INV");
  const invoice: Invoice = {
    id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: date, status: "DRAFT", paymentAccount,
    taxType: "NONE", taxRateBasisPoints: 0,
    lines: [{ itemId: w.designId, description: "Design", quantity: 1, unitPricePaise: paise }],
  };
  w.repository.saveDraft(invoice);
  w.repository.finalizeInvoice(id, C);
  return id;
}

function noteOn(w: World, invoiceId: string, date: string, paise = 50_000): string {
  const id = next("CN");
  w.repository.saveCreditNote({
    id, invoiceId, number: id, reason: "Returned", status: "DRAFT", noteDate: date,
    lines: [{ itemId: w.designId, description: "Design", quantity: 1, unitPricePaise: paise }],
  });
  w.repository.finalizeCreditNote(id, C);
  return id;
}

function billOn(w: World, date: string, paymentAccount: "CASH" | "PAYABLES", paise = 100_000): string {
  const bill = w.repository.createPurchaseBill({
    businessId: w.businessId, supplierId: w.supplierId, number: next("BILL"), billDate: date, paymentAccount,
    lines: [{ itemId: w.designId, description: "Paper", quantity: 1, unitPricePaise: paise }],
  });
  w.repository.finalizePurchaseBill(bill.id, C);
  return bill.id;
}

function returnOn(w: World, billId: string, date: string, paise = 100_000): string {
  const ret = w.repository.createPurchaseReturn({
    billId, number: next("PR"), reason: "Faulty", returnDate: date,
    lines: [{ itemId: w.designId, description: "Paper", quantity: 1, unitPricePaise: paise }],
  });
  w.repository.finalizePurchaseReturn(ret.id, C);
  return ret.id;
}

const options = (confirm: boolean): { confirmBackdatedMonth?: boolean } => (confirm ? { confirmBackdatedMonth: true } : {});

interface Door {
  readonly name: string;
  readonly noun: string;
  readonly verb: string;
  /** Anything the dated act needs to exist first. Posted at BASE with the confirm. */
  readonly prepare?: (w: World) => unknown;
  readonly run: (w: World, ctx: any, date: string, confirm: boolean) => unknown;
}

const lines = (w: World, paise: number) => [{ itemId: w.designId, description: "Design", quantity: 1, unitPricePaise: paise }];

const DOORS: readonly Door[] = [
  // ---- documents
  {
    name: "invoice (finalize)", noun: "invoice", verb: "finalize",
    run: (w, _ctx, date, confirm) => {
      const id = next("INV");
      w.repository.saveDraft({
        id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: date, status: "DRAFT",
        paymentAccount: "RECEIVABLES", taxType: "NONE", taxRateBasisPoints: 0, lines: lines(w, 10_000),
      });
      w.repository.finalizeInvoice(id, options(confirm));
    },
  },
  {
    name: "credit note (finalize)", noun: "credit note", verb: "finalize",
    prepare: (w) => invoiceOn(w, BASE, "CASH"),
    run: (w, invoiceId: string, date, confirm) => {
      const id = next("CN");
      w.repository.saveCreditNote({ id, invoiceId, number: id, reason: "Returned", status: "DRAFT", noteDate: date, lines: lines(w, 10_000) });
      w.repository.finalizeCreditNote(id, options(confirm));
    },
  },
  {
    name: "purchase bill (finalize)", noun: "purchase bill", verb: "finalize",
    run: (w, _ctx, date, confirm) => {
      const bill = w.repository.createPurchaseBill({
        businessId: w.businessId, supplierId: w.supplierId, number: next("BILL"), billDate: date, paymentAccount: "PAYABLES",
        lines: [{ itemId: w.designId, description: "Paper", quantity: 1, unitPricePaise: 10_000 }],
      });
      w.repository.finalizePurchaseBill(bill.id, options(confirm));
    },
  },
  {
    name: "expense (finalize)", noun: "expense", verb: "finalize",
    run: (w, _ctx, date, confirm) => {
      const expense = w.repository.createExpense({
        businessId: w.businessId, number: next("EXP"), expenseDate: date, description: "Stall rent", amountPaise: 5_000, paymentAccount: "CASH",
      });
      w.repository.finalizeExpense(expense.id, options(confirm));
    },
  },
  {
    name: "purchase return (finalize)", noun: "purchase return", verb: "finalize",
    prepare: (w) => billOn(w, BASE, "PAYABLES"),
    run: (w, billId: string, date, confirm) => {
      const ret = w.repository.createPurchaseReturn({
        billId, number: next("PR"), reason: "Faulty", returnDate: date,
        lines: [{ itemId: w.designId, description: "Paper", quantity: 1, unitPricePaise: 100_000 }],
      });
      w.repository.finalizePurchaseReturn(ret.id, options(confirm));
    },
  },
  // ---- money
  {
    name: "customer payment", noun: "payment", verb: "record",
    prepare: (w) => invoiceOn(w, BASE, "RECEIVABLES"),
    run: (w, invoiceId: string, date, confirm) => {
      w.repository.recordPayment(invoiceId, 1_000, date, {}, options(confirm));
    },
  },
  {
    name: "supplier payment", noun: "payment", verb: "record",
    prepare: (w) => billOn(w, BASE, "PAYABLES"),
    run: (w, billId: string, date, confirm) => {
      w.repository.recordSupplierPayment({ billId, amountPaise: 1_000, paidOn: date, ...options(confirm) });
    },
  },
  {
    name: "credit note refund", noun: "refund", verb: "record",
    prepare: (w) => refundableNote(w),
    run: (w, noteId: string, date, confirm) => {
      w.repository.recordCreditNoteRefund({ id: next("RF"), creditNoteId: noteId, amountPaise: 1_000, refundedOn: date, ...options(confirm) });
    },
  },
  {
    name: "credit application", noun: "credit application", verb: "apply",
    prepare: (w) => ({ noteId: refundableNote(w), targetId: invoiceOn(w, BASE, "RECEIVABLES") }),
    run: (w, ctx: { noteId: string; targetId: string }, date, confirm) => {
      w.repository.applyCreditNote({ id: next("AP"), creditNoteId: ctx.noteId, invoiceId: ctx.targetId, amountPaise: 1_000, appliedOn: date, ...options(confirm) });
    },
  },
  {
    name: "purchase return refund", noun: "refund", verb: "record",
    prepare: (w) => {
      // A payable bill paid in full, then returned: the whole return is owed back in money.
      const billId = billOn(w, BASE, "PAYABLES");
      w.repository.recordSupplierPayment({ billId, amountPaise: 100_000, paidOn: BASE, ...C });
      return returnOn(w, billId, BASE);
    },
    run: (w, returnId: string, date, confirm) => {
      w.repository.recordSupplierRefund({ purchaseReturnId: returnId, amountPaise: 1_000, refundedOn: date, ...options(confirm) });
    },
  },
  // ---- opening balances
  {
    name: "opening balance (save)", noun: "opening balance", verb: "save",
    run: (w, _ctx, date, confirm) => {
      w.repository.saveOpeningBalances({
        id: next("OB"), businessId: w.businessId, asAt: date, ...options(confirm),
        lines: [{ account: "HDFC", debitPaise: 5_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 5_000 }],
      });
    },
  },
  {
    name: "opening customer balance (save)", noun: "opening balance", verb: "save",
    run: (w, _ctx, date, confirm) => {
      w.repository.saveOpeningCustomerBalance({
        id: next("OCB"), businessId: w.businessId, customerId: w.customerId, asAt: date, amountPaise: 5_000, incomePaise: 0, ...options(confirm),
      });
    },
  },
  {
    name: "opening supplier balance (save)", noun: "opening balance", verb: "save",
    run: (w, _ctx, date, confirm) => {
      w.repository.saveOpeningSupplierBalance({
        id: next("OSB"), businessId: w.businessId, supplierId: w.supplierId, asAt: date, amountPaise: 5_000, ...options(confirm),
      });
    },
  },
  {
    name: "opening balance receipt", noun: "receipt", verb: "record",
    prepare: (w) => {
      const id = next("OCB");
      w.repository.saveOpeningCustomerBalance({ id, businessId: w.businessId, customerId: w.customerId, asAt: "2026-01-31", amountPaise: 50_000, incomePaise: 0, ...C });
      return id;
    },
    run: (w, balanceId: string, date, confirm) => {
      w.repository.recordOpeningBalanceReceipt({ id: next("RC"), openingCustomerBalanceId: balanceId, amountPaise: 1_000, receivedOn: date, ...options(confirm) });
    },
  },
  {
    name: "opening balance settlement", noun: "settlement", verb: "record",
    prepare: (w) => {
      const id = next("OSB");
      w.repository.saveOpeningSupplierBalance({ id, businessId: w.businessId, supplierId: w.supplierId, asAt: "2026-01-31", amountPaise: 50_000, ...C });
      return id;
    },
    run: (w, balanceId: string, date, confirm) => {
      w.repository.recordOpeningBalanceSettlement({ id: next("ST"), openingSupplierBalanceId: balanceId, amountPaise: 1_000, paidOn: date, ...options(confirm) });
    },
  },
  {
    name: "opening balance reversal", noun: "reversal", verb: "record",
    prepare: (w) => {
      const id = next("OB");
      w.repository.saveOpeningBalances({
        id, businessId: w.businessId, asAt: "2026-01-31", ...C,
        lines: [{ account: "HDFC", debitPaise: 5_000, creditPaise: 0 }, { account: "CAPITAL", debitPaise: 0, creditPaise: 5_000 }],
      });
      return id;
    },
    run: (w, id: string, date, confirm) => {
      w.repository.reverseOpeningBalances({ id, reversedOn: date, ...options(confirm) });
    },
  },
  {
    name: "opening customer balance reversal", noun: "reversal", verb: "record",
    prepare: (w) => {
      const id = next("OCB");
      w.repository.saveOpeningCustomerBalance({ id, businessId: w.businessId, customerId: w.customerId, asAt: "2026-01-31", amountPaise: 5_000, incomePaise: 0, ...C });
      return id;
    },
    run: (w, id: string, date, confirm) => {
      w.repository.reverseOpeningCustomerBalance({ id, reversedOn: date, ...options(confirm) });
    },
  },
  {
    name: "opening supplier balance reversal", noun: "reversal", verb: "record",
    prepare: (w) => {
      const id = next("OSB");
      w.repository.saveOpeningSupplierBalance({ id, businessId: w.businessId, supplierId: w.supplierId, asAt: "2026-01-31", amountPaise: 5_000, ...C });
      return id;
    },
    run: (w, id: string, date, confirm) => {
      w.repository.reverseOpeningSupplierBalance({ id, reversedOn: date, ...options(confirm) });
    },
  },
  // ---- banking
  {
    name: "receipt voucher", noun: "receipt voucher", verb: "post",
    run: (w, _ctx, date, confirm) => {
      createVoucher(w.repository.db, {
        kind: "RECEIPT", businessId: w.businessId, date, moneyAccount: "HDFC", lines: [{ account: "OTHER_INCOME", amountPaise: 2_000 }], ...options(confirm),
      });
    },
  },
  {
    name: "payment voucher", noun: "payment voucher", verb: "post",
    run: (w, _ctx, date, confirm) => {
      createVoucher(w.repository.db, {
        kind: "PAYMENT", businessId: w.businessId, date, moneyAccount: "HDFC", lines: [{ account: "OFFICE_EXPENSES", amountPaise: 200 }], ...options(confirm),
      });
    },
  },
  {
    name: "internal transfer", noun: "internal transfer", verb: "post",
    run: (w, _ctx, date, confirm) => {
      createInternalTransfer(w.repository.db, {
        businessId: w.businessId, date, fromAccount: "HDFC", toAccount: "SBI", amountPaise: 1_000, ...options(confirm),
      });
    },
  },
  // ---- stock
  {
    name: "stock movement", noun: "stock movement", verb: "record",
    run: (w, _ctx, date, confirm) => {
      w.repository.addStockMovement({
        itemId: w.atlasId, movementType: "OPENING", quantity: 3, unitCostPaise: 5_000, businessId: w.businessId, occurredOn: date, ...options(confirm),
      });
    },
  },
  {
    name: "stock write-down", noun: "stock write-down", verb: "record",
    prepare: (w) => {
      w.repository.addStockMovement({ itemId: w.atlasId, movementType: "OPENING", quantity: 10, unitCostPaise: 5_000, businessId: w.businessId, occurredOn: SAME });
    },
    run: (w, _ctx, date, confirm) => {
      w.repository.writeDownStock({ itemId: w.atlasId, quantity: 1, businessId: w.businessId, occurredOn: date, ...options(confirm) });
    },
  },
  // ---- statement lines (review queue)
  {
    name: "statement line: Add", noun: "payment voucher", verb: "post",
    prepare: (w) => ({}),
    run: (w, _ctx, date, confirm) => {
      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: date, description: "UPI-OFFICE", reference: next("REF"), amountPaise: -2_000, businessId: w.businessId,
      });
      addLine(w.repository, line.id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: 2_000 }], confirm: true, ...options(confirm) });
    },
  },
  {
    name: "statement line: Split", noun: "receipt voucher", verb: "post",
    run: (w, _ctx, date, confirm) => {
      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: date, description: "NEFT-IN", reference: next("REF"), amountPaise: 3_000, businessId: w.businessId,
      });
      addLine(w.repository, line.id, {
        splits: [{ accountCode: "OTHER_INCOME", amountPaise: 2_000 }, { accountCode: "CAPITAL", amountPaise: 1_000 }], confirm: true, ...options(confirm),
      });
    },
  },
  {
    name: "statement line: Uncategorise", noun: "payment voucher", verb: "post",
    run: (w, _ctx, date, confirm) => {
      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: date, description: "UPI-X", reference: next("REF"), amountPaise: -500, businessId: w.businessId,
      });
      uncategoriseLine(w.repository, line.id, { confirm: true, ...options(confirm) });
    },
  },
  {
    name: "statement line: Transfer", noun: "internal transfer", verb: "post",
    run: (w, _ctx, date, confirm) => {
      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: date, description: "TO SBI", reference: next("REF"), amountPaise: -1_500, businessId: w.businessId,
      });
      transferLine(w.repository, line.id, { otherAccountCode: "SBI", confirm: true, ...options(confirm) });
    },
  },
  {
    name: "statement line: Match to an invoice", noun: "payment", verb: "record",
    prepare: (w) => invoiceOn(w, BASE, "RECEIVABLES", 4_000),
    run: (w, invoiceId: string, date, confirm) => {
      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: date, description: "NEFT-RAMAN", reference: next("REF"), amountPaise: 1_000, businessId: w.businessId,
      });
      matchLine(w.repository, line.id, { documents: [{ kind: "INVOICE", id: invoiceId, amountPaise: 1_000 }], confirm: true, ...options(confirm) });
    },
  },
];

describe.each(DOORS.map((door) => [door.name, door] as const))("back-dated month confirm: %s", (_name, door) => {
  it("is refused without the confirm, with the exact message, and posts nothing", () => {
    const w = world();
    const ctx = door.prepare?.(w);
    const before = entries(w);
    let message = "";
    try {
      door.run(w, ctx, OLD, false);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(refusal(door.noun, door.verb));
    expect(entries(w)).toBe(before);
  });

  it("posts when the user confirms", () => {
    const w = world();
    const ctx = door.prepare?.(w);
    const before = entries(w);
    door.run(w, ctx, OLD, true);
    expect(entries(w)).toBeGreaterThan(before);
  });

  it("posts freely when dated in the current month (no confirm)", () => {
    const w = world();
    const ctx = door.prepare?.(w);
    const before = entries(w);
    door.run(w, ctx, SAME, false);
    expect(entries(w)).toBeGreaterThan(before);
  });

  it("a locked financial year refuses even WITH the confirm: the lock is checked first and is absolute", () => {
    const w = world();
    const ctx = door.prepare?.(w);
    const year = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2026-02-01", endsOn: "2026-02-28" });
    w.repository.setFinancialYearLocked(year, true);
    const before = entries(w);
    expect(() => door.run(w, ctx, OLD, true)).toThrow(/locked/);
    // Without the confirm the lock still speaks first.
    expect(() => door.run(w, ctx, OLD, false)).toThrow(/locked/);
    expect(entries(w)).toBe(before);
  });
});

describe("history items are not asked (F posts nothing) and the two confirms are independent", () => {
  // The opening date is 31 January 2026; "today" is 15 March 2026.
  function opened(): World {
    const w = world();
    w.repository.saveOpeningCustomerBalance({
      id: "OCB-H", businessId: w.businessId, customerId: w.customerId, asAt: "2026-01-31", amountPaise: 10_000, incomePaise: 0, ...C,
    });
    return w;
  }
  const HISTORY = "2026-01-20";

  it("an invoice dated before the opening date needs only confirmBeforeOpening, never the back-dated confirm", () => {
    const w = opened();
    const id = next("INV");
    w.repository.saveDraft({
      id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: HISTORY, status: "DRAFT",
      paymentAccount: "RECEIVABLES", taxType: "NONE", taxRateBasisPoints: 0, lines: lines(w, 10_000),
    });
    const before = entries(w);
    // Not confirmed as history: the history wording, NOT the back-dated one.
    expect(() => w.repository.finalizeInvoice(id)).toThrow(/on or before your opening date/);
    const result = w.repository.finalizeInvoice(id, { confirmBeforeOpening: true });
    expect(result.lines).toEqual([]);
    expect(entries(w)).toBe(before);
  });

  it("a bill and an expense dated before the opening date are kept as history without the back-dated confirm", () => {
    const w = opened();
    const bill = w.repository.createPurchaseBill({
      businessId: w.businessId, supplierId: w.supplierId, number: next("BILL"), billDate: HISTORY, paymentAccount: "PAYABLES",
      lines: [{ itemId: w.designId, description: "Paper", quantity: 1, unitPricePaise: 10_000 }],
    });
    const expense = w.repository.createExpense({
      businessId: w.businessId, number: next("EXP"), expenseDate: HISTORY, description: "Rent", amountPaise: 5_000, paymentAccount: "CASH",
    });
    const before = entries(w);
    w.repository.finalizePurchaseBill(bill.id, { confirmBeforeOpening: true });
    w.repository.finalizeExpense(expense.id, { confirmBeforeOpening: true });
    expect(entries(w)).toBe(before);
  });

  it("a document dated AFTER the opening date but in an earlier month still needs the back-dated confirm; the two flags are independent", () => {
    const w = opened();
    const id = next("INV");
    w.repository.saveDraft({
      id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate: OLD, status: "DRAFT",
      paymentAccount: "RECEIVABLES", taxType: "NONE", taxRateBasisPoints: 0, lines: lines(w, 10_000),
    });
    // confirmBeforeOpening does not stand in for the back-dated confirm...
    expect(() => w.repository.finalizeInvoice(id, { confirmBeforeOpening: true })).toThrow(/in a month that has already passed/);
    // ...and the back-dated confirm posts it.
    const before = entries(w);
    w.repository.finalizeInvoice(id, C);
    expect(entries(w)).toBeGreaterThan(before);
  });
});

describe("cancellations are never back-dated", () => {
  it("a reversal is dated today, so cancelling an old document needs no confirm", () => {
    const w = world();
    const invoiceId = invoiceOn(w, OLD, "RECEIVABLES");
    const before = entries(w);
    w.repository.cancelInvoice(invoiceId);
    expect(entries(w)).toBeGreaterThan(before);
    const reversalDate = (w.repository.db.prepare("SELECT entry_date FROM journal_entries WHERE is_reversal = 1").get() as { entry_date: string }).entry_date;
    expect(reversalDate).toBe(TODAY);
  });
});

describe("the one clock", () => {
  it("a defaulted document date is today from the clock, and buildApi can set the clock", async () => {
    const repository = new AccountingRepository(":memory:"); // the REAL clock...
    open.push(repository);
    const app = buildApi(repository, { __unsafeDisableAuthForTests: true, today: () => TODAY }); // ...set through buildApi
    try {
      expect(repository.today()).toBe(TODAY);
      const companyId = (await app.inject({ method: "POST", url: "/companies", payload: { name: "Co" } })).json<{ id: string }>().id;
      const businessId = (await app.inject({ method: "POST", url: "/businesses", payload: { companyId, name: "B" } })).json<{ id: string }>().id;
      const customerId = (await app.inject({ method: "POST", url: "/customers", payload: { companyId, name: "C" } })).json<{ id: string }>().id;
      const itemId = (await app.inject({ method: "POST", url: "/items", payload: { companyId, name: "I", unit: "each", trackStock: false } })).json<{ id: string }>().id;
      const created = await app.inject({
        method: "POST", url: "/invoices",
        payload: { businessId, customerId, paymentAccount: "RECEIVABLES", lines: [{ itemId, description: "Book", quantity: 1, unitPricePaise: 1000 }] },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json<{ invoiceDate: string }>().invoiceDate).toBe(TODAY);
    } finally {
      await app.close();
    }
  });
});

describe("over HTTP", () => {
  it("POST /invoices/:id/finalize answers 400 for a back-dated invoice, then 200 with confirmBackdatedMonth", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const created = await app.inject({
        method: "POST", url: "/invoices",
        payload: {
          businessId: w.businessId, customerId: w.customerId, paymentAccount: "RECEIVABLES", invoiceDate: OLD,
          lines: [{ itemId: w.designId, description: "Design", quantity: 1, unitPricePaise: 10_000 }],
        },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;
      const refused = await app.inject({ method: "POST", url: `/invoices/${id}/finalize`, payload: {} });
      expect(refused.statusCode).toBe(400);
      expect(refused.json<{ error: string }>().error).toBe(refusal("invoice", "finalize"));
      const confirmed = await app.inject({ method: "POST", url: `/invoices/${id}/finalize`, payload: { confirmBackdatedMonth: true } });
      expect(confirmed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("payments, supplier payments and bank-feed Add accept confirmBackdatedMonth on the wire", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const invoiceId = invoiceOn(w, BASE, "RECEIVABLES");
      const billId = billOn(w, BASE, "PAYABLES");
      const refusedPayment = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/payments`, payload: { amountPaise: 1_000, paidOn: OLD } });
      expect(refusedPayment.statusCode).toBe(400);
      expect(refusedPayment.json<{ error: string }>().error).toBe(refusal("payment", "record"));
      expect((await app.inject({ method: "POST", url: `/invoices/${invoiceId}/payments`, payload: { amountPaise: 1_000, paidOn: OLD, confirmBackdatedMonth: true } })).statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: "/supplier-payments", payload: { billId, amountPaise: 1_000, paidOn: OLD } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: "/supplier-payments", payload: { billId, amountPaise: 1_000, paidOn: OLD, confirmBackdatedMonth: true } })).statusCode).toBe(201);

      const line = insertStatementLine(w.repository.db, {
        companyId: w.companyId, accountCode: "HDFC", txnDate: OLD, description: "UPI-OFFICE", reference: "REF-H", amountPaise: -2_000, businessId: w.businessId,
      });
      const add = (extra: object) => app.inject({
        method: "POST", url: `/bank-feed/lines/${line.id}/add`,
        payload: { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: 2_000 }], confirm: true, ...extra },
      });
      expect((await add({})).statusCode).toBe(400);
      expect((await add({ confirmBackdatedMonth: true })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe("imports", () => {
  const kind = DOCUMENT_IMPORT_KINDS.find((k) => k.kind === "invoices");
  const row = (rowNumber: number, number: string, date: string): MappedRow => ({
    rowNumber,
    values: { number, invoiceDate: date, customer: "Host School", description: "Design", quantity: "1", unitPrice: "100" },
  });

  it("flags a back-dated row in the preview path, posts it on commit, and leaves a current-month row unflagged", () => {
    const w = world();
    if (kind === undefined) throw new Error("no invoices kind");
    const context: ImportContext = { repository: w.repository, companyId: w.companyId, businessId: w.businessId, dateFormat: "YYYY-MM-DD" };
    const run = (r: MappedRow) => w.repository.db.transaction(() => kind.post(context, [r]))();
    const old = run(row(2, "IMP-OLD", OLD));
    const same = run(row(3, "IMP-SAME", SAME));
    expect(old).toMatchObject({ status: "CREATED", message: BACKDATED_MESSAGE });
    expect(same.status).toBe("CREATED");
    expect(same.message).toBeUndefined();
    // Both rows were actually posted (committing the previewed file is the confirmation).
    expect(w.repository.listInvoices(w.businessId).map((i) => [i.number, i.status])).toEqual(
      expect.arrayContaining([["IMP-OLD", "FINALIZED"], ["IMP-SAME", "FINALIZED"]]),
    );
  });

  it("a history row (on or before the opening date) is flagged as history, not as back-dated", () => {
    const w = world();
    w.repository.saveOpeningCustomerBalance({
      id: "OCB-I", businessId: w.businessId, customerId: w.customerId, asAt: "2026-01-31", amountPaise: 10_000, incomePaise: 0, ...C,
    });
    if (kind === undefined) throw new Error("no invoices kind");
    const context: ImportContext = { repository: w.repository, companyId: w.companyId, businessId: w.businessId, dateFormat: "YYYY-MM-DD" };
    const outcome = w.repository.db.transaction(() => kind.post(context, [row(2, "IMP-HIST", "2026-01-20")]))();
    expect(outcome.message).toBe("kept as history (before opening date)");
  });

  it("POST /imports/commit counts the back-dated rows in its result", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      const csv = ["Number,Date,Customer,Description,Qty,Price", `IMP-A,${OLD},Host School,Design,1,100`, `IMP-B,${SAME},Host School,Design,1,100`].join("\n");
      const body = {
        kind: "invoices", fileName: "inv.csv", contentBase64: Buffer.from(csv).toString("base64"), companyId: w.companyId, businessId: w.businessId,
        dateFormat: "YYYY-MM-DD",
        columnMap: { number: "Number", invoiceDate: "Date", customer: "Customer", description: "Description", quantity: "Qty", unitPrice: "Price" },
      };
      const preview = await app.inject({ method: "POST", url: "/imports/preview", payload: body });
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ created: 2, failed: 0, backdated: 1 });
      expect(w.repository.listInvoices(w.businessId)).toHaveLength(0); // a preview posts nothing
      const commit = await app.inject({ method: "POST", url: "/imports/commit", payload: body });
      expect(commit.statusCode).toBe(200);
      expect(commit.json()).toMatchObject({ created: 2, failed: 0, backdated: 1 });
      expect(w.repository.listInvoices(w.businessId)).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
