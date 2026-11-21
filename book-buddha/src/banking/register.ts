import type Database from "better-sqlite3";
import { isValidIsoDate } from "../accounting/recurrence.js";
import { RepositoryValidationError } from "../database/errors.js";
import { reconciliationStatusOf } from "./reconciliation.js";

export interface RegisterRow {
  readonly journalLineId: number;
  readonly journalEntryId: string;
  readonly entryDate: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly description: string;
  readonly businessId: string;
  readonly isReversal: boolean;
  /** Debit (money in, for a bank). */
  readonly inPaise: number;
  /** Credit (money out, for a bank). */
  readonly outPaise: number;
  readonly runningBalancePaise: number;
  /**
   * Reconciliation status (plan 12a, QBO's column): null = not yet cleared, "C" = ticked in a
   * reconciliation still in progress, "R" = in a FINISHED reconciliation. Read from 12d's tables.
   */
  readonly reconciliationStatus: "C" | "R" | null;
}

export interface AccountRegister {
  readonly account: { code: string; name: string; type: string; role: string | null };
  /** Balance before `fromDate` (0 when there is no fromDate). Debit less credit. */
  readonly openingBalancePaise: number;
  readonly rows: RegisterRow[];
  readonly closingBalancePaise: number;
}

interface LineRow {
  id: number;
  journal_entry_id: string;
  entry_date: string;
  source_type: string;
  source_id: string;
  description: string;
  business_id: string;
  is_reversal: number;
  debit_paise: number;
  credit_paise: number;
}

/**
 * Every line on one account, oldest first, with a running balance (debit less credit, so an
 * overdraft in use is negative). Only entries of the company's own businesses count: the seeded
 * BANK is shared by every company and must never show another company's money.
 */
export function getAccountRegister(
  db: Database.Database,
  input: {
    companyId: string;
    accountCode: string;
    fromDate?: string | undefined;
    toDate?: string | undefined;
    businessId?: string | undefined;
  },
): AccountRegister {
  if (db.prepare("SELECT 1 FROM companies WHERE id = ?").get(input.companyId) === undefined) {
    throw new RepositoryValidationError(`Company ${input.companyId} was not found.`);
  }
  const account = db
    .prepare("SELECT code, name, type, role FROM chart_accounts WHERE code = ? AND (company_id IS NULL OR company_id = ?)")
    .get(input.accountCode, input.companyId) as { code: string; name: string; type: string; role: string | null } | undefined;
  if (account === undefined) throw new RepositoryValidationError(`Account ${input.accountCode} was not found for this company.`);
  for (const [label, value] of [["from date", input.fromDate], ["to date", input.toDate]] as const) {
    if (value !== undefined && !isValidIsoDate(value)) {
      throw new RepositoryValidationError(`The ${label} must be a real date written as YYYY-MM-DD.`);
    }
  }
  if (input.fromDate !== undefined && input.toDate !== undefined && input.fromDate > input.toDate) {
    throw new RepositoryValidationError("The from date cannot be after the to date.");
  }
  if (input.businessId !== undefined) {
    const biz = db.prepare("SELECT company_id FROM businesses WHERE id = ?").get(input.businessId) as { company_id: string } | undefined;
    if (biz === undefined || biz.company_id !== input.companyId) {
      throw new RepositoryValidationError(`Business ${input.businessId} was not found in this company.`);
    }
  }

  const scope = "jl.account = ? AND b.company_id = ?" + (input.businessId === undefined ? "" : " AND je.business_id = ?");
  const scopeArgs: string[] = [input.accountCode, input.companyId, ...(input.businessId === undefined ? [] : [input.businessId])];
  const from = "FROM journal_lines jl JOIN journal_entries je ON je.id = jl.journal_entry_id JOIN businesses b ON b.id = je.business_id";

  let opening = 0;
  if (input.fromDate !== undefined) {
    opening = (
      db
        .prepare(`SELECT COALESCE(SUM(jl.debit_paise - jl.credit_paise), 0) AS n ${from} WHERE ${scope} AND je.entry_date < ?`)
        .get(...scopeArgs, input.fromDate) as { n: number }
    ).n;
  }
  const range = (input.fromDate === undefined ? "" : " AND je.entry_date >= ?") + (input.toDate === undefined ? "" : " AND je.entry_date <= ?");
  const rangeArgs = [...(input.fromDate === undefined ? [] : [input.fromDate]), ...(input.toDate === undefined ? [] : [input.toDate])];
  const lines = db
    .prepare(
      `SELECT jl.id, jl.journal_entry_id, je.entry_date, je.source_type, je.source_id, je.description, je.business_id, je.is_reversal,
              jl.debit_paise, jl.credit_paise
         ${from} WHERE ${scope}${range}
        ORDER BY je.entry_date, je.rowid, jl.id`,
    )
    .all(...scopeArgs, ...rangeArgs) as LineRow[];

  let running = opening;
  const status = reconciliationStatusOf(db, lines.map((l) => l.id));
  const rows: RegisterRow[] = lines.map((l) => {
    running += l.debit_paise - l.credit_paise;
    return {
      journalLineId: l.id,
      journalEntryId: l.journal_entry_id,
      entryDate: l.entry_date,
      sourceType: l.source_type,
      sourceId: l.source_id,
      description: l.description,
      businessId: l.business_id,
      isReversal: l.is_reversal === 1,
      inPaise: l.debit_paise,
      outPaise: l.credit_paise,
      runningBalancePaise: running,
      reconciliationStatus: status.get(l.id) ?? null,
    };
  });
  return { account, openingBalancePaise: opening, rows, closingBalancePaise: running };
}
