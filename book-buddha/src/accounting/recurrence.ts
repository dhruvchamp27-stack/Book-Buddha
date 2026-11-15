export type RecurrenceFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function format(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the run date that follows `date`. Month-based cadences keep the day of
 * month from `anchorDate` (the template start date) and clamp to the last day of
 * shorter months, so a template starting on the 31st runs Jan 31, Feb 28, Mar 31.
 */
export function advanceRunDate(
  date: string,
  frequency: RecurrenceFrequency,
  intervalCount: number,
  anchorDate: string,
): string {
  const match = DATE_PATTERN.exec(date);
  if (match === null || !isValidIsoDate(date) || !isValidIsoDate(anchorDate)) {
    throw new Error("Recurrence dates must be valid YYYY-MM-DD dates.");
  }
  if (!Number.isInteger(intervalCount) || intervalCount < 1) {
    throw new Error("Recurrence interval must be a positive whole number.");
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (frequency === "WEEKLY") {
    return format(year, monthIndex, day + 7 * intervalCount);
  }
  const monthsPerStep = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
  const anchorDay = Number(anchorDate.slice(8, 10));
  const totalMonths = year * 12 + monthIndex + monthsPerStep * intervalCount;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  return format(targetYear, targetMonth, Math.min(anchorDay, daysInMonth(targetYear, targetMonth)));
}
