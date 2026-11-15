import type Database from "better-sqlite3";

export function initializeSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      accounting_basis TEXT NOT NULL DEFAULT 'ACCRUAL' CHECK(accounting_basis IN ('CASH', 'ACCRUAL')),
      financial_year_start_month INTEGER NOT NULL DEFAULT 4,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(company_id, name)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fairs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      host_customer_id TEXT NOT NULL REFERENCES customers(id),
      name TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      track_stock INTEGER NOT NULL DEFAULT 0 CHECK(track_stock IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      fair_id TEXT REFERENCES fairs(id),
      buyer_name TEXT,
      buyer_contact TEXT,
      number TEXT NOT NULL,
      invoice_date TEXT,
      due_date TEXT,
      discount_paise INTEGER NOT NULL DEFAULT 0 CHECK(discount_paise >= 0),
      extra_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK(extra_charge_paise >= 0),
      notes TEXT,
      payment_terms TEXT,
      tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
      tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
      payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'RECEIVABLES')),
      status TEXT NOT NULL CHECK(status IN ('DRAFT', 'QUOTATION', 'FINALIZED', 'CANCELLED')),
      converted_invoice_id TEXT REFERENCES invoices(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES items(id),
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      number TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credit_note_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES items(id),
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0)
    );

    CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES invoices(id),
      description TEXT NOT NULL,
      is_reversal INTEGER NOT NULL CHECK(is_reversal IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account TEXT NOT NULL CHECK(account IN ('CASH', 'RECEIVABLES', 'SALES', 'INVENTORY', 'COGS', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST')),
      debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0),
      credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0),
      CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0))
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
      payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH')),
      paid_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id),
      source_id TEXT,
      movement_type TEXT NOT NULL CHECK(movement_type IN ('OPENING', 'PURCHASE', 'ADJUSTMENT', 'SALE', 'SALE_REVERSAL')),
      quantity_delta INTEGER NOT NULL CHECK(quantity_delta <> 0),
      unit_cost_paise INTEGER NOT NULL CHECK(unit_cost_paise >= 0),
      occurred_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_invoice_templates (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      customer_id TEXT NOT NULL REFERENCES customers(id),
      fair_id TEXT REFERENCES fairs(id),
      buyer_name TEXT,
      buyer_contact TEXT,
      payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'RECEIVABLES')),
      tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
      tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
      discount_paise INTEGER NOT NULL DEFAULT 0 CHECK(discount_paise >= 0),
      extra_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK(extra_charge_paise >= 0),
      notes TEXT,
      payment_terms TEXT,
      frequency TEXT NOT NULL CHECK(frequency IN ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY')),
      interval_count INTEGER NOT NULL DEFAULT 1 CHECK(interval_count >= 1),
      start_date TEXT NOT NULL,
      next_run_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_invoice_template_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id TEXT NOT NULL REFERENCES recurring_invoice_templates(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES items(id),
      description TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_paise INTEGER NOT NULL CHECK(unit_price_paise >= 0)
    );

    CREATE INDEX IF NOT EXISTS idx_recurring_templates_due ON recurring_invoice_templates(active, next_run_date);
    CREATE INDEX IF NOT EXISTS idx_invoices_business ON invoices(business_id);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_id);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_id, occurred_at, id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_source ON stock_movements(source_id);
  `);
  const invoiceLineColumns = db
    .prepare("PRAGMA table_info(invoice_lines)")
    .all() as Array<{ name: string }>;
  const companyColumns = db
    .prepare("PRAGMA table_info(companies)")
    .all() as Array<{ name: string }>;
  if (!companyColumns.some((column) => column.name === "accounting_basis")) {
    db.exec("ALTER TABLE companies ADD COLUMN accounting_basis TEXT NOT NULL DEFAULT 'ACCRUAL' CHECK(accounting_basis IN ('CASH', 'ACCRUAL'))");
  }
  if (!invoiceLineColumns.some((column) => column.name === "item_id")) {
    db.exec("ALTER TABLE invoice_lines ADD COLUMN item_id TEXT REFERENCES items(id)");
  }
  const invoiceColumns = db
    .prepare("PRAGMA table_info(invoices)")
    .all() as Array<{ name: string }>;
  if (!invoiceColumns.some((column) => column.name === "fair_id")) {
    db.exec("ALTER TABLE invoices ADD COLUMN fair_id TEXT REFERENCES fairs(id)");
  }
  if (!invoiceColumns.some((column) => column.name === "buyer_name")) {
    db.exec("ALTER TABLE invoices ADD COLUMN buyer_name TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "buyer_contact")) {
    db.exec("ALTER TABLE invoices ADD COLUMN buyer_contact TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "invoice_date")) {
    db.exec("ALTER TABLE invoices ADD COLUMN invoice_date TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "due_date")) {
    db.exec("ALTER TABLE invoices ADD COLUMN due_date TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "discount_paise")) {
    db.exec("ALTER TABLE invoices ADD COLUMN discount_paise INTEGER NOT NULL DEFAULT 0 CHECK(discount_paise >= 0)");
  }
  if (!invoiceColumns.some((column) => column.name === "extra_charge_paise")) {
    db.exec("ALTER TABLE invoices ADD COLUMN extra_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK(extra_charge_paise >= 0)");
  }
  if (!invoiceColumns.some((column) => column.name === "notes")) {
    db.exec("ALTER TABLE invoices ADD COLUMN notes TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "payment_terms")) {
    db.exec("ALTER TABLE invoices ADD COLUMN payment_terms TEXT");
  }
  if (!invoiceColumns.some((column) => column.name === "converted_invoice_id")) {
    db.exec("ALTER TABLE invoices ADD COLUMN converted_invoice_id TEXT REFERENCES invoices(id)");
  }
  const invoiceTableSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'invoices'")
    .get() as { sql: string } | undefined;
  if (invoiceTableSql !== undefined && !invoiceTableSql.sql.includes("'QUOTATION'")) {
    db.pragma("foreign_keys = OFF");
    db.exec(`
      CREATE TABLE invoices_v2 (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL REFERENCES businesses(id),
        customer_id TEXT NOT NULL REFERENCES customers(id),
        fair_id TEXT REFERENCES fairs(id),
        buyer_name TEXT,
        buyer_contact TEXT,
        number TEXT NOT NULL,
        invoice_date TEXT,
        due_date TEXT,
        discount_paise INTEGER NOT NULL DEFAULT 0 CHECK(discount_paise >= 0),
        extra_charge_paise INTEGER NOT NULL DEFAULT 0 CHECK(extra_charge_paise >= 0),
        notes TEXT,
        payment_terms TEXT,
        tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK(tax_type IN ('NONE', 'CGST_SGST', 'IGST')),
        tax_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate_basis_points >= 0 AND tax_rate_basis_points <= 10000),
        payment_account TEXT NOT NULL CHECK(payment_account IN ('CASH', 'RECEIVABLES')),
        status TEXT NOT NULL CHECK(status IN ('DRAFT', 'QUOTATION', 'FINALIZED', 'CANCELLED')),
        converted_invoice_id TEXT REFERENCES invoices_v2(id),
        created_at TEXT NOT NULL
      );
      INSERT INTO invoices_v2
        SELECT id, business_id, customer_id, fair_id, buyer_name, buyer_contact, number,
          invoice_date, due_date, discount_paise, extra_charge_paise, notes, payment_terms,
          tax_type, tax_rate_basis_points, payment_account, status, converted_invoice_id, created_at
        FROM invoices;
      DROP TABLE invoices;
      ALTER TABLE invoices_v2 RENAME TO invoices;
    `);
    db.pragma("foreign_keys = ON");
  }
  if (!invoiceColumns.some((column) => column.name === "tax_type")) {
    db.exec("ALTER TABLE invoices ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'NONE'");
  }
  if (!invoiceColumns.some((column) => column.name === "tax_rate_basis_points")) {
    db.exec("ALTER TABLE invoices ADD COLUMN tax_rate_basis_points INTEGER NOT NULL DEFAULT 0");
  }
  const journalLineSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'journal_lines'")
    .get() as { sql: string } | undefined;
  if (journalLineSql !== undefined && !journalLineSql.sql.includes("'OUTPUT_CGST'")) {
    db.exec(`
      CREATE TABLE journal_lines_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account TEXT NOT NULL CHECK(account IN ('CASH', 'RECEIVABLES', 'SALES', 'INVENTORY', 'COGS', 'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST')),
        debit_paise INTEGER NOT NULL CHECK(debit_paise >= 0),
        credit_paise INTEGER NOT NULL CHECK(credit_paise >= 0),
        CHECK((debit_paise = 0 AND credit_paise > 0) OR (debit_paise > 0 AND credit_paise = 0))
      );
      INSERT INTO journal_lines_v2 (id, journal_entry_id, account, debit_paise, credit_paise)
        SELECT id, journal_entry_id, account, debit_paise, credit_paise FROM journal_lines;
      DROP TABLE journal_lines;
      ALTER TABLE journal_lines_v2 RENAME TO journal_lines;
    `);
  }
}
