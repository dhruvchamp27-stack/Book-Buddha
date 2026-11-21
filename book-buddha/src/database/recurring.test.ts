import { describe, expect, it } from "vitest";
import { advanceRunDate, isValidIsoDate } from "../accounting/recurrence.js";
import { AccountingRepository, type RecurringInvoiceTemplateInput } from "./repository.js";

function setup(accountingBasis: "CASH" | "ACCRUAL" = "ACCRUAL") {
  const repository = new AccountingRepository();
  const companyId = repository.createCompany({ name: "Test Company", accountingBasis });
  const businessId = repository.createBusiness({ companyId, name: "Book Business" });
  const customerId = repository.createCustomer({ companyId, name: "Test Customer" });
  const itemId = repository.createItem({ companyId, name: "Book", unit: "each", trackStock: false });
  const template = (overrides: Partial<RecurringInvoiceTemplateInput> = {}): RecurringInvoiceTemplateInput => ({
    id: "tmpl-0001-abcdef",
    businessId,
    customerId,
    paymentAccount: "RECEIVABLES",
    frequency: "MONTHLY",
    startDate: "2026-01-31",
    lines: [{ itemId, description: "Monthly supply", quantity: 2, unitPricePaise: 12500 }],
    ...overrides,
  });
  return { repository, companyId, businessId, customerId, itemId, template };
}

describe("recurrence dates", () => {
  it("validates calendar dates", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("26-02-01")).toBe(false);
  });

  it("advances by cadence and clamps month-end without drifting", () => {
    expect(advanceRunDate("2026-01-01", "WEEKLY", 2, "2026-01-01")).toBe("2026-01-15");
    expect(advanceRunDate("2026-01-31", "MONTHLY", 1, "2026-01-31")).toBe("2026-02-28");
    expect(advanceRunDate("2026-02-28", "MONTHLY", 1, "2026-01-31")).toBe("2026-03-31");
    expect(advanceRunDate("2026-11-15", "QUARTERLY", 1, "2026-11-15")).toBe("2027-02-15");
    expect(advanceRunDate("2028-02-29", "YEARLY", 1, "2028-02-29")).toBe("2029-02-28");
    expect(advanceRunDate("2026-12-01", "MONTHLY", 2, "2026-12-01")).toBe("2027-02-01");
  });
});

describe("recurring invoice templates", () => {
  it("creates, lists and fetches a template with its lines", () => {
    const { repository, businessId, itemId, template } = setup();
    try {
      const created = repository.createRecurringInvoiceTemplate(template());
      expect(created).toMatchObject({
        active: true, frequency: "MONTHLY", intervalCount: 1,
        startDate: "2026-01-31", nextRunDate: "2026-01-31", taxType: "NONE",
      });
      expect(created.lines).toEqual([{ itemId, description: "Monthly supply", quantity: 2, unitPricePaise: 12500 }]);
      expect(repository.listRecurringInvoiceTemplates({ businessId })).toHaveLength(1);
      expect(repository.listRecurringInvoiceTemplates({ active: false })).toHaveLength(0);
      expect(repository.getRecurringInvoiceTemplate(created.id).id).toBe(created.id);
      expect(repository.listAuditEvents(created.id).map((event) => event.action)).toContain("recurring_template.created");
    } finally {
      repository.close();
    }
  });

  it("rejects invalid templates", () => {
    const { repository, template } = setup();
    try {
      expect(() => repository.createRecurringInvoiceTemplate(template({ businessId: "missing" }))).toThrow("not found");
      expect(() => repository.createRecurringInvoiceTemplate(template({ endDate: "2026-01-01" }))).toThrow("End date");
      expect(() => repository.createRecurringInvoiceTemplate(template({ intervalCount: 0 }))).toThrow("Interval");
      expect(() => repository.createRecurringInvoiceTemplate(template({ taxType: "IGST" }))).toThrow("Tax rate");
      expect(() => repository.createRecurringInvoiceTemplate(template({ lines: [] }))).toThrow("at least one line");
      expect(repository.listRecurringInvoiceTemplates()).toHaveLength(0);
    } finally {
      repository.close();
    }
  });

  it("refuses (as this template's failure) when its invoice number is already taken, never renumbering (S16-9)", () => {
    const { repository, template } = setup();
    try {
      const created = repository.createRecurringInvoiceTemplate(template());
      expect(repository.generateDueInvoices("2026-01-31").invoices).toHaveLength(1);
      // Wind the template back so the same run date - and so the same number - comes round again.
      repository.db.prepare("UPDATE recurring_invoice_templates SET next_run_date = '2026-01-31' WHERE id = ?").run(created.id);
      const again = repository.generateDueInvoices("2026-01-31");
      expect(again.invoices).toHaveLength(0);
      expect(again.failures).toHaveLength(1);
      expect(again.failures[0]?.error).toContain("REC-tmpl-000-2026-01-31 is already used");
      expect(repository.listInvoices()).toHaveLength(1);
      expect(repository.getRecurringInvoiceTemplate(created.id).nextRunDate).toBe("2026-01-31");
    } finally {
      repository.close();
    }
  });

  it("generates a draft for a due template and advances nextRunDate", () => {
    const { repository, template } = setup();
    try {
      const created = repository.createRecurringInvoiceTemplate(template({ taxType: "CGST_SGST", taxRateBasisPoints: 1200, discountPaise: 1000 }));
      const result = repository.generateDueInvoices("2026-01-31");

      expect(result.failures).toEqual([]);
      expect(result.invoices).toHaveLength(1);
      const draft = result.invoices[0]!;
      expect(draft).toMatchObject({
        status: "DRAFT", invoiceDate: "2026-01-31", number: "REC-tmpl-000-2026-01-31",
        taxType: "CGST_SGST", taxRateBasisPoints: 1200, discountPaise: 1000, paymentAccount: "RECEIVABLES",
      });
      expect(draft.lines).toEqual(created.lines);
      expect(repository.getRecurringInvoiceTemplate(created.id).nextRunDate).toBe("2026-02-28");
      expect(repository.listInvoices()).toHaveLength(1);
      // Re-running for the same date must not double-generate.
      expect(repository.generateDueInvoices("2026-01-31").invoices).toHaveLength(0);
      expect(repository.listInvoices()).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  it("does not generate when nothing is due or the template is inactive", () => {
    const { repository, template } = setup();
    try {
      const created = repository.createRecurringInvoiceTemplate(template());
      expect(repository.generateDueInvoices("2026-01-30").invoices).toHaveLength(0);
      expect(repository.getRecurringInvoiceTemplate(created.id).nextRunDate).toBe("2026-01-31");

      repository.deactivateRecurringInvoiceTemplate(created.id);
      expect(repository.getRecurringInvoiceTemplate(created.id).active).toBe(false);
      expect(repository.generateDueInvoices("2027-01-01").invoices).toHaveLength(0);
      expect(repository.listInvoices()).toHaveLength(0);

      const reactivated = repository.updateRecurringInvoiceTemplate(created.id, { active: true, nextRunDate: "2026-03-31" });
      expect(reactivated).toMatchObject({ active: true, nextRunDate: "2026-03-31" });
      expect(repository.generateDueInvoices("2026-03-30").invoices).toHaveLength(0);
      expect(repository.generateDueInvoices("2026-03-31").invoices).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  it("catches up every missed period once and stops at the end date", () => {
    const { repository, template } = setup();
    try {
      const created = repository.createRecurringInvoiceTemplate(template({
        startDate: "2026-01-01", frequency: "MONTHLY", endDate: "2026-03-15",
      }));
      const result = repository.generateDueInvoices("2026-12-31");
      expect(result.invoices.map((invoice) => invoice.invoiceDate)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
      const after = repository.getRecurringInvoiceTemplate(created.id);
      expect(after.active).toBe(false);
      expect(after.nextRunDate).toBe("2026-04-01");
      expect(repository.generateDueInvoices("2027-12-31").invoices).toHaveLength(0);
      expect(() => repository.updateRecurringInvoiceTemplate(created.id, { active: true })).toThrow("end date");
    } finally {
      repository.close();
    }
  });

  it("reports upcoming runs for active templates only", () => {
    const { repository, template } = setup();
    try {
      const a = repository.createRecurringInvoiceTemplate(template({ id: "a", startDate: "2026-05-01" }));
      repository.createRecurringInvoiceTemplate(template({ id: "b", startDate: "2026-04-01", taxType: "IGST", taxRateBasisPoints: 1800 }));
      repository.deactivateRecurringInvoiceTemplate(a.id);
      const upcoming = repository.getUpcomingRecurringInvoices();
      expect(upcoming).toEqual([expect.objectContaining({
        templateId: "b", customerName: "Test Customer", nextRunDate: "2026-04-01", totalPaise: 29500,
      })]);
    } finally {
      repository.close();
    }
  });

  it.each(["ACCRUAL", "CASH"] as const)("a generated draft finalizes into balanced journals (%s basis)", (basis) => {
    const { repository, template } = setup(basis);
    try {
      repository.createRecurringInvoiceTemplate(template({ taxType: "CGST_SGST", taxRateBasisPoints: 1800, paymentAccount: "CASH" }));
      const draft = repository.generateDueInvoices("2026-01-31").invoices[0]!;
      expect(draft.status).toBe("DRAFT");
      expect(repository.listJournalEntries()).toHaveLength(0);

      const entry = repository.finalizeInvoice(draft.id);
      expect(repository.getInvoice(draft.id).status).toBe("FINALIZED");
      expect(entry.lines.reduce((total, line) => total + line.debitPaise, 0))
        .toBe(entry.lines.reduce((total, line) => total + line.creditPaise, 0));
      const trial = repository.getTrialBalance();
      expect(trial.reduce((total, row) => total + row.debitPaise, 0))
        .toBe(trial.reduce((total, row) => total + row.creditPaise, 0));
      expect(trial.find((row) => row.account === "CASH")?.debitPaise).toBe(29500);
    } finally {
      repository.close();
    }
  });
});
