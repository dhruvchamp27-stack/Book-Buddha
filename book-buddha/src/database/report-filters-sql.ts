import { isValidIsoDate } from "../accounting/recurrence.js";
import { RepositoryValidationError } from "./errors.js";

export interface ReportFilter {
  readonly businessId?: string;
  readonly fairId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly asAtDate?: string;
}

function assertIsoDate(label: string, value: string): void {
  if (!isValidIsoDate(value)) throw new RepositoryValidationError(`${label} must be a real date written as YYYY-MM-DD.`);
}

/**
 * WHERE clause (alias `je` = journal_entries) for a report filter, with bound parameters.
 * No filter at all yields an empty clause, i.e. consolidated and all dates. Date bounds are inclusive.
 */
export function reportConditions(filter: ReportFilter): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];
  if (filter.businessId !== undefined) { conditions.push("je.business_id = ?"); params.push(filter.businessId); }
  if (filter.fairId !== undefined) { conditions.push("je.fair_id = ?"); params.push(filter.fairId); }
  if (filter.fromDate !== undefined) { assertIsoDate("From date", filter.fromDate); conditions.push("je.entry_date >= ?"); params.push(filter.fromDate); }
  if (filter.toDate !== undefined) { assertIsoDate("To date", filter.toDate); conditions.push("je.entry_date <= ?"); params.push(filter.toDate); }
  if (filter.asAtDate !== undefined) { assertIsoDate("As-at date", filter.asAtDate); conditions.push("je.entry_date <= ?"); params.push(filter.asAtDate); }
  if (filter.fromDate !== undefined && filter.toDate !== undefined && filter.fromDate > filter.toDate) {
    throw new RepositoryValidationError("From date cannot be after the to date.");
  }
  return { where: conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`, params };
}
