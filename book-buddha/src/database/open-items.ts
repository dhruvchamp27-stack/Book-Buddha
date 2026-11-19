import type Database from "better-sqlite3";

/**
 * THE SHARED OPEN-ITEMS QUERY — the single definition of "what a customer still owes".
 *
 * Moved out of `repository.ts` in session 12, UNCHANGED, for one reason: the customer statement,
 * balance detail and collections reports live in a `reports-*.ts` module that takes the database
 * handle first, and they must read THIS query rather than re-deriving settlement from `payments`.
 * A report that re-derives it is a report that can disagree with the ledger. `repository.ts` now
 * delegates here, so `getReceivables`, `getReceivablesAgeing` and `getOpenCustomerItems` still
 * read exactly what they always did.
 */

/** One open item of a customer: an invoice or an opening balance. See getOpenCustomerItems. */
export interface OpenCustomerItem {
  readonly documentId: string;
  readonly kind: "INVOICE" | "OPENING";
  readonly date: string;
  /** Payments, applied credit and credit notes (invoice), or receipts (opening balance). */
  readonly settledPaise: number;
  readonly totalPaise: number;
  readonly outstandingPaise: number;
  readonly customerId: string;
  readonly businessId: string;
}

export interface OpenItemFilter {
  readonly businessId?: string;
  readonly customerId?: string;
  /**
   * Fair-wise A/R. Design Document line 366 names A/R as viewable fair by fair. The filter is
   * on `invoices.fair_id`, which is on the invoice itself, so no journal join is needed.
   *
   * OPENING BALANCES ARE EXCLUDED under a fair filter, and that is the right answer, not a
   * gap: `opening_customer_balances` has no `fair_id` and should not have one, because an
   * opening balance is what the customer owed before the books began and cannot belong to a
   * fair that happened afterwards. A fair-wise total is therefore SMALLER than the
   * consolidated total by those openings, so every fair-filtered report must show
   * `excludedOpeningBalancesPaise` (see `excludedOpeningBalances` below) rather than let a
   * real receivable vanish quietly.
   */
  readonly fairId?: string;
  /**
   * Keep documents that are fully settled. The default (false) is an OPEN-ITEM list, which is
   * right for receivables and ageing and wrong for a statement: a statement that dropped the
   * invoice a customer has paid would not show the payment either, and would not add up.
   */
  readonly includeSettled?: boolean;
}

/** The internal row: everything above plus the detail only the reports and getReceivables need. */
export type OpenCustomerItemRow = OpenCustomerItem & {
  readonly number: string;
  readonly paidPaise: number;
  readonly creditedPaise: number;
  /** The fair this invoice was tagged to, or null. Always null for an opening balance. */
  readonly fairId: string | null;
  /** The invoice's agreed due date, or null when none was set. Null for an opening balance. */
  readonly dueDate: string | null;
};

export function openCustomerItemRows(
  db: Database.Database,
  filter: OpenItemFilter,
): OpenCustomerItemRow[] {
  const where = (alias: string): { sql: string; params: string[] } => ({
    sql: (filter.businessId === undefined ? "" : ` AND ${alias}.business_id = ?`) + (filter.customerId === undefined ? "" : ` AND ${alias}.customer_id = ?`),
    params: [...(filter.businessId === undefined ? [] : [filter.businessId]), ...(filter.customerId === undefined ? [] : [filter.customerId])],
  });
  const base = where("i");
  const invoiceWhere = {
    sql: base.sql + (filter.fairId === undefined ? "" : " AND i.fair_id = ?"),
    params: [...base.params, ...(filter.fairId === undefined ? [] : [filter.fairId])],
  };
  const rows = db
    .prepare(
      `SELECT i.id, i.number, i.business_id, i.customer_id, i.fair_id, i.due_date,
              -- The date this document bears. Session 12 replaced a fallback to i.created_at
              -- with a fallback to the POSTED entry's own date. created_at is a UTC TIMESTAMP,
              -- so for an invoice with no invoice_date it dated the document by the UTC
              -- calendar (a day early for anything posted between 00:00 and 05:29 IST) and
              -- disagreed with the ledger whenever a draft was finalized later than it was
              -- written. The posted date is invoice_date or else today in IST at finalisation
              -- (repository.invoiceEntryDate), which is what the journal, the P&L and the
              -- General Ledger all show. The third fallback cannot normally be reached and
              -- only guarantees this column is never a timestamp.
              COALESCE(i.invoice_date, je.entry_date, date(i.created_at, '+330 minutes'))
                AS invoice_date,
              i.tax_rate_basis_points,
              (SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise)
                + ROUND((SUM(il.quantity * il.unit_price_paise) - i.discount_paise + i.extra_charge_paise) * i.tax_rate_basis_points / 10000.0) AS total_paise,
              COALESCE((SELECT SUM(p.amount_paise) FROM payments p WHERE p.invoice_id = i.id AND p.cancelled_at IS NULL), 0)
                + COALESCE((SELECT SUM(a.amount_paise) FROM credit_note_applications a WHERE a.invoice_id = i.id), 0) AS paid_paise
         FROM invoices i
         JOIN invoice_lines il ON il.invoice_id = i.id
         -- Every FINALIZED invoice has this entry; LEFT so a missing one cannot silently
         -- drop the invoice from what the customer owes.
         LEFT JOIN journal_entries je ON je.id = 'je-' || i.id
         WHERE i.status = 'FINALIZED' AND i.payment_account = 'RECEIVABLES'${invoiceWhere.sql}
         GROUP BY i.id
         ORDER BY i.created_at`,
    )
    .all(...invoiceWhere.params) as Array<{
      id: string; number: string; business_id: string; customer_id: string; invoice_date: string;
      fair_id: string | null; due_date: string | null;
      tax_rate_basis_points: number; total_paise: number; paid_paise: number;
    }>;
  // Credit notes, read from the POSTED journal exactly as invoiceCreditedPaise does, so the
  // list and the payment cap can never disagree. Recomputing from the note lines would drift
  // the moment a note's tax is clamped. SAME DEFECT as recordPayment's cap: without this, an
  // invoice that has been fully credited still appeared on the receivables list as owed.
  const creditedByInvoice = new Map<string, number>();
  for (
    const note of db
      .prepare(
        `SELECT je.source_id AS invoice_id,
                COALESCE(SUM(jl.credit_paise), 0) - COALESCE(SUM(jl.debit_paise), 0) AS credited
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_entry_id
           JOIN invoices i ON i.id = je.source_id
          WHERE je.id LIKE 'je-credit-note-%' AND jl.account = i.payment_account
          GROUP BY je.source_id`,
      )
      .all() as Array<{ invoice_id: string; credited: number }>
  ) {
    creditedByInvoice.set(note.invoice_id, note.credited);
  }
  const items: OpenCustomerItemRow[] = [];
  for (const row of rows) {
    const creditedPaise = creditedByInvoice.get(row.id) ?? 0;
    items.push({
      documentId: row.id, kind: "INVOICE", date: row.invoice_date, totalPaise: row.total_paise,
      settledPaise: row.paid_paise + creditedPaise, outstandingPaise: row.total_paise - creditedPaise - row.paid_paise,
      customerId: row.customer_id, businessId: row.business_id,
      number: row.number, paidPaise: row.paid_paise, creditedPaise,
      fairId: row.fair_id, dueDate: row.due_date,
    });
  }
  // Under a fair filter there are no opening balances to report: see OpenItemFilter.fairId.
  const openingWhere = where("b");
  for (
    const b of filter.fairId !== undefined ? [] : db
      .prepare(
        `SELECT b.id, b.business_id, b.customer_id, b.as_at, b.amount_paise,
                COALESCE((SELECT SUM(r.amount_paise) FROM opening_balance_receipts r WHERE r.opening_customer_balance_id = b.id), 0) AS received_paise
           FROM opening_customer_balances b
          WHERE b.reversed_at IS NULL${openingWhere.sql}
          ORDER BY b.created_at, b.rowid`,
      )
      .all(...openingWhere.params) as Array<{
      id: string; business_id: string; customer_id: string; as_at: string; amount_paise: number; received_paise: number;
    }>
  ) {
    items.push({
      documentId: b.id, kind: "OPENING", date: b.as_at, totalPaise: b.amount_paise, settledPaise: b.received_paise,
      outstandingPaise: b.amount_paise - b.received_paise, customerId: b.customer_id, businessId: b.business_id,
      number: "Opening balance", paidPaise: b.received_paise, creditedPaise: 0,
      fairId: null, dueDate: null,
    });
  }
  return filter.includeSettled === true ? items : items.filter((item) => item.outstandingPaise > 0);
}

/**
 * What a fair-filtered A/R figure leaves out: the opening balances still outstanding for the
 * same business and customer. Not a receivable that went missing -- one that belongs to no
 * fair. Every fair-filtered report shows this so the difference from the consolidated total is
 * visible and nobody reads it as a shortfall.
 *
 * Returns 0 when no fair was asked for, because then nothing was excluded.
 */
export function excludedOpeningBalances(db: Database.Database, filter: OpenItemFilter): number {
  if (filter.fairId === undefined) return 0;
  return openCustomerItemRows(db, {
    ...(filter.businessId === undefined ? {} : { businessId: filter.businessId }),
    ...(filter.customerId === undefined ? {} : { customerId: filter.customerId }),
  })
    .filter((item) => item.kind === "OPENING")
    .reduce((sum, item) => sum + item.outstandingPaise, 0);
}
