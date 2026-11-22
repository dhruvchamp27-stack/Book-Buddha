import type Database from "better-sqlite3";

/**
 * Migration v31 body (S17-8): a quotation that is converted into an invoice keeps a LINK to it.
 * One nullable column on `invoices`, `source_quotation_id` (FK to invoices.id), plus an index so
 * "which invoices came from this quotation" is a lookup. NULL means the invoice did not come from
 * a quotation.
 *
 * ADDITIVE ONLY and IDEMPOTENT: `ALTER TABLE ... ADD COLUMN` guarded by PRAGMA table_info, and
 * `CREATE INDEX IF NOT EXISTS`. Nothing is backfilled. NOT registered here: `migrations.ts` owns
 * version numbers.
 */
export function applyQuotationLinkSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(invoices)").all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === "source_quotation_id")) {
    db.exec("ALTER TABLE invoices ADD COLUMN source_quotation_id TEXT NULL REFERENCES invoices(id)");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_source_quotation ON invoices(source_quotation_id)");
}
