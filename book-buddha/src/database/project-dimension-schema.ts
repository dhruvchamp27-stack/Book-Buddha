import type Database from "better-sqlite3";

/**
 * Entry-id shapes that belong to an invoice, matched by exact equality against ids (never
 * by prefix parsing), exactly as v5 does. `je` is the journal entry, `i` its source invoice.
 *   je-<inv>, je-<inv>-reversal, je-inventory-<inv>, je-inventory-<inv>-reversal
 *   je-payment-<payment>             (source_id is the INVOICE id)
 *   je-credit-note-<note>, je-credit-note-inventory-<note>   (source_id is the INVOICE id)
 * Purchase-bill, expense and supplier-payment entries are deliberately absent: those
 * documents have no fair yet (slice 8b adds one), so their entries stay NULL.
 */
const INVOICE_ENTRY_SHAPE = `
  je.source_type = 'INVOICE'
  AND i.id = je.source_id
  AND (
    je.id IN ('je-' || i.id, 'je-' || i.id || '-reversal',
              'je-inventory-' || i.id, 'je-inventory-' || i.id || '-reversal')
    OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id AND je.id = 'je-payment-' || p.id)
    OR EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.invoice_id = i.id
                AND je.id IN ('je-credit-note-' || cn.id, 'je-credit-note-inventory-' || cn.id))
  )`;

/**
 * Migration v6 body: the project (fair) dimension.
 *
 * Adds a nullable `fair_id` to journal_entries, stock_movements, purchase_bills and expenses,
 * then backfills journal_entries.fair_id from each entry's own source invoice.
 *
 * !! fair_id is PERMANENTLY NULLABLE, BY DESIGN !!
 * A project is OPTIONAL on every record (Design Document 3.3: one business, optionally one
 * project, any number of tags). Unlike v5's business_id there is therefore NO "zero NULLs
 * remain" gate here, and there must never be one: it would fail on the very first invoice
 * that has no fair. Do NOT "fix" this by copying v5. The exhaustiveness proof is instead the
 * conditional gate below: every entry whose source invoice HAS a fair must carry that fair.
 *
 * No journal entry or line is inserted, updated-beyond-fair_id, or deleted. Only NULL
 * fair_id values are filled, so a re-run never overwrites anything. Runs inside the
 * migration transaction; any thrown error rolls everything back.
 */
export function applyProjectDimensionSchema(db: Database.Database): void {
  const hasColumn = (table: string, name: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === name);

  for (const table of ["journal_entries", "stock_movements", "purchase_bills", "expenses"]) {
    if (!hasColumn(table, "fair_id")) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN fair_id TEXT REFERENCES fairs(id)`);
    }
  }

  const count = (table: "journal_entries" | "journal_lines"): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const entriesBefore = count("journal_entries");
  const linesBefore = count("journal_lines");

  db.exec(`
    UPDATE journal_entries AS je
       SET fair_id = (SELECT i.fair_id FROM invoices i WHERE ${INVOICE_ENTRY_SHAPE})
     WHERE je.fair_id IS NULL AND je.source_type = 'INVOICE'
  `);

  const describe = (rows: Array<{ id: string; source_type: string }>): string => {
    const shown = rows.slice(0, 20).map((r) => `${r.id} (${r.source_type})`).join(", ");
    return rows.length > 20 ? `${shown} ... and ${rows.length - 20} more` : shown;
  };

  // Gate 1: nothing inserted or deleted.
  const entriesAfter = count("journal_entries");
  if (entriesAfter !== entriesBefore) {
    throw new Error(`Migration v6 changed the journal_entries count (${entriesBefore} -> ${entriesAfter}); rolled back.`);
  }
  const linesAfter = count("journal_lines");
  if (linesAfter !== linesBefore) {
    throw new Error(`Migration v6 changed the journal_lines count (${linesBefore} -> ${linesAfter}); rolled back.`);
  }

  // Gate 2 (replaces v5's zero-NULL gate): every entry of an invoice that HAS a fair carries
  // that same fair. Judged by source_id alone (not by entry shape), so an entry shape the
  // mapping above did not know about is caught here instead of silently staying NULL.
  const missing = db
    .prepare(
      `SELECT je.id, je.source_type FROM journal_entries je
         JOIN invoices i ON i.id = je.source_id
        WHERE je.source_type = 'INVOICE' AND i.fair_id IS NOT NULL AND je.fair_id IS NOT i.fair_id
        ORDER BY je.rowid`,
    )
    .all() as Array<{ id: string; source_type: string }>;
  if (missing.length > 0) {
    throw new Error(
      `Migration v6 could not give the correct fair to ${missing.length} journal entr${missing.length === 1 ? "y" : "ies"}: ${describe(missing)}; rolled back.`,
    );
  }

  // Gate 3: the other direction - no entry carries a fair its source document does not have
  // (covers bill/expense/supplier-payment entries, fairless invoices, and any wrong fair).
  const stray = db
    .prepare(
      `SELECT je.id, je.source_type FROM journal_entries je
        WHERE je.fair_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM invoices i WHERE ${INVOICE_ENTRY_SHAPE} AND i.fair_id = je.fair_id)
        ORDER BY je.rowid`,
    )
    .all() as Array<{ id: string; source_type: string }>;
  if (stray.length > 0) {
    throw new Error(
      `Migration v6 found ${stray.length} journal entr${stray.length === 1 ? "y" : "ies"} carrying a fair its source document does not have: ${describe(stray)}; rolled back.`,
    );
  }

  // Gate 4: referential integrity (fairs FK on the new columns, plus everything else).
  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`Migration v6 left ${violations.length} foreign key violation(s); rolled back.`);
  }
}
