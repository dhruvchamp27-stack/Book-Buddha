import type Database from "better-sqlite3";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { RepositoryValidationError } from "./errors.js";
import { istDateOf } from "./ist-date.js";
import { assertReportFairExists } from "./report-filters-sql.js";
import {
  excludedOpeningBalances, existingOn, openCustomerItemRows,
  type OpenCustomerItemRow,
} from "./open-items.js";

/**
 * Session 12, reports 1, 2 and 3: the customer statement, Customer Balance Detail and Collections.
 *
 * Every function takes the `better-sqlite3` handle first. All are ACCRUAL ONLY and read-only.
 *
 * THE ONE DEFINITION. What a customer owes is whatever `openCustomerItemRows` says -- the shared
 * open-items query. Nothing here writes a second "what is owed" query, so these reports cannot
 * disagree with `getReceivables`. The statement adds only the per-document settlement events, read
 * from each document's own settlements, so that the rows under a document always sum to what the
 * shared query says that document has settled.
 *
 * AS-AT. Where a report offers `asAtDate` it carries the codebase's established meaning, shared
 * through `existingOn`: "what is outstanding NOW, excluding documents that did not yet exist on
 * that date." It is NOT the balance as it stood that day. A payment, credit or cancellation made
 * after the date is NOT rolled back.
 *
 * FAIR FILTER. Opening balances belong to no fair, so under a `fairId` they are left out and each
 * report carries `excludedOpeningBalancesPaise`, a disclosure of why the figure is smaller than the
 * consolidated one. An unknown fair raises; it never returns an empty report.
 *
 * Figures are integer paise throughout. There are no percentages and no rounding.
 */

// ---------------------------------------------------------------- 1. statement

export type CustomerStatementRowType =
  | "OPENING" | "INVOICE" | "CREDIT_NOTE" | "CREDIT_APPLIED" | "PAYMENT" | "OPENING_RECEIPT";

export interface CustomerStatementRow {
  readonly date: string;
  readonly type: CustomerStatementRowType;
  /** The invoice or opening balance this row belongs to (the document, not the note or payment). */
  readonly documentId: string;
  /** The invoice number, credit note number or "Opening balance" the reader recognises. */
  readonly reference: string;
  /** Signed: a charge is positive, a settlement negative. */
  readonly amountPaise: number;
  readonly balancePaise: number;
  /** True for the entry that reverses a cancelled credit note. Both rows are shown; they net to nil. */
  readonly isReversal: boolean;
}

export interface CustomerStatementDocument {
  readonly documentId: string;
  readonly kind: "INVOICE" | "OPENING";
  readonly number: string;
  readonly date: string;
  readonly totalPaise: number;
  readonly settledPaise: number;
  readonly outstandingPaise: number;
}

export interface CustomerStatementFilter {
  readonly customerId: string;
  readonly businessId?: string;
  readonly fairId?: string;
}

export interface CustomerStatement {
  readonly customerId: string;
  readonly customerName: string;
  readonly rows: readonly CustomerStatementRow[];
  /** Every document on the statement, with the figures the shared open-items query gives it. */
  readonly documents: readonly CustomerStatementDocument[];
  /** What the customer owes. Equals the sum of `outstandingPaise` from the shared open-items query. */
  readonly closingBalancePaise: number;
  /**
   * Credit notes' refundable part that is neither refunded nor applied: money the BUSINESS owes
   * the customer. Reported beside the closing balance and NEVER netted into it.
   */
  readonly unappliedCreditPaise: number;
  /** Opening balances a fair filter leaves out (a disclosure). 0 when no fair was asked for. */
  readonly excludedOpeningBalancesPaise: number;
}

interface PendingRow extends Omit<CustomerStatementRow, "balancePaise"> {
  /** 0 for a document, 1 for a settlement, so a same-day invoice and receipt read in that order. */
  readonly order: number;
}

/**
 * One customer's account: every invoice, credit note and receipt in date order with a running
 * balance, ending at what they owe now. A cancelled credit note shows as two rows netting to nil.
 * A cancelled payment never settled anything and is not shown. A refund is not a row: it never
 * touches receivables, so it reduces `unappliedCreditPaise` instead.
 */
export function buildCustomerStatement(db: Database.Database, filter: CustomerStatementFilter): CustomerStatement {
  assertReportFairExists(db, filter.fairId);
  const customer = db.prepare("SELECT name FROM customers WHERE id = ?").get(filter.customerId) as { name: string } | undefined;
  if (customer === undefined) throw new RepositoryValidationError(`Customer ${filter.customerId} was not found.`);

  const documents = openCustomerItemRows(db, { ...filter, includeSettled: true });

  const payments = db.prepare(
    `SELECT id, amount_paise, date(paid_at, '+330 minutes') AS on_date
       FROM payments WHERE invoice_id = ? AND cancelled_at IS NULL ORDER BY rowid`,
  );
  const applications = db.prepare(
    `SELECT a.id, a.amount_paise, a.applied_on, cn.number
       FROM credit_note_applications a JOIN credit_notes cn ON cn.id = a.credit_note_id
      WHERE a.invoice_id = ? ORDER BY a.rowid`,
  );
  // One row per posted entry that moves THIS invoice's receivable. `jl.account = i.payment_account`
  // is what keeps `je-credit-note-inventory-%` out (it touches INVENTORY and COGS, never the
  // receivable); the note's reversal shares the prefix and is deliberately kept.
  const creditNotes = db.prepare(
    `SELECT je.id AS entry_id, je.entry_date, je.is_reversal, cn.number,
            SUM(jl.credit_paise) - SUM(jl.debit_paise) AS credited
       FROM journal_entries je
       JOIN invoices i ON i.id = je.source_id
       JOIN journal_lines jl ON jl.journal_entry_id = je.id AND jl.account = i.payment_account
       LEFT JOIN credit_notes cn
         ON je.id = 'je-credit-note-' || cn.id OR je.id = 'je-credit-note-cancel-' || cn.id
      WHERE je.source_id = ? AND je.id LIKE 'je-credit-note-%'
      GROUP BY je.id
      ORDER BY MIN(jl.id)`,
  );
  const receipts = db.prepare(
    "SELECT id, amount_paise, received_on FROM opening_balance_receipts WHERE opening_customer_balance_id = ? ORDER BY rowid",
  );

  const pending: PendingRow[] = [];
  for (const doc of documents) {
    const id = doc.documentId;
    pending.push({
      date: doc.date, type: doc.kind === "INVOICE" ? "INVOICE" : "OPENING", documentId: id,
      reference: doc.number, amountPaise: doc.totalPaise, isReversal: false, order: 0,
    });
    if (doc.kind === "INVOICE") {
      for (const p of payments.all(id) as Array<{ id: string; amount_paise: number; on_date: string }>) {
        pending.push({ date: p.on_date, type: "PAYMENT", documentId: id, reference: doc.number, amountPaise: -p.amount_paise, isReversal: false, order: 1 });
      }
      for (const a of applications.all(id) as Array<{ id: string; amount_paise: number; applied_on: string; number: string }>) {
        pending.push({ date: a.applied_on, type: "CREDIT_APPLIED", documentId: id, reference: a.number, amountPaise: -a.amount_paise, isReversal: false, order: 1 });
      }
      for (
        const n of creditNotes.all(id) as Array<{
          entry_id: string; entry_date: string; is_reversal: number; number: string | null; credited: number;
        }>
      ) {
        pending.push({
          date: n.entry_date, type: "CREDIT_NOTE", documentId: id, reference: n.number ?? n.entry_id,
          amountPaise: -n.credited, isReversal: n.is_reversal === 1, order: 1,
        });
      }
    } else {
      for (const r of receipts.all(id) as Array<{ id: string; amount_paise: number; received_on: string }>) {
        pending.push({ date: r.received_on, type: "OPENING_RECEIPT", documentId: id, reference: doc.number, amountPaise: -r.amount_paise, isReversal: false, order: 1 });
      }
    }
  }
  // Array.prototype.sort is stable, so rows that tie on (date, order) keep the order they were
  // read in: a credit note before its own reversal.
  const sorted = [...pending].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));
  let balance = 0;
  const rows: CustomerStatementRow[] = sorted.map(({ order: _order, ...row }) => {
    balance += row.amountPaise;
    return { ...row, balancePaise: balance };
  });

  return {
    customerId: filter.customerId,
    customerName: customer.name,
    rows,
    documents: documents.map((d) => ({
      documentId: d.documentId, kind: d.kind, number: d.number, date: d.date,
      totalPaise: d.totalPaise, settledPaise: d.settledPaise, outstandingPaise: d.outstandingPaise,
    })),
    closingBalancePaise: balance,
    unappliedCreditPaise: unappliedCredit(db, filter),
    excludedOpeningBalancesPaise: excludedOpeningBalances(db, filter),
  };
}

/**
 * Refundable less refunded less applied, over this customer's FINALIZED credit notes: the same
 * arithmetic as `getCreditNoteBalance`. Scoped by the same business and fair as the statement,
 * through the note's own invoice. A cancelled note owes nothing (its entries are reversed).
 */
function unappliedCredit(db: Database.Database, filter: CustomerStatementFilter): number {
  const conditions: string[] = ["cn.status = 'FINALIZED'", "i.customer_id = ?"];
  const params: string[] = [filter.customerId];
  if (filter.businessId !== undefined) { conditions.push("i.business_id = ?"); params.push(filter.businessId); }
  if (filter.fairId !== undefined) { conditions.push("i.fair_id = ?"); params.push(filter.fairId); }
  const row = db.prepare(
    `SELECT COALESCE(SUM(cn.refundable_paise
              - COALESCE((SELECT SUM(r.amount_paise) FROM credit_note_refunds r WHERE r.credit_note_id = cn.id), 0)
              - COALESCE((SELECT SUM(a.amount_paise) FROM credit_note_applications a WHERE a.credit_note_id = cn.id), 0)), 0) AS total
       FROM credit_notes cn JOIN invoices i ON i.id = cn.invoice_id
      WHERE ${conditions.join(" AND ")}`,
  ).get(...params) as { total: number };
  return row.total;
}

// ---------------------------------------------------------------- 2. balance detail

export interface CustomerBalanceFilter {
  readonly businessId?: string;
  readonly customerId?: string;
  readonly fairId?: string;
  readonly asAtDate?: string;
}

export interface CustomerBalanceItem {
  readonly documentId: string;
  readonly kind: "INVOICE" | "OPENING";
  readonly number: string;
  readonly date: string;
  readonly dueDate: string | null;
  readonly fairId: string | null;
  readonly totalPaise: number;
  readonly settledPaise: number;
  readonly outstandingPaise: number;
}

export interface CustomerBalanceGroup {
  readonly customerId: string;
  readonly customerName: string;
  readonly items: readonly CustomerBalanceItem[];
  /** The sum of this customer's own items. Unapplied credit is NOT netted in. */
  readonly subtotalPaise: number;
}

export interface CustomerBalanceDetail {
  /** The as-at the caller asked for, or null for "now". See the module header for what it means. */
  readonly asAtDate: string | null;
  readonly groups: readonly CustomerBalanceGroup[];
  /** Equals `getReceivables` for the same business, customer and as-at. */
  readonly totalPaise: number;
  readonly excludedOpeningBalancesPaise: number;
}

function assertAsAt(asAtDate: string | undefined): void {
  if (asAtDate !== undefined && !isValidIsoDate(asAtDate)) {
    throw new RepositoryValidationError("As-at date must be a real date written as YYYY-MM-DD.");
  }
}

/** The open items the two list reports share, in one place so they cannot filter differently. */
function openItemsFor(db: Database.Database, filter: CustomerBalanceFilter): readonly OpenCustomerItemRow[] {
  const items = openCustomerItemRows(db, {
    ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
    ...(filter.customerId === undefined ? {} : { customerId: filter.customerId }),
    ...(filter.fairId === undefined ? {} : { fairId: filter.fairId }),
  });
  return existingOn(items, filter.asAtDate);
}

function customerNames(db: Database.Database, ids: Iterable<string>): Map<string, string> {
  const lookup = db.prepare("SELECT name FROM customers WHERE id = ?");
  const names = new Map<string, string>();
  for (const id of ids) names.set(id, (lookup.get(id) as { name: string } | undefined)?.name ?? "(unknown)");
  return names;
}

/**
 * Every customer, and under each one every document still unpaid with what is left on it: the
 * detail behind the A/R total. `asAtDate` means "outstanding now, excluding documents that did not
 * yet exist then", not a historical balance.
 */
export function buildCustomerBalanceDetail(db: Database.Database, filter: CustomerBalanceFilter = {}): CustomerBalanceDetail {
  assertReportFairExists(db, filter.fairId);
  assertAsAt(filter.asAtDate);
  const items = openItemsFor(db, filter);
  const names = customerNames(db, new Set(items.map((item) => item.customerId)));
  const byCustomer = new Map<string, CustomerBalanceItem[]>();
  for (const item of items) {
    const list = byCustomer.get(item.customerId) ?? [];
    list.push({
      documentId: item.documentId, kind: item.kind, number: item.number, date: item.date,
      dueDate: item.dueDate, fairId: item.fairId, totalPaise: item.totalPaise,
      settledPaise: item.settledPaise, outstandingPaise: item.outstandingPaise,
    });
    byCustomer.set(item.customerId, list);
  }
  const groups: CustomerBalanceGroup[] = [...byCustomer.entries()]
    .map(([customerId, list]) => ({
      customerId,
      customerName: names.get(customerId) ?? "(unknown)",
      items: [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.documentId.localeCompare(b.documentId))),
      subtotalPaise: list.reduce((sum, item) => sum + item.outstandingPaise, 0),
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName) || a.customerId.localeCompare(b.customerId));
  return {
    asAtDate: filter.asAtDate ?? null,
    groups,
    totalPaise: groups.reduce((sum, group) => sum + group.subtotalPaise, 0),
    excludedOpeningBalancesPaise: excludedOpeningBalances(db, filter),
  };
}

// ---------------------------------------------------------------- 3. collections

export interface CollectionsRow {
  readonly documentId: string;
  readonly kind: "INVOICE" | "OPENING";
  readonly number: string;
  readonly customerId: string;
  readonly customerName: string;
  /** Contact details as held on the customer; null when none was recorded. */
  readonly email: string | null;
  readonly phone: string | null;
  readonly phone2: string | null;
  readonly date: string;
  /** The due date, or else the document's own date (see `dueDateBasis`). */
  readonly dueOn: string;
  /**
   * Which date `dueOn` is. INVOICE_DATE means no due date was set and the document's own date was
   * used (for an opening balance, its as-at date), so it reads as overdue the day after.
   */
  readonly dueDateBasis: "DUE_DATE" | "INVOICE_DATE";
  /** Whole days from `dueOn` to the as-at date; always at least 1 on this report. */
  readonly daysOverdue: number;
  readonly totalPaise: number;
  readonly outstandingPaise: number;
  readonly fairId: string | null;
}

export interface CollectionsReport {
  /** The date overdue was measured against: the caller's, or today in IST. */
  readonly asAtDate: string;
  /** Oldest overdue first: the order the calls are made in. */
  readonly rows: readonly CollectionsRow[];
  readonly totalOverduePaise: number;
  readonly excludedOpeningBalancesPaise: number;
}

/**
 * The chasing list: Customer Balance Detail restricted to documents whose due date is before the
 * as-at date, with the customer's contact details attached.
 *
 * `asAtDate` carries the codebase's established meaning, NOT a historical one: it is "what is
 * outstanding now, excluding documents that did not yet exist on the as-at date, aged to that
 * date". Settlements made after the date are not rolled back. It defaults to today in IST.
 */
export function buildCollectionsReport(db: Database.Database, filter: CustomerBalanceFilter = {}): CollectionsReport {
  assertReportFairExists(db, filter.fairId);
  assertAsAt(filter.asAtDate);
  const asAtDate = filter.asAtDate ?? istDateOf();
  const asAtMs = Date.parse(`${asAtDate}T00:00:00.000Z`);
  const contact = db.prepare("SELECT name, email, phone, phone2 FROM customers WHERE id = ?");
  const contacts = new Map<string, { name: string; email: string | null; phone: string | null; phone2: string | null }>();

  const rows: CollectionsRow[] = [];
  // Passed the caller's own date (not the defaulted one), so it filters exactly as Balance Detail does.
  for (const item of openItemsFor(db, filter)) {
    const dueDateBasis = item.dueDate === null ? "INVOICE_DATE" : "DUE_DATE";
    const dueOn = (item.dueDate ?? item.date).slice(0, 10);
    if (!(dueOn < asAtDate)) continue;
    let c = contacts.get(item.customerId);
    if (c === undefined) {
      c = (contact.get(item.customerId) as typeof c) ?? { name: "(unknown)", email: null, phone: null, phone2: null };
      contacts.set(item.customerId, c);
    }
    rows.push({
      documentId: item.documentId, kind: item.kind, number: item.number,
      customerId: item.customerId, customerName: c.name, email: c.email, phone: c.phone, phone2: c.phone2,
      date: item.date, dueOn, dueDateBasis,
      daysOverdue: Math.floor((asAtMs - Date.parse(`${dueOn}T00:00:00.000Z`)) / 86400000),
      totalPaise: item.totalPaise, outstandingPaise: item.outstandingPaise, fairId: item.fairId,
    });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.customerName.localeCompare(b.customerName) || a.documentId.localeCompare(b.documentId));
  return {
    asAtDate,
    rows,
    totalOverduePaise: rows.reduce((sum, row) => sum + row.outstandingPaise, 0),
    excludedOpeningBalancesPaise: excludedOpeningBalances(db, filter),
  };
}
