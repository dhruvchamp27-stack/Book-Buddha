import type Database from "better-sqlite3";

/**
 * Metadata for stored documents (invoice PDFs, bill scans, receipts...).
 * The file bytes live on disk, outside SQLite; only this row is in the database.
 * `stored_filename` is a name WE generated - never the user's original name.
 */
export function applyAttachmentsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN (
        'INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'EXPENSE', 'CUSTOMER', 'SUPPLIER', 'FAIR'
      )),
      entity_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
      sha256 TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_entity
      ON attachments(entity_type, entity_id);
  `);
}
