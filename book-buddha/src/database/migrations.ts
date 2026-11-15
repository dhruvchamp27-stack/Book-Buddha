import type Database from "better-sqlite3";
import { applyBaselineSchema } from "./schema.js";

export interface Migration {
  version: number;
  name: string;
  /**
   * Default true: `up` and the version record run in one transaction.
   * Set false ONLY when `up` must manage its own pragmas/transactions
   * (e.g. PRAGMA foreign_keys is a no-op inside a transaction).
   */
  transactional?: boolean;
  up(db: Database.Database): void;
}

export interface MigrationLogEvent {
  event: "migration_applied" | "migrations_up_to_date";
  version?: number;
  name?: string;
  at: string;
}

export type MigrationLogger = (event: MigrationLogEvent) => void;

/**
 * Ordered list. NEVER edit or reorder an applied migration; append new ones
 * with the next version number. Every migration must be non-destructive.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "baseline_schema",
    // The baseline includes legacy-upgrade steps that toggle PRAGMA foreign_keys,
    // which SQLite ignores inside a transaction. It stays outside one, exactly as
    // the pre-migration bootstrap behaved, and is fully idempotent.
    transactional: false,
    up: applyBaselineSchema,
  },
];

export function runMigrations(
  db: Database.Database,
  list: readonly Migration[] = migrations,
  log: MigrationLogger = () => undefined,
): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map((r) => r.version),
  );
  const ordered = [...list].sort((a, b) => a.version - b.version);
  const record = db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
  const ran: number[] = [];
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    const apply = (): void => {
      migration.up(db);
      record.run(migration.version, migration.name, new Date().toISOString());
    };
    if (migration.transactional === false) {
      apply();
    } else {
      db.transaction(apply)();
    }
    ran.push(migration.version);
    log({ event: "migration_applied", version: migration.version, name: migration.name, at: new Date().toISOString() });
  }
  if (ran.length === 0) log({ event: "migrations_up_to_date", at: new Date().toISOString() });
  return ran;
}

/** Compatibility shim for the previous bootstrap entry point. */
export function initializeSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  runMigrations(db);
}
