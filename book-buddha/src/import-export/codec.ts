/**
 * The file reader for imports (R10, "codec").
 *
 * In plain English: when you hand Book Buddha a spreadsheet saved as CSV (or a
 * JSON file), this module turns the raw bytes into tidy rows of text, and gives
 * you small, careful helpers to turn one cell of text into a real value - an
 * amount in paise, a date, a quantity, a tax rate, a yes/no, or a comparable name.
 *
 * It does NOT touch the database and does NOT decide what a row means; the
 * import engine does that. Everything here is a pure function: same input,
 * same output, nothing saved.
 *
 * Choices worth knowing about:
 *  - Money is handled as text and converted to whole paise by string arithmetic
 *    (never "number x 100", which can be off by a paisa). Rs 1,234.50 = 123450.
 *  - A bare ".5" IS ACCEPTED and means 50 paise (Rs 0.50). Spreadsheets and people
 *    write it that way, and the meaning is unambiguous. A dangling "5." (a dot
 *    with nothing after it) and a lone "." are rejected, as is any third decimal.
 *  - Dates are never guessed. The caller says which layout the column uses
 *    (YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY); impossible dates such as 31/02 are
 *    refused. ISO text (2026-11-20) is always accepted.
 *  - File encoding: a byte-order mark decides first; otherwise strict UTF-8; if
 *    that fails the file is read as Windows-1252 (what Excel's plain "CSV" save
 *    produces). The separator (comma, semicolon, tab or pipe) is detected.
 *  - Every problem is reported as a CodecError with a plain-English message,
 *    naming the spreadsheet row where there is one (header = row 1).
 */

export class CodecError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

export type Encoding = "UTF-8" | "UTF-16LE" | "UTF-16BE" | "WINDOWS-1252";
export type Delimiter = "," | ";" | "\t" | "|";
export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY";

export interface DecodedText {
  readonly text: string;
  readonly encoding: Encoding;
}

export interface TabularRow {
  /** The spreadsheet row: the header is row 1, the first data record is row 2. */
  readonly rowNumber: number;
  readonly cells: readonly string[];
}

export interface ParsedTabular {
  readonly format: "CSV" | "JSON";
  readonly encoding: Encoding;
  /** The separator used; null for JSON files. */
  readonly delimiter: Delimiter | null;
  readonly headers: readonly string[];
  readonly rows: readonly TabularRow[];
}

const DELIMITER_CANDIDATES: readonly Delimiter[] = [",", ";", "\t", "|"];

// ---------------------------------------------------------------- decoding

export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "UTF-8" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decodeUtf16(bytes.subarray(2), false), encoding: "UTF-16LE" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decodeUtf16(bytes.subarray(2), true), encoding: "UTF-16BE" };
  }
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "WINDOWS-1252" };
  }
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  const even = bytes.length - (bytes.length % 2);
  const copy = new Uint8Array(even);
  for (let i = 0; i < even; i += 2) {
    copy[i] = (bigEndian ? bytes[i + 1] : bytes[i]) ?? 0;
    copy[i + 1] = (bigEndian ? bytes[i] : bytes[i + 1]) ?? 0;
  }
  return new TextDecoder("utf-16le").decode(copy);
}

// ------------------------------------------------------------- CSV reading

/** Split into raw records (quotes respected, no delimiter splitting), up to a limit. */
function rawRecords(text: string, limit: number): string[] {
  const records: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && records.length < limit; i += 1) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      records.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  if (records.length < limit && current !== "") records.push(current);
  return records;
}

function countOutsideQuotes(record: string, delimiter: string): number {
  let inQuotes = false;
  let count = 0;
  for (const c of record) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === delimiter) count += 1;
  }
  return count;
}

export function detectDelimiter(text: string): Delimiter {
  const records = rawRecords(text, 10).filter((r) => r.trim() !== "");
  let best: Delimiter = ",";
  let bestScore = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    const frequency = new Map<number, number>();
    for (const record of records) {
      const n = countOutsideQuotes(record, candidate);
      if (n > 0) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    }
    let score = 0;
    for (const f of frequency.values()) score = Math.max(score, f);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

export function parseCsv(text: string, delimiter: string): string[][] {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new CodecError("The column separator must be a single character such as a comma.");
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;
  let quoteOpenedOnRow = 0;

  const endField = (): void => {
    row.push(field);
    field = "";
    wasQuoted = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "" && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
      quoteOpenedOnRow = rows.length + 1;
    } else if (c === delimiter) {
      endField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      endField();
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (inQuotes) {
    throw new CodecError(
      `Row ${quoteOpenedOnRow}: a quoted cell was opened but never closed, so the rest of the file cannot be read. Check for a stray double quote (").`,
    );
  }
  if (field !== "" || row.length > 0 || wasQuoted) {
    endField();
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------- whole-file read

export function parseTabular(input: { fileName: string; bytes: Uint8Array }): ParsedTabular {
  const { text, encoding } = decodeBytes(input.bytes);
  const trimmedStart = text.trimStart();
  const isJson =
    input.fileName.trim().toLowerCase().endsWith(".json") ||
    trimmedStart.startsWith("[") ||
    trimmedStart.startsWith("{");
  return isJson ? parseJsonTable(text, encoding) : parseCsvTable(text, encoding);
}

function checkHeaders(rawHeaders: readonly string[]): string[] {
  const headers = rawHeaders.map((h) => h.trim());
  const seen = new Map<string, string>();
  headers.forEach((h, index) => {
    if (h === "") {
      throw new CodecError(`Row 1: column ${index + 1} has no heading. Every column needs a name in the first row.`);
    }
    const key = h.toLowerCase();
    if (seen.has(key)) {
      throw new CodecError(
        `Row 1: the heading "${h}" appears more than once (also as "${seen.get(key)}"). Each column needs its own name.`,
      );
    }
    seen.set(key, h);
  });
  return headers;
}

function parseCsvTable(text: string, encoding: Encoding): ParsedTabular {
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  if (records.length === 0) {
    throw new CodecError("The file is empty: there is no heading row.");
  }
  const headers = checkHeaders(records[0] ?? []);
  const rows: TabularRow[] = [];
  for (let i = 1; i < records.length; i += 1) {
    const record = records[i] ?? [];
    if (record.every((cell) => cell.trim() === "")) continue;
    if (record.length > headers.length && record.slice(headers.length).some((c) => c.trim() !== "")) {
      throw new CodecError(
        `Row ${i + 1}: has ${record.length} cells but the heading row has only ${headers.length} columns.`,
      );
    }
    const cells = headers.map((_, col) => record[col] ?? "");
    rows.push({ rowNumber: i + 1, cells });
  }
  return { format: "CSV", encoding, delimiter, headers, rows };
}

function parseJsonTable(text: string, encoding: Encoding): ParsedTabular {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CodecError("The file looks like JSON but could not be read. Check for a missing comma, bracket or quote.");
  }
  let list: unknown;
  if (Array.isArray(data)) list = data;
  else if (data !== null && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)) {
    list = (data as { rows: unknown[] }).rows;
  } else {
    throw new CodecError('A JSON file must be a list of rows, or an object with a "rows" list.');
  }
  const records = list as unknown[];
  const headerList: string[] = [];
  const headerSeen = new Map<string, string>();
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new CodecError(`Row ${rowNumber}: each row must be an object of simple values.`);
    }
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      if (value !== null && typeof value === "object") {
        throw new CodecError(`Row ${rowNumber}: "${key}" holds a nested list or object; only simple values are allowed.`);
      }
      const trimmed = key.trim();
      if (trimmed === "") throw new CodecError(`Row ${rowNumber}: a value has a blank name.`);
      const lower = trimmed.toLowerCase();
      const existing = headerSeen.get(lower);
      if (existing === undefined) {
        headerSeen.set(lower, trimmed);
        headerList.push(trimmed);
      } else if (existing !== trimmed) {
        throw new CodecError(`Row ${rowNumber}: the heading "${trimmed}" duplicates "${existing}". Each column needs its own name.`);
      }
    }
  });
  const rows: TabularRow[] = [];
  records.forEach((record, index) => {
    const lookup = new Map<string, unknown>();
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) lookup.set(key.trim(), value);
    const cells = headerList.map((h) => {
      const v = lookup.get(h);
      return v === undefined || v === null ? "" : String(v);
    });
    if (cells.every((c) => c.trim() === "")) return;
    rows.push({ rowNumber: index + 2, cells });
  });
  return { format: "JSON", encoding, delimiter: null, headers: headerList, rows };
}

// ------------------------------------------------------------ cell parsers

const INTEGER_FORMS: readonly RegExp[] = [
  /^\d+$/, // 1234
  /^\d{1,3}(,\d{3})+$/, // 1,234,567
  /^\d{1,2}(,\d{2})+,\d{3}$/, // 1,23,456 (Indian grouping)
];

/** Rupee text to whole paise, by string arithmetic. */
export function parseRupeesToPaise(text: string, options: { allowNegative?: boolean } = {}): number {
  const original = text;
  let s = text.trim();
  if (s === "") throw new CodecError("The amount is blank.");
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/^(₹|rs\.?)\s*/i, "");
  if (s.startsWith("-") && !negative) {
    negative = true;
    s = s.slice(1).trim();
  }
  const bad = (): CodecError => new CodecError(`"${original.trim()}" is not a valid amount. Use digits like 1234.50 or 1,23,456.50.`);
  const parts = s.split(".");
  if (parts.length > 2) throw bad();
  const whole = parts[0] ?? "";
  const fraction = parts[1] ?? "";
  if (parts.length === 2 && fraction === "") throw bad();
  if (parts.length === 2 && fraction.length > 2) {
    throw new CodecError(`"${original.trim()}" has more than two decimal places; an amount cannot be smaller than one paisa.`);
  }
  if (fraction !== "" && !/^\d+$/.test(fraction)) throw bad();
  if (whole === "") {
    if (fraction === "") throw bad();
  } else if (!INTEGER_FORMS.some((re) => re.test(whole))) {
    throw bad();
  }
  if (negative && options.allowNegative !== true) {
    throw new CodecError(`"${original.trim()}" is negative; a negative amount is not allowed here.`);
  }
  const digits = (whole === "" ? "0" : whole).replace(/,/g, "");
  const paiseBig = BigInt(digits) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (paiseBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CodecError(`"${original.trim()}" is too large to store.`);
  }
  const paise = Number(paiseBig);
  return negative && paise > 0 ? -paise : paise;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Date text to ISO (YYYY-MM-DD). The layout is chosen by the caller, never guessed. */
export function parseDate(text: string, format: DateFormat): string {
  const s = text.trim();
  if (s === "") throw new CodecError("The date is blank.");
  let y: string;
  let m: string;
  let d: string;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (match) {
    y = match[1] ?? "";
    m = match[2] ?? "";
    d = match[3] ?? "";
  } else {
    const sep = format === "DD/MM/YYYY" ? "/" : format === "DD-MM-YYYY" ? "-" : null;
    match = sep === null ? null : new RegExp(`^(\\d{1,2})\\${sep}(\\d{1,2})\\${sep}(\\d{4})$`).exec(s);
    if (!match) {
      throw new CodecError(`"${s}" is not a date in the ${format} layout (the year must have four digits).`);
    }
    d = match[1] ?? "";
    m = match[2] ?? "";
    y = match[3] ?? "";
  }
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new CodecError(`"${s}" is not a real calendar date.`);
  }
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A whole number above zero. */
export function parseQuantity(text: string): number {
  const s = text.trim();
  if (!/^\d+$/.test(s)) {
    throw new CodecError(`"${s}" is not a valid quantity; use a whole number such as 12.`);
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n)) throw new CodecError(`"${s}" is too large to store.`);
  if (n <= 0) throw new CodecError(`"${s}" is not a valid quantity; it must be above zero.`);
  return n;
}

/** "18%", "18" or "2.5" to basis points (1800, 1800, 250). At most two decimals, at most 100%. */
export function parseTaxRateToBasisPoints(text: string): number {
  const original = text.trim();
  const s = original.replace(/\s*%$/, "").trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!match) {
    throw new CodecError(`"${original}" is not a valid tax rate; use something like 18, 18% or 2.5 (at most two decimals).`);
  }
  const basisPoints = Number(match[1] ?? "0") * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(basisPoints) || basisPoints > 10000) {
    throw new CodecError(`"${original}" is not a valid tax rate; it cannot be above 100%.`);
  }
  return basisPoints;
}

export function parseYesNo(text: string): boolean {
  const s = text.trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  throw new CodecError(`"${text.trim()}" is not a yes or no. Use yes, no, y, n, true, false, 1 or 0.`);
}

/** For matching names: NFC, trimmed, inner whitespace collapsed, lower-case. */
export function normaliseName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}
