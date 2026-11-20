import { describe, expect, it } from "vitest";
import {
  CodecError,
  decodeBytes,
  detectDelimiter,
  normaliseName,
  parseCsv,
  parseDate,
  parseQuantity,
  parseRupeesToPaise,
  parseTabular,
  parseTaxRateToBasisPoints,
  parseYesNo,
} from "./codec.js";

/**
 * R10-A: the file-reading layer. Every "Must pass" case from the design has a
 * named test below.
 */

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const withBom = (s: string): Uint8Array => Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8(s)]);

describe("decodeBytes", () => {
  it("reads a UTF-8 file with a byte-order mark and strips the mark", () => {
    const out = decodeBytes(withBom("Name,Phone\r\nAsha,1"));
    expect(out.encoding).toBe("UTF-8");
    expect(out.text).toBe("Name,Phone\r\nAsha,1");
    expect(out.text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("reads UTF-16LE and UTF-16BE files by their marks", () => {
    const le = Uint8Array.from([0xff, 0xfe, 0x41, 0x00, 0xe9, 0x00]);
    const be = Uint8Array.from([0xfe, 0xff, 0x00, 0x41, 0x00, 0xe9]);
    expect(decodeBytes(le)).toEqual({ text: "Aé", encoding: "UTF-16LE" });
    expect(decodeBytes(be)).toEqual({ text: "Aé", encoding: "UTF-16BE" });
  });

  it("reads plain UTF-8 without a mark", () => {
    expect(decodeBytes(utf8("Café ₹")).encoding).toBe("UTF-8");
    expect(decodeBytes(utf8("Café ₹")).text).toBe("Café ₹");
  });

  it("falls back to Windows-1252 for a file with an e-acute and Rs (Excel's CSV save)", () => {
    // "Caf" + 0xE9 (é in Windows-1252, invalid as UTF-8) + ",Rs 100"
    const bytes = Uint8Array.from([0x43, 0x61, 0x66, 0xe9, 0x2c, ...utf8("Rs 100")]);
    const out = decodeBytes(bytes);
    expect(out.encoding).toBe("WINDOWS-1252");
    expect(out.text).toBe("Café,Rs 100");
  });
});

describe("detectDelimiter", () => {
  it("detects a comma file", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
  });
  it("detects a semicolon file", () => {
    expect(detectDelimiter("Name;Amount\nAsha;1,5\nRavi;2,5\n")).toBe(";");
  });
  it("detects a tab file", () => {
    expect(detectDelimiter("Name\tAmount\nAsha\t10\n")).toBe("\t");
  });
  it("detects a pipe file", () => {
    expect(detectDelimiter("Name|Amount\nAsha|10\n")).toBe("|");
  });
  it("ignores delimiters inside quotes", () => {
    expect(detectDelimiter('"a,b,c,d";"x"\n"1,2,3,4";"y"\n')).toBe(";");
  });
  it("falls back to a comma when nothing matches", () => {
    expect(detectDelimiter("single\nsingle2\n")).toBe(",");
  });
});

describe("parseCsv", () => {
  it("parses a quoted cell holding a newline and a doubled quote", () => {
    const rows = parseCsv('Name,Notes\r\nAsha,"line one\nline ""two"""\r\nRavi,plain\r\n', ",");
    expect(rows).toEqual([
      ["Name", "Notes"],
      ["Asha", 'line one\nline "two"'],
      ["Ravi", "plain"],
    ]);
  });

  it("keeps delimiters inside quotes", () => {
    expect(parseCsv('"Doe, John",5', ",")).toEqual([["Doe, John", "5"]]);
  });

  it("accepts CRLF, LF and CR line endings", () => {
    expect(parseCsv("a,b\r\n1,2\n3,4\r5,6", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
      ["5", "6"],
    ]);
  });

  it("ignores a trailing blank line but keeps an empty last cell", () => {
    expect(parseCsv("a,b\n1,2\n", ",")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n1,\n", ",")).toEqual([["a", "b"], ["1", ""]]);
  });

  it("rejects an unterminated quote and names the row", () => {
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n', ",")).toThrow(CodecError);
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n', ",")).toThrow(/Row 2/);
  });

  it("parses a semicolon file", () => {
    expect(parseCsv("Name;Amount\nAsha;1,5", ";")).toEqual([["Name", "Amount"], ["Asha", "1,5"]]);
  });

  it("parses a tab file", () => {
    expect(parseCsv("Name\tAmount\nAsha\t10", "\t")).toEqual([["Name", "Amount"], ["Asha", "10"]]);
  });
});

describe("parseTabular", () => {
  it("reads a semicolon file end to end", () => {
    const parsed = parseTabular({ fileName: "x.csv", bytes: utf8("Name;Amount\nAsha;100\n") });
    expect(parsed.format).toBe("CSV");
    expect(parsed.delimiter).toBe(";");
    expect(parsed.headers).toEqual(["Name", "Amount"]);
    expect(parsed.rows).toEqual([{ rowNumber: 2, cells: ["Asha", "100"] }]);
  });

  it("reads a tab file end to end", () => {
    const parsed = parseTabular({ fileName: "x.txt", bytes: utf8("Name\tAmount\nAsha\t100\n") });
    expect(parsed.delimiter).toBe("\t");
    expect(parsed.rows[0]?.cells).toEqual(["Asha", "100"]);
  });

  it("reads a UTF-8-BOM file and the header has no stray mark", () => {
    const parsed = parseTabular({ fileName: "x.csv", bytes: withBom("Name,Amount\r\nAsha,100\r\n") });
    expect(parsed.encoding).toBe("UTF-8");
    expect(parsed.headers).toEqual(["Name", "Amount"]);
  });

  it("reads a Windows-1252 file containing e-acute and Rs", () => {
    const bytes = Uint8Array.from([...utf8("Name,Amount\r\nCaf"), 0xe9, ...utf8(",Rs 100\r\n")]);
    const parsed = parseTabular({ fileName: "x.csv", bytes });
    expect(parsed.encoding).toBe("WINDOWS-1252");
    expect(parsed.rows[0]?.cells).toEqual(["Café", "Rs 100"]);
    expect(parseRupeesToPaise(parsed.rows[0]?.cells[1] ?? "")).toBe(10000);
  });

  it("numbers rows like the spreadsheet and drops fully blank rows", () => {
    const parsed = parseTabular({ fileName: "x.csv", bytes: utf8("A,B\n1,2\n,\n\n3,4\n") });
    expect(parsed.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
  });

  it("trims header cells", () => {
    const parsed = parseTabular({ fileName: "x.csv", bytes: utf8(" Name , Amount \nA,1\n") });
    expect(parsed.headers).toEqual(["Name", "Amount"]);
  });

  it("rejects a blank header", () => {
    expect(() => parseTabular({ fileName: "x.csv", bytes: utf8("A,,C\n1,2,3\n") })).toThrow(/Row 1.*column 2/);
  });

  it("rejects a duplicate header, ignoring case", () => {
    expect(() => parseTabular({ fileName: "x.csv", bytes: utf8("Name,name\nA,B\n") })).toThrow(/more than once/);
  });

  it("pads short rows and rejects rows with extra filled cells", () => {
    const ok = parseTabular({ fileName: "x.csv", bytes: utf8("A,B,C\n1,2\n") });
    expect(ok.rows[0]?.cells).toEqual(["1", "2", ""]);
    expect(() => parseTabular({ fileName: "x.csv", bytes: utf8("A,B\n1,2,3\n") })).toThrow(/Row 2/);
  });

  it("rejects an empty file", () => {
    expect(() => parseTabular({ fileName: "x.csv", bytes: utf8("") })).toThrow(CodecError);
  });

  it("reads a JSON array of flat objects, keys in first-seen order", () => {
    const json = JSON.stringify([{ Name: "Asha", Amount: 100 }, { Name: "Ravi", Notes: "x", Amount: null }]);
    const parsed = parseTabular({ fileName: "x.json", bytes: utf8(json) });
    expect(parsed.format).toBe("JSON");
    expect(parsed.delimiter).toBeNull();
    expect(parsed.headers).toEqual(["Name", "Amount", "Notes"]);
    expect(parsed.rows).toEqual([
      { rowNumber: 2, cells: ["Asha", "100", ""] },
      { rowNumber: 3, cells: ["Ravi", "", "x"] },
    ]);
  });

  it("reads a JSON object with a rows list, even when the name does not end in .json", () => {
    const parsed = parseTabular({ fileName: "export.txt", bytes: utf8('{ "rows": [ {"A": "1"} ] }') });
    expect(parsed.format).toBe("JSON");
    expect(parsed.rows[0]?.cells).toEqual(["1"]);
  });

  it("rejects a nested value in JSON and names the row", () => {
    expect(() => parseTabular({ fileName: "x.json", bytes: utf8('[{"A":1},{"A":{"b":2}}]') })).toThrow(/Row 3/);
    expect(() => parseTabular({ fileName: "x.json", bytes: utf8('[{"A":[1]}]') })).toThrow(/Row 2/);
  });

  it("rejects broken JSON with a plain message", () => {
    expect(() => parseTabular({ fileName: "x.json", bytes: utf8("[{") })).toThrow(CodecError);
  });
});

describe("parseRupeesToPaise", () => {
  it("accepts the listed forms", () => {
    expect(parseRupeesToPaise("1234")).toBe(123400);
    expect(parseRupeesToPaise("1234.5")).toBe(123450);
    expect(parseRupeesToPaise("1,23,456.50")).toBe(12345650);
    expect(parseRupeesToPaise("1,234.50")).toBe(123450);
    expect(parseRupeesToPaise("₹1,234.50")).toBe(123450);
    expect(parseRupeesToPaise("Rs 100")).toBe(10000);
    expect(parseRupeesToPaise("Rs. 100")).toBe(10000);
    expect(parseRupeesToPaise("  rs.100  ")).toBe(10000);
  });

  it("turns 0.10 into 10 paise and 1,23,456.50 into 12345650", () => {
    expect(parseRupeesToPaise("0.10")).toBe(10);
    expect(parseRupeesToPaise("1,23,456.50")).toBe(12345650);
  });

  it("decision: a bare .5 is ACCEPTED as 50 paise; a dangling 5. and a lone . are rejected", () => {
    expect(parseRupeesToPaise(".5")).toBe(50);
    expect(parseRupeesToPaise(".05")).toBe(5);
    expect(() => parseRupeesToPaise("5.")).toThrow(CodecError);
    expect(() => parseRupeesToPaise(".")).toThrow(CodecError);
  });

  it("uses exact string arithmetic where a float would drift", () => {
    expect(parseRupeesToPaise("1.15")).toBe(115);
    expect(parseRupeesToPaise("19.99")).toBe(1999);
    expect(parseRupeesToPaise("0.29")).toBe(29);
    expect(parseRupeesToPaise("4.35")).toBe(435);
  });

  it("rejects a third decimal", () => {
    expect(() => parseRupeesToPaise("1.234")).toThrow(/two decimal/);
    expect(() => parseRupeesToPaise("1.000")).toThrow(CodecError);
  });

  it("rejects letters, empty and misplaced commas", () => {
    for (const bad of ["abc", "12abc", "", "   ", "Rs", "1,,2", ",5", "1,2", "12,34", "1,2345", "1.2.3", "1,234,5"]) {
      expect(() => parseRupeesToPaise(bad), `"${bad}"`).toThrow(CodecError);
    }
  });

  it("rejects amounts above Number.MAX_SAFE_INTEGER paise", () => {
    expect(parseRupeesToPaise("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parseRupeesToPaise("90071992547409.92")).toThrow(/too large/);
    expect(() => parseRupeesToPaise("999999999999999999999")).toThrow(/too large/);
  });

  it("rejects negatives unless allowed, and never returns -0", () => {
    expect(() => parseRupeesToPaise("-12.00")).toThrow(/negative/);
    expect(parseRupeesToPaise("-12.00", { allowNegative: true })).toBe(-1200);
    expect(parseRupeesToPaise("-₹1,234.50", { allowNegative: true })).toBe(-123450);
    expect(Object.is(parseRupeesToPaise("-0", { allowNegative: true }), 0)).toBe(true);
  });
});

describe("parseDate", () => {
  it("accepts ISO text whatever layout is chosen", () => {
    expect(parseDate("2026-11-20", "DD/MM/YYYY")).toBe("2026-11-20");
    expect(parseDate("2026-11-20", "YYYY-MM-DD")).toBe("2026-11-20");
  });
  it("reads DD/MM/YYYY and DD-MM-YYYY, with or without leading zeros", () => {
    expect(parseDate("20/11/2026", "DD/MM/YYYY")).toBe("2026-11-20");
    expect(parseDate("5/1/2026", "DD/MM/YYYY")).toBe("2026-01-05");
    expect(parseDate("05-01-2026", "DD-MM-YYYY")).toBe("2026-01-05");
  });
  it("does not guess: the wrong layout for the text is an error", () => {
    expect(() => parseDate("20/11/2026", "DD-MM-YYYY")).toThrow(CodecError);
    expect(() => parseDate("20-11-2026", "DD/MM/YYYY")).toThrow(CodecError);
    expect(() => parseDate("20/11/2026", "YYYY-MM-DD")).toThrow(CodecError);
  });
  it("rejects impossible dates", () => {
    expect(() => parseDate("31/02/2026", "DD/MM/YYYY")).toThrow(/real calendar date/);
    expect(() => parseDate("29/02/2026", "DD/MM/YYYY")).toThrow(/real calendar date/);
    expect(() => parseDate("2026-13-01", "YYYY-MM-DD")).toThrow(CodecError);
    expect(() => parseDate("0/1/2026", "DD/MM/YYYY")).toThrow(CodecError);
    expect(() => parseDate("31/04/2026", "DD/MM/YYYY")).toThrow(CodecError);
  });
  it("accepts 29 February in a leap year, including 2000 but not 1900", () => {
    expect(parseDate("29/02/2028", "DD/MM/YYYY")).toBe("2028-02-29");
    expect(parseDate("29/02/2000", "DD/MM/YYYY")).toBe("2000-02-29");
    expect(() => parseDate("29/02/1900", "DD/MM/YYYY")).toThrow(CodecError);
  });
  it("requires a four-digit year and rejects blanks", () => {
    expect(() => parseDate("20/11/26", "DD/MM/YYYY")).toThrow(CodecError);
    expect(() => parseDate("", "DD/MM/YYYY")).toThrow(CodecError);
  });
});

describe("parseQuantity", () => {
  it("accepts whole numbers above zero", () => {
    expect(parseQuantity("12")).toBe(12);
    expect(parseQuantity(" 3 ")).toBe(3);
  });
  it("rejects zero, negatives, decimals, letters and blanks", () => {
    for (const bad of ["0", "-1", "1.5", "2.0", "abc", "", "1e3"]) {
      expect(() => parseQuantity(bad), `"${bad}"`).toThrow(CodecError);
    }
  });
});

describe("parseTaxRateToBasisPoints", () => {
  it("turns 18%, 18 and 2.5 into 1800, 1800 and 250", () => {
    expect(parseTaxRateToBasisPoints("18%")).toBe(1800);
    expect(parseTaxRateToBasisPoints("18")).toBe(1800);
    expect(parseTaxRateToBasisPoints("2.5")).toBe(250);
    expect(parseTaxRateToBasisPoints("2.5 %")).toBe(250);
    expect(parseTaxRateToBasisPoints("0")).toBe(0);
    expect(parseTaxRateToBasisPoints("0.05")).toBe(5);
  });
  it("allows at most two decimals and rejects junk", () => {
    expect(() => parseTaxRateToBasisPoints("2.555")).toThrow(CodecError);
    for (const bad of ["", "abc", "-5", "5.", "%", "101"]) {
      expect(() => parseTaxRateToBasisPoints(bad), `"${bad}"`).toThrow(CodecError);
    }
  });
});

describe("parseYesNo", () => {
  it("reads yes/no in all the listed spellings, any case", () => {
    for (const t of ["yes", "Y", "TRUE", "true", "1", " Yes "]) expect(parseYesNo(t)).toBe(true);
    for (const f of ["no", "N", "False", "0"]) expect(parseYesNo(f)).toBe(false);
  });
  it("rejects anything else", () => {
    expect(() => parseYesNo("maybe")).toThrow(CodecError);
    expect(() => parseYesNo("")).toThrow(CodecError);
  });
});

describe("normaliseName", () => {
  it("trims, collapses whitespace and lower-cases", () => {
    expect(normaliseName("  Asha   Book\t House ")).toBe("asha book house");
  });
  it("makes composed and decomposed accents equal (NFC)", () => {
    expect(normaliseName("Café")).toBe(normaliseName("Café"));
  });
});
