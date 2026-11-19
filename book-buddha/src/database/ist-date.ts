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
