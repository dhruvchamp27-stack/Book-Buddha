import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set([
  "database/ledger.ts",
  "database/audit-log.ts",
  "database/schema.ts",
  "database/purchasing-schema.ts",
  "database/journal-dimensions-schema.ts",
  "database/project-dimension-schema.ts",
  "database/migrations.ts",
]);
const FORBIDDEN = /INTO\s+(journal_entries|journal_lines|audit_events)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("single writer for the journal and the audit log", () => {
  it("only ledger.ts and audit-log.ts (and schema/migration files) write those tables", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => ({ path, rel: relative(SRC, path).split(sep).join("/") }))
      .filter(({ rel }) => !/\.test\.tsx?$/.test(rel) && !ALLOWED.has(rel))
      .filter(({ path }) => FORBIDDEN.test(readFileSync(path, "utf8")));
    const message = offenders
      .map(({ rel }) => `${rel} writes to journal_entries / journal_lines / audit_events directly. Use postJournalEntry (src/database/ledger.ts) or appendAuditEvent (src/database/audit-log.ts) instead.`)
      .join("\n");
    expect(offenders.map(({ rel }) => rel), message).toEqual([]);
  });
});
