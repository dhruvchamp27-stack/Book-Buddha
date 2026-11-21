import type Database from "better-sqlite3";

/**
 * R12g bank rules (migration v29; the orchestrator registers it). IDEMPOTENT: CREATE ... IF NOT
 * EXISTS only. Rules are CONFIGURATION, not books: they only PROPOSE a pre-fill for a statement
 * line (FD section D5) and are never part of a journal.
 *
 * `account_scope` NULL = every bank account of the company. `fair_id` is a plain optional text
 * (statement lines carry it the same way).
 */
export const BANK_RULE_DIRECTIONS = ["ANY", "IN", "OUT"] as const;
export const BANK_RULE_MATCH_MODES = ["ALL", "ANY"] as const;
export const BANK_RULE_ACTIONS = ["ADD", "TRANSFER"] as const;
export const BANK_RULE_FIELDS = ["DESCRIPTION", "REFERENCE", "AMOUNT"] as const;
export const BANK_RULE_OPERATORS = ["CONTAINS", "NOT_CONTAINS", "EQUALS", "GREATER_THAN", "LESS_THAN"] as const;

export function applyBankRulesSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_rules (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES companies(id),
      name TEXT NOT NULL,
      priority INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
      account_scope TEXT REFERENCES chart_accounts(code),
      direction TEXT NOT NULL DEFAULT 'ANY' CHECK(direction IN ('ANY', 'IN', 'OUT')),
      match_mode TEXT NOT NULL DEFAULT 'ALL' CHECK(match_mode IN ('ALL', 'ANY')),
      action TEXT NOT NULL CHECK(action IN ('ADD', 'TRANSFER')),
      target_account TEXT NOT NULL REFERENCES chart_accounts(code),
      business_id TEXT REFERENCES businesses(id),
      fair_id TEXT,
      party_name TEXT,
      memo TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_rules_company ON bank_rules(company_id, priority);
    CREATE TABLE IF NOT EXISTS bank_rule_conditions (
      rule_id TEXT NOT NULL REFERENCES bank_rules(id),
      position INTEGER NOT NULL,
      field TEXT NOT NULL CHECK(field IN ('DESCRIPTION', 'REFERENCE', 'AMOUNT')),
      operator TEXT NOT NULL CHECK(operator IN ('CONTAINS', 'NOT_CONTAINS', 'EQUALS', 'GREATER_THAN', 'LESS_THAN')),
      value_text TEXT,
      value_paise INTEGER,
      PRIMARY KEY (rule_id, position)
    );
  `);
}
