import { FormEvent, useEffect, useState } from "react";
import { authHeaders } from "./session.js";

type Account = "CASH" | "RECEIVABLES";
type InvoiceStatus = "DRAFT" | "QUOTATION" | "FINALIZED" | "CANCELLED";
interface Company { id: string; name: string; accountingBasis: "CASH" | "ACCRUAL"; }
interface Business { id: string; companyId: string; name: string; }
interface Customer { id: string; companyId: string; name: string; }
interface Fair { id: string; companyId: string; hostCustomerId: string; name: string; startsAt: string | null; endsAt: string | null; }
interface Item { id: string; companyId: string; name: string; unit: string; trackStock: boolean; }
interface InvoiceLine { itemId?: string; description: string; quantity: number; unitPricePaise: number; }
interface Invoice {
  id: string; number: string; businessId: string; customerId: string;
  fairId?: string; buyerName?: string; buyerContact?: string;
  invoiceDate?: string; dueDate?: string; discountPaise?: number; extraChargePaise?: number;
  notes?: string; paymentTerms?: string;
  taxType?: "NONE" | "CGST_SGST" | "IGST"; taxRateBasisPoints?: number;
  convertedInvoiceId?: string;
  paymentAccount: Account; status: InvoiceStatus; lines: InvoiceLine[];
}
interface InvoiceSummary {
  id: string; number: string; businessId: string; customerId: string;
  paymentAccount: Account; status: InvoiceStatus;
}
interface AuditEvent { action: string; entityId: string; occurredAt: string; }
interface TrialBalanceRow { account: string; debitPaise: number; creditPaise: number; }
interface ReportAccountRow { account: string; debitPaise: number; creditPaise: number; balancePaise: number; }
interface ProfitAndLossReport { income: ReportAccountRow[]; expenses: ReportAccountRow[]; totalIncomePaise: number; totalExpensesPaise: number; netProfitPaise: number; }
interface BalanceSheetReport { assets: ReportAccountRow[]; liabilities: ReportAccountRow[]; equity: ReportAccountRow[]; totalAssetsPaise: number; totalLiabilitiesPaise: number; totalEquityPaise: number; }
interface GeneralLedgerRow { journalEntryId: string; sourceId: string; date: string; description: string; isReversal: boolean; account: string; debitPaise: number; creditPaise: number; }
interface Payment { id: string; invoiceId: string; amountPaise: number; paymentAccount: "CASH"; paidAt: string; }
interface ReceivableRow { invoiceId: string; invoiceNumber: string; customerId: string; invoiceDate: string; totalPaise: number; paidPaise: number; outstandingPaise: number; ageDays: number; }
interface FairSalesRow { fairId: string; fairName: string; invoiceCount: number; totalPaise: number; }
interface StockBalance { itemId: string; itemName: string; unit: string; quantity: number; valuePaise: number; }
/** R4c. OPENING and ADJUSTMENT post to the ledger; a bare PURCHASE does not (its bill does). */
type StockMovementType = "OPENING" | "ADJUSTMENT" | "PURCHASE";
interface StockMovementResult {
  id: string; itemId: string; movementType: StockMovementType; quantityDelta: number;
  unitCostPaise: number; occurredAt: string; journalEntryId?: string;
}
interface StockBackfillRow {
  movementId: string; itemName: string; movementType: StockMovementType; quantity: number;
  unitCostPaise: number; valuePaise: number; entryDate: string; offsetAccount: string; reason?: string;
}
interface StockBackfillResult {
  dryRun: boolean; postedCount: number; postedPaise: number; totalPaise: number;
  toPost: StockBackfillRow[]; refused: StockBackfillRow[]; nothingToPost: StockBackfillRow[];
  uncoveredPurchaseMovements: number;
}
interface CreditNoteSummary {
  id: string; invoiceId: string; invoiceNumber: string; number: string; reason: string;
  status: "DRAFT" | "FINALIZED" | "CANCELLED"; createdAt: string;
  subtotalPaise: number; taxPaise: number; totalPaise: number;
}
interface CreditNote {
  id: string; invoiceId: string; number: string; reason: string;
  status: "DRAFT" | "FINALIZED" | "CANCELLED"; lines: InvoiceLine[];
}
interface JournalEntry {
  id: string; sourceId: string; description: string; isReversal: boolean;
  lines: Array<{ account: string; debitPaise: number; creditPaise: number }>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    // Headers go last so the session token cannot be dropped by a caller's own
    // `init`, and so a caller's headers are merged rather than replacing these.
    headers: { "content-type": "application/json", ...authHeaders(), ...init?.headers },
  });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "The request failed.");
  return body as T;
}

function money(paise: number): string {
  // Indian digit grouping (1,12,500.00), which is what the figures are read in.
  const rupees = Math.abs(paise) / 100;
  // The minus belongs in FRONT of the symbol: -₹2,500.00, never ₹-2,500.00.
  return `${paise < 0 ? "-" : ""}₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function emptyLine(): InvoiceLine {
  return { description: "", quantity: 1, unitPricePaise: 0 };
}

export function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [fairs, setFairs] = useState<Fair[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [fairId, setFairId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerContact, setBuyerContact] = useState("");
  const [itemId, setItemId] = useState("");
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [discountPaise, setDiscountPaise] = useState(0);
  const [extraChargePaise, setExtraChargePaise] = useState(0);
  const [notes, setNotes] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [taxType, setTaxType] = useState<"NONE" | "CGST_SGST" | "IGST">("NONE");
  const [taxRateBasisPoints, setTaxRateBasisPoints] = useState(0);
  const [saveAsQuotation, setSaveAsQuotation] = useState(false);
  const [paymentAccount, setPaymentAccount] = useState<Account>("CASH");
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([{
    description: "Sample Book",
    quantity: 1,
    unitPricePaise: 25000,
  }]);
  const invoiceSubtotalPaise = invoiceLines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0);
  const invoiceTaxablePaise = invoiceSubtotalPaise - discountPaise + extraChargePaise;
  const invoiceTaxPaise = Math.round(invoiceTaxablePaise * taxRateBasisPoints / 10000);
  const invoiceTotalPaise = invoiceTaxablePaise + invoiceTaxPaise;
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalanceRow[]>([]);
  const [profitAndLoss, setProfitAndLoss] = useState<ProfitAndLossReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheetReport | null>(null);
  const [generalLedger, setGeneralLedger] = useState<GeneralLedgerRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [fairSales, setFairSales] = useState<FairSalesRow[]>([]);
  const [stockBalances, setStockBalances] = useState<StockBalance[]>([]);
  const [stockItemId, setStockItemId] = useState("");
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockCost, setStockCost] = useState("");
  // R4c: a hand-entered movement now posts, so it needs a type and a date of its own.
  const [stockMovementType, setStockMovementType] = useState<StockMovementType>("OPENING");
  const [stockOccurredOn, setStockOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [lastStockPosting, setLastStockPosting] = useState<StockMovementResult | null>(null);
  const [backfill, setBackfill] = useState<StockBackfillResult | null>(null);
  const [postedSummary, setPostedSummary] = useState<{ count: number; paise: number } | null>(null);
  // R4c's tie-out, both sides derived from what the app already has on screen: the INVENTORY
  // account as the LEDGER has it, against the stock the FIFO layers say is held.
  const inventoryLedgerPaise = trialBalance
    .filter((row) => row.account === "INVENTORY")
    .reduce((total, row) => total + row.debitPaise - row.creditPaise, 0);
  const stockValuationPaise = stockBalances.reduce((total, row) => total + row.valuePaise, 0);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [creditNotes, setCreditNotes] = useState<CreditNoteSummary[]>([]);
  const [returnedByItem, setReturnedByItem] = useState<Record<string, number>>({});
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({});
  const [creditNoteNumber, setCreditNoteNumber] = useState("");
  const [creditNoteReason, setCreditNoteReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadCompanies() {
    const records = await api<Company[]>("/companies");
    setCompanies(records);
    if (records.length > 0 && !companyId) await selectCompany(records[0].id);
  }

  async function selectCompany(id: string) {
    setCompanyId(id);
    const [businessRecords, customerRecords, itemRecords, fairRecords, stockRecords] = await Promise.all([
      api<Business[]>(`/businesses?companyId=${encodeURIComponent(id)}`),
      api<Customer[]>(`/customers?companyId=${encodeURIComponent(id)}`),
      api<Item[]>(`/items?companyId=${encodeURIComponent(id)}`),
      api<Fair[]>(`/fairs?companyId=${encodeURIComponent(id)}`),
      api<StockBalance[]>("/inventory/stock"),
    ]);
    setBusinesses(businessRecords);
    setCustomers(customerRecords);
    setItems(itemRecords);
    setFairs(fairRecords);
    setStockBalances(stockRecords);
    setBusinessId((current) => businessRecords.some((record) => record.id === current) ? current : (businessRecords[0]?.id ?? ""));
    setCustomerId((current) => customerRecords.some((record) => record.id === current) ? current : (customerRecords[0]?.id ?? ""));
    setItemId((current) => itemRecords.some((record) => record.id === current) ? current : (itemRecords[0]?.id ?? ""));
    setFairId((current) => fairRecords.some((record) => record.id === current) ? current : "");
  }

  async function loadInvoices(id: string) {
    if (!id) {
      setInvoices([]);
      return;
    }
    setInvoices(await api<InvoiceSummary[]>(`/invoices?businessId=${encodeURIComponent(id)}`));
  }

  async function selectInvoice(id: string) {
    await run(async () => {
      const selected = await api<Invoice>(`/invoices/${encodeURIComponent(id)}`);
      setInvoice(selected);
      setInvoiceNumber(selected.number);
      setInvoiceDate(selected.invoiceDate ?? new Date().toISOString().slice(0, 10));
      setDueDate(selected.dueDate ?? "");
      setDiscountPaise(selected.discountPaise ?? 0);
      setExtraChargePaise(selected.extraChargePaise ?? 0);
      setNotes(selected.notes ?? "");
      setPaymentTerms(selected.paymentTerms ?? "");
      setTaxType(selected.taxType ?? "NONE");
      setTaxRateBasisPoints(selected.taxRateBasisPoints ?? 0);
      setSaveAsQuotation(selected.status === "QUOTATION");
      setPaymentAccount(selected.paymentAccount);
      setFairId(selected.fairId ?? "");
      setBuyerName(selected.buyerName ?? "");
      setBuyerContact(selected.buyerContact ?? "");
      setInvoiceLines(selected.lines.map((line) => ({ ...line })));
      setReturnQuantities({});
      setPayments(await api<Payment[]>(`/invoices/${encodeURIComponent(id)}/payments`));
      await refreshAccounting(selected.id);
    });
  }

  useEffect(() => {
    void loadCompanies().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load saved records."));
    void loadCreditNotes().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load credit notes."));
    // R4c: the inventory tie-out reads the trial balance, so the reports must be loaded on
    // arrival. Without this the ledger side shows zero on a book that already has entries -
    // which reads as "the accounts hold no stock" when they may hold plenty.
    void refreshLedgerViews().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load the reports."));
    void api<StockBalance[]>("/inventory/stock").then(setStockBalances).catch(() => undefined);
  }, []);

  useEffect(() => {
    void loadInvoices(businessId).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Could not load invoices."));
  }, [businessId]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const company = await api<Company>("/companies", {
        method: "POST", body: JSON.stringify({
          name: form.get("companyName"),
          accountingBasis: form.get("accountingBasis"),
        }),
      });
      const business = await api<Business>("/businesses", {
        method: "POST", body: JSON.stringify({ companyId: company.id, name: form.get("businessName") }),
      });
      const customer = await api<Customer>("/customers", {
        method: "POST", body: JSON.stringify({ companyId: company.id, name: form.get("customerName") }),
      });
      const item = await api<Item>("/items", {
        method: "POST", body: JSON.stringify({
          companyId: company.id, name: form.get("itemName"), unit: form.get("itemUnit"),
          trackStock: form.get("trackStock") === "on",
        }),
      });
      setCompanies((current) => [...current, company]);
      setBusinesses([business]); setCustomers([customer]); setItems([item]);
      setCompanyId(company.id); setBusinessId(business.id); setCustomerId(customer.id); setItemId(item.id);
      setMessage("Setup saved. Existing records remain available for reuse.");
    });
  }

  async function submitInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!businessId || !customerId) throw new Error("Select or create a business and customer first.");
      const lines = invoiceLines.map((line) => ({
        ...(line.itemId ? { itemId: line.itemId } : {}),
        description: line.description.trim(),
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
      }));
      if (lines.some((line) => line.description.length === 0)) {
        throw new Error("Every invoice line needs a description.");
      }
      const payload = {
        number: invoiceNumber.trim() || `INV-${Date.now()}`,
        businessId,
        customerId,
        paymentAccount,
        invoiceDate,
        ...(dueDate ? { dueDate } : {}),
        discountPaise,
        extraChargePaise,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(paymentTerms.trim() ? { paymentTerms: paymentTerms.trim() } : {}),
        taxType,
        taxRateBasisPoints,
        status: saveAsQuotation ? "QUOTATION" : "DRAFT",
        ...(fairId ? { fairId } : {}),
        ...(buyerName.trim() ? { buyerName: buyerName.trim() } : {}),
        ...(buyerContact.trim() ? { buyerContact: buyerContact.trim() } : {}),
        lines,
      };
      const editingDraft = invoice?.status === "DRAFT" || invoice?.status === "QUOTATION";
      const editingQuotation = invoice?.status === "QUOTATION";
      const saved = await api<Invoice>(
        editingDraft ? `/invoices/${invoice.id}` : (saveAsQuotation ? "/quotations" : "/invoices"),
        {
        method: editingDraft ? "PUT" : "POST",
        body: JSON.stringify({
          ...payload,
        }),
        });
      setInvoice(saved);
      setInvoiceNumber(saved.number);
      setInvoiceDate(saved.invoiceDate ?? invoiceDate);
      setDueDate(saved.dueDate ?? "");
      setDiscountPaise(saved.discountPaise ?? 0);
      setExtraChargePaise(saved.extraChargePaise ?? 0);
      setNotes(saved.notes ?? "");
      setPaymentTerms(saved.paymentTerms ?? "");
      setTaxType(saved.taxType ?? "NONE");
      setTaxRateBasisPoints(saved.taxRateBasisPoints ?? 0);
      setPaymentAccount(saved.paymentAccount);
      setFairId(saved.fairId ?? "");
      setBuyerName(saved.buyerName ?? "");
      setBuyerContact(saved.buyerContact ?? "");
      setInvoiceLines(saved.lines.map((line) => ({ ...line })));
      setInvoices(await api<InvoiceSummary[]>(`/invoices?businessId=${encodeURIComponent(saved.businessId)}`));
      setMessage(editingQuotation ? "Quotation updated." : saveAsQuotation ? "Quotation saved." : editingDraft ? "Draft invoice updated." : "Draft invoice saved.");
    });
  }

  async function updateInvoice(action: "finalize" | "cancel") {
    await run(async () => {
      if (!invoice) throw new Error("Create an invoice first.");
      await api(`/invoices/${invoice.id}/${action}`, { method: "POST" });
      setInvoice(await api<Invoice>(`/invoices/${invoice.id}`));
      setInvoices(await api<InvoiceSummary[]>(`/invoices?businessId=${encodeURIComponent(invoice.businessId)}`));
      await refreshAccounting(invoice.id);
      setMessage(action === "finalize" ? "Invoice finalized." : "Invoice cancelled with a reversal.");
    });
  }

  async function convertQuotation() {
    await run(async () => {
      if (!invoice || invoice.status !== "QUOTATION") throw new Error("Select a quotation first.");
      const converted = await api<Invoice>(`/quotations/${invoice.id}/convert`, { method: "POST" });
      setInvoice(converted);
      setInvoices(await api<InvoiceSummary[]>(`/invoices?businessId=${encodeURIComponent(converted.businessId)}`));
      setMessage("Quotation converted to a draft invoice.");
    });
  }

  function updateLine(index: number, patch: Partial<InvoiceLine>) {
    setInvoiceLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, ...patch } : line,
    ));
  }

  function selectLineItem(index: number, selectedItemId: string) {
    const item = items.find((record) => record.id === selectedItemId);
    updateLine(index, {
      itemId: selectedItemId || undefined,
      ...(item ? { description: item.name } : {}),
    });
  }

  async function refreshAccounting(invoiceId: string) {
    const [events, entries, balance] = await Promise.all([
      api<AuditEvent[]>(`/audit-events?entityId=${encodeURIComponent(invoiceId)}`),
      api<JournalEntry[]>("/journal-entries"),
      api<TrialBalanceRow[]>("/reports/trial-balance"),
    ]);
    setAuditEvents(events); setJournalEntries(entries); setTrialBalance(balance);
    const [profitAndLossReport, balanceSheetReport, ledger] = await Promise.all([
      api<ProfitAndLossReport>("/reports/profit-and-loss"),
      api<BalanceSheetReport>("/reports/balance-sheet"),
      api<GeneralLedgerRow[]>("/reports/general-ledger"),
    ]);
    setProfitAndLoss(profitAndLossReport);
    setBalanceSheet(balanceSheetReport);
    setGeneralLedger(ledger);
    setReceivables(await api<ReceivableRow[]>("/reports/receivables"));
    setFairSales(await api<FairSalesRow[]>("/reports/fair-sales"));
    setStockBalances(await api<StockBalance[]>("/inventory/stock"));
    await loadCreditNotes(invoiceId);
  }

  async function loadCreditNotes(forInvoiceId?: string) {
    const all = await api<CreditNoteSummary[]>("/credit-notes");
    setCreditNotes(all);
    const targetInvoiceId = forInvoiceId ?? invoice?.id;
    if (!targetInvoiceId) { setReturnedByItem({}); return; }
    const finalizedForInvoice = all.filter((note) => note.invoiceId === targetInvoiceId && note.status === "FINALIZED");
    const details = await Promise.all(finalizedForInvoice.map((note) => api<CreditNote>(`/credit-notes/${encodeURIComponent(note.id)}`)));
    const returned: Record<string, number> = {};
    for (const detail of details) {
      for (const line of detail.lines) {
        if (line.itemId) returned[line.itemId] = (returned[line.itemId] ?? 0) + line.quantity;
      }
    }
    setReturnedByItem(returned);
  }

  function returnableQuantity(line: InvoiceLine): number {
    if (!line.itemId) return line.quantity;
    const invoicedForItem = (invoice?.lines ?? []).filter((candidate) => candidate.itemId === line.itemId).reduce((total, candidate) => total + candidate.quantity, 0);
    return Math.max(0, Math.min(line.quantity, invoicedForItem - (returnedByItem[line.itemId] ?? 0)));
  }

  async function submitCreditNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!invoice || invoice.status !== "FINALIZED") throw new Error("Select a finalized invoice first.");
      const lines = invoice.lines.flatMap((line, index) => {
        const quantity = Number(returnQuantities[index] ?? "0");
        if (!quantity) return [];
        if (!Number.isInteger(quantity) || quantity < 0) throw new Error("Return quantities must be whole numbers.");
        if (quantity > returnableQuantity(line)) throw new Error(`You can return at most ${returnableQuantity(line)} of "${line.description}".`);
        return [{ ...(line.itemId ? { itemId: line.itemId } : {}), description: line.description, quantity, unitPricePaise: line.unitPricePaise }];
      });
      if (lines.length === 0) throw new Error("Enter a return quantity for at least one line.");
      if (!creditNoteReason.trim()) throw new Error("Enter a reason for the return.");
      await api<CreditNote>("/credit-notes", {
        method: "POST",
        body: JSON.stringify({ invoiceId: invoice.id, number: creditNoteNumber.trim() || `CN-${Date.now()}`, reason: creditNoteReason.trim(), lines }),
      });
      setReturnQuantities({}); setCreditNoteNumber(""); setCreditNoteReason("");
      await loadCreditNotes(invoice.id);
      setMessage("Draft credit note saved. Finalize it to post the return.");
    });
  }

  async function finalizeCreditNote(creditNoteId: string) {
    await run(async () => {
      if (!invoice) throw new Error("Select an invoice first.");
      await api(`/credit-notes/${encodeURIComponent(creditNoteId)}/finalize`, { method: "POST" });
      await refreshAccounting(invoice.id);
      setMessage("Credit note finalized. The return has been posted to the books.");
    });
  }

  async function submitStockMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!stockItemId) throw new Error("Select a stock-tracked item first.");
      const posted = await api<StockMovementResult>("/inventory/movements", {
        method: "POST",
        body: JSON.stringify({
          itemId: stockItemId,
          quantity: Number(stockQuantity),
          unitCostPaise: Math.round(Number(stockCost) * 100),
          movementType: stockMovementType,
          // R4c: the business owns the journal entry, and the date is the entry's date.
          ...(businessId === "" ? {} : { businessId }),
          ...(stockMovementType === "PURCHASE" ? {} : { occurredOn: stockOccurredOn }),
          ...(fairId === "" || stockMovementType === "PURCHASE" ? {} : { fairId }),
        }),
      });
      setStockQuantity("");
      setStockCost("");
      setLastStockPosting(posted);
      setStockBalances(await api<StockBalance[]>("/inventory/stock"));
      await refreshLedgerViews();
      setMessage(
        posted.journalEntryId === undefined
          ? "Stock added. Nothing was posted to the accounts: a purchase is posted by its bill."
          : `Stock added and posted to the accounts: ${stockPostingWords(stockMovementType)}.`,
      );
    });
  }

  /** R4c: what the owner is about to post, in words, before they press the button. */
  function stockPostingWords(movementType: StockMovementType): string {
    if (movementType === "OPENING") return "Debit Inventory, credit Opening Balance Equity";
    if (movementType === "ADJUSTMENT") return "Debit Inventory, credit Stock Adjustment";
    return "nothing — a purchase is posted by its bill";
  }

  /** The reports that move when anything posts, refreshed without needing an invoice. */
  async function refreshLedgerViews() {
    const [balance, entries, ledger] = await Promise.all([
      api<TrialBalanceRow[]>("/reports/trial-balance"),
      api<JournalEntry[]>("/journal-entries"),
      api<GeneralLedgerRow[]>("/reports/general-ledger"),
    ]);
    setTrialBalance(balance); setJournalEntries(entries); setGeneralLedger(ledger);
    const [profitAndLossReport, balanceSheetReport] = await Promise.all([
      api<ProfitAndLossReport>("/reports/profit-and-loss"),
      api<BalanceSheetReport>("/reports/balance-sheet"),
    ]);
    setProfitAndLoss(profitAndLossReport); setBalanceSheet(balanceSheetReport);
  }

  /**
   * R4c. `apply: false` is a DRY RUN: it reports what would be posted and writes nothing. The
   * owner has to press the second button, which is the whole point - it never runs on its own.
   */
  async function runBackfill(apply: boolean) {
    await run(async () => {
      if (!businessId) throw new Error("Pick a business first: a journal entry belongs to one.");
      const result = await api<StockBackfillResult>("/inventory/journal-backfill", {
        method: "POST",
        body: JSON.stringify({ businessId, apply }),
      });
      setBackfill(result);
      if (apply) {
        setStockBalances(await api<StockBalance[]>("/inventory/stock"));
        await refreshLedgerViews();
        // Re-check after posting, so what is on screen is what is NOW outstanding rather than
        // a list of things already done, still headed "would post".
        setBackfill(await api<StockBackfillResult>("/inventory/journal-backfill", {
          method: "POST",
          body: JSON.stringify({ businessId, apply: false }),
        }));
        setPostedSummary({ count: result.postedCount, paise: result.postedPaise });
      } else {
        setPostedSummary(null);
      }
      setMessage(
        apply
          ? `Posted ${result.postedCount} entr${result.postedCount === 1 ? "y" : "ies"}, ${money(result.postedPaise)} in total.`
          : result.toPost.length === 0
            ? "Checked: every opening and adjustment movement is already in the accounts."
            : `Checked only — nothing written. ${result.toPost.length} movement${result.toPost.length === 1 ? "" : "s"} worth ${money(result.totalPaise)} would be posted.`,
      );
    });
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      if (!invoice) throw new Error("Select an invoice first.");
      const amountPaise = Math.round(Number(paymentAmount) * 100);
      const payment = await api<Payment>(`/invoices/${encodeURIComponent(invoice.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({ amountPaise }),
      });
      setPayments((current) => [...current, payment]);
      setPaymentAmount("");
      await refreshAccounting(invoice.id);
      setMessage("Payment recorded.");
    });
  }

  return (
    <main className="shell">
      <header className="header"><div><h1>Book Buddha</h1></div><span className="status"><span className="dot" /> Local workspace</span></header>
      <section className="hero"><div><p className="eyebrow">Phase 1A</p><h2>Accounting proof of concept</h2><p>Create records, raise an invoice, and verify balanced accounting entries.</p></div></section>
      {message && <div className="notice">{message}</div>}
      <section className="card">
        <p className="eyebrow">Workspace</p><h3>Use saved records</h3>
        <div className="form-row">
          <label>Company<select value={companyId} onChange={(event) => void selectCompany(event.target.value)}><option value="">Select company</option>{companies.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
          <label>Business<select value={businessId} onChange={(event) => setBusinessId(event.target.value)} disabled={!companyId}><option value="">Select business</option>{businesses.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
          <label>Customer<select value={customerId} onChange={(event) => setCustomerId(event.target.value)} disabled={!companyId}><option value="">Select customer</option>{customers.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
          <label>Item<select value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={!companyId}><option value="">Select item</option>{items.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}</select></label>
          <label>Fair<select value={fairId} onChange={(event) => setFairId(event.target.value)} disabled={!companyId}><option value="">No fair</option>{fairs.filter((fair) => fair.hostCustomerId === customerId).map((fair) => <option key={fair.id} value={fair.id}>{fair.name}</option>)}</select></label>
        </div>
      </section>
      {/* R4c: opening stock and adjustments now reach the accounts, so this card says what it
          will post BEFORE the button is pressed, and shows the entry it posted afterwards. */}
      <section className="card">
        <p className="eyebrow">Inventory</p><h3>Add stock</h3>
        <form onSubmit={submitStockMovement} className="form">
          <div className="form-row">
            <label>Item<select value={stockItemId} onChange={(event) => setStockItemId(event.target.value)} required><option value="">Select tracked item</option>{items.filter((item) => item.trackStock).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Why<select value={stockMovementType} onChange={(event) => { setStockMovementType(event.target.value as StockMovementType); setLastStockPosting(null); }}>
              <option value="OPENING">Opening stock (held before the books began)</option>
              <option value="ADJUSTMENT">Adjustment (a recount found more)</option>
              <option value="PURCHASE">Purchase without a bill</option>
            </select></label>
          </div>
          <div className="form-row">
            <label>Quantity<input type="number" min="1" step="1" value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} required /></label>
            <label>Unit cost (₹)<input type="number" min="0" step="0.01" value={stockCost} onChange={(event) => setStockCost(event.target.value)} required /></label>
            <label>Dated<input type="date" value={stockOccurredOn} onChange={(event) => setStockOccurredOn(event.target.value)} disabled={stockMovementType === "PURCHASE"} /></label>
          </div>
          <p className={stockMovementType === "PURCHASE" ? "muted" : "posting-note"}>
            {stockMovementType === "PURCHASE"
              ? "This posts nothing to the accounts: a purchase is posted by its bill, so posting here would count the same stock twice."
              : <>This will post <strong>{stockPostingWords(stockMovementType)}</strong>{stockQuantity !== "" && stockCost !== "" ? <> — {money(Math.round(Number(stockQuantity) * Number(stockCost) * 100))}</> : null}, dated {stockOccurredOn}.</>}
          </p>
          <button className="primary" disabled={busy}>Add stock</button>
        </form>
        {lastStockPosting !== null && <p className={lastStockPosting.journalEntryId === undefined ? "muted" : "posted-note"}>
          {lastStockPosting.journalEntryId === undefined
            ? `${lastStockPosting.quantityDelta} added to stock. Nothing posted to the accounts.`
            : `${lastStockPosting.quantityDelta} added to stock and posted: ${money(lastStockPosting.quantityDelta * lastStockPosting.unitCostPaise)}.`}
        </p>}
        {stockBalances.length > 0 && <table><thead><tr><th>Item</th><th>Quantity</th><th>Value</th></tr></thead><tbody>{stockBalances.map((row) => <tr key={row.itemId}><td>{row.itemName}</td><td>{row.quantity} {row.unit}</td><td>{money(row.valuePaise)}</td></tr>)}</tbody></table>}
      </section>
      {/* R4c: the tie-out this slice exists for, plus the backfill for stock entered earlier. */}
      <section className="card">
        <p className="eyebrow">Inventory &amp; the ledger</p><h3>Does the stock agree with the accounts?</h3>
        <table className="tieout">
          <tbody>
            <tr><td>Inventory, as the accounts have it</td><td>{money(inventoryLedgerPaise)}</td></tr>
            <tr><td>Stock the app says you hold</td><td>{money(stockValuationPaise)}</td></tr>
            <tr className={inventoryLedgerPaise === stockValuationPaise ? "agrees" : "differs"}>
              <td><strong>Difference</strong></td><td><strong>{money(inventoryLedgerPaise - stockValuationPaise)}</strong></td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          {inventoryLedgerPaise === stockValuationPaise
            ? "They agree to the paise."
            : "They do not agree. Opening stock or adjustments entered before this was built posted nothing to the accounts; check below."}
        </p>
        <h3 className="subheading">Stock entered without an accounting entry</h3>
        <div className="form-row">
          <button type="button" className="primary" disabled={busy} onClick={() => void runBackfill(false)}>Check only (writes nothing)</button>
          <button type="button" disabled={busy || backfill === null || backfill.toPost.length === 0} onClick={() => void runBackfill(true)}>
            {backfill === null || backfill.toPost.length === 0 ? "Post these entries" : `Post these ${backfill.toPost.length} entries (${money(backfill.totalPaise)})`}
          </button>
        </div>
        {postedSummary !== null && <p className="posted-note">
          Posted {postedSummary.count} entr{postedSummary.count === 1 ? "y" : "ies"}, {money(postedSummary.paise)} in total. Nothing else is waiting.
        </p>}
        {backfill !== null && <>
          <p className="muted">{backfill.toPost.length === 0 ? "Every opening and adjustment movement is in the accounts." : "Checked only — nothing has been written."}</p>
          {backfill.toPost.length > 0 && <table><thead><tr><th>Item</th><th>Why</th><th>Dated</th><th>Quantity</th><th>Value</th><th>Would credit</th></tr></thead><tbody>
            {backfill.toPost.map((row) => <tr key={row.movementId}><td>{row.itemName}</td><td>{row.movementType === "OPENING" ? "Opening stock" : "Adjustment"}</td><td>{row.entryDate}</td><td>{row.quantity}</td><td>{money(row.valuePaise)}</td><td>{row.offsetAccount === "OPENING_BALANCE_EQUITY" ? "Opening Balance Equity" : "Stock Adjustment"}</td></tr>)}
          </tbody></table>}
          {backfill.refused.length > 0 && <>
            <h3 className="subheading">Refused, and why</h3>
            <table><thead><tr><th>Item</th><th>Dated</th><th>Value</th><th>Reason</th></tr></thead><tbody>
              {backfill.refused.map((row) => <tr key={row.movementId}><td>{row.itemName}</td><td>{row.entryDate}</td><td>{money(row.valuePaise)}</td><td>{row.reason}</td></tr>)}
            </tbody></table>
          </>}
          {backfill.uncoveredPurchaseMovements > 0 && <p className="muted">
            {backfill.uncoveredPurchaseMovements} purchase movement{backfill.uncoveredPurchaseMovements === 1 ? "" : "s"} {backfill.uncoveredPurchaseMovements === 1 ? "has" : "have"} no bill behind {backfill.uncoveredPurchaseMovements === 1 ? "it" : "them"}, so {backfill.uncoveredPurchaseMovements === 1 ? "it" : "they"} cannot be posted here. Enter a purchase bill for {backfill.uncoveredPurchaseMovements === 1 ? "it" : "them"} instead.
          </p>}
        </>}
      </section>
      {invoice?.status === "FINALIZED" && invoice.paymentAccount === "RECEIVABLES" && <section className="card payment-card"><p className="eyebrow">Receivables</p><h3>Record customer payment</h3><form onSubmit={submitPayment} className="form"><label>Amount (₹)<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label><button className="primary" disabled={busy}>Record payment</button></form>{payments.length > 0 && <p className="muted">{payments.length} payment{payments.length === 1 ? "" : "s"} recorded · {money(payments.reduce((total, payment) => total + payment.amountPaise, 0))}</p>}</section>}
      <section className="grid">
        <article className="card"><p className="eyebrow">Setup</p><h3>Create new records</h3><form onSubmit={submitSetup} className="form">
          <label>Company name<input name="companyName" defaultValue="My Company" required /></label><label>Accounting basis<select name="accountingBasis" defaultValue="ACCRUAL"><option value="ACCRUAL">Accrual basis</option><option value="CASH">Cash basis</option></select></label><label>Business name<input name="businessName" defaultValue="My Business" required /></label><label>Customer name<input name="customerName" defaultValue="Sample Customer" required /></label><label>Item name<input name="itemName" defaultValue="Sample Book" required /></label><label>Item unit<input name="itemUnit" defaultValue="each" required /></label><label className="check"><input name="trackStock" type="checkbox" defaultChecked /> Track stock</label><button className="primary" disabled={busy}>Save new setup</button>
        </form></article>
        <article className="card"><p className="eyebrow">Sales</p><h3>Invoice lifecycle</h3><form onSubmit={submitInvoice} className="form">
          <div className="form-row"><label>Invoice number<input value={invoiceNumber} placeholder={`INV-${Date.now()}`} onChange={(event) => setInvoiceNumber(event.target.value)} required /></label><label>Invoice date<input type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} required /></label><label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>
          <div className="form-row"><label>Discount (₹)<input type="number" min="0" step="0.01" value={discountPaise / 100} onChange={(event) => setDiscountPaise(Math.round(Number(event.target.value) * 100))} /></label><label>Extra charge (₹)<input type="number" min="0" step="0.01" value={extraChargePaise / 100} onChange={(event) => setExtraChargePaise(Math.round(Number(event.target.value) * 100))} /></label><label>Payment terms<input value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} placeholder="e.g. Due in 30 days" /></label></div>
          <div className="form-row"><label>Tax type<select value={taxType} onChange={(event) => setTaxType(event.target.value as typeof taxType)}><option value="NONE">No tax</option><option value="CGST_SGST">CGST + SGST</option><option value="IGST">IGST</option></select></label><label>GST rate (%)<input type="number" min="0" max="100" step="0.01" value={taxRateBasisPoints / 100} onChange={(event) => setTaxRateBasisPoints(Math.round(Number(event.target.value) * 100))} disabled={taxType === "NONE"} /></label></div>
          <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} placeholder="Optional customer-facing notes" /></label>
          <div className="form-row"><label>Buyer name<input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} placeholder="Optional fair buyer" /></label><label>Buyer contact<input value={buyerContact} onChange={(event) => setBuyerContact(event.target.value)} placeholder="Optional phone or email" /></label></div>
          <div className="line-editor">
            {invoiceLines.map((line, index) => (
              <div className="line-row" key={index}>
                <label>Saved item<select value={line.itemId ?? ""} onChange={(event) => selectLineItem(index, event.target.value)} disabled={busy}><option value="">Custom description</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
                <label>Description<input value={line.description} onChange={(event) => updateLine(index, { description: event.target.value })} required /></label>
                <label>Qty<input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} required /></label>
                <label>Price (₹)<input type="number" min="0" step="0.01" value={line.unitPricePaise / 100} onChange={(event) => updateLine(index, { unitPricePaise: Math.round(Number(event.target.value) * 100) })} required /></label>
                <button type="button" className="remove-line" onClick={() => setInvoiceLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} disabled={invoiceLines.length === 1 || busy}>Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setInvoiceLines((current) => [...current, emptyLine()])} disabled={busy}>+ Add line</button>
          </div>
          <div className="invoice-total"><span>Subtotal: {money(invoiceSubtotalPaise)}</span><span>Discount: {money(discountPaise)}</span><span>Extra charge: {money(extraChargePaise)}</span><span>GST: {money(invoiceTaxPaise)}</span><strong>Total: {money(invoiceTotalPaise)}</strong></div>
          <label>Payment account<select value={paymentAccount} onChange={(event) => setPaymentAccount(event.target.value as Account)}><option value="CASH">Cash</option><option value="RECEIVABLES">Accounts receivable</option></select></label><label className="check"><input type="checkbox" checked={saveAsQuotation} onChange={(event) => setSaveAsQuotation(event.target.checked)} disabled={invoice?.status === "FINALIZED" || invoice?.status === "CANCELLED"} /> Save as quotation</label><button disabled={busy || !businessId}>{saveAsQuotation ? (invoice?.status === "QUOTATION" ? "Update quotation" : "Save quotation") : invoice?.status === "DRAFT" ? "Update draft invoice" : "Save draft invoice"}</button>
        </form>{invoice && <div className="invoice"><div className="row"><strong>{invoice.number}</strong><span className={`badge ${invoice.status.toLowerCase()}`}>{invoice.status}</span></div><p>{invoice.lines.length} line{invoice.lines.length === 1 ? "" : "s"} · Total {money(invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0) - (invoice.discountPaise ?? 0) + (invoice.extraChargePaise ?? 0) + Math.round((invoice.lines.reduce((total, line) => total + line.quantity * line.unitPricePaise, 0) - (invoice.discountPaise ?? 0) + (invoice.extraChargePaise ?? 0)) * (invoice.taxRateBasisPoints ?? 0) / 10000))}</p>{invoice.status === "QUOTATION" && <button className="primary" onClick={() => void convertQuotation()} disabled={busy || invoice.convertedInvoiceId !== undefined}>Convert to draft invoice</button>}{invoice.status === "DRAFT" && <button className="primary" onClick={() => updateInvoice("finalize")} disabled={busy}>Finalize invoice</button>}{invoice.status === "FINALIZED" && <button className="danger" onClick={() => updateInvoice("cancel")} disabled={busy}>Cancel with reversal</button>}</div>}</article>
      </section>
      {invoice?.status === "FINALIZED" && <section className="card"><p className="eyebrow">Sales returns</p><h3>Credit note for {invoice.number}</h3>
        <form onSubmit={submitCreditNote} className="form">
          <div className="form-row"><label>Credit note number<input value={creditNoteNumber} placeholder="CN-…" onChange={(event) => setCreditNoteNumber(event.target.value)} /></label><label>Reason<input value={creditNoteReason} onChange={(event) => setCreditNoteReason(event.target.value)} placeholder="e.g. Damaged copies returned" required /></label></div>
          <div className="line-editor">
            {invoice.lines.map((line, index) => (
              <div className="line-row" key={index}>
                <label>Description<input value={line.description} disabled readOnly /></label>
                <label>Price (₹)<input value={(line.unitPricePaise / 100).toFixed(2)} disabled readOnly /></label>
                <label>Returnable<input value={returnableQuantity(line)} disabled readOnly /></label>
                <label>Return qty<input type="number" min="0" max={returnableQuantity(line)} step="1" value={returnQuantities[index] ?? ""} onChange={(event) => setReturnQuantities((current) => ({ ...current, [index]: event.target.value }))} disabled={busy || returnableQuantity(line) === 0} /></label>
              </div>
            ))}
          </div>
          <div className="invoice-total"><strong>Return value (before GST): {money(invoice.lines.reduce((total, line, index) => total + (Number(returnQuantities[index] ?? "0") || 0) * line.unitPricePaise, 0))}</strong></div>
          <button className="primary" disabled={busy}>Save draft credit note</button>
        </form>
        {creditNotes.filter((note) => note.invoiceId === invoice.id).length > 0 && <table><thead><tr><th>Credit note</th><th>Reason</th><th>Status</th><th>Total</th><th /></tr></thead><tbody>{creditNotes.filter((note) => note.invoiceId === invoice.id).map((note) => <tr key={note.id}><td>{note.number}</td><td>{note.reason}</td><td><span className={`badge ${note.status.toLowerCase()}`}>{note.status}</span></td><td>{money(note.totalPaise)}</td><td>{note.status === "DRAFT" && <button className="primary" onClick={() => void finalizeCreditNote(note.id)} disabled={busy}>Finalize</button>}</td></tr>)}</tbody></table>}
      </section>}
      <section className="card">
        <p className="eyebrow">Saved work</p><h3>Invoices</h3>
        {invoices.length === 0 ? <p className="muted">No invoices have been saved for this business.</p> : (
          <div className="invoice-list">{invoices.map((record) => (
            <button className="invoice-row" key={record.id} onClick={() => void selectInvoice(record.id)} disabled={busy}>
              <span><strong>{record.number}</strong><small>{record.paymentAccount === "CASH" ? "Cash" : "Accounts receivable"}</small></span>
              <span className={`badge ${record.status.toLowerCase()}`}>{record.status}</span>
            </button>
          ))}</div>
        )}
      </section>
      <section className="grid"><article className="card"><p className="eyebrow">Reports</p><h3>Trial Balance</h3>{trialBalance.length === 0 ? <p className="muted">Finalize an invoice to populate the report.</p> : <table><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{trialBalance.map((row) => <tr key={row.account}><td>{row.account}</td><td>{money(row.debitPaise)}</td><td>{money(row.creditPaise)}</td></tr>)}</tbody></table>}</article><article className="card"><p className="eyebrow">Traceability</p><h3>Audit history</h3>{auditEvents.length === 0 ? <p className="muted">Finalize or cancel an invoice to see its events.</p> : <ul className="events">{auditEvents.map((event) => <li key={`${event.action}-${event.occurredAt}`}><strong>{event.action}</strong><span>{new Date(event.occurredAt).toLocaleString()}</span></li>)}</ul>}<h3 className="subheading">Journal entries</h3>{journalEntries.map((entry) => <p className="journal" key={entry.id}>{entry.description} · {entry.isReversal ? "Reversal" : "Original"}</p>)}</article></section>
      <section className="grid"><article className="card"><p className="eyebrow">Financial statements</p><h3>Profit &amp; Loss</h3>{profitAndLoss === null ? <p className="muted">Finalize an invoice to populate the report.</p> : <><p>Income: <strong>{money(profitAndLoss.totalIncomePaise)}</strong></p><p>Expenses: <strong>{money(profitAndLoss.totalExpensesPaise)}</strong></p><p>Net profit: <strong>{money(profitAndLoss.netProfitPaise)}</strong></p></>}</article><article className="card"><p className="eyebrow">Financial position</p><h3>Balance Sheet</h3>{balanceSheet === null ? <p className="muted">Finalize an invoice to populate the report.</p> : <><p>Assets: <strong>{money(balanceSheet.totalAssetsPaise)}</strong></p><p>Liabilities: <strong>{money(balanceSheet.totalLiabilitiesPaise)}</strong></p><p>Equity: <strong>{money(balanceSheet.totalEquityPaise)}</strong></p></>}</article></section>
      <section className="card"><p className="eyebrow">Report detail</p><h3>General Ledger</h3>{generalLedger.length === 0 ? <p className="muted">No journal lines yet.</p> : <div className="ledger"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{generalLedger.map((row) => <tr key={`${row.journalEntryId}-${row.account}`}><td>{new Date(row.date).toLocaleDateString()}</td><td>{row.account}</td><td>{row.description}{row.isReversal ? " (Reversal)" : ""}</td><td>{money(row.debitPaise)}</td><td>{money(row.creditPaise)}</td></tr>)}</tbody></table></div>}</section>
      <section className="card"><p className="eyebrow">Receivables</p><h3>Outstanding invoices</h3>{receivables.length === 0 ? <p className="muted">No outstanding receivables.</p> : <table><thead><tr><th>Invoice</th><th>Invoice date</th><th>Outstanding</th><th>Age</th></tr></thead><tbody>{receivables.map((row) => <tr key={row.invoiceId}><td>{row.invoiceNumber}</td><td>{new Date(row.invoiceDate).toLocaleDateString()}</td><td>{money(row.outstandingPaise)}</td><td>{row.ageDays} days</td></tr>)}</tbody></table>}</section>
      <section className="card"><p className="eyebrow">Fair reporting</p><h3>Sales by fair</h3>{fairSales.length === 0 ? <p className="muted">No fairs have finalized sales yet.</p> : <table><thead><tr><th>Fair</th><th>Invoices</th><th>Sales</th></tr></thead><tbody>{fairSales.map((row) => <tr key={row.fairId}><td>{row.fairName}</td><td>{row.invoiceCount}</td><td>{money(row.totalPaise)}</td></tr>)}</tbody></table>}</section>
      <section className="card"><p className="eyebrow">Returns reporting</p><h3>Sales returns</h3>{creditNotes.filter((note) => note.status === "FINALIZED").length === 0 ? <p className="muted">No finalized credit notes yet.</p> : <><table><thead><tr><th>Credit note</th><th>Invoice</th><th>Reason</th><th>Total</th></tr></thead><tbody>{creditNotes.filter((note) => note.status === "FINALIZED").map((note) => <tr key={note.id}><td>{note.number}</td><td>{note.invoiceNumber}</td><td>{note.reason}</td><td>{money(note.totalPaise)}</td></tr>)}</tbody></table><p>Total returned: <strong>{money(creditNotes.filter((note) => note.status === "FINALIZED").reduce((total, note) => total + note.totalPaise, 0))}</strong></p></>}</section>
    </main>
  );
}
