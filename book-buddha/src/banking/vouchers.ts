import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { appendAuditEvent } from "../database/audit-log.js";
import { RepositoryValidationError } from "../database/errors.js";
import { assertPeriodOpen, postJournalEntry } from "../database/ledger.js";
import { assertBackdatedConfirmed } from "../database/ist-date.js";
import {
  assertPaymentMode, assertPositivePaise, assertRealDate, cancellationDate, nextDocumentNumber, optionalText,
  requireReason, reversalOf, type ListMovementsFilter,
} from "./internal-transfers.js";
import { assertMoneyAccount, companyOfBusiness } from "./money-accounts.js";
import { assertNotOnBankLine } from "./statement-lines.js";

/**
 * R12c - Receipt and Payment Vouchers: money in or out of a cash/bank account against any OTHER
 * account (interest, capital, loans, bank charges, GST paid).
 *
 * RECEIPT: Dr the money account (total) / Cr each line.  PAYMENT: Dr each line / Cr the money account.
 * Cash moves on the voucher's own date (the cash view recognises its income/expense lines then).
 */
export type VoucherKind = "RECEIPT" | "PAYMENT";

export interface VoucherLine {
  readonly lineNo: number;
  readonly account: string;
  readonly amountPaise: number;
  readonly description: string | null;
}

export interface Voucher {
  readonly id: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly fairId: string | null;
  readonly kind: VoucherKind;
  readonly number: string;
  readonly voucherDate: string;
  readonly moneyAccount: string;
  readonly paymentMode: string | null;
  readonly paymentReference: string | null;
  readonly partyName: string | null;
  readonly narration: string | null;
  readonly totalPaise: number;
  readonly status: "POSTED" | "CANCELLED";
  readonly journalEntryId: string;
  readonly reversalEntryId: string | null;
  readonly createdAt: string;
  readonly cancelledAt: string | null;
  readonly cancellationReason: string | null;
  readonly lines: readonly VoucherLine[];
}

export interface CreateVoucherInput {
  readonly kind: VoucherKind;
  readonly businessId: string;
  readonly date: string;
  readonly moneyAccount: string;
  readonly lines: ReadonlyArray<{ account: string; amountPaise: number; description?: string | undefined }>;
  readonly paymentMode?: string | undefined;
  readonly paymentReference?: string | undefined;
  readonly partyName?: string | undefined;
  readonly narration?: string | undefined;
  readonly fairId?: string | undefined;
  /** Q12: confirm a date in an earlier month than today changes figures already reported. */
  readonly confirmBackdatedMonth?: boolean | undefined;
}

export interface ListVouchersFilter extends ListMovementsFilter {
  readonly kind?: VoucherKind | undefined;
}

interface Row {
  id: string; company_id: string; business_id: string; fair_id: string | null; kind: VoucherKind; number: string;
  voucher_date: string; money_account: string; payment_mode: string | null; payment_reference: string | null;
  party_name: string | null; narration: string | null; total_paise: number; status: "POSTED" | "CANCELLED";
  journal_entry_id: string; reversal_entry_id: string | null; created_at: string; cancelled_at: string | null;
  cancellation_reason: string | null;
}

/** Roles that have their own flow: a voucher line may not use them. */
const BLOCKED_ROLES: Record<string, string> = {
  CASH: "use an Internal Transfer to move money between cash and bank accounts",
  BANK: "use an Internal Transfer to move money between cash and bank accounts",
  RECEIVABLES: "customer money goes through the invoice and payment flow",
  PAYABLES: "supplier money goes through the bill and supplier payment flow",
  CUSTOMER_CREDITS: "customer credits go through the credit note flow",
  INVENTORY: "stock goes through purchases and stock adjustments",
};
const BLOCKED_CODES: Record<string, string> = {
  SUPPLIER_CREDITS: "supplier credits go through the purchase return and supplier refund flow",
};

function assertVoucherLineAccount(db: Database.Database, code: string, companyId: string): void {
  const row = db
    .prepare("SELECT code, name, role, active, company_id FROM chart_accounts WHERE code = ?")
    .get(code) as { code: string; name: string; role: string | null; active: number; company_id: string | null } | undefined;
  if (row === undefined || (row.company_id !== null && row.company_id !== companyId)) {
    throw new RepositoryValidationError(`${code} is not an account of this company.`);
  }
  if (row.active === 0) {
    throw new RepositoryValidationError(`${row.name} (${code}) is no longer active. Reactivate it, or pick another account.`);
  }
  const blocked = (row.role !== null ? BLOCKED_ROLES[row.role] : undefined) ?? BLOCKED_CODES[row.code];
  if (blocked !== undefined) {
    throw new RepositoryValidationError(`${row.name} (${code}) cannot be used on a voucher: ${blocked}.`);
  }
}

function toVoucher(db: Database.Database, r: Row): Voucher {
  const lines = db
    .prepare("SELECT line_no, account, amount_paise, description FROM voucher_lines WHERE voucher_id = ? ORDER BY line_no")
    .all(r.id) as Array<{ line_no: number; account: string; amount_paise: number; description: string | null }>;
  return {
    id: r.id, companyId: r.company_id, businessId: r.business_id, fairId: r.fair_id, kind: r.kind, number: r.number,
    voucherDate: r.voucher_date, moneyAccount: r.money_account, paymentMode: r.payment_mode,
    paymentReference: r.payment_reference, partyName: r.party_name, narration: r.narration,
    totalPaise: r.total_paise, status: r.status, journalEntryId: r.journal_entry_id,
    reversalEntryId: r.reversal_entry_id, createdAt: r.created_at, cancelledAt: r.cancelled_at,
    cancellationReason: r.cancellation_reason,
    lines: lines.map((l) => ({ lineNo: l.line_no, account: l.account, amountPaise: l.amount_paise, description: l.description })),
  };
}

export function createVoucher(db: Database.Database, input: CreateVoucherInput): Voucher {
  return db.transaction(() => {
    const companyId = companyOfBusiness(db, input.businessId);
    if (input.kind !== "RECEIPT" && input.kind !== "PAYMENT") {
      throw new RepositoryValidationError("A voucher is either a RECEIPT or a PAYMENT.");
    }
    assertRealDate(input.date, "The voucher date");
    if (!Array.isArray(input.lines) || input.lines.length === 0) {
      throw new RepositoryValidationError("A voucher needs at least one line.");
    }
    assertMoneyAccount(db, input.moneyAccount, companyId);
    assertPaymentMode(db, input.paymentMode, companyId);
    let total = 0;
    input.lines.forEach((line, i) => {
      assertPositivePaise(line.amountPaise, `Line ${i + 1} amount`);
      assertVoucherLineAccount(db, line.account, companyId);
      total += line.amountPaise;
    });

    // Q12: the financial-year lock first (absolute), then the back-dated-month confirm.
    assertPeriodOpen(db, input.businessId, input.date);
    assertBackdatedConfirmed(db, input.date, input.confirmBackdatedMonth, input.kind === "RECEIPT" ? "receipt voucher" : "payment voucher", "post");
    const id = randomUUID();
    const prefix = input.kind === "RECEIPT" ? "RV" : "PV";
    const number = nextDocumentNumber(db, "vouchers", companyId, prefix, input.date);
    const journalEntryId = `je-voucher-${id}`;
    const now = new Date().toISOString();
    const receipt = input.kind === "RECEIPT";
    postJournalEntry(
      db,
      {
        id: journalEntryId,
        sourceId: id,
        sourceType: "MONEY_VOUCHER",
        description: `${receipt ? "Receipt" : "Payment"} voucher ${number}`,
        isReversal: false,
        lines: [
          receipt
            ? { account: input.moneyAccount, debitPaise: total, creditPaise: 0 }
            : { account: input.moneyAccount, debitPaise: 0, creditPaise: total },
          ...input.lines.map((l) =>
            receipt
              ? { account: l.account, debitPaise: 0, creditPaise: l.amountPaise }
              : { account: l.account, debitPaise: l.amountPaise, creditPaise: 0 }),
        ],
      },
      { businessId: input.businessId, entryDate: input.date, ...(input.fairId === undefined ? {} : { fairId: input.fairId }) },
    );
    db.prepare(
      `INSERT INTO vouchers
         (id, company_id, business_id, fair_id, kind, number, voucher_date, money_account, payment_mode,
          payment_reference, party_name, narration, total_paise, status, journal_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
    ).run(
      id, companyId, input.businessId, input.fairId ?? null, input.kind, number, input.date, input.moneyAccount,
      input.paymentMode ?? null, optionalText(input.paymentReference), optionalText(input.partyName),
      optionalText(input.narration), total, journalEntryId, now,
    );
    const insertLine = db.prepare(
      "INSERT INTO voucher_lines (voucher_id, line_no, account, amount_paise, description) VALUES (?, ?, ?, ?, ?)",
    );
    input.lines.forEach((l, i) => insertLine.run(id, i + 1, l.account, l.amountPaise, optionalText(l.description)));
    const created = getVoucher(db, id);
    appendAuditEvent(db, {
      action: "VOUCHER_POSTED",
      entityId: id,
      entityType: "voucher",
      companyId,
      occurredAt: now,
      afterValues: created,
    });
    return created;
  })();
}

export function getVoucher(db: Database.Database, id: string): Voucher {
  const row = db.prepare("SELECT * FROM vouchers WHERE id = ?").get(id) as Row | undefined;
  if (row === undefined) throw new RepositoryValidationError(`Voucher ${id} was not found.`);
  return toVoucher(db, row);
}

export function listVouchers(db: Database.Database, companyId: string, filter: ListVouchersFilter = {}): Voucher[] {
  const where = ["company_id = ?"];
  const params: string[] = [companyId];
  if (filter.fromDate !== undefined) { where.push("voucher_date >= ?"); params.push(filter.fromDate); }
  if (filter.toDate !== undefined) { where.push("voucher_date <= ?"); params.push(filter.toDate); }
  if (filter.businessId !== undefined) { where.push("business_id = ?"); params.push(filter.businessId); }
  if (filter.kind !== undefined) { where.push("kind = ?"); params.push(filter.kind); }
  const rows = db
    .prepare(`SELECT * FROM vouchers WHERE ${where.join(" AND ")} ORDER BY voucher_date, rowid`)
    .all(...params) as Row[];
  return rows.map((r) => toVoucher(db, r));
}

export function cancelVoucher(db: Database.Database, id: string, reason: string): Voucher {
  return db.transaction(() => {
    const why = requireReason(reason);
    const before = getVoucher(db, id);
    if (before.status === "CANCELLED") {
      throw new RepositoryValidationError(`Voucher ${before.number} has already been cancelled.`);
    }
    assertNotOnBankLine(db, before.journalEntryId, `Voucher ${before.number}`);
    // Dated TODAY (IST), like every other cancellation; see cancellationDate in internal-transfers.ts.
    const cancelledOn = cancellationDate(db, before.businessId);
    const reversalId = `${before.journalEntryId}-reversal`;
    postJournalEntry(
      db,
      reversalOf(db, before.journalEntryId, reversalId, before.id, "MONEY_VOUCHER", `Cancelled voucher ${before.number}`),
      { businessId: before.businessId, entryDate: cancelledOn, ...(before.fairId === null ? {} : { fairId: before.fairId }) },
    );
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE vouchers SET status = 'CANCELLED', reversal_entry_id = ?, cancelled_at = ?, cancellation_reason = ? WHERE id = ?",
    ).run(reversalId, now, why, id);
    const after = getVoucher(db, id);
    appendAuditEvent(db, {
      action: "VOUCHER_CANCELLED",
      entityId: id,
      entityType: "voucher",
      companyId: before.companyId,
      occurredAt: now,
      reason: why,
      beforeValues: { status: before.status },
      afterValues: { status: after.status, reversalEntryId: reversalId, reversalDate: cancelledOn },
    });
    return after;
  })();
}
