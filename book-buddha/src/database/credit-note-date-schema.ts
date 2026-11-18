import type Database from "better-sqlite3";

/**
 * v20 - a credit note carries its own transaction date (owner decision S11-4).
 *
 * Until now a credit note had no date of its own: `finalizeCreditNote` posted it on the day it
 * was FINALIZED. Raise the paperwork in January, finalize it in February, and the return landed
 * in February although the goods came back in January. The note now carries `note_date`, the day
 * the goods actually came back, and posts on that. `created_at` stays what it always was, the
 * moment the row was written. A purchase return has done this since v19 (`return_date`), and the
 * two features are mirrors, so the column is named to match.
 *
 * ADDITIVE ONLY: one nullable column on credit_notes. SQLite cannot add a NOT NULL column
 * without a default, and the table must NOT be rebuilt, because a rebuild forces every trigger
 * to be replayed (the v11 rule). So: nullable column, a backfill, and a guard.
 *
 * The backfill is ordered so that no figure already in the books moves:
 *   (a) a note with a posted entry `je-credit-note-<id>` takes THAT entry's entry_date, the date
 *       it actually took effect, so every posted figure stays exactly where it is;
 *   (b) any other note (never posted: draft or cancelled) stays NULL. NULL means "no date was
 *       given" (S11-20): the transaction date is SPECIFIED by the owner, never guessed from a
 *       creation timestamp, and an undated note is posted on its finalize date as before.
 *
 * NOT registered here. The orchestrator registers v20 in `migrations.ts`, which owns version
 * numbers. The runner wraps `up` in a transaction, so a throw below rolls the whole of v20 back.
 */
export function applyCreditNoteDateSchema(db: Database.Database): void {
  db.transaction(() => {
    const columns = db.pragma("table_info(credit_notes)") as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "note_date")) {
      db.exec("ALTER TABLE credit_notes ADD COLUMN note_date TEXT");
    }

    // (a) posted notes keep the date they were posted on.
    db.exec(`
      UPDATE credit_notes
         SET note_date = (SELECT je.entry_date FROM journal_entries je WHERE je.id = 'je-credit-note-' || credit_notes.id)
       WHERE note_date IS NULL
         AND EXISTS (SELECT 1 FROM journal_entries je WHERE je.id = 'je-credit-note-' || credit_notes.id
                      AND je.entry_date IS NOT NULL)
    `);
    // (b) deliberately nothing: a never-posted note stays NULL = "no date given".

    const missing = db
      .prepare("SELECT COUNT(*) AS n FROM credit_notes WHERE status = 'FINALIZED' AND note_date IS NULL")
      .get() as { n: number };
    if (missing.n > 0) {
      throw new Error(`v20 cannot date ${missing.n} finalized credit note(s): no posted entry date and no posted entry to take a date from.`);
    }
  })();
}
