import type Database from "better-sqlite3";
import { V34_ADDED_ACCOUNTS } from "./chart-accounts-schema.js";

/**
 * Migration v34 body (I, rulings S18-3 = I-Q1..I-Q10 and S18-5 = I-Q11..I-Q14): GST moves from the
 * DOCUMENT to the LINE, and an invoice carries a whole-rupee round-off.
 *
 * ADDITIVE ONLY and IDEMPOTENT: every ALTER is guarded by PRAGMA table_info, and each backfill AND
 * its check run only in the branch where that table's own ALTER just ran. That matters more than it
 * looks: after v34 a line's rate is SUPPOSED to differ from its document's (that is what a
 * mixed-rate invoice is), so a check that ran on every call would throw the moment the owner issued
 * one. NOT registered here; `migrations.ts` owns version numbers.
 *
 * WHAT IT ADDS
 *  - `tax_rate_basis_points` on the five document LINE tables, backfilled from the document the line
 *    belongs to. Credit notes and purchase returns hold no rate of their own, so their lines are
 *    backfilled by joining through to the parent invoice or bill (I-Q1).
 *  - `items.default_tax_rate_basis_points`, NULLABLE: a pre-fill for new lines only, which never
 *    touches a posted document (I-Q2). NULL means "no default".
 *  - `invoices.round_off_paise`, signed, default 0. Old invoices keep 0 and are never re-rounded
 *    (I-Q10).
 *  - `invoices.total_paise`, the STORED rounded total (I-Q12). Backfilled with EXACTLY the formula
 *    `open-items.ts` computes today, so no receivable, statement or ageing figure moves when this
 *    migration runs. Per-rate-group rounding (I-Q3) cannot be expressed sanely in that SQL once an
 *    invoice can hold several rates, which is why the total is stored rather than recomputed.
 *  - `credit_note_lines.reverses_invoice_line_id` and
 *    `purchase_return_lines.reverses_bill_line_id` (I-Q14): a note or return line points at the line
 *    it reverses and takes THAT line's rate. Nullable, because every pre-v34 line has no link.
 *  - The `ROUND_OFF` chart account, seeded from the FROZEN v34 list, never the live SEED_ACCOUNTS.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *  - It adds NO account role. `V9_ACCOUNT_ROLES` is frozen and the role CHECK is built from it, so a
 *    new role would mean rebuilding `chart_accounts` and replaying every trigger that mentions it.
 *    Ruling I-Q11: ROUND_OFF is a roleless signed INCOME account and the three income aggregates
 *    exclude it BY CODE, through the single exported `ROUND_OFF_ACCOUNT` constant. Same treatment as
 *    ROUNDING and STOCK_ADJUSTMENT already get.
 *  - It does not touch `tax_type`. The tax TYPE stays per document: it is the place of supply (I-Q1).
 *  - It does not touch expenses, which have no lines table; their rate stays document-level.
 */

/**
 * The five line tables. `backfill` copies the rate down from the document; `verify` counts the rows
 * that did NOT end up matching it, which can only be an orphaned line or a wrong join, and a
 * silently wrong rate would mis-post GST for the life of the database.
 */
const LINE_TAX_TABLES: ReadonlyArray<{
  readonly table: string;
  readonly backfill: string;
  readonly verify: string;
}> = [
  {
    table: "invoice_lines",
    backfill: `UPDATE invoice_lines SET tax_rate_basis_points = COALESCE(
                 (SELECT i.tax_rate_basis_points FROM invoices i WHERE i.id = invoice_lines.invoice_id), 0)`,
    verify: `SELECT COUNT(*) AS n FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
               WHERE l.tax_rate_basis_points <> i.tax_rate_basis_points`,
  },
  {
    table: "recurring_invoice_template_lines",
    backfill: `UPDATE recurring_invoice_template_lines SET tax_rate_basis_points = COALESCE(
                 (SELECT t.tax_rate_basis_points FROM recurring_invoice_templates t
                   WHERE t.id = recurring_invoice_template_lines.template_id), 0)`,
    verify: `SELECT COUNT(*) AS n FROM recurring_invoice_template_lines l
               JOIN recurring_invoice_templates t ON t.id = l.template_id
               WHERE l.tax_rate_basis_points <> t.tax_rate_basis_points`,
  },
  {
    table: "purchase_bill_lines",
    backfill: `UPDATE purchase_bill_lines SET tax_rate_basis_points = COALESCE(
                 (SELECT b.tax_rate_basis_points FROM purchase_bills b WHERE b.id = purchase_bill_lines.bill_id), 0)`,
    verify: `SELECT COUNT(*) AS n FROM purchase_bill_lines l JOIN purchase_bills b ON b.id = l.bill_id
               WHERE l.tax_rate_basis_points <> b.tax_rate_basis_points`,
  },
  {
    // A credit note has no rate of its own: it charged the parent invoice's rate.
    table: "credit_note_lines",
    backfill: `UPDATE credit_note_lines SET tax_rate_basis_points = COALESCE(
                 (SELECT i.tax_rate_basis_points FROM credit_notes c JOIN invoices i ON i.id = c.invoice_id
                   WHERE c.id = credit_note_lines.credit_note_id), 0)`,
    verify: `SELECT COUNT(*) AS n FROM credit_note_lines l JOIN credit_notes c ON c.id = l.credit_note_id
               JOIN invoices i ON i.id = c.invoice_id
               WHERE l.tax_rate_basis_points <> i.tax_rate_basis_points`,
  },
  {
    // Likewise a purchase return: the bill's rate.
    table: "purchase_return_lines",
    backfill: `UPDATE purchase_return_lines SET tax_rate_basis_points = COALESCE(
                 (SELECT b.tax_rate_basis_points FROM purchase_returns r JOIN purchase_bills b ON b.id = r.bill_id
                   WHERE r.id = purchase_return_lines.purchase_return_id), 0)`,
    verify: `SELECT COUNT(*) AS n FROM purchase_return_lines l
               JOIN purchase_returns r ON r.id = l.purchase_return_id
               JOIN purchase_bills b ON b.id = r.bill_id
               WHERE l.tax_rate_basis_points <> b.tax_rate_basis_points`,
  },
];

/**
 * The stored total, backfilled to match `open-items.ts` to the paise: taxable (lines less discount
 * plus extra charge) plus the document-rate tax, rounded as SQLite ROUND does there. COALESCE covers
 * an invoice with no lines, which must land on 0 and not NULL.
 */
const TOTAL_PAISE_BACKFILL = `
  UPDATE invoices SET total_paise = (
    SELECT CAST(
      (COALESCE(SUM(il.quantity * il.unit_price_paise), 0) - invoices.discount_paise + invoices.extra_charge_paise)
      + ROUND(
          (COALESCE(SUM(il.quantity * il.unit_price_paise), 0) - invoices.discount_paise + invoices.extra_charge_paise)
          * invoices.tax_rate_basis_points / 10000.0
        )
      AS INTEGER)
    FROM invoice_lines il WHERE il.invoice_id = invoices.id
  )`;

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return columns.some((c) => c.name === column);
}

/**
 * COST, measured 22 Nov so nobody has to re-derive it: this migration adds ~24-32 ms to building a
 * database, about 27% on top of the whole v1..v33 chain (115 ms). It is the TEN `ALTER TABLE ADD
 * COLUMN` statements, not the backfills - guarding the backfills behind an "is the table empty?"
 * check was tried and measured no better, so it was removed rather than left in as dead
 * complexity. SQLite re-parses the schema on each ADD COLUMN, and this schema is large. Every
 * column here is required by a ruling (I-Q1, I-Q2, I-Q10, I-Q12, I-Q14), so the cost is the going
 * rate for the feature. The suite rebuilds the whole chain for EVERY test, so each new migration
 * makes every test slower; that is a test-infrastructure problem, not this migration's to solve.
 */

/** Throws so v34 rolls back whole, the way v20 does when it finds a FINALIZED note left undated. */
function verifyJustBackfilled(db: Database.Database, table: string, sql: string): void {
  const { n } = db.prepare(sql).get() as { n: number };
  if (n !== 0) {
    throw new Error(
      `Migration v34 backfill left ${n} ${table} row(s) whose tax rate does not match the document; rolled back.`,
    );
  }
}

function seedRoundOffAccount(db: Database.Database): void {
  const now = new Date().toISOString();
  const find = db.prepare("SELECT type, role FROM chart_accounts WHERE code = ?");
  const insert = db.prepare(
    "INSERT INTO chart_accounts (code, company_id, name, type, role, parent_code, active, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, NULL, 1, ?, ?)",
  );
  for (const account of V34_ADDED_ACCOUNTS) {
    const row = find.get(account.code) as { type: string; role: string | null } | undefined;
    if (row === undefined) {
      insert.run(account.code, account.name, account.type, account.role ?? null, now, now);
      continue;
    }
    if (row.type !== account.type || (row.role ?? null) !== (account.role ?? null)) {
      throw new Error(
        `Migration v34 found account ${account.code} as ${row.type}/${String(row.role)} but expected ${account.type}/${String(account.role ?? null)}; rolled back.`,
      );
    }
  }
}

export function applyLineTaxSchema(db: Database.Database): void {
  // Per-line GST rate on the five line tables. ALTER, backfill and check stay in one branch, so the
  // check only ever judges rows this migration just wrote.
  for (const { table, backfill, verify } of LINE_TAX_TABLES) {
    if (!hasColumn(db, table, "tax_rate_basis_points")) {
      db.exec(
        `ALTER TABLE ${table} ADD COLUMN tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000)`,
      );
      db.exec(backfill);
      verifyJustBackfilled(db, table, verify);
    }
  }

  // The item master's optional default rate: pre-fill only, NULL means none (I-Q2).
  if (!hasColumn(db, "items", "default_tax_rate_basis_points")) {
    db.exec(
      `ALTER TABLE items ADD COLUMN default_tax_rate_basis_points INTEGER CHECK (default_tax_rate_basis_points IS NULL OR (default_tax_rate_basis_points >= 0 AND default_tax_rate_basis_points <= 10000))`,
    );
  }

  // Signed whole-rupee round-off. Old invoices keep 0 and are never re-rounded (I-Q10).
  if (!hasColumn(db, "invoices", "round_off_paise")) {
    db.exec(`ALTER TABLE invoices ADD COLUMN round_off_paise INTEGER NOT NULL DEFAULT 0`);
  }

  // The stored rounded total (I-Q12), backfilled to today's figures so nothing moves.
  if (!hasColumn(db, "invoices", "total_paise")) {
    db.exec(`ALTER TABLE invoices ADD COLUMN total_paise INTEGER NOT NULL DEFAULT 0`);
    db.exec(TOTAL_PAISE_BACKFILL);
  }

  // A note or return line points at the line it reverses (I-Q14). Nullable: pre-v34 lines have none.
  if (!hasColumn(db, "credit_note_lines", "reverses_invoice_line_id")) {
    db.exec(
      `ALTER TABLE credit_note_lines ADD COLUMN reverses_invoice_line_id INTEGER REFERENCES invoice_lines(id)`,
    );
  }
  if (!hasColumn(db, "purchase_return_lines", "reverses_bill_line_id")) {
    db.exec(
      `ALTER TABLE purchase_return_lines ADD COLUMN reverses_bill_line_id INTEGER REFERENCES purchase_bill_lines(id)`,
    );
  }

  seedRoundOffAccount(db);
}
