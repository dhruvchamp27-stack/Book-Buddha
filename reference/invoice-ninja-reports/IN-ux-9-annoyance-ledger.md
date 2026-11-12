# Pass 9 — The Annoyance Ledger and The Good-Ideas List

---

## 1. The Annoyance Ledger (Ranked Worst First)

Every single friction point, hazard, and time-wasting pattern identified across 9 UX audit passes in Invoice Ninja, ranked by daily cumulative cost.

| Rank | Annoyance | Location | Cost per Occurrence | Daily Frequency (30 inv/day) | Daily Cost |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Silent Draft Loss on Navigation**<br>Clicking any sidebar link (Clients, Payments, etc.) while filling an invoice immediately navigates away without an "Unsaved Changes" warning. All typed content is permanently lost. | Left Sidebar / Global Navigation | **100% data loss** (~120s to retype 5 lines) | 2–3 times / day | **~5 minutes + extreme frustration** |
| **2** | **Zero Autofocus on Invoice Create**<br>Opening `/invoices/create` leaves focus on `<BODY>`. Pressing Tab cycles through 35+ left sidebar menu links before reaching the form. | `/invoices/create` | **Forces mouse reach** (or 35 Tab keypresses) | 30 times / day | **30 mouse reaches / day** |
| **3** | **Reports Have Zero On-Screen Tables**<br>`/reports` renders no interactive HTML grid or charts. To see any figures, the user must click Export, download a CSV, and open Microsoft Excel. | `/reports` | **1 download + app switch + ~35s formatting** | 5–10 times / day | **~4 minutes / day** |
| **4** | **No Inline Undo on Row Delete**<br>Deleting an invoice from the row actions menu executes immediately with zero confirmation prompt and no inline Undo link. Rescuing it requires 4 clicks through lifecycle filters. | Invoices List Table | **4 clicks + 15.2s rescue workflow** | 2–4 times / day | **~1 minute / day** |
| **5** | **Silent Incomplete Row Drop**<br>Leaving an item description filled but price blank and clicking Save silently drops the row without any warning or validation prompt. | Line Items Grid | **Silent data loss** (~20s re-entry) | 3–5 times / day | **~1.5 minutes / day** |
| **6** | **Zero Visual Differentiation Across Documents**<br>Invoices, Quotes, Credits, Recurring Invoices, and Purchase Orders share identical gray layout, typography, and buttons. | All Document Editors | **High cognitive load / error risk** | Constant | **Daily mis-entry hazard** |
| **7** | **"Balance Due" Rendered on Quotes and Credits**<br>The summary totals box on Quotes and Credit Notes still reads `"Balance Due: $0.00"`, confusing users as to whether a quote or credit is an accounts receivable bill. | Quotes & Credits Footer | **Mental double-take** (~2s) | 15 times / day | **~30s / day** |
| **8** | **Tabbing from Last Line Lands on "+ Add Item" Button**<br>Tabbing out of a line item lands on the "+ Add Item" button, requiring Enter or click rather than auto-spawning a new blank line. | Line Items Grid | **1 extra keypress per row** | 100+ times / day | **100 extra keypresses / day** |
| **9** | **Tax Settings Page Load Freeze (~6.5s)**<br>Navigating to `Settings -> Tax Settings` blocks the UI for ~6.47s while querying all tax rates and rules synchronously. | `/settings/tax_settings` | **~6.5s wait per visit** | 2–3 times / day | **~20s / day** |
| **10** | **Two-Step Login Flow**<br>Login screen requires typing email, clicking Continue, waiting for password field to mount, typing password, and clicking Login. | `/login` | **2 clicks + 2 waits (~4s)** | 2–4 times / day | **~15s / day** |
| **11** | **Mobile Soft Keyboard Occludes Save & Totals**<br>On mobile viewport (390px), typing into line items pushes the sticky top Save button and bottom live totals completely out of sight. | Mobile `/invoices/create` | **Blind typing + 10 scroll swipes** | Every mobile invoice | **Severe mobile friction** |
| **12** | **Duplicate Client Names Allowed Silently**<br>Typing an existing client name in client create saves without any duplicate warning, leading to split customer histories. | `/clients/create` | **Database pollution + manual merge later** | 1–2 times / day | **5 minutes cleanup** |
| **13** | **Invoice Lock Setting Buried in "Workflow Settings"**<br>Users looking to prevent editing of sent invoices search under "Invoices" or "Invoice Design" but find it hidden under "Workflow Settings". | `/settings/workflow_settings` | **~10s hunting** | Setup / periodic | **Periodic friction** |
| **14** | **Numbering Formats Hidden under "Generated Numbers"**<br>Document prefixes and counter patterns are siloed in an abstract tab rather than document settings. | `/settings/generated_numbers` | **~8s hunting** | Periodic | **Periodic friction** |
| **15** | **No Intra-Document Link Post Quote Conversion**<br>Converting a quote to an invoice gives no persistent banner linking the quote to the newly generated invoice ID. | Quotes / Invoices | **4 clicks to cross-reference invoice** | 10 times / day | **~2 minutes / day** |
| **16** | **Tiny 18px Multi-Select Checkboxes**<br>Selecting invoices for bulk action requires clicking a miniature checkbox. Misclicking opens the invoice instead. | Table Views | **Misclick recovery (1 back click + 2s)** | 10 times / day | **~30s / day** |
| **17** | **Persistent "Purchase White Label" Promo Banner**<br>Pinned inside the top-right header on every single view, eating up prime horizontal real estate. | Global Top Bar | **Visual noise / misclick hazard** | Constant | **Persistent annoyance** |
| **18** | **Full Page Entity Re-Fetch on Save**<br>Clicking Save does not execute an optimistic or fast in-place update; it reloads the entire entity bundle, causing a ~1.2s screen flicker. | Entity Forms | **~1.2s freeze per save** | 30 times / day | **~36s / day** |
| **19** | **Mobile Touch Targets Violate Apple HIG**<br>Delete trash can and line item buttons measure ~32px, causing frequent mis-taps on phones. | Mobile Forms | **Accidental row deletions / re-taps** | Every mobile invoice | **Mobile fatigue** |
| **20** | **Global Search Has No Quick Keyboard Shortcut**<br>Pressing `/` or `Ctrl+K` does not focus the top search bar; requires a manual mouse reach to click into the input. | Global Header | **1 mouse reach per search** | 20 times / day | **20 mouse reaches / day** |

---

## 2. The Good-Ideas List (Small UX Kindnesses & Clever Defaults)

1. **Full-Text Indexing of Line Item Descriptions in Invoice Search**:
   - Searching a term like `"Periodical"` in the invoices list table instantly surfaces invoices where that text only exists in an item's description notes, without requiring advanced SQL filtering.
2. **Inline Client & Product Creation from Invoice Editor**:
   - Clicking `"+ New Client"` or typing an uncatalogued product directly inside the invoice grid creates the entity seamlessly without navigating away or losing draft state.
3. **Automatic Routing of Overpayments to Client Payment Balance**:
   - Entering an overpayment on an invoice automatically detects the excess and deposits it as an `"Unapplied Payment"` into the client's credit standing for automatic application against future bills.
4. **Multi-Invoice One-Shot Allocation Grid**:
   - Recording a lump-sum payment automatically displays all open invoices for that client with quick `"Pay"` buttons to distribute funds across multiple invoices in a single transaction.
5. **Keystroke-Level Numeric Input Masking**:
   - Price and quantity inputs intercept and reject alphabetic characters at the keystroke level, completely preventing invalid format errors before form submission.
6. **Flat 25-Tab Settings Sidebar**:
   - All settings categories are organized in a flat, single-level navigation bar without nested cascading menus or hidden accordions.
7. **One-Click Payment Entry from Invoice Header**:
   - The invoice edit view features a dedicated `"Enter Payment"` action that opens the payment form pre-filled with the exact client, invoice number, and outstanding balance in 1 click (0.42s).
8. **Smart Relative Date Defaults**:
   - Document Date defaults to today's date (`Current Date`), and Due Date automatically computes based on client payment terms (`Net 30`).

---

## 3. Pass 9 Summary Lists

### 1. Seen and Screenshotted
- All 39 screenshots across Passes 0 through 8 verified and archived in `invoice-ninja-reports/IN-ux-screenshots/`.

### 2. Measured
- **Annoyance Ledger items cataloged**: 20 ranked entries.
- **Good-Ideas items cataloged**: 8 verified design kindnesses.
- **Estimated cumulative daily user tax**: ~18.5 minutes wasted per day across 30 invoices.

### 3. Quoted
- `"Purchase White Label"` [QUOTED]
- `"Balance Due: $0.00"` [QUOTED]
- `"Workflow Settings"` [QUOTED]
- `"Generated Numbers"` [QUOTED]
- `"Successfully deleted invoice"` [QUOTED]
- `"Open sidebar"` [QUOTED]

### 4. Could Not Verify
- Long-term multi-user concurrent edit locking collision (requires multiple browser user sessions running simultaneously).
