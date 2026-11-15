import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrations, runMigrations, type Migration } from "./migrations.js";
import { applyBaselineSchema } from "./schema.js";

const versions = (db: Database.Database) =>
  (db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{ version: number }>).map((r) => r.version);

describe("migrations", () => {
  it("fresh DB migrates to latest and records all versions", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(versions(db)).toEqual(migrations.map((m) => m.version));
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'invoices'").get()).toBeDefined();
  });

  it("running twice is a no-op", () => {
    const db = new Database(":memory:");
    expect(runMigrations(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(runMigrations(db)).toEqual([]);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("migration v2 creates the auth tables", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    expect(db.prepare("SELECT name FROM schema_migrations WHERE version = 2").get()).toEqual({ name: "auth_foundation" });
    for (const table of ["auth_users", "auth_sessions"]) {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeDefined();
    }
  });

  it("old-style DB (tables, no migrations row) keeps its data", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    applyBaselineSchema(db);
    db.prepare("INSERT INTO companies (id, name, created_at) VALUES ('c1', 'Old Co', '2026-01-01')").run();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").get()).toBeUndefined();
    runMigrations(db);
    expect(db.prepare("SELECT name FROM companies WHERE id = 'c1'").get()).toEqual({ name: "Old Co" });
    expect(versions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("runs migrations in version order, logs them, and rolls back a failing one", () => {
    const db = new Database(":memory:");
    const order: number[] = [];
    const mk = (version: number): Migration => ({
      version,
      name: `m${version}`,
      up: (d) => {
        order.push(version);
        d.exec(`CREATE TABLE t${version} (id INTEGER)`);
      },
    });
    const events: string[] = [];
    runMigrations(db, [mk(3), mk(1), mk(2)], (e) => events.push(`${e.event}:${e.version}`));
    expect(order).toEqual([1, 2, 3]);
    expect(events).toEqual(["migration_applied:1", "migration_applied:2", "migration_applied:3"]);

    const bad: Migration = {
      version: 4,
      name: "bad",
      up: (d) => {
        d.exec("CREATE TABLE t4 (id INTEGER)");
        throw new Error("boom");
      },
    };
    expect(() => runMigrations(db, [mk(1), mk(2), mk(3), bad])).toThrow("boom");
    expect(versions(db)).toEqual([1, 2, 3]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 't4'").get()).toBeUndefined();
  });
});
