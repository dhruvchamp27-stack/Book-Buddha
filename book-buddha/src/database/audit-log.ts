import type Database from "better-sqlite3";
import type { AuditEvent } from "../accounting/types.js";

/**
 * The ONLY door through which audit events are written. Every audit row goes through here
 * (enforced by single-writer.test.ts).
 */
export function appendAuditEvent(db: Database.Database, event: AuditEvent): void {
  // EXTENSION POINT (tamper-evident log): a later slice computes each event's hash, chained to the
  // previous event's hash, here and stores it alongside the row.
  db.prepare("INSERT INTO audit_events (action, entity_id, occurred_at) VALUES (?, ?, ?)").run(
    event.action,
    event.entityId,
    event.occurredAt,
  );
}
