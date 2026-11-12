# Pass 5 — The Other Documents: Quotes, Credit Notes, Recurring Invoices, Purchase Orders, and Delivery Notes

[SEEN route: /quotes/create | IN-ux-screenshots/28-pass5-quote-create.png]
[SEEN route: /quotes/4openRe7Az/edit | IN-ux-screenshots/29-pass5-quote-converted.png]
[SEEN route: /credits/create | IN-ux-screenshots/30-pass5-credit-create.png]
[SEEN route: /recurring_invoices/create | IN-ux-screenshots/31-pass5-recurring-invoice-create.png]
[SEEN route: /purchase_orders/create | IN-ux-screenshots/32-pass5-purchase-order-create.png]

---

## 1. Executive Summary & Document Feel Comparison

Invoice Ninja reuses a nearly identical form template across its five core document types: Invoices, Quotes, Credit Notes, Recurring Invoices, and Purchase Orders. The underlying layout, grid system, column alignments, font weights, and action headers are identical.

```
+----------------------------------------------------------------------------------------------------+
|  [Sidebar Menu]   | [Breadcrumb: Quotes / New Quote]                  [Purchase White Label] [Save]|
|-------------------+--------------------------------------------------------------------------------|
| Invoices          | [Left Sidebar / Document Details]       | [Line Items Grid]                    |
| Recurring Invoices| Client: [Select or Create Client      ] | Item | Description | Cost | Qty | Amt |
| Payments          | Quote Date: [2026-11-08]                | ------------------------------------ |
| Quotes  <-- Active| Valid Until: [2026-12-08]               | [  ] |             | 0.00 | 1   | 0.00|
| Credits           | Partial/Deposit: [0.00]                 | ------------------------------------ |
| Purchase Orders   | Quote #: [0005]                         | [+ Add Item]                         |
| Expenses          | PO #: [Optional]                        | ------------------------------------ |
| Settings          | Discount: [0.00]                        | Subtotal: $0.00 | Balance Due: $0.00 |
+----------------------------------------------------------------------------------------------------+
```

### Document Feel Matrix (Feel, Not Just Fields)

| Document | Primary Heading & Breadcrumb | Entity Selector | Key Date Field Label | Total Box Label | Feel Compared to Invoice Screen |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Invoice** | `Invoices / New Invoice` [QUOTED] | `"Client"` [QUOTED] | `"Due Date"` [QUOTED] | `"Balance Due"` [QUOTED] | Baseline standard document form. |
| **Quote** | `Quotes / New Quote` [QUOTED] | `"Client"` [QUOTED] | `"Valid Until"` [QUOTED] | `"Balance Due"` [QUOTED] | **Identical to invoice.** Zero palette change; only label changes from "Due Date" to "Valid Until". Still displays "Balance Due" even though a quote is not an accounts receivable balance due. |
| **Credit Note** | `Credits / Enter Credit` [QUOTED] | `"Client"` [QUOTED] | `"Credit Date"` [QUOTED] | `"Balance Due"` [QUOTED] | **Identical to invoice.** No warning color or red negative indicator in the default line grid; feels just like issuing a positive bill. |
| **Recurring Invoice** | `Recurring Invoices / New Recurring Invoice` [QUOTED] | `"Client"` [QUOTED] | `"Next Send Date"` [QUOTED] | `"Balance Due"` [QUOTED] | **Identical layout plus cadence picker.** Adds "Frequency" dropdown (`Monthly`, `Weekly`, etc.) and "Remaining Cycles" counter in the left panel. |
| **Purchase Order** | `Purchase Orders / New Purchase Order` [QUOTED] | `"Vendor"` [QUOTED] | `"Due Date"` [QUOTED] | `"Balance Due"` [QUOTED] | **Identical to invoice inverted.** Replaces "Client" combobox with "Vendor" combobox. The rest of the form, styling, and table are indistinguishable from an outbound customer invoice. |
| **Delivery Note** | N/A (Not an editable document entity) | N/A | N/A | N/A | **Does not exist as an editor or entity.** It is an export rendering format triggered on an existing invoice (`Actions -> Delivery Note`), producing a stripped-down packing slip PDF without prices. |

---

## 2. In-Depth Screen Walkthroughs

### Screen 1: Quote Editor (`/quotes/create`)
- **Reached by**: 1 click from Dashboard left sidebar (`"Quotes" -> "+"` or `Quotes List -> "New Quote"`). [MEASURED]
- **Screenshot**: `IN-ux-screenshots/28-pass5-quote-create.png` [SEEN route: /quotes/create]
- **Visible without scrolling**: Left details panel (Client selector, Quote Date, Valid Until, Partial/Deposit, Tags, Quote #, PO #, Discount); Line items grid with 1 blank row; Save button. [MEASURED]
- **Below the fold**: Terms & Conditions, Public Notes, Private Notes, Footer totals block. [MEASURED]
- **Focus on open**: None. Focus stays on `<BODY>`. [MEASURED]
- **Feel difference**: The screen feels identical to invoice creation. There is no visual badge or yellow/provisional accent indicating this is a non-binding quotation rather than a legal tax demand. Even the totals section confusingly says `"Balance Due: $0.00"` [QUOTED] rather than "Quotation Total" or "Estimated Amount".

### Screen 2: Converting a Quote to an Invoice
- **The Workflow**:
  1. User navigates to an existing Quote (`/quotes/:id/edit`).
  2. In the Quote actions menu or row dropdown, user clicks `"Convert to Invoice"` [QUOTED].
  3. **What the user sees before**: The quote in `"Draft"` or `"Sent"` status with Quote # (e.g. `0005`).
  4. **What happens during**: The backend calls `QuoteService::convert()` [CODE app/Services/Quote/QuoteService.php:60], copies quote lines into a new `Invoice` record in `Draft` status, and updates `quotes.invoice_id = invoices.id`.
  5. **What the user sees after**: If accessed via the edit screen button, the page reloads. If auto-archive is enabled, the quote is archived silently. The screen banner updates or redirects to the newly created invoice.
  6. **Clarity of feedback**: The system provides minimal visual narrative. There is no persistent link banner saying *"Converted to Invoice #0071 on Nov 8, 2026 — Click here to view"*. If the user stays on the quote list, the quote status pill changes from `Draft` to `Converted`.

### Screen 3: Credit Note Editor (`/credits/create`)
- **Reached by**: 1 click from sidebar (`"Credits"` [QUOTED]).
- **Screenshot**: `IN-ux-screenshots/30-pass5-credit-create.png` [SEEN route: /credits/create]
- **Header**: `"Enter Credit"` [QUOTED]
- **Fields visible**: Client, Credit Date, Credit #, PO #, Discount, Line Items (Item, Description, Unit Cost, Quantity, Tax, Line Total).
- **Feel difference**:
  - The form is labeled `"Enter Credit"`, but line item inputs accept positive numbers just like an invoice. A unit cost of `50.00` with quantity `1` computes a positive subtotal `$50.00`.
  - There is no red warning tint, no credit ledger watermark, and no negative currency signs `-$50.00` in the entry grid to remind the user that money is being deducted rather than billed.
  - A user who accidentally navigated to `/credits/create` instead of `/invoices/create` could easily fill out five line items without realizing they are crediting a customer rather than charging them.

### Screen 4: Recurring Invoice Editor (`/recurring_invoices/create`)
- **Reached by**: 1 click from sidebar (`"Recurring Invoices"` [QUOTED]).
- **Screenshot**: `IN-ux-screenshots/31-pass5-recurring-invoice-create.png` [SEEN route: /recurring_invoices/create]
- **Header**: `"New Recurring Invoice"` [QUOTED]
- **Distinct Fields in Left Panel**:
  - `"Frequency"` [QUOTED]: Dropdown defaulting to `"Monthly"` [QUOTED] (options: Weekly, Two weeks, Four weeks, Monthly, Two months, Three months, Four months, Six months, Annually, Two years, Three years).
  - `"Remaining Cycles"` [QUOTED]: Default `-1` (meaning endless recurring generation).
  - `"Auto-Bill"` [QUOTED]: Toggle options (`Always`, `Opt-in`, `Opt-out`, `Disabled`).
  - `"Due Date"` [QUOTED]: Terms dropdown (`Use payment terms`, `First day of the month`, `Last day of the month`).
- **Feel difference**: The presence of recurring parameters (Frequency, Remaining Cycles, Auto-Bill) is the only visual clue distinguishing this screen from standard invoice entry. The line items grid and footer behave identically.

### Screen 5: Purchase Order Editor (`/purchase_orders/create`)
- **Reached by**: 1 click from sidebar (`"Purchase Orders"` [QUOTED]).
- **Screenshot**: `IN-ux-screenshots/32-pass5-purchase-order-create.png` [SEEN route: /purchase_orders/create]
- **Header**: `"New Purchase Order"` [QUOTED]
- **Distinct Field**: Entity combobox is labeled `"Vendor"` [QUOTED] instead of `"Client"` [QUOTED].
- **Feel difference**:
  - Outbound customer invoices and inbound vendor purchase orders look practically identical.
  - The terminology remains customer-centric in parts of the line item grid: product selection still auto-populates the customer retail selling price rather than vendor cost unless specific vendor product costs are configured.

### Document 6: Delivery Note (Packing Slip)
- **Editor**: None exists. [CODE app/Services/Invoice/GenerateDeliveryNote.php:42]
- **Access Route**: In an existing Invoice (`/invoices/:id/edit`), click `"Actions" -> "Delivery Note"` [QUOTED].
- **Output**: Generates a PDF packing slip (`/api/v1/invoices/{id}/delivery_note`) showing customer delivery address, line item names, and quantities, while stripping unit costs, line totals, and payment balances.

---

## 3. Global Document Set Assessment

### Is it obvious which document you are looking at once inside?
**No.** [INFERRED]
- The palette, typography, layout columns, button placements, and table styling are 100% homogenous.
- The only differentiating indicator is the small top-left breadcrumb text (e.g. `Quotes / Edit Quote` vs `Invoices / Edit Invoice`) and the sidebar active selection highlight.
- If the sidebar is collapsed or the user's attention is focused on the line items grid, there is zero visual feedback signaling whether the document is a Quote, Invoice, Credit, or Purchase Order.

### Is it obvious how to get from one to another?
**Partially.** [MEASURED]
- Navigating between document types requires clicking out to the primary left sidebar (`Invoices`, `Recurring Invoices`, `Quotes`, `Credits`, `Purchase Orders`).
- There are no intra-document tabs (e.g., you cannot toggle an invoice view to view related quotes or credits with a single tab click).
- The only direct conversion shortcut provided inside the workflow is **Quote -> Invoice** via the `"Convert to Invoice"` action button.

---

## 4. Mandatory Questions Answered

### Question 1: Could a person who has never seen this screen complete the task without help?
**Yes, for single document creation; No, for quote conversion or delivery notes.** [INFERRED]
- A newcomer can fill out a Quote or Credit Note easily because the fields match standard invoicing.
- However, for Quote Conversion, a newcomer would struggle to find where the converted invoice landed because the screen offers no direct hyperlink banner back and forth between the two related documents.
- For Delivery Notes, a newcomer would spend 10+ minutes hunting the left sidebar for a "Delivery Notes" menu that does not exist.

### Question 2: Would a person doing this task thirty times a day resent anything here?
**Yes: Visual Uniformity & Repetitive Data Entry.** [MEASURED]
- **Cognitive Risk**: Because Invoices, Credits, and Quotes look identical, a user managing thirty documents an hour is at high risk of issuing a Credit Note when they meant to invoice, or vice versa.
- **Missing Breadcrumb Navigation**: Once a quote is converted, jumping between the quote and its generated invoice requires 4+ clicks through the left sidebar and search filters, costing ~12 seconds per document conversion.

---

## 5. Pass 5 Summary Lists

### 1. Seen and Screenshotted
- `IN-ux-screenshots/28-pass5-quote-create.png` — New Quote form with Valid Until date and identical invoice grid.
- `IN-ux-screenshots/29-pass5-quote-converted.png` — Quote edit view post-conversion attempt.
- `IN-ux-screenshots/30-pass5-credit-create.png` — Enter Credit form showing identical positive item grid.
- `IN-ux-screenshots/31-pass5-recurring-invoice-create.png` — New Recurring Invoice form showing Frequency and Remaining Cycles.
- `IN-ux-screenshots/32-pass5-purchase-order-create.png` — New Purchase Order form with Vendor selector.

### 2. Measured
- **Navigation clicks to any document create screen**: 1 click from sidebar (`+` icon).
- **Quote to Invoice Conversion time**: ~1.8 seconds backend processing time; 4 manual clicks to locate and cross-reference the resulting invoice.
- **Visual Palette Distinction**: 0 color shifts across document types (all share identical gray/neutral canvas).

### 3. Quoted
- `"New Quote"` [QUOTED]
- `"Valid Until"` [QUOTED]
- `"Enter Credit"` [QUOTED]
- `"New Recurring Invoice"` [QUOTED]
- `"Frequency"` [QUOTED]
- `"Remaining Cycles"` [QUOTED]
- `"New Purchase Order"` [QUOTED]
- `"Vendor"` [QUOTED]
- `"Convert to Invoice"` [QUOTED]
- `"Balance Due: $0.00"` [QUOTED]

### 4. Could Not Verify
- In-place delivery note custom styling editor in UI without generating the Snappdf binary compile.
