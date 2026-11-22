import type Database from "better-sqlite3";

/**
 * Migration v32 body (S17, slow-test fix): an index on invoices(business_id, number).
 *
 * The D11 rule (S16-7) checks an invoice number is free in its business on every save and finalize
 * (`assertInvoiceNumberFree`), and S17-4 numbering reads the highest number in a business's series.
 * Without this index both scan every invoice of the business, so a 2,000-invoice import slowed as it
 * grew (measured 0.79 → 1.05 s per 500; with the index ~0.5–0.64 s, flat).
 *
 * Index only, NOT unique: D11 deliberately added no unique index until existing data is scanned
 * (quotations and imported numbers share the table). IDEMPOTENT via IF NOT EXISTS.
 */
export function applyInvoiceNumberIndexSchema(db: Database.Database): void {
  db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_business_number ON invoices(business_id, number)");
}
