import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Invoice } from "../accounting/types.js";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository } from "../database/repository.js";
import {
  addLine, excludeLine, findMatches, listReviewQueue, matchLine, transferLine, uncategoriseLine, undoLine, updateLine,
  type ConfirmedResult, type PreviewResult, type ReviewResult,
} from "./review-queue.js";
import { createInternalTransfer } from "./internal-transfers.js";
import { finishReconciliation, setTicked, startReconciliation } from "./reconciliation.js";
import { getStatementLine, insertStatementLine, linksOfLine } from "./statement-lines.js";
import { getVoucher } from "./vouchers.js";

/** R12 12f. Figures are PAISE; the rupee figure is in the helper RS(). A line is + money IN, - money OUT. */
const RS = (rupees: number): number => rupees * 100;

let r: AccountingRepository;
let companyX: string;
let companyY: string;
let bizX: string;
let bizY: string;
let bizX2: string;

beforeEach(() => {
  r = new AccountingRepository();
  companyX = r.createCompany({ name: "X Co", accountingBasis: "ACCRUAL" });
  companyY = r.createCompany({ name: "Y Co", accountingBasis: "ACCRUAL" });
  bizX = r.createBusiness({ companyId: companyX, name: "X Biz" });
  bizX2 = r.createBusiness({ companyId: companyX, name: "X Biz Two" });
  bizY = r.createBusiness({ companyId: companyY, name: "Y Biz" });
  const now = new Date().toISOString();
  const insert = r.db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, ?, ?, 'ASSET', 'BANK', NULL, 1, ?, ?)",
  );
  insert.run("HDFC", companyX, "HDFC Current", now, now);
  insert.run("SBI", companyX, "SBI Savings", now, now);
  r.createAccount({ companyId: companyX, code: "OFFICE_EXPENSES", name: "Office Expenses", type: "EXPENSE" });
});
afterEach(() => r.close());

const db = (): AccountingRepository["db"] => r.db;
const count = (table: string): number => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const balance = (account: string): number =>
  (db().prepare("SELECT COALESCE(SUM(debit_paise - credit_paise), 0) AS b FROM journal_lines WHERE account = ?").get(account) as { b: number }).b;

/** Every counter that a preview must leave alone. */
function snapshot(lineId: string): Record<string, unknown> {
  return {
    journal_lines: count("journal_lines"), journal_entries: count("journal_entries"), vouchers: count("vouchers"),
    internal_transfers: count("internal_transfers"), payments: count("payments"), supplier_payments: count("supplier_payments"),
    links: count("bank_statement_line_links"), audit: count("audit_events"), status: getStatementLine(db(), lineId).status,
  };
}

function seed(over: { amount: number; date?: string; ref?: string | null; desc?: string; biz?: string | null; company?: string; account?: string }): string {
  return insertStatementLine(db(), {
    companyId: over.company ?? companyX, accountCode: over.account ?? "HDFC", txnDate: over.date ?? "2025-10-20",
    description: over.desc ?? "UPI-OFFICE SUPPLIES", reference: over.ref === undefined ? "UPI-123" : over.ref,
    amountPaise: over.amount, businessId: over.biz === undefined ? bizX : over.biz,
  }).id;
}

const confirmed = (x: ReviewResult): ConfirmedResult => {
  expect(x.confirmed).toBe(true);
  return x as ConfirmedResult;
};
const preview = (x: ReviewResult): PreviewResult => {
  expect(x.confirmed).toBe(false);
  return x as PreviewResult;
};
const refusal = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
};

function customerInvoice(id: string, number: string, rupees: number, biz = bizX, company = companyX, date = "2025-10-02"): string {
  const customerId = r.createCustomer({ companyId: company, name: "Raman Books" });
  const invoice: Invoice = {
    id, number, businessId: biz, customerId, invoiceDate: date, status: "DRAFT", paymentAccount: "RECEIVABLES",
    lines: [{ description: "Books", quantity: 1, unitPricePaise: RS(rupees) }],
  };
  r.saveDraft(invoice);
  r.finalizeInvoice(id);
  return id;
}
function supplierBill(number: string, rupees: number, biz = bizX): string {
  const supplierId = r.createSupplier({ companyId: companyX, name: "Paper Co" });
  const bill = r.createPurchaseBill({ businessId: biz, supplierId, number, billDate: "2025-10-10", paymentAccount: "PAYABLES", lines: [{ description: "Paper", quantity: 1, unitPricePaise: RS(rupees) }] });
  r.finalizePurchaseBill(bill.id);
  return bill.id;
}
const receivable = (): number => r.getReceivables().reduce((s, x) => s + x.outstandingPaise, 0);
const payable = (): number => r.getPayables().reduce((s, x) => s + x.outstandingPaise, 0);

describe("12f review queue: Add, Uncategorise, Transfer", () => {
  it("1. Add -1,180 split 1,000 + 180 GST: preview shows the entry and writes nothing; confirm posts PV-001/25-26", () => {
    const id = seed({ amount: -RS(1_180) });
    const input = { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_000) }, { accountCode: "INPUT_CGST", amountPaise: RS(180) }], partyName: "Office Mart" };
    const before = snapshot(id);
    const p = preview(addLine(r, id, { ...input, confirm: false }));
    expect(p.willPost).toHaveLength(1);
    expect(p.willPost[0]!.entryDate).toBe("2025-10-20");
    expect(p.willPost[0]!.lines.map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["HDFC", 0, RS(1_180)], ["OFFICE_EXPENSES", RS(1_000), 0], ["INPUT_CGST", RS(180), 0]]);
    expect(p.willPost[0]!.lines[0]!.accountName).toBe("HDFC Current");
    expect(snapshot(id)).toEqual(before);

    const done = confirmed(addLine(r, id, { ...input, confirm: true }));
    expect(done.line.status).toBe("ADDED");
    expect(done.links).toHaveLength(1);
    expect(done.links[0]).toMatchObject({ linkKind: "VOUCHER", postedByFeed: true });
    const voucher = getVoucher(db(), done.links[0]!.documentId!);
    expect(voucher).toMatchObject({ number: "PV-001/25-26", voucherDate: "2025-10-20", paymentReference: "UPI-123", kind: "PAYMENT", status: "POSTED" });
    const hdfcLine = db().prepare("SELECT id, account FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(voucher.journalEntryId) as { id: number };
    expect(done.links[0]!.journalLineId).toBe(hdfcLine.id);
    expect(balance("HDFC")).toBe(-RS(1_180));
    expect(balance("OFFICE_EXPENSES")).toBe(RS(1_000));
  });

  it("2. Add +412 to OTHER_INCOME: RV-001/25-26, HDFC +412, accrual income +412", () => {
    const id = seed({ amount: RS(412), desc: "INT CREDIT", ref: null });
    confirmed(addLine(r, id, { splits: [{ accountCode: "OTHER_INCOME", amountPaise: RS(412) }], confirm: true }));
    const link = linksOfLine(db(), id)[0]!;
    expect(getVoucher(db(), link.documentId!)).toMatchObject({ number: "RV-001/25-26", kind: "RECEIPT" });
    expect(balance("HDFC")).toBe(RS(412));
    const income = r.getProfitAndLoss({ basis: "ACCRUAL" }).income.find((x) => x.account === "OTHER_INCOME");
    expect(Math.abs(income!.balancePaise)).toBe(RS(412));
  });

  it("3. refusals: splits that do not add up (names both), no business, already ADDED, RECEIVABLES and CASH splits", () => {
    const id = seed({ amount: -RS(1_180) });
    const msg = refusal(() => addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_000) }, { accountCode: "INPUT_CGST", amountPaise: RS(100) }], confirm: true }));
    expect(msg).toContain("Rs 1,100");
    expect(msg).toContain("Rs 1,180");
    const noBiz = seed({ amount: -RS(500), biz: null });
    expect(refusal(() => addLine(r, noBiz, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(500) }], confirm: true }))).toBe("Choose a business for this line first.");
    const otherCompanyBiz = seed({ amount: -RS(500), biz: bizY });
    expect(refusal(() => addLine(r, otherCompanyBiz, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(500) }], confirm: false }))).toContain("another company");
    expect(refusal(() => addLine(r, id, { splits: [{ accountCode: "RECEIVABLES", amountPaise: RS(1_180) }], confirm: true }))).toContain("RECEIVABLES");
    expect(refusal(() => addLine(r, id, { splits: [{ accountCode: "CASH", amountPaise: RS(1_180) }], confirm: true }))).toContain("CASH");
    expect(count("vouchers")).toBe(0);
    confirmed(addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true }));
    expect(refusal(() => addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true }))).toContain("ADDED");
    expect(count("vouchers")).toBe(1);
  });

  it("4. Uncategorise: -500 to UNCATEGORIZED, +700 to UNCATEGORIZED_INCOME (preview first, nothing written)", () => {
    const out = seed({ amount: -RS(500) });
    const inn = seed({ amount: RS(700), desc: "UNKNOWN CREDIT" });
    const before = snapshot(out);
    expect(preview(uncategoriseLine(r, out, { confirm: false })).willPost[0]!.lines.map((l) => l.account)).toContain("UNCATEGORIZED");
    expect(snapshot(out)).toEqual(before);
    confirmed(uncategoriseLine(r, out, { confirm: true }));
    confirmed(uncategoriseLine(r, inn, { confirm: true }));
    expect(balance("UNCATEGORIZED")).toBe(RS(500));
    expect(balance("UNCATEGORIZED_INCOME")).toBe(-RS(700));
    expect(getStatementLine(db(), out).status).toBe("ADDED");
  });

  it("5. Transfer: -12,000 to CASH -> TRF HDFC to CASH; +5,000 with SBI -> TRF SBI to HDFC", () => {
    const out = seed({ amount: -RS(12_000), desc: "CASH WITHDRAWAL", ref: null });
    const before = snapshot(out);
    preview(transferLine(r, out, { otherAccountCode: "CASH", confirm: false }));
    expect(snapshot(out)).toEqual(before);
    const done = confirmed(transferLine(r, out, { otherAccountCode: "CASH", confirm: true }));
    expect(done.line.status).toBe("TRANSFERRED");
    expect(done.links[0]).toMatchObject({ linkKind: "INTERNAL_TRANSFER", postedByFeed: true });
    expect(balance("CASH")).toBe(RS(12_000));
    expect(balance("HDFC")).toBe(-RS(12_000));
    const inn = seed({ amount: RS(5_000), desc: "FROM SBI", ref: null, date: "2025-10-22" });
    confirmed(transferLine(r, inn, { otherAccountCode: "SBI", confirm: true }));
    expect(balance("SBI")).toBe(-RS(5_000));
    expect(balance("HDFC")).toBe(-RS(7_000));
    const t = db().prepare("SELECT number, from_account, to_account FROM internal_transfers ORDER BY rowid DESC LIMIT 1").get() as { number: string; from_account: string; to_account: string };
    expect(t).toMatchObject({ number: "TRF-002/25-26", from_account: "SBI", to_account: "HDFC" });
    expect(refusal(() => transferLine(r, seed({ amount: -RS(1) }), { otherAccountCode: "OFFICE_EXPENSES", confirm: true }))).toContain("not a cash or bank account");
  });
});

describe("12f review queue: Match", () => {
  it("6. match an invoice: listed first, preview writes nothing, confirm posts a payment of 23,600 into HDFC", () => {
    customerInvoice("inv-a", "INV-001", 23_600);
    customerInvoice("inv-big", "INV-009", 99_000);
    const id = seed({ amount: RS(23_600), date: "2025-10-08", ref: "UTR123", desc: "NEFT CR-RAMAN BOOKS" });
    const m = findMatches(r, id);
    expect(m.documents[0]).toMatchObject({ id: "inv-a", number: "INV-001", outstandingPaise: RS(23_600), partyName: "Raman Books", businessId: bizX });
    expect(m.documents.map((d) => d.id)).toEqual(["inv-a", "inv-big"]);

    const before = snapshot(id);
    const doc = [{ kind: "INVOICE" as const, id: "inv-a", amountPaise: RS(23_600) }];
    const p = preview(matchLine(r, id, { documents: doc, paymentMode: "NEFT", confirm: false }));
    expect(p.willPost[0]!.lines.map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["HDFC", RS(23_600), 0], ["RECEIVABLES", 0, RS(23_600)]]);
    expect(snapshot(id)).toEqual(before);
    expect(receivable()).toBe(RS(23_600) + RS(99_000));

    const done = confirmed(matchLine(r, id, { documents: doc, paymentMode: "NEFT", confirm: true }));
    expect(done.line.status).toBe("MATCHED");
    expect(done.links[0]).toMatchObject({ linkKind: "PAYMENT", postedByFeed: true });
    const payment = r.listPayments("inv-a")[0]!;
    expect(payment).toMatchObject({ amountPaise: RS(23_600), moneyAccount: "HDFC", paymentMode: "NEFT", paymentReference: "UTR123" });
    const entry = db().prepare("SELECT entry_date FROM journal_entries WHERE id = ?").get(`je-payment-${payment.id}`) as { entry_date: string };
    expect(entry.entry_date).toBe("2025-10-08");
    expect(receivable()).toBe(RS(99_000));
    expect(balance("HDFC")).toBe(RS(23_600));
  });

  it("7. several invoices: 23,600 + 6,400 -> two payments; refusals name the figures", () => {
    customerInvoice("inv-a", "INV-001", 23_600);
    customerInvoice("inv-b", "INV-002", 10_000);
    const id = seed({ amount: RS(30_000), date: "2025-10-09", ref: null, desc: "NEFT CR" });
    const docs = (a: number, b: number) => [{ kind: "INVOICE" as const, id: "inv-a", amountPaise: RS(a) }, { kind: "INVOICE" as const, id: "inv-b", amountPaise: RS(b) }];
    expect(refusal(() => matchLine(r, id, { documents: docs(23_600, 7_000), confirm: true }))).toContain("Rs 30,600");
    expect(refusal(() => matchLine(r, id, { documents: docs(24_000, 6_000), confirm: true }))).toContain("Rs 23,600");
    expect(refusal(() => matchLine(r, id, { documents: docs(20_000, 6_000), confirm: true }))).toMatch(/Rs 26,000.*Rs 30,000/);
    expect(refusal(() => matchLine(r, id, { documents: [{ kind: "BILL", id: "x", amountPaise: RS(30_000) }], confirm: true }))).toContain("invoices");
    const single = seed({ amount: RS(25_000), date: "2025-10-09", ref: null, desc: "NEFT CR OVER" });
    expect(refusal(() => matchLine(r, single, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(23_600) }], confirm: true }))).toMatch(/Over-payment/);
    expect(refusal(() => matchLine(r, single, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(25_000) }], confirm: true }))).toContain("Rs 23,600");
    expect(count("payments")).toBe(0);

    const done = confirmed(matchLine(r, id, { documents: docs(23_600, 6_400), confirm: true }));
    expect(done.links).toHaveLength(2);
    expect(count("payments")).toBe(2);
    expect(receivable()).toBe(RS(3_600));
    expect(getStatementLine(db(), id).status).toBe("MATCHED");
  });

  it("7b. documents of two businesses cannot share one line; an invoice cannot take money out", () => {
    customerInvoice("inv-a", "INV-001", 1_000, bizX);
    customerInvoice("inv-b", "INV-002", 500, bizX2);
    const id = seed({ amount: RS(1_500), date: "2025-10-09", ref: null, desc: "NEFT CR" });
    expect(refusal(() => matchLine(r, id, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(1_000) }, { kind: "INVOICE", id: "inv-b", amountPaise: RS(500) }], confirm: true }))).toContain("same business");
    const out = seed({ amount: -RS(1_000), date: "2025-10-09", ref: null, desc: "PAID" });
    expect(refusal(() => matchLine(r, out, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(1_000) }], confirm: true }))).toContain("bills");
    expect(refusal(() => matchLine(r, out, {}))).toContain("exactly one list");
    expect(refusal(() => matchLine(r, out, { documents: [], journalLineIds: [] }))).toContain("exactly one list");
    expect(count("payments")).toBe(0);
  });

  it("8. match a bill: -18,000 pays the supplier bill from HDFC", () => {
    const billId = supplierBill("PB-001", 18_000);
    const id = seed({ amount: -RS(18_000), date: "2025-10-15", ref: "CHQ 000451", desc: "CHQ PAID PAPER CO" });
    const m = findMatches(r, id);
    expect(m.documents[0]).toMatchObject({ kind: "BILL", id: billId, partyName: "Paper Co", outstandingPaise: RS(18_000) });
    const before = snapshot(id);
    preview(matchLine(r, id, { documents: [{ kind: "BILL", id: billId, amountPaise: RS(18_000) }], confirm: false }));
    expect(snapshot(id)).toEqual(before);
    const done = confirmed(matchLine(r, id, { documents: [{ kind: "BILL", id: billId, amountPaise: RS(18_000) }], paymentMode: "CHEQUE", confirm: true }));
    expect(done.links[0]).toMatchObject({ linkKind: "SUPPLIER_PAYMENT", postedByFeed: true });
    expect(payable()).toBe(0);
    expect(balance("HDFC")).toBe(-RS(18_000));
    expect(r.listSupplierPayments({ billId })[0]).toMatchObject({ moneyAccount: "HDFC", paymentReference: "CHQ 000451" });
  });

  it("9. match an existing posted line: link only, nothing posted; once only; cancelled and wrong ones refused; transfer -> TRANSFERRED", () => {
    customerInvoice("inv-b", "INV-002", 5_900, bizX, companyX, "2025-10-25");
    const payment = r.recordPayment("inv-b", RS(5_900), "2025-10-28", { moneyAccount: "HDFC", paymentMode: "CHEQUE", paymentReference: "CHQ 778812" });
    const jl = (db().prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(`je-payment-${payment.id}`) as { id: number }).id;
    const id = seed({ amount: RS(5_900), date: "2025-11-02", ref: "CHQ 778812", desc: "CHQ DEP CLEARED" });
    const m = findMatches(r, id);
    expect(m.postedLines.map((p) => p.journalLineId)).toEqual([jl]);

    const wrongAmount = seed({ amount: RS(5_800), date: "2025-11-02", desc: "X" });
    expect(refusal(() => matchLine(r, wrongAmount, { journalLineIds: [jl] }))).toContain("Rs 5,900");
    const wrongDirection = seed({ amount: -RS(5_900), date: "2025-11-02", desc: "Y" });
    expect(refusal(() => matchLine(r, wrongDirection, { journalLineIds: [jl] }))).toContain("cannot be matched");

    const journalBefore = count("journal_lines");
    const auditBefore = count("audit_events");
    const done = confirmed(matchLine(r, id, { journalLineIds: [jl] }));
    expect(done.line.status).toBe("MATCHED");
    expect(done.links[0]).toMatchObject({ linkKind: "EXISTING", postedByFeed: false, documentId: null });
    expect(count("journal_lines")).toBe(journalBefore);
    expect(count("payments")).toBe(1);
    expect(count("audit_events")).toBe(auditBefore + 1);

    const second = seed({ amount: RS(5_900), date: "2025-11-03", desc: "AGAIN" });
    expect(refusal(() => matchLine(r, second, { journalLineIds: [jl] }))).toContain("already matched");
    expect(findMatches(r, second).postedLines).toEqual([]);

    // A cancelled payment is neither offered nor accepted.
    customerInvoice("inv-c", "INV-003", 700, bizX, companyX, "2025-10-25");
    const p2 = r.recordPayment("inv-c", RS(700), "2025-10-29", { moneyAccount: "HDFC" });
    const jl2 = (db().prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(`je-payment-${p2.id}`) as { id: number }).id;
    r.cancelPayment(p2.id, "wrong customer");
    const line700 = seed({ amount: RS(700), date: "2025-11-02", desc: "Z" });
    expect(findMatches(r, line700).postedLines).toEqual([]);
    expect(refusal(() => matchLine(r, line700, { journalLineIds: [jl2] }))).toContain("cannot be matched");

    // An existing Internal Transfer matched -> TRANSFERRED.
    const trf = createInternalTransfer(db(), { businessId: bizX, date: "2025-10-30", fromAccount: "CASH", toAccount: "HDFC", amountPaise: RS(12_000) });
    const jl3 = (db().prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(trf.journalEntryId) as { id: number }).id;
    const dep = seed({ amount: RS(12_000), date: "2025-10-31", desc: "CASH DEPOSIT" });
    expect(confirmed(matchLine(r, dep, { journalLineIds: [jl3] })).line.status).toBe("TRANSFERRED");
  });

  it("15. company scope on the shared BANK: X's line cannot match Y's invoice or journal line", () => {
    const now = new Date().toISOString();
    db().prepare("INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES ('YBANK', ?, 'YBANK', 'ASSET', 'BANK', NULL, 1, ?, ?)").run(companyY, now, now);
    customerInvoice("inv-y", "INV-Y1", 1_000, bizY, companyY);
    // Y's money lands on the SHARED seeded BANK, dated within X's window.
    const yPay = r.recordPayment("inv-y", RS(1_000), "2025-10-08", { moneyAccount: "BANK" });
    const yJl = (db().prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'BANK'").get(`je-payment-${yPay.id}`) as { id: number }).id;
    customerInvoice("inv-y2", "INV-Y2", 1_000, bizY, companyY);
    const xLine = seed({ amount: RS(1_000), date: "2025-10-09", account: "BANK", desc: "NEFT" });
    expect(findMatches(r, xLine).postedLines).toEqual([]);
    expect(findMatches(r, xLine).documents).toEqual([]);
    expect(refusal(() => matchLine(r, xLine, { journalLineIds: [yJl] }))).toContain("cannot be matched");
    expect(refusal(() => matchLine(r, xLine, { documents: [{ kind: "INVOICE", id: "inv-y2", amountPaise: RS(1_000) }], confirm: true }))).toContain("not open for this company");
    // Y's own line on the shared BANK does see it.
    const yLine = seed({ amount: RS(1_000), date: "2025-10-09", account: "BANK", company: companyY, biz: bizY, desc: "NEFT" });
    expect(findMatches(r, yLine).postedLines.map((p) => p.journalLineId)).toEqual([yJl]);
  });
});

describe("12f review queue: Exclude and Undo", () => {
  it("10. Exclude posts nothing; undo returns it to FOR_REVIEW; a resolved line cannot be excluded", () => {
    const id = seed({ amount: -RS(59) });
    const journal = count("journal_lines");
    expect(excludeLine(r, id, "duplicate of another line").status).toBe("EXCLUDED");
    expect(count("journal_lines")).toBe(journal);
    expect(refusal(() => excludeLine(r, id))).toContain("EXCLUDED");
    const back = confirmed(undoLine(r, id, {}));
    expect(back.line.status).toBe("FOR_REVIEW");
    expect(refusal(() => undoLine(r, id, {}))).toContain("nothing to undo");
  });

  it("11. undo a posted Add (reason + confirm), then Add again -> PV-002; undo the invoice match; undo a link-only match", () => {
    const id = seed({ amount: -RS(1_180) });
    const add = { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true };
    confirmed(addLine(r, id, add));
    const voucherId = linksOfLine(db(), id)[0]!.documentId!;
    expect(refusal(() => undoLine(r, id, { confirm: true }))).toContain("reason");
    expect(refusal(() => undoLine(r, id, { reason: "  ", confirm: false }))).toContain("reason");
    const before = snapshot(id);
    const p = preview(undoLine(r, id, { reason: "wrong account", confirm: false }));
    expect(p.willPost[0]!.lines.map((l) => [l.account, l.debitPaise, l.creditPaise])).toEqual([["HDFC", RS(1_180), 0], ["OFFICE_EXPENSES", 0, RS(1_180)]]);
    expect(snapshot(id)).toEqual(before);
    expect(preview(undoLine(r, id, { reason: "wrong account" })).confirmed).toBe(false); // confirm missing = preview

    const done = confirmed(undoLine(r, id, { reason: "wrong account", confirm: true }));
    expect(done.line.status).toBe("FOR_REVIEW");
    expect(done.links).toEqual([]);
    expect(getVoucher(db(), voucherId)).toMatchObject({ status: "CANCELLED", cancellationReason: "wrong account" });
    expect(getVoucher(db(), voucherId).reversalEntryId).not.toBeNull();
    expect(balance("HDFC")).toBe(0);
    confirmed(addLine(r, id, add));
    expect(getVoucher(db(), linksOfLine(db(), id)[0]!.documentId!).number).toBe("PV-002/25-26");

    // The invoice match.
    customerInvoice("inv-a", "INV-001", 23_600);
    const inv = seed({ amount: RS(23_600), date: "2025-10-08", ref: "UTR123", desc: "NEFT" });
    confirmed(matchLine(r, inv, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(23_600) }], confirm: true }));
    expect(receivable()).toBe(0);
    confirmed(undoLine(r, inv, { reason: "wrong line", confirm: true }));
    expect(receivable()).toBe(RS(23_600));
    expect(r.listPayments("inv-a")[0]!.cancelledAt).not.toBeNull();
    expect(getStatementLine(db(), inv).status).toBe("FOR_REVIEW");

    // The bill match, undone.
    const billId = supplierBill("PB-001", 18_000);
    const out = seed({ amount: -RS(18_000), date: "2025-10-15", ref: null, desc: "CHQ" });
    confirmed(matchLine(r, out, { documents: [{ kind: "BILL", id: billId, amountPaise: RS(18_000) }], confirm: true }));
    confirmed(undoLine(r, out, { reason: "oops", confirm: true }));
    expect(payable()).toBe(RS(18_000));

    // A link-only match: undo posts nothing, needs no reason or confirm.
    customerInvoice("inv-b", "INV-002", 5_900, bizX, companyX, "2025-10-25");
    const pay = r.recordPayment("inv-b", RS(5_900), "2025-10-28", { moneyAccount: "HDFC" });
    const jl = (db().prepare("SELECT id FROM journal_lines WHERE journal_entry_id = ? AND account = 'HDFC'").get(`je-payment-${pay.id}`) as { id: number }).id;
    const link = seed({ amount: RS(5_900), date: "2025-11-02", desc: "CHQ" });
    confirmed(matchLine(r, link, { journalLineIds: [jl] }));
    const entries = count("journal_entries");
    expect(confirmed(undoLine(r, link, {})).line.status).toBe("FOR_REVIEW");
    expect(count("journal_entries")).toBe(entries);
    expect(r.listPayments("inv-b")[0]!.cancelledAt).toBeNull();
    expect(linksOfLine(db(), link)).toEqual([]);
  });

  it("11b. undo a Transfer cancels the internal transfer", () => {
    const id = seed({ amount: -RS(12_000), ref: null });
    confirmed(transferLine(r, id, { otherAccountCode: "CASH", confirm: true }));
    confirmed(undoLine(r, id, { reason: "not a transfer", confirm: true }));
    expect(balance("CASH")).toBe(0);
    expect((db().prepare("SELECT status FROM internal_transfers").get() as { status: string }).status).toBe("CANCELLED");
  });

  it("12. undo is refused while the linked line is ticked in an IN_PROGRESS reconciliation and while it is in a FINISHED one", () => {
    const id = seed({ amount: -RS(1_180) });
    confirmed(addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true }));
    const jl = linksOfLine(db(), id)[0]!.journalLineId;
    const rec = startReconciliation(db(), { companyId: companyX, accountCode: "HDFC", statementEndDate: "2025-10-31", statementEndingBalancePaise: -RS(1_180) });
    setTicked(db(), rec.id, [jl], true); // pre-ticked already; ticking again is harmless
    const before = snapshot(id);
    const m1 = refusal(() => undoLine(r, id, { reason: "x", confirm: true }));
    expect(m1).toContain("2025-10-31");
    expect(m1).toContain("Untick");
    expect(snapshot(id)).toEqual(before);
    finishReconciliation(db(), rec.id);
    const afterFinish = snapshot(id); // finishing audits itself; the refusal below must change nothing more
    const m2 = refusal(() => undoLine(r, id, { reason: "x", confirm: true }));
    expect(m2).toContain("finished reconciliation");
    expect(m2).toContain("2025-10-31");
    expect(snapshot(id)).toEqual(afterFinish);
    // A finished reconciliation also takes the line off the offer list for matching.
    const other = seed({ amount: -RS(1_180), date: "2025-10-21" });
    expect(findMatches(r, other).postedLines).toEqual([]);
  });
});

describe("12f review queue: atomic, audit, queue", () => {
  it("13. atomic: a locked financial year refuses Add; the line stays FOR_REVIEW with no voucher, link or audit row", () => {
    const yearId = r.createFinancialYear({ businessId: bizX, startsOn: "2025-04-01", endsOn: "2026-03-31" });
    r.setFinancialYearLocked(yearId, true);
    const id = seed({ amount: -RS(1_180) });
    const before = snapshot(id);
    expect(refusal(() => addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true }))).toContain("locked");
    expect(snapshot(id)).toEqual(before);
    expect(refusal(() => addLine(r, id, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: false }))).toContain("locked");
    expect(snapshot(id)).toEqual(before);
    expect(refusal(() => transferLine(r, id, { otherAccountCode: "CASH", confirm: true }))).toContain("locked");
    expect(snapshot(id)).toEqual(before);
  });

  it("14. audit: update, add, match, transfer, exclude, undo each write one event; the chain verifies", () => {
    const actions = (): string[] => (db().prepare("SELECT action FROM audit_events WHERE entity_type = 'bank_statement_line' ORDER BY id").all() as Array<{ action: string }>).map((x) => x.action);
    const a = seed({ amount: -RS(1_180), biz: null });
    expect(refusal(() => updateLine(r, a, { businessId: bizY }))).toContain("another company");
    expect(updateLine(r, a, { businessId: bizX }).businessId).toBe(bizX);
    confirmed(addLine(r, a, { splits: [{ accountCode: "OFFICE_EXPENSES", amountPaise: RS(1_180) }], confirm: true }));
    expect(refusal(() => updateLine(r, a, { businessId: bizX2 }))).toContain("ADDED");
    const t = seed({ amount: -RS(100), ref: null });
    confirmed(transferLine(r, t, { otherAccountCode: "CASH", confirm: true }));
    customerInvoice("inv-a", "INV-001", 100);
    const m = seed({ amount: RS(100), date: "2025-10-08", ref: null });
    confirmed(matchLine(r, m, { documents: [{ kind: "INVOICE", id: "inv-a", amountPaise: RS(100) }], confirm: true }));
    const e = seed({ amount: -RS(5) });
    excludeLine(r, e, "bank error");
    confirmed(undoLine(r, a, { reason: "retry", confirm: true }));
    expect(actions()).toEqual(["BANK_LINE_UPDATED", "BANK_LINE_ADDED", "BANK_LINE_TRANSFERRED", "BANK_LINE_MATCHED", "BANK_LINE_EXCLUDED", "BANK_LINE_UNDONE"]);
    const undone = db().prepare("SELECT before_values, reason FROM audit_events WHERE action = 'BANK_LINE_UNDONE'").get() as { before_values: string; reason: string };
    expect(undone.reason).toBe("retry");
    expect(undone.before_values).toContain("VOUCHER");
    expect(verifyAuditChain(db()).ok).toBe(true);
    const tb = r.getTrialBalance();
    expect(tb.reduce((s, row) => s + row.debitPaise - row.creditPaise, 0)).toBe(0);
  });

  it("listReviewQueue: FOR_REVIEW by default, oldest first, with links and the suggestion (null without suggest)", () => {
    const a = seed({ amount: -RS(10), date: "2025-10-02" });
    seed({ amount: -RS(20), date: "2025-10-01" });
    confirmed(uncategoriseLine(r, a, { confirm: true }));
    const queue = listReviewQueue(r, { companyId: companyX, accountCode: "HDFC" });
    expect(queue).toHaveLength(1);
    expect(queue[0]!.suggestion).toBeNull();
    const added = listReviewQueue(r, { companyId: companyX, accountCode: "HDFC", status: "ADDED" }, () => null);
    expect(added[0]!.links).toHaveLength(1);
  });
});
