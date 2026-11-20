/**
 * Master-data import kinds (R10-C): customers, suppliers, items, and the three opening-balance
 * kinds. Each is an `ImportKindDefinition` for the engine in `import-engine.ts`; every record is
 * written through the repository's public methods, so each created record carries its own audit
 * event exactly as if it had been typed in by hand.
 *
 * Field labels are the EXPORT headers (`exports.ts`), so a file exported from Book Buddha maps
 * itself with no help.
 *
 * "Exists" rules (re-running a file is safe):
 *  - customers / suppliers: same `normaliseName(name)`, or the same non-blank GSTIN, in the company
 *    -> SKIPPED "already exists". The customer NUMBER is never copied - it is always allocated - but
 *    its category prefix is kept (SCH0001 -> next SCH number; blank -> no number; unknown -> GEN).
 *  - items: same `normaliseName(name)` -> updated with the FILLED cells only (blank leaves alone). A
 *    different Track stock value fails (it is not editable). Nothing to change -> SKIPPED.
 *  - opening-balances: a live (not reversed) set with the same As-at date -> SKIPPED.
 *  - opening-customer / supplier balances: the party already has a live opening balance -> SKIPPED.
 *
 * Opening stock (items): `Opening quantity` + `Opening unit cost` on a NEW stock-tracked item post
 * an OPENING stock movement (needs the business; none -> that unit fails). The pair must be given
 * together, and on a new item that is not stock-tracked they fail rather than being silently
 * dropped. On an EXISTING item the opening cells are ignored and the outcome message says so.
 *
 * Opening customer balances: the repository separates the amount owed from the part of it that is
 * INCOME (`incomePaise` + `incomeAccount`). The importer takes two optional columns, `Income amount`
 * (default 0) and `Income account` (code or name; required when income is above zero). With no
 * income the whole balance is a receivable carried forward, which is the usual case for a ledger
 * moved from another system.
 */
import { randomUUID } from "node:crypto";
import {
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_NUMBERING_CATEGORIES,
  type ChartAccount,
  type CustomerInput,
  type ItemPatch,
} from "../database/repository.js";
import type { SupplierInput } from "../database/purchasing-types.js";
import { normaliseName, parseDate, parseQuantity, parseRupeesToPaise, parseYesNo } from "./codec.js";
import {
  ImportRowError,
  type ImportContext,
  type ImportField,
  type ImportKindDefinition,
  type MappedRow,
  type UnitOutcome,
} from "./import-engine.js";

// ---------------------------------------------------------------- helpers
const field = (key: string, label: string, required: boolean, ...synonyms: string[]): ImportField => ({ key, label, required, synonyms });

const cell = (row: MappedRow, key: string): string => row.values[key] ?? "";

/** Runs a parser on one cell; a failure becomes a row error naming the row and the column. */
function parseField<T>(row: MappedRow, key: string, label: string, parse: (text: string) => T): T {
  try {
    return parse(cell(row, key));
  } catch (error) {
    throw new ImportRowError(`Row ${row.rowNumber}: ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const optionalPaise = (row: MappedRow, key: string, label: string): number | undefined =>
  cell(row, key) === "" ? undefined : parseField(row, key, label, (t) => parseRupeesToPaise(t));

const optionalText = (row: MappedRow, key: string): string | undefined => (cell(row, key) === "" ? undefined : cell(row, key));

function canonicalClassification(value: string): string {
  const match = CUSTOMER_CLASSIFICATIONS.find((c) => c.toLowerCase() === value.trim().toLowerCase());
  return match ?? value; // an unknown value is left for the repository to refuse in its own words
}

// ---------------------------------------------------------------- party index (speed)
/**
 * Customers and suppliers are looked up once per ROW, and listing them is a full read, so a file of
 * thousands of rows would be quadratic. The index is built once per run (the engine hands every
 * unit the same context object, so the context is the cache key) and a new party is added to it
 * only when its unit is about to succeed - `post` adds it as its last step, after which nothing can
 * throw - so a rolled-back unit never leaves a phantom behind.
 */
interface PartyEntry { readonly id: string; readonly name: string; readonly gstin: string | null }
interface PartyIndex {
  readonly byName: Map<string, PartyEntry[]>;
  readonly gstins: Set<string>;
}
const partyIndexes = new WeakMap<ImportContext, Partial<Record<"customers" | "suppliers", PartyIndex>>>();

function partyIndex(context: ImportContext, which: "customers" | "suppliers"): PartyIndex {
  let perContext = partyIndexes.get(context);
  if (perContext === undefined) {
    perContext = {};
    partyIndexes.set(context, perContext);
  }
  let index = perContext[which];
  if (index === undefined) {
    index = { byName: new Map(), gstins: new Set() };
    const records = which === "customers" ? context.repository.listCustomers(context.companyId) : context.repository.listSuppliers(context.companyId);
    for (const r of records) addParty(index, { id: r.id, name: r.name, gstin: r.gstin });
    perContext[which] = index;
  }
  return index;
}
function addParty(index: PartyIndex, entry: PartyEntry): void {
  const key = normaliseName(entry.name);
  index.byName.set(key, [...(index.byName.get(key) ?? []), entry]);
  if (entry.gstin !== null && entry.gstin.trim() !== "") index.gstins.add(entry.gstin.trim().toUpperCase());
}
const partyExists = (index: PartyIndex, name: string, gstin: string): boolean =>
  index.byName.has(normaliseName(name)) || (gstin !== "" && index.gstins.has(gstin.trim().toUpperCase()));

function businessOf(context: ImportContext): string {
  if (context.businessId === undefined) throw new ImportRowError("This import needs a business.");
  return context.businessId;
}

/** Account by code (exact, any case) or by name; refuses none and refuses more than one. */
function resolveAccount(context: ImportContext, row: MappedRow, text: string): ChartAccount {
  const accounts = context.repository.listAccounts({ companyId: context.companyId });
  const wanted = text.trim();
  const byCode = accounts.filter((a) => a.code.toLowerCase() === wanted.toLowerCase());
  const matches = byCode.length > 0 ? byCode : accounts.filter((a) => normaliseName(a.name) === normaliseName(wanted));
  if (matches.length === 0) throw new ImportRowError(`Row ${row.rowNumber}: there is no account "${wanted}" in the chart of accounts.`);
  if (matches.length > 1) throw new ImportRowError(`Row ${row.rowNumber}: "${wanted}" matches more than one account; use the account code.`);
  return matches[0] as ChartAccount;
}

// ---------------------------------------------------------------- customers / suppliers
const PARTY_FIELDS: readonly ImportField[] = [
  field("name", "Name", true, "customer", "customer name", "supplier", "supplier name", "party"),
  field("email", "Email", false, "e-mail", "email address"),
  field("phone", "Phone", false, "mobile", "phone 1", "telephone", "contact number"),
  field("phone2", "Phone 2", false, "alternate phone", "mobile 2", "phone2"),
  field("classification", "Classification", false, "type", "category"),
  field("gstin", "GSTIN", false, "gst number", "gst no", "gst"),
  field("website", "Website", false, "web", "url"),
  field("billingAddress", "Billing address", false, "address", "billing"),
  field("shippingAddress", "Shipping address", false, "delivery address", "shipping"),
  field("notes", "Notes", false, "internal notes", "remarks"),
];
const ACTIVE_FIELD = field("active", "Active", false, "is active", "status");

function partyOptions(row: MappedRow): {
  email?: string; phone?: string; phone2?: string; classification?: string; gstin?: string; website?: string;
  billingAddress?: string; shippingAddress?: string; internalNotes?: string;
} {
  const out: ReturnType<typeof partyOptions> = {};
  const set = <K extends keyof ReturnType<typeof partyOptions>>(k: K, v: string | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  set("email", optionalText(row, "email"));
  set("phone", optionalText(row, "phone"));
  set("phone2", optionalText(row, "phone2"));
  const classification = optionalText(row, "classification");
  set("classification", classification === undefined ? undefined : canonicalClassification(classification));
  set("gstin", optionalText(row, "gstin"));
  set("website", optionalText(row, "website"));
  set("billingAddress", optionalText(row, "billingAddress"));
  set("shippingAddress", optionalText(row, "shippingAddress"));
  set("internalNotes", optionalText(row, "notes"));
  return out;
}

const customersKind: ImportKindDefinition = {
  kind: "customers",
  scope: "COMPANY",
  fields: [...PARTY_FIELDS, field("customerNumber", "Customer number", false, "customer no", "customer code"), ACTIVE_FIELD],
  post(context, rows): UnitOutcome {
    const row = rows[0] as MappedRow;
    const name = cell(row, "name");
    const gstin = cell(row, "gstin");
    const index = partyIndex(context, "customers");
    if (partyExists(index, name, gstin)) return { status: "SKIPPED", reference: name, message: "already exists" };
    const active = cell(row, "active") === "" ? true : parseField(row, "active", "Active", parseYesNo);
    // The number itself is never copied (it is always allocated), but its CATEGORY is kept: an
    // exported SCH0001 comes back in SCH, and a customer exported with no number gets none. An
    // unrecognised prefix falls back to GEN.
    const fileNumber = cell(row, "customerNumber").toUpperCase();
    const prefix = fileNumber.slice(0, 3);
    const numberingCategory = fileNumber === ""
      ? undefined
      : (CUSTOMER_NUMBERING_CATEGORIES as readonly string[]).includes(prefix) ? prefix : "GEN";
    const input: CustomerInput = {
      companyId: context.companyId,
      name,
      ...(numberingCategory === undefined ? {} : { numberingCategory }),
      ...partyOptions(row),
    };
    const id = context.repository.createCustomer(input);
    if (!active) context.repository.setCustomerActive(id, false);
    addParty(index, { id, name, gstin: gstin === "" ? null : gstin });
    return { status: "CREATED", reference: name };
  },
};

const suppliersKind: ImportKindDefinition = {
  kind: "suppliers",
  scope: "COMPANY",
  fields: [...PARTY_FIELDS, ACTIVE_FIELD],
  post(context, rows): UnitOutcome {
    const row = rows[0] as MappedRow;
    const name = cell(row, "name");
    const gstin = cell(row, "gstin");
    const index = partyIndex(context, "suppliers");
    if (partyExists(index, name, gstin)) return { status: "SKIPPED", reference: name, message: "already exists" };
    const active = cell(row, "active") === "" ? true : parseField(row, "active", "Active", parseYesNo);
    const input: SupplierInput = { companyId: context.companyId, name, ...partyOptions(row) };
    const id = context.repository.createSupplier(input);
    if (!active) context.repository.setSupplierActive(id, false);
    addParty(index, { id, name, gstin: gstin === "" ? null : gstin });
    return { status: "CREATED", reference: name };
  },
};

// ---------------------------------------------------------------- items
const parseReorder = (text: string): number => {
  if (!/^\d+$/.test(text.trim())) throw new Error(`"${text.trim()}" is not a valid reorder level; use a whole number such as 10.`);
  return Number(text.trim());
};

const itemsKind: ImportKindDefinition = {
  kind: "items",
  scope: "COMPANY",
  fields: [
    field("name", "Name", true, "item", "item name", "product", "product name", "title"),
    field("unit", "Unit", false, "uom", "unit of measure"),
    field("trackStock", "Track stock", false, "stock tracked", "track inventory", "track"),
    field("description", "Description", false, "details"),
    field("sellingPrice", "Selling price", false, "price", "sale price", "rate"),
    field("costPrice", "Cost price", false, "cost", "purchase price"),
    field("mrp", "MRP", false, "maximum retail price"),
    field("reorderLevel", "Reorder level", false, "reorder threshold", "reorder point", "minimum stock"),
    ACTIVE_FIELD,
    field("openingQuantity", "Opening quantity", false, "opening qty", "opening stock"),
    field("openingUnitCost", "Opening unit cost", false, "opening cost", "opening rate"),
  ],
  post(context, rows): UnitOutcome {
    const row = rows[0] as MappedRow;
    const repo = context.repository;
    const name = cell(row, "name");
    const sellingPricePaise = optionalPaise(row, "sellingPrice", "Selling price");
    const costPricePaise = optionalPaise(row, "costPrice", "Cost price");
    const mrpPaise = optionalPaise(row, "mrp", "MRP");
    const reorderThreshold = cell(row, "reorderLevel") === "" ? undefined : parseField(row, "reorderLevel", "Reorder level", parseReorder);
    const trackStock = cell(row, "trackStock") === "" ? undefined : parseField(row, "trackStock", "Track stock", parseYesNo);
    const active = cell(row, "active") === "" ? undefined : parseField(row, "active", "Active", parseYesNo);
    const description = optionalText(row, "description");
    const unit = optionalText(row, "unit");
    const hasOpening = cell(row, "openingQuantity") !== "" || cell(row, "openingUnitCost") !== "";

    const existing = repo.listItems(context.companyId).find((i) => normaliseName(i.name) === normaliseName(name));

    if (existing !== undefined) {
      if (trackStock !== undefined && trackStock !== existing.trackStock) {
        throw new ImportRowError(
          `Row ${row.rowNumber}: "${name}" already exists with Track stock = ${existing.trackStock ? "yes" : "no"}; that cannot be changed by import.`,
        );
      }
      const patch: { -readonly [K in keyof ItemPatch]: ItemPatch[K] } = {};
      if (unit !== undefined && unit !== existing.unit) patch.unit = unit;
      if (description !== undefined && description !== existing.description) patch.description = description;
      if (sellingPricePaise !== undefined && sellingPricePaise !== existing.sellingPricePaise) patch.sellingPricePaise = sellingPricePaise;
      if (costPricePaise !== undefined && costPricePaise !== existing.costPricePaise) patch.costPricePaise = costPricePaise;
      if (mrpPaise !== undefined && mrpPaise !== existing.mrpPaise) patch.mrpPaise = mrpPaise;
      if (reorderThreshold !== undefined && reorderThreshold !== existing.reorderThreshold) patch.reorderThreshold = reorderThreshold;
      const activeChanged = active !== undefined && active !== existing.active;
      const notes = hasOpening ? "opening quantity and cost ignored: the item already exists" : undefined;
      if (Object.keys(patch).length === 0 && !activeChanged) {
        return { status: "SKIPPED", reference: name, message: notes === undefined ? "no changes" : `no changes; ${notes}` };
      }
      if (Object.keys(patch).length > 0) repo.updateItem(existing.id, patch);
      if (activeChanged) repo.setItemActive(existing.id, active);
      return { status: "UPDATED", reference: name, ...(notes === undefined ? {} : { message: notes }) };
    }

    // A new item.
    if (unit === undefined) throw new ImportRowError(`Row ${row.rowNumber}: "Unit" is required for a new item.`);
    let opening: { quantity: number; unitCostPaise: number } | undefined;
    if (hasOpening) {
      if (trackStock !== true) {
        throw new ImportRowError(`Row ${row.rowNumber}: opening quantity and cost need "Track stock" = yes.`);
      }
      if (cell(row, "openingQuantity") === "" || cell(row, "openingUnitCost") === "") {
        throw new ImportRowError(`Row ${row.rowNumber}: "Opening quantity" and "Opening unit cost" must be given together.`);
      }
      opening = {
        quantity: parseField(row, "openingQuantity", "Opening quantity", parseQuantity),
        unitCostPaise: parseField(row, "openingUnitCost", "Opening unit cost", (t) => parseRupeesToPaise(t)),
      };
      businessOf(context); // refuse before creating anything
    }
    const id = repo.createItem({
      companyId: context.companyId,
      name,
      unit,
      trackStock: trackStock === true,
      ...(description === undefined ? {} : { description }),
      ...(sellingPricePaise === undefined ? {} : { sellingPricePaise }),
      ...(costPricePaise === undefined ? {} : { costPricePaise }),
      ...(mrpPaise === undefined ? {} : { mrpPaise }),
      ...(reorderThreshold === undefined ? {} : { reorderThreshold }),
    });
    if (active === false) repo.setItemActive(id, false);
    if (opening !== undefined) {
      repo.addStockMovement({
        itemId: id,
        movementType: "OPENING",
        quantity: opening.quantity,
        unitCostPaise: opening.unitCostPaise,
        businessId: businessOf(context),
      });
    }
    return { status: "CREATED", reference: name };
  },
};

// ---------------------------------------------------------------- opening balances (BUSINESS)
const openingBalancesKind: ImportKindDefinition = {
  kind: "opening-balances",
  scope: "BUSINESS",
  groupBy: "asAt",
  fields: [
    field("asAt", "As at", true, "date", "opening date", "as on"),
    field("account", "Account", true, "account code", "ledger", "account name"),
    field("debit", "Debit", false, "dr", "debit amount"),
    field("credit", "Credit", false, "cr", "credit amount"),
  ],
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const first = rows[0] as MappedRow;
    const asAt = parseField(first, "asAt", "As at", (t) => parseDate(t, context.dateFormat));
    for (const row of rows) {
      const other = parseField(row, "asAt", "As at", (t) => parseDate(t, context.dateFormat));
      if (other !== asAt) throw new ImportRowError(`Row ${row.rowNumber}: "As at" is ${other}, but the set starts at ${asAt}.`);
    }
    if (context.repository.getOpeningBalances(businessId).some((s) => s.asAt === asAt && s.reversedAt === null)) {
      return { status: "SKIPPED", reference: asAt, message: `an opening balance set as at ${asAt} already exists` };
    }
    const lines = rows.map((row) => ({
      account: resolveAccount(context, row, cell(row, "account")).code,
      debitPaise: cell(row, "debit") === "" ? 0 : parseField(row, "debit", "Debit", (t) => parseRupeesToPaise(t)),
      creditPaise: cell(row, "credit") === "" ? 0 : parseField(row, "credit", "Credit", (t) => parseRupeesToPaise(t)),
    }));
    context.repository.saveOpeningBalances({ id: randomUUID(), businessId, asAt, lines });
    return { status: "CREATED", reference: asAt, message: `${lines.length} line${lines.length === 1 ? "" : "s"}` };
  },
};

const openingCustomerBalancesKind: ImportKindDefinition = {
  kind: "opening-customer-balances",
  scope: "BUSINESS",
  fields: [
    field("party", "Customer", true, "customer name", "name", "party"),
    field("asAt", "As at", true, "date", "opening date", "as on"),
    field("amount", "Amount", true, "balance", "outstanding", "amount owed"),
    field("income", "Income amount", false, "income"),
    field("incomeAccount", "Income account", false, "income ledger"),
  ],
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const row = rows[0] as MappedRow;
    const name = cell(row, "party");
    const matches = partyIndex(context, "customers").byName.get(normaliseName(name)) ?? [];
    if (matches.length === 0) throw new ImportRowError(`Row ${row.rowNumber}: there is no customer named "${name}".`);
    if (matches.length > 1) throw new ImportRowError(`Row ${row.rowNumber}: more than one customer is named "${name}".`);
    const customer = matches[0] as (typeof matches)[number];
    const asAt = parseField(row, "asAt", "As at", (t) => parseDate(t, context.dateFormat));
    const amountPaise = parseField(row, "amount", "Amount", (t) => parseRupeesToPaise(t));
    const incomePaise = cell(row, "income") === "" ? 0 : parseField(row, "income", "Income amount", (t) => parseRupeesToPaise(t));
    if (context.repository.listOpeningCustomerBalances(businessId).some((b) => b.customerId === customer.id && b.reversedAt === null)) {
      return { status: "SKIPPED", reference: name, message: "already has an opening balance" };
    }
    const incomeAccount = cell(row, "incomeAccount") === "" ? undefined : resolveAccount(context, row, cell(row, "incomeAccount")).code;
    context.repository.saveOpeningCustomerBalance({
      id: randomUUID(),
      businessId,
      customerId: customer.id,
      asAt,
      amountPaise,
      incomePaise,
      ...(incomeAccount === undefined ? {} : { incomeAccount }),
    });
    return { status: "CREATED", reference: name };
  },
};

const openingSupplierBalancesKind: ImportKindDefinition = {
  kind: "opening-supplier-balances",
  scope: "BUSINESS",
  fields: [
    field("party", "Supplier", true, "supplier name", "name", "party"),
    field("asAt", "As at", true, "date", "opening date", "as on"),
    field("amount", "Amount", true, "balance", "outstanding", "amount owed"),
  ],
  post(context, rows): UnitOutcome {
    const businessId = businessOf(context);
    const row = rows[0] as MappedRow;
    const name = cell(row, "party");
    const matches = partyIndex(context, "suppliers").byName.get(normaliseName(name)) ?? [];
    if (matches.length === 0) throw new ImportRowError(`Row ${row.rowNumber}: there is no supplier named "${name}".`);
    if (matches.length > 1) throw new ImportRowError(`Row ${row.rowNumber}: more than one supplier is named "${name}".`);
    const supplier = matches[0] as (typeof matches)[number];
    const asAt = parseField(row, "asAt", "As at", (t) => parseDate(t, context.dateFormat));
    const amountPaise = parseField(row, "amount", "Amount", (t) => parseRupeesToPaise(t));
    if (context.repository.listOpeningSupplierBalances(businessId).some((b) => b.supplierId === supplier.id && b.reversedAt === null)) {
      return { status: "SKIPPED", reference: name, message: "already has an opening balance" };
    }
    context.repository.saveOpeningSupplierBalance({ id: randomUUID(), businessId, supplierId: supplier.id, asAt, amountPaise });
    return { status: "CREATED", reference: name };
  },
};

export const MASTER_IMPORT_KINDS: readonly ImportKindDefinition[] = [
  customersKind,
  suppliersKind,
  itemsKind,
  openingBalancesKind,
  openingCustomerBalancesKind,
  openingSupplierBalancesKind,
];
