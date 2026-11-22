import { RepositoryValidationError } from "./errors.js";

/**
 * The app assumes India Standard Time (UTC+5:30) for every business date. This lives in its own
 * file, not in repository.ts, so the report modules can use the SAME conversion without importing
 * the repository (which would be a circular import: the repository delegates stock layers to a
 * module that needs this).
 */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in IST of an ISO instant; defaults to now. The single "today" source. */
export function istDateOf(instant: string | Date = new Date()): string {
  const ms = typeof instant === "string" ? Date.parse(instant) : instant.getTime();
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The app's ONE settable "today" (IST, YYYY-MM-DD). Each database registers the clock its
 * repository was built with; modules that only hold a `db` (vouchers, internal transfers, the
 * review queue) ask here, so no route has to thread a clock through. Unregistered: the real date.
 * The default is read per call, never cached, so a test that fakes `Date` still moves "today".
 */
const todayClocks = new WeakMap<object, () => string>();

export function registerToday(db: object, today: (() => string) | undefined): void {
  if (today === undefined) todayClocks.delete(db);
  else todayClocks.set(db, today);
}

export function todayOf(db: object): string {
  return (todayClocks.get(db) ?? (() => istDateOf()))();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "2026-01-20" -> "January 2026". */
export function readableMonth(isoDate: string): string {
  return `${MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1] ?? isoDate.slice(5, 7)} ${isoDate.slice(0, 4)}`;
}

/** "2026-01-20" -> "20 January 2026": how a person reads a date, for messages they will see. */
export function readableDate(isoDate: string): string {
  return `${Number(isoDate.slice(8, 10))} ${readableMonth(isoDate)}`;
}

/** True when `date` is in an EARLIER CALENDAR MONTH than today (ruling Q12). */
export function isBackdatedMonth(db: object, date: string): boolean {
  return date.slice(0, 7) < todayOf(db).slice(0, 7);
}

/**
 * Ruling Q12 / S16-2(d) / S17-13(1): an entry dated in an earlier calendar month than today needs
 * an explicit `confirmBackdatedMonth`. The caller runs the absolute financial-year lock
 * (assertPeriodOpen) FIRST, and does not call this for history items (they post nothing).
 * `verb` completes "confirm and ___ it again".
 */
export function assertBackdatedConfirmed(
  db: object,
  date: string,
  confirmed: boolean | undefined,
  noun: string,
  verb: string,
): void {
  if (!isBackdatedMonth(db, date) || confirmed === true) return;
  throw new RepositoryValidationError(
    `This ${noun} is dated ${readableDate(date)}, in a month that has already passed. Posting it will change the figures already reported for ${readableMonth(date)}. If that is what you want, confirm and ${verb} it again.`,
  );
}
