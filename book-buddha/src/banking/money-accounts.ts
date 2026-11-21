import type Database from "better-sqlite3";
import { RepositoryValidationError } from "../database/errors.js";

/**
 * R12 shared contract (written by the orchestrator before the 12a–12d builders start; builders do
 * not edit this file).
 *
 * A MONEY ACCOUNT is any chart account whose role is CASH or BANK: the seeded `CASH`, the seeded
 * `BANK`, and every bank account created by 12a (current, savings, overdraft, cash credit). An
 * overdraft / cash-credit account is a money account too, even though its class is LIABILITY
 * (ruling S15-4). Money accounts are recognised by ROLE, never by a literal code.
 *
 * Visible to a company = a system account (company_id NULL) or one the company owns.
 */
export const MONEY_ROLES = ["CASH", "BANK"] as const;
export type MoneyRole = (typeof MONEY_ROLES)[number];

export interface MoneyAccount {
  readonly code: string;
  readonly name: string;
  readonly type: "ASSET" | "LIABILITY";
  readonly role: MoneyRole;
  readonly active: boolean;
}

interface Row { code: string; name: string; type: string; role: string; active: number; company_id: string | null }

/** Every money account the company can use, active or not, system ones first, then by code. */
export function listMoneyAccounts(db: Database.Database, companyId: string): MoneyAccount[] {
  const rows = db
    .prepare(
      `SELECT code, name, type, role, active, company_id FROM chart_accounts
        WHERE role IN ('CASH', 'BANK') AND (company_id IS NULL OR company_id = ?)
        ORDER BY company_id IS NOT NULL, code`,
    )
    .all(companyId) as Row[];
  return rows.map(toMoneyAccount);
}

/** True when `code` is a money account visible to the company (active or not). */
export function isMoneyAccount(db: Database.Database, code: string, companyId: string): boolean {
  return find(db, code, companyId) !== undefined;
}

/**
 * Throws RepositoryValidationError unless `code` is an ACTIVE money account visible to the company.
 * Use this on every NEW posting that names a cash/bank account. (Reversals of old documents go
 * through postJournalEntry's own reversal exemption and do not call this.)
 */
export function assertMoneyAccount(db: Database.Database, code: string, companyId: string): MoneyAccount {
  const row = find(db, code, companyId);
  if (row === undefined) {
    throw new RepositoryValidationError(`${code} is not a cash or bank account of this company.`);
  }
  if (row.active === 0) {
    throw new RepositoryValidationError(`${row.name} (${code}) is no longer active. Reactivate it, or pick another account.`);
  }
  return toMoneyAccount(row);
}

/** The company a business belongs to; throws when the business does not exist. */
export function companyOfBusiness(db: Database.Database, businessId: string): string {
  const row = db.prepare("SELECT company_id FROM businesses WHERE id = ?").get(businessId) as { company_id: string } | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Business ${businessId} was not found.`);
  return row.company_id;
}

function find(db: Database.Database, code: string, companyId: string): Row | undefined {
  return db
    .prepare(
      `SELECT code, name, type, role, active, company_id FROM chart_accounts
        WHERE code = ? AND role IN ('CASH', 'BANK') AND (company_id IS NULL OR company_id = ?)`,
    )
    .get(code, companyId) as Row | undefined;
}

function toMoneyAccount(row: Row): MoneyAccount {
  return {
    code: row.code,
    name: row.name,
    type: row.type as MoneyAccount["type"],
    role: row.role as MoneyRole,
    active: row.active === 1,
  };
}
