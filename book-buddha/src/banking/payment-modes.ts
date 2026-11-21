import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";

export interface PaymentModeView {
  readonly code: string;
  readonly label: string;
  readonly sortOrder: number;
  readonly active: boolean;
  /** System modes (company_id NULL) are shared by every company and read-only. */
  readonly isSystem: boolean;
}

interface ModeRow { code: string; company_id: string | null; label: string; sort_order: number; active: number }

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;

/** System modes plus the company's own, by sort_order. Inactive ones only when asked for. */
export function listPaymentModes(
  db: Database.Database,
  companyId: string,
  options: { includeInactive?: boolean | undefined } = {},
): PaymentModeView[] {
  requireCompany(db, companyId);
  const rows = db
    .prepare(
      `SELECT code, company_id, label, sort_order, active FROM payment_modes
        WHERE (company_id IS NULL OR company_id = ?) ${options.includeInactive === true ? "" : "AND active = 1"}
        ORDER BY sort_order, code`,
    )
    .all(companyId) as ModeRow[];
  return rows.map(toView);
}

export function addPaymentMode(db: Database.Database, input: { companyId: string; code: string; label: string }): PaymentModeView {
  requireCompany(db, input.companyId);
  const code = input.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    throw new RepositoryValidationError(
      "A payment mode code must be 2 to 40 characters, start with a letter, and use only letters, numbers and underscores.",
    );
  }
  const label = input.label.trim();
  if (label === "") throw new RepositoryValidationError("A payment mode needs a label.");
  if (db.prepare("SELECT 1 FROM payment_modes WHERE code = ?").get(code) !== undefined) {
    throw new RepositoryValidationError(`A payment mode with the code ${code} already exists.`);
  }
  const top = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS top FROM payment_modes WHERE company_id = ?")
    .get(input.companyId) as { top: number };
  const sortOrder = Math.max(100, top.top + 10);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO payment_modes (code, company_id, label, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)",
    ).run(code, input.companyId, label, sortOrder, now, now);
    appendAuditEvent(db, {
      action: "PAYMENT_MODE_ADDED",
      entityId: code,
      entityType: "payment_mode",
      companyId: input.companyId,
      occurredAt: now,
      afterValues: { code, label, sortOrder, active: true },
    });
  })();
  return { code, label, sortOrder, active: true, isSystem: false };
}

export function renamePaymentMode(db: Database.Database, companyId: string, code: string, label: string): void {
  const before = ownMode(db, companyId, code);
  const next = label.trim();
  if (next === "") throw new RepositoryValidationError("A payment mode needs a label.");
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE payment_modes SET label = ?, updated_at = ? WHERE code = ?").run(next, now, before.code);
    appendAuditEvent(db, {
      action: "PAYMENT_MODE_RENAMED",
      entityId: before.code,
      entityType: "payment_mode",
      companyId,
      occurredAt: now,
      beforeValues: { label: before.label },
      afterValues: { label: next },
    });
  })();
}

export function setPaymentModeActive(db: Database.Database, companyId: string, code: string, active: boolean): void {
  const before = ownMode(db, companyId, code);
  if ((before.active === 1) === active) return;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("UPDATE payment_modes SET active = ?, updated_at = ? WHERE code = ?").run(active ? 1 : 0, now, before.code);
    appendAuditEvent(db, {
      action: active ? "PAYMENT_MODE_ACTIVATED" : "PAYMENT_MODE_DEACTIVATED",
      entityId: before.code,
      entityType: "payment_mode",
      companyId,
      occurredAt: now,
      beforeValues: { active: before.active === 1 },
      afterValues: { active },
    });
  })();
}

function requireCompany(db: Database.Database, companyId: string): void {
  if (typeof companyId !== "string" || db.prepare("SELECT 1 FROM companies WHERE id = ?").get(companyId) === undefined) {
    throw new RepositoryValidationError(`Company ${String(companyId)} was not found.`);
  }
}

/** A mode the company owns; a system mode or another company's mode is refused. */
function ownMode(db: Database.Database, companyId: string, rawCode: string): ModeRow {
  requireCompany(db, companyId);
  const code = rawCode.trim().toUpperCase();
  const row = db.prepare("SELECT code, company_id, label, sort_order, active FROM payment_modes WHERE code = ?").get(code) as ModeRow | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Payment mode ${code} was not found.`);
  if (row.company_id === null) throw new RepositoryValidationError(`${row.label} (${code}) is a built-in payment mode and cannot be changed.`);
  if (row.company_id !== companyId) throw new RepositoryValidationError(`Payment mode ${code} was not found.`);
  return row;
}

function toView(r: ModeRow): PaymentModeView {
  return { code: r.code, label: r.label, sortOrder: r.sort_order, active: r.active === 1, isSystem: r.company_id === null };
}
