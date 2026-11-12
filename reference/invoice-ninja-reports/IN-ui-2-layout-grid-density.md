# Pass 2 — Layout, Navigation and Density

[SEEN route: /invoices | IN-ui-screenshots/03-pass2-shell-desktop.png]
[SEEN route: /invoices | IN-ui-screenshots/04-pass2-breakpoint-tablet.png]
[SEEN route: /invoices | IN-ui-screenshots/05-pass2-breakpoint-mobile.png]

---

## 1. The Page Shell Architecture

Invoice Ninja employs a persistent split-shell administrative layout consisting of a fixed-width left navigation sidebar and a full-bleed, fluid-width content canvas.

```
+----------------------------------------------------------------------------------------------------+
| [Company Switcher v] | [Global Search: Find invoices, clients...]         [White Label] [Save / New]|
|----------------------+-----------------------------------------------------------------------------|
| Sidebar (216px)      | Main Content Canvas (Fluid width, maxWidth: none)                           |
| Dashboard            |-----------------------------------------------------------------------------|
| Clients              | Breadcrumbs: / Invoices                                                     |
| Invoices <-- Active  | Filters: [Lifecycle: Active v] [Status: All v]                              |
| Payments             | +-------------------------------------------------------------------------+ |
| Quotes               | | Table: Status | Number | Client | Amount | Balance | Date | Due Date    | |
| Credits              | | (Row Height: 54px, Cell Padding: 8px 16px)                               | |
| Settings             | +-------------------------------------------------------------------------+ |
+----------------------------------------------------------------------------------------------------+
```

### 1. Primary Structural Dimensions

| Element | Desktop Computed Dimension | CSS Class / Rule | Behavior on Viewport Resize |
| :--- | :--- | :--- | :--- |
| **Sidebar Width** | `216px` [INSPECT] | `w-[216px]` or `w-54` [CSS] | Fixed width on desktop; collapses to off-canvas slideover below `768px`. |
| **Sidebar Position** | `static` / `sticky` flex child [INSPECT] | `flex-shrink-0` [CSS] | Remains pinned alongside view height. |
| **Header Bar Height** | `64px` (`4rem`) [INSPECT] | `h-16 border-b` [CSS] | Pinned to top of viewport with company dropdown and global search. |
| **Main Content Width** | Fluid (`1094.67px` on 1366px screen) [INSPECT] | `flex-1 min-w-0` [CSS] | Expands to fill 100% of remaining horizontal window width. |
| **Maximum Content Width** | `none` (No container clamping) [INSPECT] | `max-w-none` [CSS] | High-density tables utilize the entire available monitor span. |
| **Global Page Padding** | `0px` outer shell, `16px`–`24px` internal [INSPECT] | `px-4 sm:px-6 lg:px-8` [CSS] | Responsive horizontal gutters adjust at Tailwind breakpoints. |

---

## 2. Responsive Breakpoints

Invoice Ninja inherits standard Tailwind CSS v3 media query breakpoints:

| Breakpoint Name | Min-Width Value | Layout & Structural Changes Observed |
| :--- | :--- | :--- |
| **`sm`** | `640px` | Horizontal gutters widen from `16px` (`px-4`) to `24px` (`px-6`). Table search bar expands. |
| **`md`** | `768px` | **Primary Sidebar Switch**: At `< 768px`, the left navigation bar is removed from the DOM flow and replaced by an `"Open sidebar"` hamburger button. |
| **`lg`** | `1024px` | **Form Column Split**: Document creation forms (`/invoices/create`) switch from a stacked single-column flow into a two-column desktop grid (Left Metadata Panel: ~33% width / Right Line Items: ~67% width). |
| **`xl`** | `1280px` | Data tables reveal secondary columns (e.g. Exchange Rate, Private Notes, PO #) without column truncation. |
| **`2xl`** | `1536px` | Full high-resolution widescreen layout; line item grid description fields expand up to `500px` without text wrapping. |

---

## 3. The Navigation Tree (Exact Screen Hierarchy)

The primary sidebar displays **17 top-level navigation categories** in strict vertical order. There are no secondary cascading hover menus or hidden "More..." accordions in the primary sidebar:

1. `Dashboard` (`/dashboard`) [QUOTED]
2. `Clients` (`/clients`) [QUOTED]
3. `Products` (`/products`) [QUOTED]
4. `Invoices` (`/invoices`) [QUOTED]
5. `Recurring Invoices` (`/recurring_invoices`) [QUOTED]
6. `Payments` (`/payments`) [QUOTED]
7. `Quotes` (`/quotes`) [QUOTED]
8. `Credits` (`/credits`) [QUOTED]
9. `Projects` (`/projects`) [QUOTED]
10. `Tasks` (`/tasks`) [QUOTED]
11. `Vendors` (`/vendors`) [QUOTED]
12. `Purchase Orders` (`/purchase_orders`) [QUOTED]
13. `Expenses` (`/expenses`) [QUOTED]
14. `Recurring Expenses` (`/recurring_expenses`) [QUOTED]
15. `Transactions` (`/transactions`) [QUOTED]
16. `Reports` (`/reports`) [QUOTED]
17. `Settings` (`/settings`) [QUOTED]

*Completeness check: 17 primary navigation links, enumerated by AST DOM query of `aside nav a`.*

---

## 4. Density & Micro-Spacing Measurements

Exact pixel measurements captured via Chrome DOM inspector on `/invoices` and `/invoices/create`:

### 1. Data Table Density (Invoices List)
- **Table Row Height (`<tr>`)**: `54.0px` [INSPECT]
- **Table Header Height (`<th>`)**: `42.7px` [INSPECT]
- **Cell Internal Padding (`<td>`)**: `8px 16px` (`padding-top: 8px; padding-bottom: 8px; padding-left: 16px; padding-right: 16px`) [INSPECT]
- **Header Internal Padding (`<th>`)**: `10px 16px` (`padding-top: 10px; padding-bottom: 10px; padding-left: 16px; padding-right: 16px`) [INSPECT]
- **Row Divider Border**: `border-bottom: 1px solid #E5E7EB` (Light mode) [INSPECT]
- **Density Rating**: **Medium-High**. The 54px row height balances touch hit targets with desktop scanning density, fitting ~11 table rows above the fold on a 768px height screen.

### 2. Form Density (Invoice Editor)
- **Standard Input Height**: `37.33px` (`border-box`) [INSPECT]
- **Input Padding**: `8px 12px` (`py-2 px-3`) [INSPECT]
- **Standard Button Height**: `38.4px` (`border-box`) [INSPECT]
- **Button Padding**: `8px 16px` (`py-2 px-4`) [INSPECT]
- **Vertical Gap Between Form Fields**: `16px` (`space-y-4` / `mb-4`) [INSPECT]
- **Label to Input Gap**: `4px` (`mb-1`) [INSPECT]

---

## 5. How Long Forms Are Divided

Document creation screens (`/invoices/create`, `/quotes/create`) structure long data entry forms using a **Split Grid + Collapsible Sub-Tabs Architecture**:

1. **Top Primary Division (Two-Column Asymmetric Grid)**:
   - **Left Column (~320px width on desktop)**: Document properties card containing Client Selector, Invoice Date, Due Date, Partial/Deposit, Invoice #, PO #, Discount.
   - **Right Column (Remaining ~770px width)**: Line items grid table (Item, Description, Unit Cost, Quantity, Tax, Line Total), "+ Add Item" button, and running Subtotal/Balance Due footer.
2. **Bottom Secondary Division (Horizontal Sub-Tabs)**:
   - Positioned below the line items grid, divided into horizontal pill tabs:
     - `Terms` (Textarea for legal/payment conditions) [QUOTED]
     - `Public Notes` (Textarea visible to client on PDF) [QUOTED]
     - `Private Notes` (Textarea visible only to administrative users) [QUOTED]
     - `Settings` (Per-invoice overrides for payment terms and auto-bill) [QUOTED]
     - `Documents` (File upload dropzone for attachments) [QUOTED]

---

## 6. Closing Lists

### 1. Measured from Code
- Shell container classes: `resources/views/react/index.blade.php:125-130`
- Tailwind grid utilities: `public/src-Cls2ms66.css:1-50`
- Navigation definitions: `public/forms-DEWnBS77.js:1`

### 2. Measured in the Browser
- Sidebar width: [INSPECT `/invoices` | `aside` -> `216px`]
- Content width: [INSPECT `/invoices` | `main` -> `1094.67px`]
- Table row height: [INSPECT `/invoices` | `tbody tr` -> `54.0px`]
- Table cell padding: [INSPECT `/invoices` | `td` -> `8px 16px`]
- Button height: [INSPECT `/invoices/create` | `button[type="submit"]` -> `38.4px`]

### 3. Screenshotted
- `IN-ui-screenshots/03-pass2-shell-desktop.png` — Desktop shell at 1366x768.
- `IN-ui-screenshots/04-pass2-breakpoint-tablet.png` — Tablet breakpoint at 768x1024.
- `IN-ui-screenshots/05-pass2-breakpoint-mobile.png` — Mobile breakpoint at 390x844.

### 4. Could Not Verify
- Behavior on ultra-wide displays (> 2560px) in a physical headed monitor (tested up to 1920x1080 virtual viewport).
