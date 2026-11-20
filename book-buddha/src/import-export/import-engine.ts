/**
 * Import engine (R10-C): the one path every import takes, whatever the kind of file.
 *
 * Stateless and two-phase. A file is parsed (`codec.ts`), its columns are mapped onto a kind's
 * fields, and every UNIT (one record, or one document = all rows sharing the `groupBy` value) is
 * handed to the kind's `post` function. `post` uses the repository's ordinary public methods, so
 * an import posts through exactly the same door - and the same audit trail - as typing the record
 * in by hand.
 *
 * TRANSACTIONS. The whole run is one outer transaction; each unit runs in its own nested
 * transaction (a savepoint). A unit that throws is rolled back ALONE and collected as FAILED; the
 * rest go on ("skipped and collected, the import does not abort"). PREVIEW runs the identical code
 * and then throws a private sentinel at the end of the outer transaction so everything rolls back:
 * the preview is exactly what commit will do. COMMIT keeps it.
 *
 * REGISTRY. `registeredKinds()` is the single list of kinds. It is a FUNCTION, evaluated at call
 * time, on purpose: `import-masters.ts` imports `ImportRowError` from this file at run time, and
 * this file imports the master kinds from it, so the two files form an import cycle. A top-level
 * `const ALL = [...MASTER_IMPORT_KINDS]` would read the master list before it exists whenever the
 * masters file is loaded first. Reading it inside a function is safe in either load order.
 * TO ADD THE DOCUMENT KINDS (one import + one line): add
 *   `import { DOCUMENT_IMPORT_KINDS } from "./import-documents.js";`
 * and change the return of `registeredKinds()` to `[...MASTER_IMPORT_KINDS, ...DOCUMENT_IMPORT_KINDS]`.
 */
import type { AccountingRepository } from "../database/repository.js";
import { RepositoryValidationError } from "../database/repository.js";
import { normaliseName, type DateFormat, type ParsedTabular } from "./codec.js";
import { DOCUMENT_IMPORT_KINDS } from "./import-documents.js";
import { MASTER_IMPORT_KINDS } from "./import-masters.js";

export type { DateFormat } from "./codec.js";

export interface ImportField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly synonyms: readonly string[];
}
export interface ImportContext {
  readonly repository: AccountingRepository;
  readonly companyId: string;
  readonly businessId?: string;
  readonly dateFormat: DateFormat;
}
/** Trimmed cell per field key; "" when blank or unmapped. */
export interface MappedRow {
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}
export interface UnitOutcome {
  readonly status: "CREATED" | "UPDATED" | "SKIPPED";
  readonly reference: string;
  readonly message?: string;
}
export interface ImportKindDefinition {
  readonly kind: string;
  readonly scope: "COMPANY" | "BUSINESS";
  readonly fields: readonly ImportField[];
  /** Rows sharing this field's value are ONE unit, in first-seen order. */
  readonly groupBy?: string;
  /** Throw to fail the unit. */
  post(context: ImportContext, rows: readonly MappedRow[]): UnitOutcome;
}
export class ImportRowError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ImportRowError";
  }
}

export type ImportMode = "PREVIEW" | "COMMIT";

export interface ImportOutcome {
  readonly rowNumbers: readonly number[];
  readonly reference: string;
  readonly status: "CREATED" | "UPDATED" | "SKIPPED" | "FAILED";
  readonly message?: string;
}
export interface ImportResult {
  readonly mode: ImportMode;
  readonly kind: string;
  readonly totalRows: number;
  readonly units: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly outcomes: readonly ImportOutcome[];
}
export interface RunImportInput {
  readonly repository: AccountingRepository;
  readonly kind: string;
  readonly parsed: ParsedTabular;
  /** { fieldKey: headerName } */
  readonly columnMap: Readonly<Record<string, string>>;
  readonly companyId: string;
  readonly businessId?: string;
  readonly dateFormat: DateFormat;
  readonly mode: ImportMode;
  /** A kind supplied directly instead of looked up by name. A test seam: the routes never set it. */
  readonly definition?: ImportKindDefinition;
}

// ---------------------------------------------------------------- registry
/** Every kind the importer knows. A function, not a constant: see the REGISTRY note above. */
export function registeredKinds(): readonly ImportKindDefinition[] {
  return [...MASTER_IMPORT_KINDS, ...DOCUMENT_IMPORT_KINDS];
}

export function getImportKind(kind: string): ImportKindDefinition {
  const found = registeredKinds().find((k) => k.kind === kind);
  if (found === undefined) {
    throw new RepositoryValidationError(
      `"${kind}" is not something that can be imported. Choose one of: ${registeredKinds().map((k) => k.kind).join(", ")}.`,
    );
  }
  return found;
}

// ---------------------------------------------------------------- column map
/** Best guess of { fieldKey: headerName } by normalised label and synonyms. Never maps one header twice. */
export function suggestColumnMap(kind: string, headers: readonly string[]): Record<string, string> {
  const definition = getImportKind(kind);
  const taken = new Set<string>();
  const map: Record<string, string> = {};
  for (const field of definition.fields) {
    const wanted = new Set([field.label, ...field.synonyms].map(normaliseName));
    const header = headers.find((h) => !taken.has(h) && wanted.has(normaliseName(h)));
    if (header !== undefined) {
      map[field.key] = header;
      taken.add(header);
    }
  }
  return map;
}

/** Fails the whole request (before any row runs) for an unknown field or header, or a missing required field. */
function validateColumnMap(definition: ImportKindDefinition, headers: readonly string[], columnMap: Readonly<Record<string, string>>): void {
  const problems: string[] = [];
  const fieldKeys = new Set(definition.fields.map((f) => f.key));
  for (const [key, header] of Object.entries(columnMap)) {
    if (!fieldKeys.has(key)) problems.push(`"${key}" is not a field of ${definition.kind}`);
    else if (!headers.includes(header)) problems.push(`the column "${header}" (for ${key}) is not in the file`);
  }
  for (const field of definition.fields) {
    if (field.required && columnMap[field.key] === undefined) problems.push(`"${field.label}" is required but no column is mapped to it`);
  }
  if (problems.length > 0) throw new RepositoryValidationError(`The column map is not usable: ${problems.join("; ")}.`);
}

// ---------------------------------------------------------------- the run
/** Thrown at the end of a PREVIEW so the outer transaction rolls back; caught just outside it. */
class PreviewRollback extends Error {
  public readonly result: ImportResult;
  public constructor(result: ImportResult) {
    super("preview rollback");
    this.result = result;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runImport(input: RunImportInput): ImportResult {
  const definition = input.definition ?? getImportKind(input.kind);
  const { repository, parsed } = input;
  validateColumnMap(definition, parsed.headers, input.columnMap);
  if (definition.scope === "BUSINESS" && (input.businessId === undefined || input.businessId === "")) {
    throw new RepositoryValidationError(`Importing ${definition.kind} needs a business: choose which business these records belong to.`);
  }

  // Header -> column index, then the mapped rows.
  const indexOf = new Map<string, number>();
  parsed.headers.forEach((h, i) => indexOf.set(h, i));
  const rows: MappedRow[] = parsed.rows.map((row) => {
    const values: Record<string, string> = {};
    for (const field of definition.fields) {
      const header = input.columnMap[field.key];
      const index = header === undefined ? undefined : indexOf.get(header);
      values[field.key] = index === undefined ? "" : (row.cells[index] ?? "").trim();
    }
    return { rowNumber: row.rowNumber, values };
  });

  // Units, in first-seen order.
  const units: MappedRow[][] = [];
  if (definition.groupBy === undefined) {
    for (const row of rows) units.push([row]);
  } else {
    const byKey = new Map<string, MappedRow[]>();
    for (const row of rows) {
      const key = row.values[definition.groupBy] ?? "";
      const existing = key === "" ? undefined : byKey.get(key);
      if (existing !== undefined) existing.push(row);
      else {
        const unit = [row];
        units.push(unit);
        if (key !== "") byKey.set(key, unit);
      }
    }
  }

  const context: ImportContext = {
    repository,
    companyId: input.companyId,
    dateFormat: input.dateFormat,
    ...(input.businessId === undefined || input.businessId === "" ? {} : { businessId: input.businessId }),
  };
  const db = repository.db;

  const runUnit = db.transaction((unit: readonly MappedRow[]): UnitOutcome => {
    for (const row of unit) {
      for (const field of definition.fields) {
        if (field.required && (row.values[field.key] ?? "") === "") {
          throw new ImportRowError(`Row ${row.rowNumber}: "${field.label}" is required but is blank.`);
        }
      }
    }
    return definition.post(context, unit);
  });

  const whole = db.transaction((): ImportResult => {
    const outcomes: ImportOutcome[] = [];
    for (const unit of units) {
      const rowNumbers = unit.map((r) => r.rowNumber);
      try {
        const outcome = runUnit(unit);
        outcomes.push({
          rowNumbers,
          reference: outcome.reference,
          status: outcome.status,
          ...(outcome.message === undefined ? {} : { message: outcome.message }),
        });
      } catch (error) {
        const first = unit[0];
        const groupValue = definition.groupBy === undefined ? "" : first?.values[definition.groupBy] ?? "";
        outcomes.push({
          rowNumbers,
          reference: groupValue !== "" ? groupValue : `Row ${first?.rowNumber ?? "?"}`,
          status: "FAILED",
          message: describeError(error),
        });
      }
    }
    const count = (status: ImportOutcome["status"]): number => outcomes.filter((o) => o.status === status).length;
    const result: ImportResult = {
      mode: input.mode,
      kind: definition.kind,
      totalRows: rows.length,
      units: units.length,
      created: count("CREATED"),
      updated: count("UPDATED"),
      skipped: count("SKIPPED"),
      failed: count("FAILED"),
      outcomes,
    };
    if (input.mode === "PREVIEW") throw new PreviewRollback(result);
    return result;
  });

  try {
    return whole();
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result;
    throw error;
  }
}
