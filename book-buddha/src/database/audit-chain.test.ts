import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AUDIT_GENESIS_HASH, canonicalAuditBytes, computeAuditHash, type AuditHashFields } from "./audit-chain.js";
import { applyAuditChainSchema, AUDIT_TRIGGER_NAMES } from "./audit-chain-schema.js";
import { appendAuditEvent, verifyAuditChain } from "./audit-log.js";
import { migrations, runMigrations } from "./migrations.js";

/** A database at the schema before audit hardening (versions below 8), whether or not v8 is wired. */
function preV8Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  runMigrations(db, migrations.filter((m) => m.version < 8));
  db.pragma("foreign_keys = OFF"); // migrations turn it back on; tests insert journal rows without a full invoice graph
  return db;
}

function chainedDb(): Database.Database {
  const db = preV8Db();
  applyAuditChainSchema(db);
  return db;
}

const ev = (n: number) => ({ action: `ACT_${n}`, entityId: `ent-${n}`, occurredAt: `2026-01-0${n}T00:00:00.000Z` });

function seed(db: Database.Database, count = 5): void {
  for (let i = 1; i <= count; i++) appendAuditEvent(db, ev(i));
}

/** What a tamperer with file access would do first: remove the guard triggers. */
function dropGuards(db: Database.Database): void {
  for (const name of AUDIT_TRIGGER_NAMES) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
}

describe("audit hash chain", () => {
  it("a normal sequence of events verifies ok", () => {
    const db = chainedDb();
    expect(verifyAuditChain(db)).toEqual({ ok: true, checked: 0, headHash: AUDIT_GENESIS_HASH });
    seed(db);
    const report = verifyAuditChain(db);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(5);
    const first = db.prepare("SELECT prev_hash FROM audit_events WHERE id = 1").get() as { prev_hash: string };
    expect(first.prev_hash).toBe(AUDIT_GENESIS_HASH);
  });

  it("existing one-arg-shape appendAuditEvent calls still work, and optional fields are stored", () => {
    const db = chainedDb();
    appendAuditEvent(db, { action: "INVOICE_FINALIZED", entityId: "inv1", occurredAt: "2026-01-01T00:00:00.000Z" });
    appendAuditEvent(db, {
      ...ev(2),
      actorId: "user-1",
      companyId: "co-1",
      entityType: "INVOICE",
      reason: "customer asked",
      beforeValues: { b: 1, a: { y: 2, x: 1 } },
      afterValues: { total_paise: 12345 },
    });
    const row = db.prepare("SELECT * FROM audit_events WHERE id = 2").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      actor_id: "user-1",
      company_id: "co-1",
      entity_type: "INVOICE",
      reason: "customer asked",
      before_values: '{"a":{"x":1,"y":2},"b":1}',
      after_values: '{"total_paise":12345}',
    });
    const bare = db.prepare("SELECT actor_id, reason, before_values FROM audit_events WHERE id = 1").get();
    expect(bare).toEqual({ actor_id: null, reason: null, before_values: null });
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("still appends on a database that has not been migrated to the chain yet", () => {
    const db = preV8Db();
    appendAuditEvent(db, ev(1));
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_events").get()).toEqual({ n: 1 });
  });

  it("appends inside a caller's transaction and rolls back cleanly", () => {
    const db = chainedDb();
    seed(db, 2);
    const tx = db.transaction(() => {
      appendAuditEvent(db, ev(3));
      throw new Error("boom");
    });
    expect(() => tx()).toThrow("boom");
    appendAuditEvent(db, ev(4));
    const report = verifyAuditChain(db);
    expect(report.ok).toBe(true);
    expect(report.checked).toBe(3);
  });

  it.each([
    ["action", "'TAMPERED'"],
    ["entity_id", "'other'"],
    ["occurred_at", "'1999-01-01'"],
    ["reason", "'x'"],
    ["after_values", "'{}'"],
    ["actor_id", "'mallory'"],
  ])("detects an edit to %s of a middle row and names that row", (col, value) => {
    const db = chainedDb();
    seed(db);
    expect(() => db.exec(`UPDATE audit_events SET ${col} = ${value} WHERE id = 3`)).toThrow(/append-only/);
    dropGuards(db);
    db.exec(`UPDATE audit_events SET ${col} = ${value} WHERE id = 3`);
    const report = verifyAuditChain(db);
    expect(report).toMatchObject({ ok: false, brokenAtId: 3, position: 3, failure: "HASH_MISMATCH" });
  });

  it("detects an edit even when the tamperer recomputes that row's hash (the next row no longer links)", () => {
    const db = chainedDb();
    seed(db);
    dropGuards(db);
    const row = db.prepare("SELECT * FROM audit_events WHERE id = 3").get() as Record<string, string | number | null>;
    const hash = computeAuditHash({
      prevHash: row.prev_hash as string,
      id: 3,
      companyId: null,
      actorId: null,
      entityType: null,
      entityId: "forged",
      action: row.action as string,
      occurredAt: row.occurred_at as string,
      reason: null,
      beforeValues: null,
      afterValues: null,
    });
    db.prepare("UPDATE audit_events SET entity_id = 'forged', hash = ? WHERE id = 3").run(hash);
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: 4, failure: "PREV_LINK_BROKEN" });
  });

  it("refuses a direct DELETE of an audit event, and detects a delete done with the guards removed", () => {
    const db = chainedDb();
    seed(db);
    expect(() => db.exec("DELETE FROM audit_events WHERE id = 3")).toThrow(/append-only/);
    dropGuards(db);
    db.exec("DELETE FROM audit_events WHERE id = 3");
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: 4, position: 3, failure: "PREV_LINK_BROKEN" });
  });

  it("detects the first row being deleted, and the last rows being deleted", () => {
    const first = chainedDb();
    seed(first);
    dropGuards(first);
    first.exec("DELETE FROM audit_events WHERE id = 1");
    expect(verifyAuditChain(first)).toMatchObject({ ok: false, brokenAtId: 2, failure: "PREV_LINK_BROKEN" });

    const tail = chainedDb();
    seed(tail);
    dropGuards(tail);
    tail.exec("DELETE FROM audit_events WHERE id >= 4");
    expect(verifyAuditChain(tail)).toMatchObject({ ok: false, brokenAtId: 3, failure: "TAIL_TRUNCATED" });
  });

  it("detects a delete done by copying the rows into a fresh table without the victim", () => {
    const db = chainedDb();
    seed(db);
    dropGuards(db);
    db.exec(`
      CREATE TABLE audit_copy AS SELECT * FROM audit_events WHERE id <> 2;
      DROP TABLE audit_events;
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
        actor_id TEXT, company_id TEXT, entity_type TEXT, reason TEXT, before_values TEXT, after_values TEXT,
        prev_hash TEXT, hash TEXT);
      INSERT INTO audit_events SELECT * FROM audit_copy;
    `);
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: 3, failure: "PREV_LINK_BROKEN" });
  });

  it("detects reordered / renumbered rows", () => {
    const db = chainedDb();
    seed(db);
    expect(() => db.exec("UPDATE audit_events SET id = 99 WHERE id = 2")).toThrow(/append-only/);
    dropGuards(db);
    db.exec("UPDATE audit_events SET id = 99 WHERE id = 2");
    db.exec("UPDATE audit_events SET id = 2 WHERE id = 3");
    db.exec("UPDATE audit_events SET id = 3 WHERE id = 99");
    // Rows 2 and 3 have swapped places in id order.
    const report = verifyAuditChain(db);
    expect(report).toMatchObject({ ok: false, brokenAtId: 2, position: 2 });
  });

  it("detects a forged row appended with a self-consistent hash but the wrong prev_hash", () => {
    const db = chainedDb();
    seed(db, 3);
    dropGuards(db);
    const id = 4;
    const forgedPrev = AUDIT_GENESIS_HASH; // attacker pretends the chain restarts
    const hash = computeAuditHash({
      prevHash: forgedPrev,
      id,
      companyId: null,
      actorId: null,
      entityType: null,
      entityId: "fake",
      action: "FAKE",
      occurredAt: "2026-02-02T00:00:00.000Z",
      reason: null,
      beforeValues: null,
      afterValues: null,
    });
    db.prepare(
      "INSERT INTO audit_events (id, action, entity_id, occurred_at, prev_hash, hash) VALUES (?, 'FAKE', 'fake', '2026-02-02T00:00:00.000Z', ?, ?)",
    ).run(id, forgedPrev, hash);
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: 4, failure: "PREV_LINK_BROKEN" });
  });

  it("detects an appended row with no hash at all", () => {
    const db = chainedDb();
    seed(db, 2);
    db.exec("INSERT INTO audit_events (action, entity_id, occurred_at) VALUES ('RAW', 'x', '2026-01-01')");
    expect(verifyAuditChain(db)).toMatchObject({ ok: false, brokenAtId: 3, failure: "UNCHAINED_ROW" });
    // The writer also refuses to extend a broken chain.
    expect(() => appendAuditEvent(db, ev(4))).toThrow(/broken/);
  });

  it("different events whose values differ only in where a delimiter falls hash differently", () => {
    const base: AuditHashFields = {
      prevHash: "p",
      id: 1,
      companyId: null,
      actorId: null,
      entityType: null,
      entityId: "ab",
      action: "c",
      occurredAt: "t",
      reason: null,
      beforeValues: null,
      afterValues: null,
    };
    const shifted = { ...base, entityId: "a", action: "bc" };
    expect(computeAuditHash(base)).not.toEqual(computeAuditHash(shifted));

    // Values that contain the encoding's own markers.
    const a = { ...base, entityId: "x;S1:y", action: "z" };
    const b = { ...base, entityId: "x", action: "S1:y;S1:z" };
    expect(canonicalAuditBytes(a).equals(canonicalAuditBytes(b))).toBe(false);
    expect(computeAuditHash(a)).not.toEqual(computeAuditHash(b));

    // null vs empty string, and a value moved between neighbouring optional fields.
    expect(computeAuditHash({ ...base, reason: null })).not.toEqual(computeAuditHash({ ...base, reason: "" }));
    expect(computeAuditHash({ ...base, reason: "r", beforeValues: null })).not.toEqual(
      computeAuditHash({ ...base, reason: null, beforeValues: "r" }),
    );
    // Multi-byte text is length-prefixed by BYTES, so it cannot collide with a shifted ASCII value.
    expect(computeAuditHash({ ...base, entityId: "₹", action: "" })).not.toEqual(
      computeAuditHash({ ...base, entityId: "", action: "₹" }),
    );
  });

  it("the same delimiter-ambiguity pair, written through appendAuditEvent, gives different stored hashes", () => {
    const db1 = chainedDb();
    const db2 = chainedDb();
    appendAuditEvent(db1, { action: "A;B", entityId: "C", occurredAt: "t" });
    appendAuditEvent(db2, { action: "A", entityId: "B;C", occurredAt: "t" });
    const h = (db: Database.Database) => (db.prepare("SELECT hash FROM audit_events").get() as { hash: string }).hash;
    expect(h(db1)).not.toEqual(h(db2));
  });
});

describe("applyAuditChainSchema", () => {
  it("backfills a valid chain over pre-existing rows, then continues it", () => {
    const db = preV8Db();
    for (let i = 1; i <= 4; i++) appendAuditEvent(db, ev(i)); // legacy three-column rows
    applyAuditChainSchema(db);
    const report = verifyAuditChain(db);
    expect(report).toMatchObject({ ok: true, checked: 4 });
    appendAuditEvent(db, ev(5));
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, checked: 5 });
  });

  it("is idempotent and does not disturb an existing chain", () => {
    const db = chainedDb();
    seed(db, 3);
    const before = db.prepare("SELECT hash FROM audit_events ORDER BY id").all();
    applyAuditChainSchema(db);
    applyAuditChainSchema(db);
    expect(db.prepare("SELECT hash FROM audit_events ORDER BY id").all()).toEqual(before);
    expect(verifyAuditChain(db).ok).toBe(true);
  });

  it("adds all section-20 columns additively", () => {
    const db = chainedDb();
    const cols = (db.prepare("PRAGMA table_info(audit_events)").all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ["actor_id", "company_id", "entity_type", "reason", "before_values", "after_values", "prev_hash", "hash"]) {
      expect(cols).toContain(c);
    }
  });
});

describe("append-only triggers", () => {
  function withJournal(): Database.Database {
    const db = chainedDb();
    db.exec(`
      INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date)
        VALUES ('je1', 'inv1', 'Invoice', 0, '2026-01-01', 'INVOICE', 'b1', NULL);
      INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise)
        VALUES ('je1', 'CASH', 100, 0), ('je1', 'SALES', 0, 100);
    `);
    return db;
  }

  it("refuses a direct UPDATE of a journal line's amount, account or entry", () => {
    const db = withJournal();
    expect(() => db.exec("UPDATE journal_lines SET debit_paise = 999 WHERE account = 'CASH'")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_lines SET account = 'SALES' WHERE account = 'CASH'")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_lines SET journal_entry_id = 'zz'")).toThrow(/immutable/);
    expect(db.prepare("SELECT debit_paise FROM journal_lines WHERE account = 'CASH'").get()).toEqual({ debit_paise: 100 });
  });

  it("refuses a direct DELETE of a journal entry or line", () => {
    const db = withJournal();
    expect(() => db.exec("DELETE FROM journal_entries WHERE id = 'je1'")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM journal_lines")).toThrow(/immutable/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM journal_lines").get()).toEqual({ n: 2 });
  });

  it("lets a NULL journal_entries column be backfilled, but never rewrites a recorded value", () => {
    const db = withJournal();
    // entry_date is NULL: a future migration may fill it (and may re-set an already-set column to itself).
    db.exec("UPDATE journal_entries SET business_id = COALESCE(business_id, 'zz'), entry_date = '2026-01-01' WHERE id = 'je1'");
    expect(db.prepare("SELECT business_id, entry_date FROM journal_entries").get()).toEqual({
      business_id: "b1",
      entry_date: "2026-01-01",
    });
    expect(() => db.exec("UPDATE journal_entries SET entry_date = '2030-01-01'")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_entries SET business_id = 'other'")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_entries SET description = 'edited'")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_entries SET id = 'je2'")).toThrow(/immutable/);
    // The fair_id reporting tag stays re-taggable.
    db.exec("UPDATE journal_entries SET fair_id = 'fairB'");
  });

  it("survives migration v4's replay pattern: stored trigger SQL can be dropped and re-created verbatim", () => {
    const db = withJournal();
    const stored = (db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('journal_entries', 'journal_lines')")
      .all() as Array<{ name: string; sql: string }>);
    expect(stored.length).toBe(4);
    for (const t of stored) db.exec(`DROP TRIGGER ${t.name}`);
    for (const t of stored) db.exec(t.sql);
    expect(() => db.exec("DELETE FROM journal_entries")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_lines SET credit_paise = 1")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_entries SET description = 'x'")).toThrow(/immutable/);
  });
});

/**
 * The regression guard for the real defect: every test above builds its database by calling
 * applyAuditChainSchema directly, so all 26 of them passed while the schema was NEVER registered
 * in the migrations list and the hardening was inert in the shipped app. These tests go through
 * the ordinary migration path only, exactly as the app bootstrap does.
 */
describe("audit hardening is wired into the migration path", () => {
  const migrated = (): Database.Database => {
    const db = new Database(":memory:");
    runMigrations(db);
    return db;
  };

  it("runMigrations alone installs the chain columns and every guard trigger", () => {
    const db = migrated();
    const cols = (db.prepare("PRAGMA table_info(audit_events)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("prev_hash");
    expect(cols).toContain("hash");
    const installed = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{ name: string }>)
      .map((t) => t.name);
    for (const name of AUDIT_TRIGGER_NAMES) expect(installed).toContain(name);
  });

  it("events appended to a plainly migrated database are chained and verify", () => {
    const db = migrated();
    seed(db, 3);
    expect(verifyAuditChain(db)).toMatchObject({ ok: true, checked: 3 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE hash IS NULL").get()).toEqual({ n: 0 });
  });

  it("a plainly migrated database refuses to delete or rewrite journal history", () => {
    const db = migrated();
    seed(db, 1);
    // A row trigger needs a row to fire on, and these journal rows have no invoice behind them.
    db.pragma("foreign_keys = OFF");
    db.exec(`
      INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date)
        VALUES ('je1', 'inv1', 'Invoice', 0, '2026-01-01', 'INVOICE', 'b1', '2026-01-01');
      INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise)
        VALUES ('je1', 'CASH', 100, 0), ('je1', 'SALES', 0, 100);
    `);
    expect(() => db.exec("DELETE FROM audit_events")).toThrow(/append-only/);
    expect(() => db.exec("UPDATE audit_events SET action = 'forged'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM journal_entries")).toThrow(/immutable/);
    expect(() => db.exec("DELETE FROM journal_lines")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_lines SET debit_paise = 999")).toThrow(/immutable/);
    expect(() => db.exec("UPDATE journal_entries SET entry_date = '2030-01-01'")).toThrow(/immutable/);
  });
});
