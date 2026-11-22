import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApi } from "../api/server.js";
import { migrations, runMigrations } from "./migrations.js";
import { AccountingRepository, istDateOf } from "./repository.js";
import { moveToday, todayAt } from "./test-clock.js";

/**
 * S11-4 - a credit note carries its own transaction date (migration v20), the mirror of a
 * purchase return's return_date. The defect this closes: a note raised in January and finalized
 * in February used to land in February, because it was posted on the day it was finalized.
 */

const at = (version: number) => migrations.filter((m) => m.version <= version);

interface World {
  repository: AccountingRepository;
  companyId: string;
  businessId: string;
  customerId: string;
  itemId: string;
}

function world(): World {
  const repository = new AccountingRepository(":memory:", todayAt("2026-01-10"));
  const companyId = repository.createCompany({ name: "Co", accountingBasis: "ACCRUAL" });
  const businessId = repository.createBusiness({ companyId, name: "Books" });
  const customerId = repository.createCustomer({ companyId, name: "Asha" });
  const itemId = repository.createItem({ companyId, name: "Design", unit: "job", trackStock: false });
  return { repository, companyId, businessId, customerId, itemId };
}

/** A finalized invoice: one line of Rs 1,000, no tax, on credit. */
function invoice(w: World, id: string, invoiceDate: string): void {
  w.repository.saveDraft({
    id, number: id, businessId: w.businessId, customerId: w.customerId, invoiceDate,
    paymentAccount: "RECEIVABLES", status: "DRAFT", taxType: "NONE", taxRateBasisPoints: 0,
    lines: [{ itemId: w.itemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
  });
  w.repository.finalizeInvoice(id);
}

function draftNote(w: World, id: string, invoiceId: string, noteDate?: string): void {
  w.repository.saveCreditNote({
    id, invoiceId, number: id, reason: "Returned", status: "DRAFT",
    ...(noteDate === undefined ? {} : { noteDate }),
    lines: [{ itemId: w.itemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
  });
}

function entryDate(w: World, creditNoteId: string): string {
  return (w.repository.db.prepare("SELECT entry_date FROM journal_entries WHERE id = ?")
    .get(`je-credit-note-${creditNoteId}`) as { entry_date: string }).entry_date;
}

afterEach(() => vi.useRealTimers());

/** The exact text a person sees when a note dated 20 January 2026 is finalized without confirmation. */
const REFUSAL_JAN_20 =
  "This credit note is dated 20 January 2026, in a month that has already passed. Posting it will change the figures already reported for January 2026. If that is what you want, confirm and finalize it again.";

describe("a credit note posts on its own date", () => {
  it("posts on the given noteDate, not today", () => {
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      draftNote(w, "CN-1", "INV-1", "2026-01-20");
      expect(w.repository.getCreditNote("CN-1").noteDate).toBe("2026-01-20");
      w.repository.finalizeCreditNote("CN-1", { confirmBackdatedMonth: true });
      expect(entryDate(w, "CN-1")).toBe("2026-01-20");
      expect(entryDate(w, "CN-1")).not.toBe(istDateOf());
    } finally {
      w.repository.close();
    }
  });

  it("an UNDATED note keeps note_date NULL and posts on the day it is FINALIZED (S11-20)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-25T06:00:00.000Z"));
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      draftNote(w, "CN-1", "INV-1");
      expect(w.repository.getCreditNote("CN-1").noteDate).toBeUndefined();
      expect(w.repository.db.prepare("SELECT note_date FROM credit_notes WHERE id = 'CN-1'").get()).toEqual({ note_date: null });
      vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
      w.repository.finalizeCreditNote("CN-1"); // no flag needed: no date was given
      expect(entryDate(w, "CN-1")).toBe("2026-02-10");
    } finally {
      w.repository.close();
    }
  });

  it("refuses a malformed or impossible date in plain words", () => {
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      for (const bad of ["20/01/2026", "2026-13-40", "2026-02-30", "yesterday", ""]) {
        expect(() => draftNote(w, `CN-${bad}`, "INV-1", bad), bad).toThrow(/Credit note date must be a real date written as YYYY-MM-DD/);
      }
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM credit_notes").get()).toEqual({ n: 0 });
    } finally {
      w.repository.close();
    }
  });

  it("refuses to back-date a note into a LOCKED financial year, naming the year", () => {
    const w = world();
    try {
      const yearId = w.repository.createFinancialYear({ businessId: w.businessId, startsOn: "2025-04-01", endsOn: "2026-03-31" });
      invoice(w, "INV-1", "2026-02-10");
      draftNote(w, "CN-1", "INV-1", "2026-02-15");
      w.repository.setFinancialYearLocked(yearId, true);
      // The year lock is absolute: confirming the back-dated month does NOT override it.
      expect(() => w.repository.finalizeCreditNote("CN-1")).toThrow(/2025-04-01 to 2026-03-31 is locked.*2026-02-15/);
      expect(() => w.repository.finalizeCreditNote("CN-1", { confirmBackdatedMonth: true })).toThrow(/2025-04-01 to 2026-03-31 is locked.*2026-02-15/);
      // The refusal rolled everything back: the note is still a draft and nothing was posted.
      expect(w.repository.getCreditNote("CN-1").status).toBe("DRAFT");
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE id LIKE 'je-credit-note-%'").get()).toEqual({ n: 0 });
      // The same note, re-dated into an open period, goes through.
      draftNote(w, "CN-2", "INV-1", "2026-04-02");
      expect(() => w.repository.finalizeCreditNote("CN-2", { confirmBackdatedMonth: true })).not.toThrow();
    } finally {
      w.repository.close();
    }
  });

  it("the January note finalized in February lands in JANUARY, and February is untouched", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T06:00:00.000Z"));
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      // Paperwork raised in January, the goods came back on 25 January...
      draftNote(w, "CN-1", "INV-1", "2026-01-25");
      // ...but it is only finalized on 10 February.
      vi.setSystemTime(new Date("2026-02-10T06:00:00.000Z"));
      w.repository.finalizeCreditNote("CN-1", { confirmBackdatedMonth: true });

      expect(entryDate(w, "CN-1")).toBe("2026-01-25");
      const january = w.repository.getProfitAndLoss({ basis: "ACCRUAL", fromDate: "2026-01-01", toDate: "2026-01-31" });
      const february = w.repository.getProfitAndLoss({ basis: "ACCRUAL", fromDate: "2026-02-01", toDate: "2026-02-28" });
      // January: the sale of 100,000 less the 100,000 that came back.
      expect(january.totalIncomePaise).toBe(0);
      // February moved by nothing. (Under the old rule it showed -100,000.)
      expect(february.totalIncomePaise).toBe(0);
      expect(february.income).toEqual([]);
    } finally {
      w.repository.close();
    }
  });
});

describe("back-dating into an earlier month needs confirmation (S11-21)", () => {
  it("refuses without the flag, naming the date and saying the figures will change; posts with it", () => {
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      draftNote(w, "CN-1", "INV-1", "2026-01-20");
      moveToday(w.repository, "2026-03-05"); // ruling G: the invoice was posted in January; now it is March
      let message = "";
      try { w.repository.finalizeCreditNote("CN-1"); } catch (error) { message = (error as Error).message; }
      expect(message).toBe(REFUSAL_JAN_20);
      // Refused means nothing happened.
      expect(w.repository.getCreditNote("CN-1").status).toBe("DRAFT");
      expect(w.repository.db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE id LIKE 'je-credit-note-%'").get()).toEqual({ n: 0 });

      w.repository.finalizeCreditNote("CN-1", { confirmBackdatedMonth: true });
      expect(entryDate(w, "CN-1")).toBe("2026-01-20");
      const january = w.repository.getProfitAndLoss({ basis: "ACCRUAL", fromDate: "2026-01-01", toDate: "2026-01-31" });
      expect(january.totalIncomePaise).toBe(0);
    } finally {
      w.repository.close();
    }
  });

  it("a date in the current month, or in the future, needs no confirmation", () => {
    const w = world();
    try {
      invoice(w, "INV-1", "2026-01-10");
      draftNote(w, "CN-1", "INV-1", istDateOf());
      expect(() => w.repository.finalizeCreditNote("CN-1")).not.toThrow();
      expect(entryDate(w, "CN-1")).toBe(istDateOf());
      invoice(w, "INV-2", "2026-01-11");
      draftNote(w, "CN-2", "INV-2", "2099-01-15");
      expect(() => w.repository.finalizeCreditNote("CN-2")).not.toThrow();
      expect(entryDate(w, "CN-2")).toBe("2099-01-15");
    } finally {
      w.repository.close();
    }
  });
});

describe("migration v20 backfills credit_notes.note_date without moving a posted figure", () => {
  it("a FINALIZED note takes its posted entry's date, a DRAFT stays NULL (no date given)", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    try {
      // A v19-era database: built by running only the migrations up to v19, so credit_notes has
      // no note_date column yet, and the rows below are written as v19 code wrote them.
      runMigrations(db, at(19));
      expect((db.pragma("table_info(credit_notes)") as Array<{ name: string }>).map((c) => c.name)).not.toContain("note_date");

      const stamp = "2026-01-01T00:00:00.000Z";
      db.prepare("INSERT INTO companies (id, name, accounting_basis, created_at) VALUES ('co', 'Co', 'ACCRUAL', ?)").run(stamp);
      db.prepare("INSERT INTO businesses (id, company_id, name, created_at) VALUES ('biz', 'co', 'Books', ?)").run(stamp);
      db.prepare("INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu', 'co', 'Asha', ?)").run(stamp);
      db.prepare(
        "INSERT INTO invoices (id, business_id, customer_id, number, invoice_date, payment_account, status, created_at)"
        + " VALUES ('INV-1', 'biz', 'cu', 'INV-1', '2026-01-10', 'RECEIVABLES', 'FINALIZED', ?)",
      ).run(stamp);
      const insertNote = db.prepare("INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES (?, 'INV-1', ?, 'Returned', ?, ?)");
      // Created 25 January, but FINALIZED (and so posted) on 10 February: the two dates differ,
      // which is exactly the case where picking the wrong source would move a figure.
      insertNote.run("CN-POSTED", "CN-POSTED", "FINALIZED", "2026-01-25T06:00:00.000Z");
      // Never posted, so nothing to take a date from: it must come out NULL, not a guessed date.
      insertNote.run("CN-DRAFT", "CN-DRAFT", "DRAFT", "2026-03-31T20:00:00.000Z");
      db.prepare(
        "INSERT INTO journal_entries (id, source_id, description, is_reversal, created_at, source_type, business_id, entry_date)"
        + " VALUES ('je-credit-note-CN-POSTED', 'INV-1', 'Credit note', 0, '2026-02-10T06:00:00.000Z', 'INVOICE', 'biz', '2026-02-10')",
      ).run();
      db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-credit-note-CN-POSTED', 'SALES', 100000, 0)").run();
      db.prepare("INSERT INTO journal_lines (journal_entry_id, account, debit_paise, credit_paise) VALUES ('je-credit-note-CN-POSTED', 'RECEIVABLES', 0, 100000)").run();
      const journalBefore = db.prepare("SELECT je.id, je.entry_date, jl.account, jl.debit_paise, jl.credit_paise FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id ORDER BY jl.id").all();

      runMigrations(db, at(20));

      const dated = db.prepare("SELECT id, note_date FROM credit_notes ORDER BY id").all();
      expect(dated).toEqual([
        { id: "CN-DRAFT", note_date: null },
        { id: "CN-POSTED", note_date: "2026-02-10" },
      ]);
      // No posted figure moved: the journal is byte-for-byte what it was.
      expect(db.prepare("SELECT je.id, je.entry_date, jl.account, jl.debit_paise, jl.credit_paise FROM journal_entries je JOIN journal_lines jl ON jl.journal_entry_id = je.id ORDER BY jl.id").all())
        .toEqual(journalBefore);
      expect(migrations.find((m) => m.version === 20)?.name).toBe("credit_note_date");
    } finally {
      db.close();
    }
  });

  it("refuses, and rolls v20 back, if a FINALIZED note cannot be dated", () => {
    const db = new Database(":memory:");
    try {
      runMigrations(db, at(19));
      const stamp = "2026-01-01T00:00:00.000Z";
      db.prepare("INSERT INTO companies (id, name, accounting_basis, created_at) VALUES ('co', 'Co', 'ACCRUAL', ?)").run(stamp);
      db.prepare("INSERT INTO businesses (id, company_id, name, created_at) VALUES ('biz', 'co', 'Books', ?)").run(stamp);
      db.prepare("INSERT INTO customers (id, company_id, name, created_at) VALUES ('cu', 'co', 'Asha', ?)").run(stamp);
      db.prepare("INSERT INTO invoices (id, business_id, customer_id, number, payment_account, status, created_at) VALUES ('INV-1', 'biz', 'cu', 'INV-1', 'RECEIVABLES', 'FINALIZED', ?)").run(stamp);
      // FINALIZED but with no posted entry: there is nothing to date it from.
      db.prepare("INSERT INTO credit_notes (id, invoice_id, number, reason, status, created_at) VALUES ('CN-1', 'INV-1', 'CN-1', 'x', 'FINALIZED', 'garbage')").run();
      expect(() => runMigrations(db, at(20))).toThrow(/cannot date 1 finalized credit note/);
      expect((db.pragma("table_info(credit_notes)") as Array<{ name: string }>).map((c) => c.name)).not.toContain("note_date");
      expect(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()).toEqual({ v: 19 });
    } finally {
      db.close();
    }
  });
});

describe("over HTTP", () => {
  it("POST /credit-notes accepts noteDate and finalizing posts on it", async () => {
    const w = world();
    const app = buildApi(w.repository, { __unsafeDisableAuthForTests: true });
    try {
      invoice(w, "INV-1", "2026-01-10");
      moveToday(w.repository, "2026-03-05"); // ruling G: the invoice was posted in January; now it is March
      const created = await app.inject({
        method: "POST", url: "/credit-notes",
        payload: {
          invoiceId: "INV-1", reason: "Returned", noteDate: "2026-01-20",
          lines: [{ itemId: w.itemId, description: "Design", quantity: 1, unitPricePaise: 100000 }],
        },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { id: string }).id;
      expect(((await app.inject({ method: "GET", url: `/credit-notes/${id}` })).json() as { noteDate: string }).noteDate).toBe("2026-01-20");
      // An earlier month: refused (409/400) until confirmed.
      const refused = await app.inject({ method: "POST", url: `/credit-notes/${id}/finalize` });
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toEqual({ error: REFUSAL_JAN_20 });
      const confirmed = await app.inject({ method: "POST", url: `/credit-notes/${id}/finalize`, payload: { confirmBackdatedMonth: true } });
      expect(confirmed.statusCode).toBe(200);
      expect(entryDate(w, id)).toBe("2026-01-20");

      const bad = await app.inject({
        method: "POST", url: "/credit-notes",
        payload: {
          invoiceId: "INV-1", reason: "Returned", noteDate: "20 Jan",
          lines: [{ itemId: w.itemId, description: "Design", quantity: 1, unitPricePaise: 100 }],
        },
      });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
      w.repository.close();
    }
  });
});
