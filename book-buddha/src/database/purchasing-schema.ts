import type Database from "better-sqlite3";

const ACCOUNTS =
  "'CASH', 'RECEIVABLES', 'SALES', 'INVENTORY', 'COGS', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST', 'PAYABLES', 'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST', 'EXPENSE'";

function tableSql(db: Database.Database, name: string): string | undefined {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { sql: string } | undefined;
  return row?.sql;
}

/**
 * Migration v4 body. Must run OUTSIDE a transaction wrapper (the caller marks it
 * transactional:false) because PRAGMA foreign_keys is a no-op inside a transaction.
 * Foreign keys stay OFF while tables are rebuilt (journal_lines cascades from
 * journal_entries, so dropping it with FKs on would delete every journal line),
 * the work itself runs in one transaction, and a foreign_key_check gates success.
 * Every rebuild is guarded so the whole function is idempotent.
 */
export function applyPurchasingExpensesSchema(db: Database.Database): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      // DROP TABLE also drops that table's triggers. None are defined by the app schema,
      // but preserve any that exist (e.g. an immutability/audit trigger) and replay them.
      const triggers = (db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL
             AND tbl_name IN ('journal_entries', 'journal_lines', 'stock_movements')`,
        )
        .all() as Array<{ sql: string }>).map((row) => row.sql);

      // 1. journal_entries: drop source_id -> invoices FK, add source_type.
      const entriesSql = tableSql(db, "journal_entries");
      if (entriesSql !== undefined && entriesSql.includes("REFERENCES invoices")) {
        db.exec(`
          CREATE TABLE journal_entries_v2 (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            description TEXT NOT NULL,
            is_reversal INTEGER NOT NULL CHECK(is_reversal IN (0, 1)),
            created_at TEXT NOT NULL,
            source_type TEXT NOT NULL DEFAULT 'INVOICE'
          );
          INSERT INTO journal_entries_v2 (rowid, id, source_id, description, is_reversal, created_at, source_type)
            SELECT rowid, id, source_id, description, is_reversal, created_at, 'INVOICE' FROM journal_entries ORDER BY rowid;
          DROP TABLE journal_entries;
          ALTER TABLE journal_entries_v2 RENAME TO journal_entries;
        `);
      }

      // 2. journal_lines: widen the account CHECK.
      const linesSql = tableSql(db, "journal_lines");
      if (linesSql !== undefined && !linesSql.includes("'PAYABLES'")) {
        db.exec(`
          CREATE TABLE journal_lines_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            account TEXT NOT NULL CHECK(account IN (${ACCOUNTS})),
            debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0),
            credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0),
            CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0))
          );
          INSERT INTO journal_lines_v2 (id, journal_entry_id, account, debit_paise, credit_paise)
            SELECT id, journal_entry_id, account, debit_paise, credit_paise FROM journal_lines ORDER BY id;
          DROP TABLE journal_lines;
          ALTER TABLE journal_lines_v2 RENAME TO journal_lines;
        `);
      }

      // 3. stock_movements: allow PURCHASE_REVERSAL. rowid is copied because FIFO ordering
      //    is "ORDER BY occurred_at, rowid" and id is a TEXT key.
      const stockSql = tableSql(db, "stock_movements");
      if (stockSql !== undefined && !stockSql.includes("PURCHASE_REVERSAL")) {
        db.exec(`
          CREATE TABLE stock_movements_v2 (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES items(id),
            source_id TEXT,
            movement_type TEXT NOT NULL CHECK(movement_type IN ('OPENING', 'PURCHASE', 'ADJUSTMENT', 'SALE', 'SALE_REVERSAL', 'PURCHASE_REVERSAL')),
            quantity_delta INTEGER NOT NULL CHECK(quantity_delta <> 0),
            unit_cost_paise INTEGER NOT NULL CHECK(unit_cost_paise >= 0),
            occurred_at TEXT NOT NULL
          );
          INSERT INTO stock_movements_v2 (rowid, id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at)
            SELECT rowid, id, item_id, source_id, movement_type, quantity_delta, unit_cost_paise, occurred_at FROM stock_movements ORDER BY rowid;
          DROP TABLE stock_movements;
          ALTER TABLE stock_movements_v2 RENAME TO stock_movements;
        `);
      }

      // 4. New tables.
      db.exec(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id),
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          phone2 TEXT,
          classification TEXT,
          gstin TEXT,
          website TEXT,
          billing_address TEXT,
          shipping_address TEXT,
          internal_notes TEXT,
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_bills (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id),
          supplier_id TEXT NOT NULL REFERENCES suppliers(id),
          number TEXT NOT NULL,
          supplier_invoice_number TEXT,
          bill_date TEXT NOT NULL,
          due_date TEXT,
          notes TEXT,
          tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
          tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
          payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'PAYABLES')),
          status TEXT NOT NULL CHECK(status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS purchase_bill_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          bill_id TEXT NOT NULL REFERENCES purchase_bills(id) ON DELETE CASCADE,
          item_id TEXT REFERENCES items(id),
          description TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0)
        );

        CREATE TABLE IF NOT EXISTS expense_categories (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL REFERENCES companies(id),
          name TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          business_id TEXT NOT NULL REFERENCES businesses(id),
          supplier_id TEXT REFERENCES suppliers(id),
          category_id TEXT REFERENCES expense_categories(id),
          number TEXT NOT NULL,
          expense_date TEXT NOT NULL,
          description TEXT NOT NULL,
          amount_paise INTEGER NOT NULL CHECK(amount_paise >= 0),
          tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
          tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
          payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'PAYABLES')),
          status TEXT NOT NULL CHECK(status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS supplier_payments (
          id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL REFERENCES suppliers(id),
          bill_id TEXT REFERENCES purchase_bills(id),
          expense_id TEXT REFERENCES expenses(id),
          amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
          payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH')),
          paid_at TEXT NOT NULL,
          CHECK((bill_id IS NOT NULL AND expense_id IS NULL) OR (bill_id IS NULL AND expense_id IS NOT NULL))
        );
      `);

      // 5. Indexes (rebuilds above dropped the old ones, so recreate those too).
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_id);
        CREATE INDEX IF NOT EXISTS idx_journal_entries_source_type ON journal_entries(source_type);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, occurred_at, id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_bills_business ON purchase_bills(business_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_bills_supplier ON purchase_bills(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_bill_lines_bill ON purchase_bill_lines(bill_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_business ON expenses(business_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill ON supplier_payments(bill_id);
        CREATE INDEX IF NOT EXISTS idx_supplier_payments_expense ON supplier_payments(expense_id);
      `);

      for (const triggerSql of triggers) {
        db.exec(triggerSql);
      }

      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(`Migration v4 left ${violations.length} foreign key violation(s); rolled back.`);
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}
