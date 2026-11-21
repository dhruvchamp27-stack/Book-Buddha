import type Database from "better-sqlite3";

/**
 * v23 - the PAYMENT MODE list (spec §9.1; Dhruv S15: "payment mode can be any cash or bank ... like
 * NEFT, RTGS, UPI and other types"). A mode is HOW money moved; the money account (CASH / a bank) is
 * WHERE it went. They are separate on purpose: a UPI receipt can land in any bank.
 *
 * ADDITIVE ONLY: one new table. System modes have company_id NULL and are shared by every company;
 * a company may add its own (company_id set). `code` is immutable and unique; `label` is renameable;
 * a mode is never deleted, only deactivated, so old payments keep a valid mode.
 *
 * Seeds the FROZEN list below. Idempotent: re-running inserts nothing that already exists.
 * NOT registered here; `migrations.ts` owns version numbers.
 */
export const V23_PAYMENT_MODES: ReadonlyArray<{ code: string; label: string; sortOrder: number }> = [
  { code: "CASH", label: "Cash", sortOrder: 10 },
  { code: "NEFT", label: "NEFT", sortOrder: 20 },
  { code: "RTGS", label: "RTGS", sortOrder: 30 },
  { code: "IMPS", label: "IMPS", sortOrder: 40 },
  { code: "UPI", label: "UPI", sortOrder: 50 },
  { code: "CHEQUE", label: "Cheque", sortOrder: 60 },
  { code: "OTHER", label: "Other", sortOrder: 90 },
];

export function applyPaymentModesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_modes (
      code TEXT PRIMARY KEY CHECK(length(code) BETWEEN 2 AND 40),
      company_id TEXT REFERENCES companies(id),
      label TEXT NOT NULL CHECK(length(trim(label)) > 0),
      sort_order INTEGER NOT NULL DEFAULT 100,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO payment_modes (code, company_id, label, sort_order, active, created_at, updated_at) VALUES (?, NULL, ?, ?, 1, ?, ?)",
  );
  for (const mode of V23_PAYMENT_MODES) insert.run(mode.code, mode.label, mode.sortOrder, now, now);
}
