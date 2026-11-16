import type Database from "better-sqlite3";
import { AUDIT_GENESIS_HASH, computeAuditHash } from "./audit-chain.js";

/**
 * Migration v8 body (wired by the orchestrator in migrations.ts): audit hardening.
 *
 *  1. Additively extends audit_events with the section-20 fields (all nullable, so existing rows
 *     survive) and the chain columns prev_hash / hash. ALTER TABLE ADD COLUMN only - never a
 *     rebuild (a rebuild is the cascade-delete hazard documented in purchasing-schema.ts).
 *  2. Backfills the hash chain over any existing rows in id order.
 *  3. Installs SCOPED append-only triggers.
 *
 * Idempotent: columns are checked first, only un-chained rows are backfilled, and the triggers are
 * dropped and re-created.
 *
 * TRIGGER REPLAY: migration v4 (purchasing-schema.ts) rebuilds journal_entries / journal_lines and
 * replays every trigger it finds in sqlite_master for those tables. Each trigger below is therefore
 * a single self-contained CREATE TRIGGER statement that depends only on its own table's columns, so
 * replaying its stored SQL verbatim after a rebuild works. A replayed trigger that names a column
 * the rebuilt table lacks would fail to create, so a rebuild must keep these columns.
 *
 * WHY SCOPED: a blanket UPDATE block on journal_entries would make any future column backfill
 * impossible (migrations v5 and v6 backfilled business_id, entry_date and fair_id). So:
 *   - identity/amount/date columns of journal_entries can never be REWRITTEN once they hold a value,
 *     but a NULL can still be filled in by a future migration, and a no-op `SET col = col` is allowed
 *     (the v5 backfill does exactly that for rows where only one of its two columns is NULL);
 *   - fair_id (a reporting tag, re-taggable by design) is deliberately NOT covered.
 */

export const AUDIT_NEW_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["actor_id", "TEXT"],
  ["company_id", "TEXT"],
  ["entity_type", "TEXT"],
  ["reason", "TEXT"],
  ["before_values", "TEXT"],
  ["after_values", "TEXT"],
  ["prev_hash", "TEXT"],
  ["hash", "TEXT"],
];

/** journal_entries columns that must never change once non-NULL (only those that exist are used). */
const JOURNAL_ENTRY_PROTECTED = [
  "id",
  "source_id",
  "source_type",
  "description",
  "is_reversal",
  "created_at",
  "business_id",
  "entry_date",
] as const;

const AUDIT_PROTECTED_COLUMNS = [
  "id",
  "action",
  "entity_id",
  "occurred_at",
  "actor_id",
  "company_id",
  "entity_type",
  "reason",
  "before_values",
  "after_values",
  "prev_hash",
  "hash",
] as const;

export const AUDIT_TRIGGER_NAMES = [
  "audit_events_no_delete",
  "audit_events_no_update",
  "journal_entries_no_delete",
  "journal_entries_no_rewrite",
  "journal_lines_no_delete",
  "journal_lines_no_update",
] as const;

const columnsOf = (db: Database.Database, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

export function applyAuditChainSchema(db: Database.Database): void {
  // Triggers off first so the backfill below can write the chain columns.
  for (const name of AUDIT_TRIGGER_NAMES) db.exec(`DROP TRIGGER IF EXISTS ${name}`);

  const existing = columnsOf(db, "audit_events");
  for (const [name, type] of AUDIT_NEW_COLUMNS) {
    if (!existing.includes(name)) db.exec(`ALTER TABLE audit_events ADD COLUMN ${name} ${type}`);
  }

  backfillChain(db);
  installTriggers(db);
}

type Row = {
  id: number;
  company_id: string | null;
  actor_id: string | null;
  entity_type: string | null;
  entity_id: string;
  action: string;
  occurred_at: string;
  reason: string | null;
  before_values: string | null;
  after_values: string | null;
};

function backfillChain(db: Database.Database): void {
  const tail = db
    .prepare("SELECT hash FROM audit_events WHERE hash IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get() as { hash: string } | undefined;
  let prev = tail?.hash ?? AUDIT_GENESIS_HASH;
  // Only un-chained rows after the last chained one; a fresh upgrade chains everything.
  const rows = db
    .prepare(
      `SELECT id, company_id, actor_id, entity_type, entity_id, action, occurred_at, reason, before_values, after_values
         FROM audit_events
        WHERE hash IS NULL AND id > COALESCE((SELECT MAX(id) FROM audit_events WHERE hash IS NOT NULL), 0)
        ORDER BY id`,
    )
    .all() as Row[];
  const update = db.prepare("UPDATE audit_events SET prev_hash = ?, hash = ? WHERE id = ?");
  for (const r of rows) {
    const hash = computeAuditHash({
      prevHash: prev,
      id: r.id,
      companyId: r.company_id,
      actorId: r.actor_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      occurredAt: r.occurred_at,
      reason: r.reason,
      beforeValues: r.before_values,
      afterValues: r.after_values,
    });
    update.run(prev, hash, r.id);
    prev = hash;
  }
}

function installTriggers(db: Database.Database): void {
  const abort = (msg: string) => `SELECT RAISE(ABORT, '${msg}');`;

  db.exec(`
    CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
    BEGIN ${abort("audit_events is append-only: rows cannot be deleted")} END;
  `);
  db.exec(`
    CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OF ${AUDIT_PROTECTED_COLUMNS.join(", ")} ON audit_events
    BEGIN ${abort("audit_events is append-only: rows cannot be changed")} END;
  `);
  db.exec(`
    CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
    BEGIN ${abort("journal_entries is immutable: correct with a reversal, never a delete")} END;
  `);
  db.exec(`
    CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines
    BEGIN ${abort("journal_lines is immutable: correct with a reversal, never a delete")} END;
  `);
  db.exec(`
    CREATE TRIGGER journal_lines_no_update
    BEFORE UPDATE OF account, debit_paise, credit_paise, journal_entry_id ON journal_lines
    BEGIN ${abort("journal_lines is immutable: correct with a reversal, never an edit")} END;
  `);

  const present = columnsOf(db, "journal_entries");
  const cols = JOURNAL_ENTRY_PROTECTED.filter((c) => present.includes(c));
  const changed = cols.map((c) => `(OLD.${c} IS NOT NULL AND NEW.${c} IS NOT OLD.${c})`).join(" OR ");
  db.exec(`
    CREATE TRIGGER journal_entries_no_rewrite
    BEFORE UPDATE OF ${cols.join(", ")} ON journal_entries
    WHEN ${changed}
    BEGIN ${abort("journal_entries is immutable: a value already recorded cannot be rewritten")} END;
  `);
}
