import { vi } from "vitest";
import { istDateOf, registerToday } from "./ist-date.js";

/**
 * Test support for ruling G (the settable "today"). Pin a repository's clock when a test posts
 * dated entries, so "is this entry back-dated?" does not depend on the day the suite is run:
 *   new AccountingRepository(":memory:", todayAt("2025-10-31"))
 * A test that fakes `Date` (vi.useFakeTimers + setSystemTime) is in charge of its own "today":
 * while fake timers are on, the clock reads the fake date instead of the pin.
 * Production code never imports this file.
 */
export const todayAt = (isoDate: string): { readonly today: () => string } => ({
  today: () => (vi.isFakeTimers() ? istDateOf() : isoDate),
});

/** Moves an existing repository's "today" mid-test (e.g. to cancel something in a later month). */
export function moveToday(repository: { readonly db: object }, isoDate: string): void {
  registerToday(repository.db, () => isoDate);
}
