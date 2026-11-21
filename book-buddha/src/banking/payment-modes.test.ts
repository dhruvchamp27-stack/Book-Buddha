import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../database/audit-log.js";
import { AccountingRepository, RepositoryValidationError } from "../database/repository.js";
import { addPaymentMode, listPaymentModes, renamePaymentMode, setPaymentModeActive } from "./payment-modes.js";

let r: AccountingRepository;
let x: string;
let y: string;

beforeEach(() => {
  r = new AccountingRepository(); // payment_modes is migration v23, already applied
  x = r.createCompany({ name: "Co X", accountingBasis: "ACCRUAL" });
  y = r.createCompany({ name: "Co Y", accountingBasis: "ACCRUAL" });
});
afterEach(() => r.close());

const codes = (companyId: string, includeInactive = false) => listPaymentModes(r.db, companyId, { includeInactive }).map((m) => m.code);

describe("payment modes", () => {
  it("9. seven seeded modes in order; a company adds, renames and deactivates its own; others never see it; duplicates and system edits refused", () => {
    expect(codes(x)).toEqual(["CASH", "NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER"]);
    expect(listPaymentModes(r.db, x).every((m) => m.isSystem && m.active)).toBe(true);

    const dd = addPaymentMode(r.db, { companyId: x, code: "dd", label: " Demand draft " });
    expect(dd).toMatchObject({ code: "DD", label: "Demand draft", isSystem: false, active: true });
    expect(codes(x)).toEqual(["CASH", "NEFT", "RTGS", "IMPS", "UPI", "CHEQUE", "OTHER", "DD"]);
    expect(codes(y)).not.toContain("DD");

    renamePaymentMode(r.db, x, "DD", "Bank draft");
    expect(listPaymentModes(r.db, x).find((m) => m.code === "DD")?.label).toBe("Bank draft");

    setPaymentModeActive(r.db, x, "DD", false);
    expect(codes(x)).not.toContain("DD");
    expect(codes(x, true)).toContain("DD");
    setPaymentModeActive(r.db, x, "DD", true);
    expect(codes(x)).toContain("DD");

    // Duplicates: against the company's own, a system code, and another company's code.
    expect(() => addPaymentMode(r.db, { companyId: x, code: "DD", label: "Again" })).toThrow(/already exists/);
    expect(() => addPaymentMode(r.db, { companyId: x, code: "upi", label: "Mine" })).toThrow(/already exists/);
    expect(() => addPaymentMode(r.db, { companyId: y, code: "DD", label: "Mine" })).toThrow(/already exists/);
    expect(() => addPaymentMode(r.db, { companyId: x, code: "1x", label: "Bad code" })).toThrow(RepositoryValidationError);
    expect(() => addPaymentMode(r.db, { companyId: x, code: "OK_CODE", label: "  " })).toThrow(RepositoryValidationError);

    // System modes are read-only; another company's mode is not editable.
    expect(() => renamePaymentMode(r.db, x, "UPI", "Unified")).toThrow(/built-in/);
    expect(() => setPaymentModeActive(r.db, x, "UPI", false)).toThrow(/built-in/);
    expect(() => renamePaymentMode(r.db, y, "DD", "Steal")).toThrow(RepositoryValidationError);
    expect(listPaymentModes(r.db, x).find((m) => m.code === "UPI")?.label).toBe("UPI");

    // A second company mode sorts after the first.
    addPaymentMode(r.db, { companyId: x, code: "WALLET", label: "Wallet" });
    expect(codes(x).slice(-2)).toEqual(["DD", "WALLET"]);
  });

  it("10. add, rename and deactivate each write an audit event and the chain verifies", () => {
    addPaymentMode(r.db, { companyId: x, code: "DD", label: "Demand draft" });
    renamePaymentMode(r.db, x, "DD", "Bank draft");
    setPaymentModeActive(r.db, x, "DD", false);
    setPaymentModeActive(r.db, x, "DD", true);
    const events = r.db
      .prepare("SELECT action, entity_type, company_id, before_values, after_values FROM audit_events WHERE entity_id = 'DD' ORDER BY id")
      .all() as Array<{ action: string; entity_type: string; company_id: string; before_values: string | null; after_values: string | null }>;
    expect(events.map((e) => e.action)).toEqual(["PAYMENT_MODE_ADDED", "PAYMENT_MODE_RENAMED", "PAYMENT_MODE_DEACTIVATED", "PAYMENT_MODE_ACTIVATED"]);
    expect(events.every((e) => e.entity_type === "payment_mode" && e.company_id === x)).toBe(true);
    expect(JSON.parse(events[1]?.before_values ?? "{}")).toEqual({ label: "Demand draft" });
    expect(JSON.parse(events[1]?.after_values ?? "{}")).toEqual({ label: "Bank draft" });
    expect(verifyAuditChain(r.db).ok).toBe(true);
  });
});
