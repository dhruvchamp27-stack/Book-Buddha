import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import type { AuditEvent } from "../accounting/types.js";
import { AUDIT_GENESIS_HASH, computeAuditHash, stableStringify } from "./audit-chain.js";

/**
 * An audit event. The three original fields are all existing callers pass; everything else is
 * OPTIONAL (section 20) and is stored as NULL when omitted, so one-arg-shape calls keep working.
 */
export interface AuditEventInput extends AuditEvent {
  readonly actorId?: string;
  readonly companyId?: string;
  readonly entityType?: string;
  readonly reason?: string;
  /** Any JSON-serialisable value; stored as canonical (sorted-key) JSON text. */
  readonly beforeValues?: unknown;
  readonly afterValues?: unknown;
}

/**
 * The signed-in user for the request being handled. The API enters this store (preHandler hook)
 * so every audit event written during the request carries the actor without each call site
 * passing it. An explicit `event.actorId` still wins. Outside a request the store is empty (NULL).
 */
export const auditActor = new AsyncLocalStorage<string>();

// Once a database is seen to have the chain columns it always will (columns are never dropped),
// so only the positive answer is cached. A database migrated later is simply re-checked.
const chainReady = new WeakSet<Database.Database>();

function hasChainColumns(db: Database.Database): boolean {
  if (chainReady.has(db)) return true;
  const cols = db.prepare("PRAGMA table_info(audit_events)").all() as Array<{ name: string }>;
  const ready = cols.some((c) => c.name === "hash") && cols.some((c) => c.name === "prev_hash");
  if (ready) chainReady.add(db);
  return ready;
}

const jsonOrNull = (v: unknown): string | null => (v === undefined ? null : stableStringify(v));

/**
 * The ONLY door through which audit events are written. Every audit row goes through here
 * (enforced by single-writer.test.ts).
 *
 * When the chain columns exist (migration v8) the event is sealed into a SHA-256 hash chain
 * computed here in Node (SQLite has no SHA function). Before v8 it falls back to the legacy
 * three-column insert so this file never breaks an un-migrated database.
 */
export function appendAuditEvent(db: Database.Database, event: AuditEventInput): void {
  if (!hasChainColumns(db)) {
    db.prepare("INSERT INTO audit_events (action, entity_id, occurred_at) VALUES (?, ?, ?)").run(
      event.action,
      event.entityId,
      event.occurredAt,
    );
    return;
  }

  // Read-previous-hash + insert must be atomic (nests as a savepoint inside a caller's transaction).
  db.transaction(() => {
    const last = db.prepare("SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1").get() as
      | { hash: string | null }
      | undefined;
    const prevHash = last === undefined ? AUDIT_GENESIS_HASH : last.hash;
    if (prevHash === null) {
      throw new Error("Audit chain is broken: the latest audit event has no hash. Run verifyAuditChain.");
    }
    // AUTOINCREMENT never reuses ids, so the next id is sqlite_sequence + 1. We assign it explicitly
    // so the id can be sealed into the hash.
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'").get() as
      | { seq: number }
      | undefined;
    const id = (seq?.seq ?? 0) + 1;

    const companyId = event.companyId ?? null;
    const actorId = event.actorId ?? auditActor.getStore() ?? null;
    const entityType = event.entityType ?? null;
    const reason = event.reason ?? null;
    const beforeValues = jsonOrNull(event.beforeValues);
    const afterValues = jsonOrNull(event.afterValues);
    const hash = computeAuditHash({
      prevHash,
      id,
      companyId,
      actorId,
      entityType,
      entityId: event.entityId,
      action: event.action,
      occurredAt: event.occurredAt,
      reason,
      beforeValues,
      afterValues,
    });
    db.prepare(
      `INSERT INTO audit_events
         (id, action, entity_id, occurred_at, actor_id, company_id, entity_type, reason, before_values, after_values, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      event.action,
      event.entityId,
      event.occurredAt,
      actorId,
      companyId,
      entityType,
      reason,
      beforeValues,
      afterValues,
      prevHash,
      hash,
    );
  })();
}

export type AuditChainFailure =
  | "UNCHAINED_ROW" // a row has no hash
  | "PREV_LINK_BROKEN" // prev_hash does not equal the previous row's hash: a row was deleted, inserted or reordered
  | "HASH_MISMATCH" // the row's own values no longer match its hash: it was edited
  | "BAD_VALUE_TYPE" // a column holds a non-text value where text is required
  | "TAIL_TRUNCATED"; // rows at the end were removed (sqlite_sequence is ahead of the last row)

export type AuditChainReport =
  | { readonly ok: true; readonly checked: number; readonly headHash: string }
  | {
      readonly ok: false;
      readonly checked: number;
      /** id of the first row where verification failed (the last surviving row for TAIL_TRUNCATED). */
      readonly brokenAtId: number;
      /** 1-based position in id order. */
      readonly position: number;
      readonly failure: AuditChainFailure;
      readonly message: string;
    };

interface ChainRow {
  id: number;
  company_id: unknown;
  actor_id: unknown;
  entity_type: unknown;
  entity_id: unknown;
  action: unknown;
  occurred_at: unknown;
  reason: unknown;
  before_values: unknown;
  after_values: unknown;
  prev_hash: unknown;
  hash: unknown;
}

const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Walks the whole chain in id order and reports the first break (or ok). Read-only. */
export function verifyAuditChain(db: Database.Database): AuditChainReport {
  const rows = db
    .prepare(
      `SELECT id, company_id, actor_id, entity_type, entity_id, action, occurred_at, reason,
              before_values, after_values, prev_hash, hash
         FROM audit_events ORDER BY id`,
    )
    .all() as ChainRow[];

  let expectedPrev = AUDIT_GENESIS_HASH;
  let position = 0;
  const fail = (row: ChainRow, failure: AuditChainFailure, message: string): AuditChainReport => ({
    ok: false,
    checked: position - 1,
    brokenAtId: row.id,
    position,
    failure,
    message,
  });

  for (const row of rows) {
    position += 1;
    if (row.hash === null || row.hash === undefined) {
      return fail(row, "UNCHAINED_ROW", `Audit event #${row.id} (position ${position}) has no hash.`);
    }
    const text = [
      row.company_id, row.actor_id, row.entity_type, row.reason, row.before_values, row.after_values,
    ];
    if (
      !text.every(isTextOrNull) ||
      typeof row.entity_id !== "string" ||
      typeof row.action !== "string" ||
      typeof row.occurred_at !== "string" ||
      typeof row.prev_hash !== "string" ||
      typeof row.hash !== "string"
    ) {
      return fail(row, "BAD_VALUE_TYPE", `Audit event #${row.id} (position ${position}) holds a non-text value.`);
    }
    if (row.prev_hash !== expectedPrev) {
      return fail(
        row,
        "PREV_LINK_BROKEN",
        `Audit event #${row.id} (position ${position}) does not link to the event before it: an earlier event was deleted, inserted, reordered or re-hashed.`,
      );
    }
    const recomputed = computeAuditHash({
      prevHash: row.prev_hash,
      id: row.id,
      companyId: row.company_id as string | null,
      actorId: row.actor_id as string | null,
      entityType: row.entity_type as string | null,
      entityId: row.entity_id,
      action: row.action,
      occurredAt: row.occurred_at,
      reason: row.reason as string | null,
      beforeValues: row.before_values as string | null,
      afterValues: row.after_values as string | null,
    });
    if (recomputed !== row.hash) {
      return fail(
        row,
        "HASH_MISMATCH",
        `Audit event #${row.id} (position ${position}) was edited: its contents no longer match its hash.`,
      );
    }
    expectedPrev = row.hash;
  }

  // Tail truncation: AUTOINCREMENT remembers the highest id ever issued.
  const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'audit_events'").get() as
    | { seq: number }
    | undefined;
  const lastId = rows.length === 0 ? 0 : rows[rows.length - 1]!.id;
  if (seq !== undefined && seq.seq > lastId) {
    return {
      ok: false,
      checked: rows.length,
      brokenAtId: lastId,
      position: rows.length,
      failure: "TAIL_TRUNCATED",
      message: `Audit events after #${lastId} were removed (ids up to #${seq.seq} were issued).`,
    };
  }

  return { ok: true, checked: rows.length, headHash: expectedPrev };
}
