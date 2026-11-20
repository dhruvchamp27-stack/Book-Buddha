import { describe, expect, it } from "vitest";
import { AccountingRepository } from "../database/repository.js";
import { parseTabular } from "./codec.js";
import {
  getImportKind,
  ImportRowError,
  registeredKinds,
  runImport,
  suggestColumnMap,
  type ImportKindDefinition,
  type ImportMode,
  type ImportResult,
} from "./import-engine.js";

/**
 * R10-C: the engine, tested with a small kind of its own so the engine's rules (units, savepoints,
 * preview rollback, column map) are proven apart from any real record type. A "document" here is
 * a group of rows sharing `doc`; each row writes one CUSTOMER through the repository, so a
 * half-written unit leaves visible rows behind if the savepoint does not take them back.
 */

const kind: ImportKindDefinition = {
  kind: "test-docs",
  scope: "COMPANY",
  groupBy: "doc",
  fields: [
    { key: "doc", label: "Document", required: true, synonyms: ["doc no", "number"] },
    { key: "name", label: "Name", required: true, synonyms: ["customer"] },
    { key: "note", label: "Note", required: false, synonyms: [] },
  ],
  post(context, rows) {
    const doc = rows[0]?.values.doc ?? "";
    if (doc === "EXISTS") return { status: "SKIPPED", reference: doc, message: "already exists" };
    for (const row of rows) {
      context.repository.createCustomer({ companyId: context.companyId, name: row.values.name ?? "" });
      // The last row of a "BOOM-AFTER" document throws AFTER the earlier rows were written.
      if (doc === "BOOM-AFTER" && row === rows[rows.length - 1]) throw new ImportRowError(`Row ${row.rowNumber}: it broke part way`);
    }
    return { status: doc === "UPD" ? "UPDATED" : "CREATED", reference: doc };
  },
};

function world(): { repository: AccountingRepository; companyId: string } {
  const repository = new AccountingRepository();
  return { repository, companyId: repository.createCompany({ name: "Co" }) };
}

const csv = (rows: readonly (readonly string[])[]): string => `${rows.map((r) => r.join(",")).join("\r\n")}\r\n`;

function run(w: ReturnType<typeof world>, text: string, mode: ImportMode, map?: Record<string, string>): ImportResult {
  const parsed = parseTabular({ fileName: "f.csv", bytes: new TextEncoder().encode(text) });
  return runImport({
    repository: w.repository,
    kind: kind.kind,
    definition: kind,
    parsed,
    columnMap: map ?? { doc: "Document", name: "Name", note: "Note" },
    companyId: w.companyId,
    dateFormat: "YYYY-MM-DD",
    mode,
  });
}

/** Total rows in every table: preview must leave this unchanged. */
function rowCounts(repository: AccountingRepository): Record<string, number> {
  const tables = repository.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    counts[name] = (repository.db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
  }
  return counts;
}

const FILE = csv([
  ["Document", "Name", "Note"],
  ["D1", "Alice", ""],
  ["D2", "Bob", ""],
  ["D1", "Alice Two", ""],
  ["EXISTS", "Zed", ""],
  ["BOOM-AFTER", "Half One", ""],
  ["BOOM-AFTER", "Half Two", ""],
  ["D3", "Carol", ""],
]);

describe("import engine", () => {
  it("preview leaves zero rows behind in any table", () => {
    const w = world();
    const before = rowCounts(w.repository);
    const result = run(w, FILE, "PREVIEW");
    expect(result.mode).toBe("PREVIEW");
    expect(result.created).toBe(3);
    expect(rowCounts(w.repository)).toEqual(before);
    expect(w.repository.listCustomers(w.companyId)).toHaveLength(0);
    expect(w.repository.db.inTransaction).toBe(false);
  });

  it("commit of the same file gives the same outcome list as its preview, and keeps the records", () => {
    const w = world();
    const preview = run(w, FILE, "PREVIEW");
    const commit = run(w, FILE, "COMMIT");
    expect(commit.outcomes).toEqual(preview.outcomes);
    expect({ ...commit, mode: "PREVIEW" }).toEqual(preview);
    expect(w.repository.listCustomers(w.companyId).map((c) => c.name).sort()).toEqual(["Alice", "Alice Two", "Bob", "Carol"]);
  });

  it("one bad unit among good ones: the others are committed and the bad one is listed with its row numbers", () => {
    const w = world();
    const result = run(w, FILE, "COMMIT");
    const bad = result.outcomes.filter((o) => o.status === "FAILED");
    expect(bad).toEqual([{ rowNumbers: [6, 7], reference: "BOOM-AFTER", status: "FAILED", message: "Row 7: it broke part way" }]);
    expect(result.outcomes.filter((o) => o.status === "CREATED").map((o) => o.reference)).toEqual(["D1", "D2", "D3"]);
    expect(result).toMatchObject({ totalRows: 7, units: 5, created: 3, updated: 0, skipped: 1, failed: 1 });
  });

  it("a unit that throws after writing part of itself leaves none of it", () => {
    const w = world();
    run(w, FILE, "COMMIT");
    const names = w.repository.listCustomers(w.companyId).map((c) => c.name);
    expect(names).not.toContain("Half One");
    expect(names).not.toContain("Half Two");
    expect(names).toHaveLength(4);
    // and the audit trail holds no event for the rolled-back rows
    const created = w.repository.listAuditEvents().filter((e) => e.action === "customer.created");
    expect(created).toHaveLength(4);
  });

  it("groups rows that share the groupBy value into one unit, in first-seen order, even when interleaved", () => {
    const w = world();
    const result = run(w, FILE, "PREVIEW");
    expect(result.outcomes.map((o) => [o.reference, o.rowNumbers])).toEqual([
      ["D1", [2, 4]], ["D2", [3]], ["EXISTS", [5]], ["BOOM-AFTER", [6, 7]], ["D3", [8]],
    ]);
  });

  it("counts UPDATED separately and totals every row", () => {
    const w = world();
    const result = run(w, csv([["Document", "Name"], ["UPD", "A"], ["N1", "B"]]), "PREVIEW", { doc: "Document", name: "Name" });
    expect(result).toMatchObject({ created: 1, updated: 1, skipped: 0, failed: 0, totalRows: 2, units: 2 });
  });

  it("a required field blank in a row fails that unit only", () => {
    const w = world();
    const result = run(w, csv([["Document", "Name"], ["D1", "A"], ["D2", ""], ["D3", "C"]]), "COMMIT", { doc: "Document", name: "Name" });
    expect(result.outcomes.map((o) => o.status)).toEqual(["CREATED", "FAILED", "CREATED"]);
    expect(result.outcomes[1]?.message).toBe('Row 3: "Name" is required but is blank.');
    expect(w.repository.listCustomers(w.companyId)).toHaveLength(2);
  });

  it("an unknown header in the column map fails the whole request before any row runs", () => {
    const w = world();
    const before = rowCounts(w.repository);
    expect(() => run(w, FILE, "COMMIT", { doc: "Document", name: "Nope" })).toThrow(/the column "Nope"/);
    expect(rowCounts(w.repository)).toEqual(before);
  });

  it("a missing required field in the column map fails the whole request", () => {
    const w = world();
    expect(() => run(w, FILE, "COMMIT", { doc: "Document" })).toThrow(/"Name" is required but no column is mapped/);
    expect(() => run(w, FILE, "COMMIT", { doc: "Document", name: "Name", bogus: "Note" })).toThrow(/"bogus" is not a field/);
    expect(w.repository.listCustomers(w.companyId)).toHaveLength(0);
  });

  it("an unmapped optional field reaches post as a blank string", () => {
    const w = world();
    const seen: Array<Record<string, string>> = [];
    const spy: ImportKindDefinition = {
      ...kind,
      post(_context, rows) {
        seen.push(...rows.map((r) => ({ ...r.values })));
        return { status: "CREATED", reference: "x" };
      },
    };
    const parsed = parseTabular({ fileName: "f.csv", bytes: new TextEncoder().encode(csv([["Document", "Name"], ["D1", "  padded  "]])) });
    runImport({
      repository: w.repository, kind: "x", definition: spy, parsed, columnMap: { doc: "Document", name: "Name" },
      companyId: w.companyId, dateFormat: "YYYY-MM-DD", mode: "PREVIEW",
    });
    expect(seen).toEqual([{ doc: "D1", name: "padded", note: "" }]);
  });

  it("suggests a column map by label and synonym, ignoring case and spacing, never using a header twice", () => {
    const map = suggestColumnMap("customers", ["  CUSTOMER NAME ", "e-mail", "Mobile", "Phone", "GST  Number", "Whatever"]);
    expect(map).toEqual({ name: "  CUSTOMER NAME ", email: "e-mail", phone: "Mobile", gstin: "GST  Number" });
    // "Mobile" is taken by Phone, so "Phone" is not reused for Phone 2 either.
    expect(Object.values(map).filter((h) => h === "Phone")).toHaveLength(0);
  });

  it("knows its kinds and refuses an unknown one in plain words", () => {
    expect(registeredKinds().map((k) => k.kind)).toEqual(expect.arrayContaining(["customers", "suppliers", "items", "opening-balances"]));
    expect(getImportKind("customers").scope).toBe("COMPANY");
    expect(() => getImportKind("pizzas")).toThrow(/not something that can be imported/);
  });
});
