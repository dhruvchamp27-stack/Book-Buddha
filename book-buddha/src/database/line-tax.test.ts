import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApi } from "../api/server.js";
import { spreadAdjustmentProRata, roundToRupee, taxGroupsFor } from "../accounting/engine.js";
import type { InvoiceLine, JournalEntry } from "../accounting/types.js";
import { ROUND_OFF_ACCOUNT } from "./chart-accounts-schema.js";
import { AccountingRepository } from "./repository.js";
import { todayAt } from "./test-clock.js";

/**
 * I-2 (rulings S18-3 I-Q1..I-Q10 and S18-5 I-Q11..I-Q14): GST per LINE and the whole-rupee round-off.
 *
 * The owner's hand-worked figure is the spine: 4 x 75.00 at 5%, 7 x 99.00 and 1 x 86.29 at 18%.
 *   5% group:  taxable 300.00, tax 15.00 (CGST 7.50 + SGST 7.50)
 *   18% group: taxable 779.29, tax 140.27 (CGST 70.13 + SGST 70.14)
 *   total before round-off 1,234.56 -> invoice 1,235.00, round off +0.44
 * Every figure below is in integer paise.
 */
let repository: AccountingRepository;
let companyId: string;
let businessId: string;
let customerId: string;
let supplierId: string;
let notebookId: string;
let penId: string;

beforeEach(() => {
  repository = new AccountingRepository(":memory:", todayAt("2026-01-01"));
  companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  businessId = repository.createBusiness({ companyId, name: "Books" });
  customerId = repository.createCustomer({ companyId, name: "Sunrise School" });
  supplierId = repository.createSupplier({ companyId, name: "Paper House" });
  notebookId = repository.createItem({ companyId, name: "Notebook", unit: "each", trackStock: false });
  penId = repository.createItem({ companyId, name: "Pen", unit: "each", trackStock: false });
});
afterEach(() => repository.close());

const lineOf = (description: string, quantity: number, unitPricePaise: number, taxRateBasisPoints: number | undefined, itemId?: string): InvoiceLine => ({
  ...(itemId === undefined ? {} : { itemId }), description, quantity, unitPricePaise,
  ...(taxRateBasisPoints === undefined ? {} : { taxRateBasisPoints }),
});

/** His hand figure: Notebook 4 x 75.00 @5%, Atlas 7 x 99.00 @18%, Pen 1 x 86.29 @18%. */
const handLines = (): InvoiceLine[] => [
  lineOf("Notebook", 4, 7500, 500, notebookId),
  lineOf("Atlas", 7, 9900, 1800),
  lineOf("Pen", 1, 8629, 1800, penId),
];

function invoice(id: string, lines: InvoiceLine[], extra: Partial<Parameters<AccountingRepository["saveDraft"]>[0]> = {}): string {
  repository.saveDraft({
    id, businessId, customerId, invoiceDate: "2026-01-01", status: "DRAFT", paymentAccount: "RECEIVABLES",
    taxType: "CGST_SGST", taxRateBasisPoints: 0, lines, ...extra,
  });
  repository.finalizeInvoice(id);
  return id;
}

/** The posted entry of a document as { account: net credit - debit } plus the raw lines in order. */
function entryOf(entryId: string): { byAccount: Record<string, number>; lines: Array<{ account: string; debit: number; credit: number }> } {
  const rows = repository.db
    .prepare("SELECT account, debit_paise AS debit, credit_paise AS credit FROM journal_lines WHERE journal_entry_id = ? ORDER BY id")
    .all(entryId) as Array<{ account: string; debit: number; credit: number }>;
  const byAccount: Record<string, number> = {};
  for (const row of rows) byAccount[row.account] = (byAccount[row.account] ?? 0) + row.credit - row.debit;
  return { byAccount, lines: rows };
}
/** Net balance (debit - credit) on one account for everything sourced from one invoice. */
const balance = (invoiceId: string, account: string): number =>
  (repository.db.prepare(
    `SELECT COALESCE(SUM(jl.debit_paise), 0) - COALESCE(SUM(jl.credit_paise), 0) AS n
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id
      WHERE je.source_id = ? AND jl.account = ?`,
  ).get(invoiceId, account) as { n: number }).n;
const ledgerTotal = (account: string): number =>
  (repository.db.prepare("SELECT COALESCE(SUM(debit_paise), 0) - COALESCE(SUM(credit_paise), 0) AS n FROM journal_lines WHERE account = ?").get(account) as { n: number }).n;

describe("I-Q1, I-Q3, I-Q5: the owner's hand-worked invoice", () => {
  it("posts Dr Receivables 1,235.00; Cr Sales 300.00 and 779.29; Cr CGST 77.63, SGST 77.64; Cr Round off 0.44", () => {
    invoice("inv-hand", handLines());
    const entry = entryOf("je-inv-hand");
    expect(entry.lines).toEqual([
      { account: "RECEIVABLES", debit: 123500, credit: 0 },
      { account: "SALES", debit: 0, credit: 30000 },
      { account: "SALES", debit: 0, credit: 77929 },
      { account: "OUTPUT_CGST", debit: 0, credit: 7763 },
      { account: "OUTPUT_SGST", debit: 0, credit: 7764 },
      { account: ROUND_OFF_ACCOUNT, debit: 0, credit: 44 },
    ]);
    const stored = repository.getInvoice("inv-hand");
    expect(stored.totalPaise).toBe(123500);
    expect(stored.roundOffPaise).toBe(44);
    expect(stored.lines.map((line) => line.taxRateBasisPoints)).toEqual([500, 1800, 1800]);
  });

  it("the engine groups per rate: 5% taxable 300.00 tax 15.00; 18% taxable 779.29 tax 140.27", () => {
    const groups = taxGroupsFor(handLines(), 0, "CGST_SGST", 0, 0);
    expect(groups).toEqual([
      { rateBasisPoints: 500, taxablePaise: 30000, taxPaise: 1500 },
      { rateBasisPoints: 1800, taxablePaise: 77929, taxPaise: 14027 },
    ]);
    expect(roundToRupee(123456)).toEqual({ totalPaise: 123500, roundOffPaise: 44 });
  });

  it("rounds 50 paise and over UP, under 50 DOWN, and leaves a whole-rupee total with NO round-off line", () => {
    expect(roundToRupee(10050)).toEqual({ totalPaise: 10100, roundOffPaise: 50 });
    expect(roundToRupee(10049)).toEqual({ totalPaise: 10000, roundOffPaise: -49 });
    expect(roundToRupee(10000)).toEqual({ totalPaise: 10000, roundOffPaise: 0 });
    invoice("inv-whole", [lineOf("Flat", 1, 10000, 0)], { taxType: "NONE" });
    const entry = entryOf("je-inv-whole");
    expect(entry.lines.map((line) => line.account)).toEqual(["RECEIVABLES", "SALES"]);
    expect(repository.getInvoice("inv-whole").roundOffPaise).toBe(0);
  });

  it("a round-DOWN is a DEBIT to the round-off account (a signed account)", () => {
    // 1 x 10.20 at 0% = 1,020 -> Rs 10.00; round off -0.20.
    invoice("inv-down", [lineOf("Odd", 1, 1020, 0)], { taxType: "NONE" });
    expect(entryOf("je-inv-down").lines).toEqual([
      { account: "RECEIVABLES", debit: 1000, credit: 0 },
      { account: "SALES", debit: 0, credit: 1020 },
      { account: ROUND_OFF_ACCOUNT, debit: 20, credit: 0 },
    ]);
  });

  it("works for a CASH invoice too (I-Q5)", () => {
    invoice("inv-cash", handLines(), { paymentAccount: "CASH" });
    expect(entryOf("je-inv-cash").lines[0]).toEqual({ account: "CASH", debit: 123500, credit: 0 });
    expect(entryOf("je-inv-cash").byAccount[ROUND_OFF_ACCOUNT]).toBe(44);
  });
});

describe("I-Q3: tax is rounded once per RATE GROUP, not per line", () => {
  it("two lines of Rs 10.10 at 5% give 1.01 of GST, where per line would give 1.02", () => {
    expect(Math.round(1010 * 500 / 10000) * 2).toBe(102); // what rounding per line would have charged
    const id = invoice("inv-group", [lineOf("A", 1, 1010, 500), lineOf("B", 1, 1010, 500)]);
    const entry = entryOf(`je-${id}`);
    expect(entry.byAccount["OUTPUT_CGST"]! + entry.byAccount["OUTPUT_SGST"]!).toBe(101);
    // 2,020 + 101 = 2,121 -> Rs 21.00, a -0.21 round-off.
    expect(repository.getInvoice(id).totalPaise).toBe(2100);
    expect(entry.byAccount[ROUND_OFF_ACCOUNT]).toBe(-21);
  });
});

describe("I-Q8, I-Q14: credit notes", () => {
  const penLineId = (id: string): number => repository.getInvoice(id).lines.find((line) => line.description === "Pen")!.id!;

  it("a note for the Pen only: 86.29 at 18% = 15.53 (7.76 + 7.77), note 101.82, invoice still owes 1,133.18", () => {
    invoice("inv-hand", handLines());
    repository.saveCreditNote({
      id: "cn-pen", invoiceId: "inv-hand", reason: "Faulty", status: "DRAFT",
      lines: [{ itemId: penId, description: "Pen", quantity: 1, unitPricePaise: 8629, reversesInvoiceLineId: penLineId("inv-hand") }],
    });
    repository.finalizeCreditNote("cn-pen");
    const note = entryOf("je-credit-note-cn-pen");
    expect(note.lines).toEqual([
      { account: "SALES", debit: 8629, credit: 0 },
      { account: "OUTPUT_CGST", debit: 776, credit: 0 },
      { account: "OUTPUT_SGST", debit: 777, credit: 0 },
      { account: "RECEIVABLES", debit: 0, credit: 10182 }, // 8,629 + 1,553, EXACT paise, no rounding
    ]);
    expect(repository.getCreditNote("cn-pen").lines[0]).toMatchObject({ taxRateBasisPoints: 1800, reversesInvoiceLineId: penLineId("inv-hand") });
    // Not the completing note, so the round-off stays: the invoice still owes 1,235.00 - 101.82.
    expect(balance("inv-hand", "RECEIVABLES")).toBe(123500 - 10182);
    expect(balance("inv-hand", ROUND_OFF_ACCOUNT)).toBe(-44);
    const [row] = repository.getReceivables();
    expect(row).toMatchObject({ totalPaise: 123500, creditedPaise: 10182, outstandingPaise: 113318 });
    // The list reads the POSTED figure (I-Q8).
    expect(repository.listCreditNotes()[0]).toMatchObject({ subtotalPaise: 8629, taxPaise: 1553, totalPaise: 10182 });
  });

  it("the note that COMPLETES the invoice also reverses the 0.44, so it clears to exactly zero", () => {
    invoice("inv-hand", handLines());
    const ids = repository.getInvoice("inv-hand").lines.map((line) => line.id!);
    repository.saveCreditNote({
      id: "cn-pen", invoiceId: "inv-hand", reason: "Faulty", status: "DRAFT",
      lines: [{ itemId: penId, description: "Pen", quantity: 1, unitPricePaise: 8629, reversesInvoiceLineId: ids[2]! }],
    });
    repository.finalizeCreditNote("cn-pen");
    repository.saveCreditNote({
      id: "cn-rest", invoiceId: "inv-hand", reason: "Rest", status: "DRAFT",
      lines: [
        { itemId: notebookId, description: "Notebook", quantity: 4, unitPricePaise: 7500, reversesInvoiceLineId: ids[0]! },
        { description: "Atlas", quantity: 7, unitPricePaise: 9900, reversesInvoiceLineId: ids[1]! },
      ],
    });
    repository.finalizeCreditNote("cn-rest");
    const last = entryOf("je-credit-note-cn-rest");
    // Notebook 5%: 15.00 (7.50 + 7.50). Atlas 18%: 124.74 (62.37 + 62.37). Round off +0.44 given back.
    expect(last.byAccount).toEqual({ SALES: -(30000 + 69300), OUTPUT_CGST: -(750 + 6237), OUTPUT_SGST: -(750 + 6237), [ROUND_OFF_ACCOUNT]: -44, RECEIVABLES: 113318 });
    expect(balance("inv-hand", "RECEIVABLES")).toBe(0);
    expect(balance("inv-hand", ROUND_OFF_ACCOUNT)).toBe(0);
    expect(balance("inv-hand", "OUTPUT_CGST")).toBe(0);
    expect(balance("inv-hand", "OUTPUT_SGST")).toBe(0);
    expect(balance("inv-hand", "SALES")).toBe(0);
    expect(repository.getReceivables()).toEqual([]);
  });

  it("a FULL return in one note reverses the 0.44 as well", () => {
    invoice("inv-hand", handLines());
    const ids = repository.getInvoice("inv-hand").lines.map((line) => line.id!);
    repository.saveCreditNote({
      id: "cn-all", invoiceId: "inv-hand", reason: "All back", status: "DRAFT",
      lines: [
        { description: "Notebook", quantity: 4, unitPricePaise: 7500, reversesInvoiceLineId: ids[0]! },
        { description: "Atlas", quantity: 7, unitPricePaise: 9900, reversesInvoiceLineId: ids[1]! },
        { description: "Pen", quantity: 1, unitPricePaise: 8629, reversesInvoiceLineId: ids[2]! },
      ],
    });
    repository.finalizeCreditNote("cn-all");
    expect(entryOf("je-credit-note-cn-all").lines.find((line) => line.account === ROUND_OFF_ACCOUNT)).toEqual({ account: ROUND_OFF_ACCOUNT, debit: 44, credit: 0 });
    expect(balance("inv-hand", "RECEIVABLES")).toBe(0);
    expect(balance("inv-hand", ROUND_OFF_ACCOUNT)).toBe(0);
    expect(ledgerTotal("RECEIVABLES")).toBe(0);
  });

  it("an invoice with two rates will not guess which line a note reverses", () => {
    invoice("inv-hand", handLines());
    expect(() => repository.saveCreditNote({
      id: "cn-vague", invoiceId: "inv-hand", reason: "?", status: "DRAFT",
      lines: [{ description: "Something", quantity: 1, unitPricePaise: 100 }],
    })).toThrow("has more than one GST rate, so credit note line \"Something\" must say which invoice line it reverses.");
  });

  it("a note line may not carry a different rate from the invoice line it reverses", () => {
    invoice("inv-hand", handLines());
    expect(() => repository.saveCreditNote({
      id: "cn-wrong", invoiceId: "inv-hand", reason: "?", status: "DRAFT",
      lines: [{ description: "Pen", quantity: 1, unitPricePaise: 8629, reversesInvoiceLineId: penLineId("inv-hand"), taxRateBasisPoints: 500 }],
    })).toThrow("takes that rate");
  });
});

describe("I-Q9, I-Q11: exempt lines and the reports", () => {
  it("an exempt 0% line on an 18% invoice is allowed and shown in its OWN row of the GST summary", () => {
    invoice("inv-mixed", [lineOf("Taxed book", 1, 10000, 1800), lineOf("Exempt book", 1, 5000, 0)]);
    const report = repository.getSalesByTax();
    expect(report.rows.map((row) => [row.taxType, row.taxRateBasisPoints, row.netSalesPaise, row.taxPaise])).toEqual([
      ["CGST_SGST", 1800, 10000, 1800],
      ["NONE", 0, 5000, 0],
    ]);
    // One invoice, counted once in the totals though it touches two rate rows.
    expect(report.totals).toMatchObject({ invoiceCount: 1, netSalesPaise: 15000 });
  });

  it("a tax type with only exempt lines is allowed (I-Q13)", () => {
    invoice("inv-exempt", [lineOf("Exempt", 1, 5000, 0)]);
    expect(repository.getInvoice("inv-exempt").totalPaise).toBe(5000);
  });

  it("the round-off is NOT sales: sales by tax, P&L gross sales and the credit-note report leave it out", () => {
    invoice("inv-hand", handLines());
    const byTax = repository.getSalesByTax();
    expect(byTax.totals.invoicedPaise).toBe(30000 + 77929); // 1,079.29: no +0.44
    expect(byTax.rows.map((row) => [row.taxRateBasisPoints, row.netSalesPaise, row.taxPaise])).toEqual([[500, 30000, 1500], [1800, 77929, 14027]]);
    const pnl = repository.getProfitAndLoss({ businessId });
    expect(pnl.grossSalesPaise).toBe(30000 + 77929 + 1500 + 14027); // sales + GST = 1,234.56, not 1,235.00
    expect(pnl.income.find((row) => row.account === ROUND_OFF_ACCOUNT)).toMatchObject({ creditPaise: 44 });
    expect(pnl.totalIncomePaise).toBe(30000 + 77929 + 44); // but it IS income, in the profit
    // By customer, business and fair too (the shared aggregate).
    expect(repository.getSalesByCustomer().totals.netSalesPaise).toBe(30000 + 77929);

    const ids = repository.getInvoice("inv-hand").lines.map((line) => line.id!);
    repository.saveCreditNote({
      id: "cn-all", invoiceId: "inv-hand", reason: "All", status: "DRAFT",
      lines: [
        { description: "Notebook", quantity: 4, unitPricePaise: 7500, reversesInvoiceLineId: ids[0]! },
        { description: "Atlas", quantity: 7, unitPricePaise: 9900, reversesInvoiceLineId: ids[1]! },
        { description: "Pen", quantity: 1, unitPricePaise: 8629, reversesInvoiceLineId: ids[2]! },
      ],
    });
    repository.finalizeCreditNote("cn-all");
    const [note] = repository.getCreditNoteReport().rows;
    expect(note).toMatchObject({ taxablePaise: 107929, taxPaise: 15527, valuePaise: 107929 + 15527 + 44 });
    expect(repository.getSalesByTax().totals.netSalesPaise).toBe(0);
  });

  it("a single-rate invoice reports exactly as before: the header rate, no round-off in sales", () => {
    invoice("inv-one", [lineOf("Book", 3, 3333, 1200)], { taxRateBasisPoints: 1200 });
    const [row] = repository.getSalesByTax().rows;
    expect(row).toMatchObject({ taxType: "CGST_SGST", taxRateBasisPoints: 1200, netSalesPaise: 9999 });
  });
});

describe("I-Q12: the rounded total is STORED, and every reader agrees with the ledger", () => {
  it("receivables, the customer statement, ageing and the ledger all say 1,235.00", () => {
    invoice("inv-hand", handLines());
    const [receivable] = repository.getReceivables();
    expect(receivable?.totalPaise).toBe(123500);
    expect(receivable?.outstandingPaise).toBe(123500);
    expect(repository.getCustomerStatement({ customerId }).closingBalancePaise).toBe(123500);
    expect(repository.getReceivablesAgeing().totalOutstandingPaise).toBe(123500);
    expect(ledgerTotal("RECEIVABLES")).toBe(123500);
    // A payment is capped against the STORED total.
    expect(() => repository.recordPayment("inv-hand", 123501)).toThrow(/outstanding balance of 123500 paise/);
    repository.recordPayment("inv-hand", 123500);
    expect(repository.getReceivables()).toEqual([]);
  });
});

describe("I-Q10: an OLD invoice is never re-rounded", () => {
  it("a pre-v34 finalized invoice (round_off 0, un-rounded total) stands as posted and a note clears it to zero with no round-off", () => {
    // Built the way v33 left one: stored total 560.50 (not a whole rupee), round_off 0, and a ledger entry
    // with no ROUND_OFF line. 2 x 250.00 less 40.00 plus 15.00 = 475.00 taxable, 18% = 85.50, total 560.50.
    repository.db.prepare(
      `INSERT INTO invoices (id, business_id, customer_id, number, invoice_date, discount_paise, extra_charge_paise, tax_type,
                            tax_rate_basis_points, payment_account, status, created_at, round_off_paise, total_paise)
       VALUES ('inv-old', ?, ?, 'INV-OLD', '2026-01-01', 4000, 1500, 'CGST_SGST', 1800, 'RECEIVABLES', 'FINALIZED', '2026-01-01T00:00:00.000Z', 0, 56050)`,
    ).run(businessId, customerId);
    repository.db.prepare(
      "INSERT INTO invoice_lines (invoice_id, item_id, description, quantity, unit_price_paise, tax_rate_basis_points) VALUES ('inv-old', ?, 'Novel', 2, 25000, 1800)",
    ).run(notebookId);
    const entry: JournalEntry = {
      id: "je-inv-old", sourceId: "inv-old", description: "Invoice INV-OLD", isReversal: false,
      lines: [
        { account: "RECEIVABLES", debitPaise: 56050, creditPaise: 0 },
        { account: "SALES", debitPaise: 0, creditPaise: 47500 },
        { account: "OUTPUT_CGST", debitPaise: 0, creditPaise: 4275 },
        { account: "OUTPUT_SGST", debitPaise: 0, creditPaise: 4275 },
      ],
    };
    (repository as unknown as { insertJournalEntry: (e: JournalEntry, d: { businessId: string; entryDate: string }) => void })
      .insertJournalEntry(entry, { businessId, entryDate: "2026-01-01" });

    expect(repository.getReceivables()[0]).toMatchObject({ totalPaise: 56050, outstandingPaise: 56050 });
    expect(repository.getInvoice("inv-old")).toMatchObject({ totalPaise: 56050, roundOffPaise: 0 });
    // A full return: taxable 475.00 is what it charged; the note completes it and there is no round-off to give back.
    repository.saveCreditNote({
      id: "cn-old", invoiceId: "inv-old", reason: "All back", status: "DRAFT",
      lines: [{ itemId: notebookId, description: "Novel", quantity: 2, unitPricePaise: 23750 }],
    });
    repository.finalizeCreditNote("cn-old");
    expect(entryOf("je-credit-note-cn-old").lines.some((line) => line.account === ROUND_OFF_ACCOUNT)).toBe(false);
    expect(balance("inv-old", "RECEIVABLES")).toBe(0);
  });
});

describe("I-Q1 recurring templates and bills carry the rate per line too", () => {
  it("a recurring template keeps each line's rate and generates a draft with the same split and round-off", () => {
    repository.createRecurringInvoiceTemplate({
      businessId, customerId, paymentAccount: "RECEIVABLES", taxType: "CGST_SGST", frequency: "MONTHLY", startDate: "2026-01-01", lines: handLines(),
    });
    const [draft] = repository.generateDueInvoices("2026-01-01").invoices;
    expect(draft?.lines.map((line) => line.taxRateBasisPoints)).toEqual([500, 1800, 1800]);
    expect(draft?.totalPaise).toBe(123500);
    expect(draft?.roundOffPaise).toBe(44);
  });

  it("a bill with two rates takes input GST per rate group, and a return line reverses the line it names", () => {
    const bill = repository.createPurchaseBill({
      businessId, supplierId, number: "PB-1", billDate: "2026-01-01", paymentAccount: "PAYABLES", taxType: "CGST_SGST",
      lines: [
        lineOf("Notebook", 4, 7500, 500, notebookId),
        lineOf("Notebook (premium)", 2, 7500, 1800, notebookId),
      ],
    });
    // 5%: 30,000 -> 1,500. 18%: 15,000 -> 2,700. Total 45,000 + 4,200 = 49,200 (a bill is NOT rounded: I-Q6).
    expect(bill).toMatchObject({ subtotalPaise: 45000, taxPaise: 4200, totalPaise: 49200 });
    repository.finalizePurchaseBill(bill.id);
    const entry = entryOf(`je-bill-${bill.id}`);
    expect(entry.byAccount).toMatchObject({ INPUT_CGST: -2100, INPUT_SGST: -2100 });

    // Same item, same price, two RATES: they are two lots. Returning 2 at the 18% line leaves the 5% line whole.
    const premium = bill.lines.find((line) => line.description === "Notebook (premium)")!;
    const ret = repository.createPurchaseReturn({
      billId: bill.id, reason: "Faulty", returnDate: "2026-01-02",
      lines: [{ itemId: notebookId, description: "Notebook (premium)", quantity: 2, unitPricePaise: 7500, reversesBillLineId: premium.id! }],
    });
    expect(ret.lines[0]).toMatchObject({ taxRateBasisPoints: 1800, reversesBillLineId: premium.id });
    repository.finalizePurchaseReturn(ret.id);
    const back = entryOf(`je-purchase-return-${ret.id}`);
    expect(back.byAccount).toMatchObject({ INPUT_CGST: 1350, INPUT_SGST: 1350 }); // 18% of 15,000 = 2,700
    // The auto-link finds the 5% line for the other four, not the 18% one.
    const rest = repository.createPurchaseReturn({
      billId: bill.id, reason: "Rest", returnDate: "2026-01-03",
      lines: [{ itemId: notebookId, description: "Notebook", quantity: 4, unitPricePaise: 7500 }],
    });
    expect(rest.lines[0]).toMatchObject({ taxRateBasisPoints: 500 });
  });
});

describe("I-Q4 (UNCONFIRMED, pending a CA): discount and freight spread pro rata over mixed rates", () => {
  it("the helper spreads in whole paise and the shares sum exactly", () => {
    expect(spreadAdjustmentProRata([30000, 77929], -1000)).toEqual([-278, -722]);
    expect(spreadAdjustmentProRata([100, 100, 100], 100).reduce((a, b) => a + b, 0)).toBe(100);
    expect(spreadAdjustmentProRata([0, 0], 5)).toEqual([5, 0]);
  });

  it("a mixed-rate invoice with a discount and freight posts a balanced entry, test behaviour only", () => {
    const id = invoice("inv-disc", [lineOf("A", 1, 10000, 500), lineOf("B", 1, 20000, 1800)], { discountPaise: 3000, extraChargePaise: 600 });
    // Net adjustment -2,400 over 10,000 : 20,000 -> -800 and -1,600. 5%: 9,200 -> 460. 18%: 18,400 -> 3,312.
    const entry = entryOf(`je-${id}`);
    expect(entry.lines.filter((line) => line.account === "SALES").map((line) => line.credit)).toEqual([9200, 18400]);
    expect(entry.byAccount["OUTPUT_CGST"]! + entry.byAccount["OUTPUT_SGST"]!).toBe(460 + 3312);
    // 27,600 + 3,772 = 31,372 -> 31,400, round off +28
    expect(repository.getInvoice(id).totalPaise).toBe(31400);
  });
});

describe("I-Q13: the API takes a rate per line", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApi(repository, { __unsafeDisableAuthForTests: true });
    await app.ready();
  });
  afterEach(async () => { await app.close(); });

  const body = (lines: object[], extra: object = {}): object => ({
    businessId, customerId, paymentAccount: "RECEIVABLES", invoiceDate: "2026-01-01", taxType: "CGST_SGST", lines, ...extra,
  });

  it("creates, finalizes and reads back a mixed-rate invoice with an exempt line, and refuses a rate with no tax type", async () => {
    const created = await app.inject({
      method: "POST", url: "/invoices",
      payload: body([
        { description: "Notebook", quantity: 4, unitPricePaise: 7500, taxRateBasisPoints: 500 },
        { description: "Atlas", quantity: 7, unitPricePaise: 9900, taxRateBasisPoints: 1800 },
        { description: "Pen", quantity: 1, unitPricePaise: 8629, taxRateBasisPoints: 1800 },
        { description: "Exempt", quantity: 1, unitPricePaise: 1000, taxRateBasisPoints: 0 },
      ]),
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    expect((await app.inject({ method: "POST", url: `/invoices/${id}/finalize`, payload: {} })).statusCode).toBe(200);
    const read = (await app.inject({ method: "GET", url: `/invoices/${id}` })).json<{ totalPaise: number; roundOffPaise: number; lines: Array<{ taxRateBasisPoints: number }> }>();
    // 1,234.56 + 10.00 exempt = 1,244.56 -> 1,245.00, round off +0.44
    expect(read.totalPaise).toBe(124500);
    expect(read.roundOffPaise).toBe(44);
    expect(read.lines.map((line) => line.taxRateBasisPoints)).toEqual([500, 1800, 1800, 0]);

    const refused = await app.inject({
      method: "POST", url: "/invoices",
      payload: body([{ description: "X", quantity: 1, unitPricePaise: 100, taxRateBasisPoints: 500 }], { taxType: "NONE" }),
    });
    expect(refused.statusCode).toBe(400);
    expect(JSON.stringify(refused.json())).toContain("A tax rate requires a tax type.");
  });

  it("a credit note over HTTP names the invoice line it reverses", async () => {
    const created = await app.inject({
      method: "POST", url: "/invoices",
      payload: body([
        { description: "Notebook", quantity: 1, unitPricePaise: 10000, taxRateBasisPoints: 500 },
        { description: "Atlas", quantity: 1, unitPricePaise: 10000, taxRateBasisPoints: 1800 },
      ]),
    });
    const { id } = created.json<{ id: string }>();
    await app.inject({ method: "POST", url: `/invoices/${id}/finalize`, payload: {} });
    const atlas = repository.getInvoice(id).lines[1]!;
    const note = await app.inject({
      method: "POST", url: "/credit-notes",
      payload: { invoiceId: id, reason: "Back", lines: [{ description: "Atlas", quantity: 1, unitPricePaise: 10000, reversesInvoiceLineId: atlas.id }] },
    });
    expect(note.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/credit-notes/${note.json<{ id: string }>().id}/finalize`, payload: {} })).statusCode).toBe(200);
    // 10,000 + 18% = 11,800 for the note; the invoice (10,000 + 500 + 10,000 + 1,800 = 22,300) now owes 10,500.
    expect(repository.getReceivables()[0]).toMatchObject({ totalPaise: 22300, creditedPaise: 11800, outstandingPaise: 10500 });
  });
});
