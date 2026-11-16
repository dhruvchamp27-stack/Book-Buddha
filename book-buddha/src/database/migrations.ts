import type Database from "better-sqlite3";
import { applyBaselineSchema } from "./schema.js";
import { applyPurchasingExpensesSchema } from "./purchasing-schema.js";
import { applyJournalDimensionsSchema } from "./journal-dimensions-schema.js";
import { applyProjectDimensionSchema } from "./project-dimension-schema.js";
import { applyAttachmentsSchema } from "./attachments-schema.js";

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
  {
    version: 2,
    name: "auth_foundation",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'ADMIN' CHECK(role IN ('ADMIN')),
          email TEXT,
          google_sub TEXT,
          password_hash TEXT NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK(failed_attempts >= 0),
          locked_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES auth_users(id),
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          expires_at TEXT,
          revoked_at TEXT
        );
      `);
    },
  },
  {
    version: 3,
    name: "customer_item_inventory",
    // Additive only: new nullable/defaulted columns plus one new table.
    // Enum/paise validation lives in the repository layer.
    up: (db) => {
      db.exec(`
        ALTER TABLE customers ADD COLUMN customer_number TEXT;
        ALTER TABLE customers ADD COLUMN classification TEXT;
        ALTER TABLE customers ADD COLUMN gstin TEXT;
        ALTER TABLE customers ADD COLUMN website TEXT;
        ALTER TABLE customers ADD COLUMN phone2 TEXT;
        ALTER TABLE customers ADD COLUMN billing_address TEXT;
        ALTER TABLE customers ADD COLUMN shipping_address TEXT;
        ALTER TABLE customers ADD COLUMN internal_notes TEXT;
        ALTER TABLE customers ADD COLUMN numbering_category TEXT;
        ALTER TABLE customers ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
        ALTER TABLE items ADD COLUMN description TEXT;
        ALTER TABLE items ADD COLUMN selling_price_paise INTEGER;
        ALTER TABLE items ADD COLUMN cost_price_paise INTEGER;
        ALTER TABLE items ADD COLUMN mrp_paise INTEGER;
        ALTER TABLE items ADD COLUMN reorder_threshold INTEGER;
        ALTER TABLE items ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1));
        CREATE TABLE IF NOT EXISTS customer_number_counters (
          company_id TEXT NOT NULL,
          category TEXT NOT NULL,
          next_seq INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (company_id, category)
        );
      `);
    },
  },
  {
    version: 4,
    name: "purchasing_expenses",
    // Rebuilds journal_entries / journal_lines / stock_movements, which needs
    // PRAGMA foreign_keys = OFF (a no-op inside a transaction), so it manages its own.
    transactional: false,
    up: applyPurchasingExpensesSchema,
  },
  {
    version: 5,
    name: "journal_business_and_date",
    // Additive: two nullable columns on journal_entries, backfilled from each entry source
    // document. Default (transactional) so a failed assertion rolls everything back.
    up: applyJournalDimensionsSchema,
  },
  {
    version: 6,
    name: "project_dimension",
    // Additive: a nullable (permanently optional) fair_id on journal entries, stock movements,
    // purchase bills and expenses; journal entries backfilled from their source invoice.
    // Default (transactional) so a failed gate rolls everything back.
    up: applyProjectDimensionSchema,
  },
  {
    version: 7,
    name: "attachments",
    // Additive: one new table (plus its index) for document metadata. The files themselves
    // live on disk outside the database, so nothing here touches existing rows.
    // Default (transactional) so a failed create rolls back.
    up: applyAttachmentsSchema,
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
