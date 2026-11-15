import type Database from "better-sqlite3";

/**
 * Migration v5 body: give every journal entry a business and a transaction date.
 *
 * Both columns are NULLABLE on purpose. SQLite cannot add a NOT NULL column without a
 * default, and a table rebuild would reintroduce the cascade-delete hazard documented in
 * purchasing-schema.ts (journal_lines cascades from journal_entries). Non-null on NEW
 * writes is enforced in the repository layer, as with the v3 enum/paise validation.
 *
 * The backfill derives each entry's values from ITS OWN source document. The entry id
 * encodes the entry kind, and every shape is matched by exact equality against the id of
 * the document it points at (never by prefix parsing), so ids cannot be mis-attributed:
 *   INVOICE          je-<inv>, je-inventory-<inv>    date = invoice_date (fallback IST date of created_at)
 *   any *-reversal   (invoice, inventory, bill, expense) date = IST date of the ENTRY's own created_at
 *   INVOICE          je-payment-<payment>            date = payments.paid_at
 *   INVOICE          je-credit-note[-inventory]-<cn> date = date(credit_notes.created_at)
 *   PURCHASE_BILL    je-bill-<bill>[-reversal]       date = bill_date
 *   EXPENSE          je-expense-<exp>[-reversal]     date = expense_date
 *   SUPPLIER_PAYMENT je-supplier-payment-<payment>   date = supplier_payments.paid_at
 * (a payment entry's source_id is the INVOICE id, so a source_id-only join would stamp it
 * with the invoice date - that is exactly the bug this mapping avoids).
 *
 * No journal entry or line is inserted or deleted, and only these two columns are written.
 * Runs inside the migration transaction; any thrown error rolls everything back.
 */
export function applyJournalDimensionsSchema(db: Database.Database): void {
  const hasColumn = (name: string): boolean =>
    (db.prepare("PRAGMA table_info(journal_entries)").all() as Array<{ name: string }>).some((c) => c.name === name);

  if (!hasColumn("business_id")) {
    db.exec("ALTER TABLE journal_entries ADD COLUMN business_id TEXT REFERENCES businesses(id)");
  }
  if (!hasColumn("entry_date")) {
    db.exec("ALTER TABLE journal_entries ADD COLUMN entry_date TEXT");
  }

  const count = (table: "journal_entries" | "journal_lines"): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const entriesBefore = count("journal_entries");
  const linesBefore = count("journal_lines");

  // Timestamps (paid_at, created_at) are stored as UTC ISO strings, but this app assumes
  // India Standard Time (UTC+5:30) for every business date, so timestamp-derived dates add
  // 330 minutes. invoice_date / bill_date / expense_date are already plain local YYYY-MM-DD
  // and are NOT shifted. The explicit offset (not SQLite's 'localtime') keeps the migration
  // deterministic regardless of the machine's timezone.
  // Only fills NULLs, so a re-run never overwrites a value the repository already wrote.
  db.exec(`
    UPDATE journal_entries
       SET business_id = COALESCE(business_id,
             (SELECT i.business_id FROM invoices i
               WHERE journal_entries.source_type = 'INVOICE' AND i.id = journal_entries.source_id),
             (SELECT b.business_id FROM purchase_bills b
               WHERE journal_entries.source_type = 'PURCHASE_BILL' AND b.id = journal_entries.source_id),
             (SELECT e.business_id FROM expenses e
               WHERE journal_entries.source_type = 'EXPENSE' AND e.id = journal_entries.source_id),
             (SELECT COALESCE(
                       (SELECT b.business_id FROM purchase_bills b WHERE b.id = sp.bill_id),
                       (SELECT e.business_id FROM expenses e WHERE e.id = sp.expense_id))
                FROM supplier_payments sp
               WHERE journal_entries.source_type = 'SUPPLIER_PAYMENT'
                 AND journal_entries.id = 'je-supplier-payment-' || sp.id)),
           entry_date = COALESCE(entry_date,
             -- A reversal is its own accounting event: dated the day it was posted, never
             -- the original document's date (that would rewrite a possibly-filed period).
             CASE WHEN journal_entries.is_reversal = 1
                  THEN date(journal_entries.created_at, '+330 minutes') END,
             (SELECT date(p.paid_at, '+330 minutes') FROM payments p
               WHERE journal_entries.source_type = 'INVOICE'
                 AND p.invoice_id = journal_entries.source_id
                 AND journal_entries.id = 'je-payment-' || p.id),
             (SELECT date(cn.created_at, '+330 minutes') FROM credit_notes cn
               WHERE journal_entries.source_type = 'INVOICE'
                 AND cn.invoice_id = journal_entries.source_id
                 AND journal_entries.id IN ('je-credit-note-' || cn.id, 'je-credit-note-inventory-' || cn.id)),
             (SELECT COALESCE(date(i.invoice_date), date(i.created_at, '+330 minutes')) FROM invoices i
               WHERE journal_entries.source_type = 'INVOICE'
                 AND i.id = journal_entries.source_id
                 AND journal_entries.id IN ('je-' || i.id, 'je-' || i.id || '-reversal',
                                            'je-inventory-' || i.id, 'je-inventory-' || i.id || '-reversal')),
             (SELECT date(b.bill_date) FROM purchase_bills b
               WHERE journal_entries.source_type = 'PURCHASE_BILL'
                 AND b.id = journal_entries.source_id
                 AND journal_entries.id IN ('je-bill-' || b.id, 'je-bill-' || b.id || '-reversal')),
             (SELECT date(e.expense_date) FROM expenses e
               WHERE journal_entries.source_type = 'EXPENSE'
                 AND e.id = journal_entries.source_id
                 AND journal_entries.id IN ('je-expense-' || e.id, 'je-expense-' || e.id || '-reversal')),
             (SELECT date(sp.paid_at, '+330 minutes') FROM supplier_payments sp
               WHERE journal_entries.source_type = 'SUPPLIER_PAYMENT'
                 AND journal_entries.id = 'je-supplier-payment-' || sp.id))
     WHERE business_id IS NULL OR entry_date IS NULL
  `);

  // Gate 1: nothing inserted or deleted.
  const entriesAfter = count("journal_entries");
  if (entriesAfter !== entriesBefore) {
    throw new Error(`Migration v5 changed the journal_entries count (${entriesBefore} -> ${entriesAfter}); rolled back.`);
  }

  // Gate 2: the mapping must be exhaustive - a partial backfill is a hard failure.
  const unmapped = db
    .prepare("SELECT id, source_type FROM journal_entries WHERE business_id IS NULL OR entry_date IS NULL ORDER BY rowid")
    .all() as Array<{ id: string; source_type: string }>;
  if (unmapped.length > 0) {
    const shown = unmapped.slice(0, 20).map((r) => `${r.id} (${r.source_type})`).join(", ");
    const more = unmapped.length > 20 ? ` ... and ${unmapped.length - 20} more` : "";
    throw new Error(
      `Migration v5 could not derive business/date for ${unmapped.length} journal entr${unmapped.length === 1 ? "y" : "ies"}: ${shown}${more}; rolled back.`,
    );
  }

  // Gate 3: referential integrity (businesses FK on the new column, plus everything else).
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`Migration v5 left ${violations.length} foreign key violation(s); rolled back.`);
  }

  // Gate 4: no journal line was touched.
  const linesAfter = count("journal_lines");
  if (linesAfter !== linesBefore) {
    throw new Error(`Migration v5 changed the journal_lines count (${linesBefore} -> ${linesAfter}); rolled back.`);
  }
}
