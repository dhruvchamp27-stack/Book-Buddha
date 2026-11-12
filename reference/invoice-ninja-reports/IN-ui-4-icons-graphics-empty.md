# Pass 4 — Icons, Graphics and Empty States (and Forms Visually)

[SEEN route: /dashboard | IN-ui-screenshots/10-pass4-icons-navigation.png]
[SEEN route: /recurring_expenses | IN-ui-screenshots/11-pass4-empty-states.png]
[SEEN route: /invoices/create | IN-ui-screenshots/12-pass4-form-validation-visual.png]

---

## 1. Iconography System & Assets

Invoice Ninja does **not** load an icon webfont (`.woff2` icon font or FontAwesome CDN). Instead, all iconography is implemented as standalone, tree-shaken **React SVG components** rendered inline in the DOM. [CODE public/Trash-B6digZTq.js:1]

```
+----------------------------------------------------------------------------------------------------+
| SVG Specification: viewBox="0 0 18 18" | strokeWidth="1.5" | strokeLinecap="round"                 |
| Default Size: 1.2rem (19.2px)          | Stroke Color: Dynamic prop (theme.$16 / #717179)          |
+----------------------------------------------------------------------------------------------------+
```

### 1. The Icon Set Matrix

| Icon Name in Code | Component File | ViewBox | Stroke Width | Semantic Role / Location |
| :--- | :--- | :--- | :--- | :--- |
| `Home` / `Squares` | `Home-*.js` | `0 0 18 18` | `1.5` | Dashboard navigation link |
| `Client` / `UserGroup` | `Client-*.js` | `0 0 18 18` | `1.5` | Clients navigation link |
| `Cube` / `ArchiveBox` | `Cube-C-W-2Syt.js` | `0 0 18 18` | `1.5` | Products catalog link |
| `Invoice` / `Document` | `Invoice-x_MfXYXV.js` | `0 0 18 18` | `1.5` | Invoices navigation link |
| `Clock` / `FileClock` | `FileClock-DkBVMYRh.js`| `0 0 18 18` | `1.5` | Recurring Invoices link |
| `CreditCard` / `Wallet`| `CreditCard-CVC20DpD.js`| `0 0 18 18` | `1.5` | Payments navigation link |
| `Chat` / `Quote` | `Quote-*.js` | `0 0 18 18` | `1.5` | Quotes navigation link |
| `Credit` / `Refund` | `Receipt-*.js` | `0 0 18 18` | `1.5` | Credits navigation link |
| `Briefcase` / `Office` | `Office-BC0YYkdK.js` | `0 0 18 18` | `1.5` | Projects navigation link |
| `ClipboardCheck` | `ClipboardCheck-CNDqkRCK.js`| `0 0 18 18` | `1.5` | Tasks navigation link |
| `Storefront` / `Vendor`| `vendor-BBRDnaHj.js` | `0 0 18 18` | `1.5` | Vendors navigation link |
| `Pencil` | `Pencil-CQTbd8ec.js` | `0 0 18 18` | `1.5` | Table row edit action |
| `Trash` | `Trash-B6digZTq.js` | `0 0 18 18` | `1.5` | Row delete, line item removal |
| `Search` | `Search-Dw05Zl33.js` | `0 0 18 18` | `1.5` | Global header search trigger |
| `ChevronUp` / `Down` | `ChevronUp-DUPqfbQr.js`| `0 0 18 18` | `1.5` | Dropdown indicators, accordions |

### 2. Icon Sizing & Color Rules
- **Sidebar & Header**: `width: 1.2rem (19.2px); height: 1.2rem;` [INSPECT]
- **Table Row Actions**: `width: 1.0rem (16px); height: 1.0rem;` [INSPECT]
- **Inactive State Color**: `#A1A1AA` (`zinc-400`) in light mode; `#717179` in dark mode.
- **Hover / Active State Color**: `#000000` (Light) / `#FFFFFF` (Dark).

---

## 2. Empty States Architecture

When an entity list (e.g. `/recurring_expenses`, `/transactions`) has zero database records, Invoice Ninja renders a table-integrated empty state rather than a separate illustration page. [SEEN route: /recurring_expenses | IN-ui-screenshots/11-pass4-empty-states.png]

### 1. Visual Structure
```
+----------------------------------------------------------------------------------------------------+
| Status | Number | Vendor | Client | Date | Frequency | Next Send | Cycles | Amount | Notes | State |
|----------------------------------------------------------------------------------------------------|
|                                                                                                    |
|                                           No records found                                         |
|                                                                                                    |
|----------------------------------------------------------------------------------------------------|
| Total results: 0                                                                    1 / 1 | rows 10|
+----------------------------------------------------------------------------------------------------+
```
- **The Empty Container**: Renders inside a standard `<tbody>` as a single full-width cell spanning all header columns (`colspan="100"`).
- **Exact Quoted Text**: `"No records found"` [QUOTED].
- **Typography**: `font-size: 14px`, `font-weight: 400`, color `#717179` (`zinc-500`), centered text alignment (`text-center py-12`).
- **Absence of Action**: Unlike consumer web apps that provide an illustration with a large "Create Your First Recurring Expense" CTA button inside the table canvas, Invoice Ninja leaves the table empty and expects the user to click the top-right `"New Recurring Expense"` button.

---

## 3. Forms and Data Entry, Visually

### 1. Required Field Indicators
- **Marking Strategy**: Required fields are marked with a small red asterisk (`*`) immediately adjacent to the label text (e.g. `"Item*"` on product forms). [INSPECT]
- **Unmarked Required Fields**: In the document editor (`/invoices/create`), the Client Selector has **no asterisk**, despite being strictly required. The user discovers it is required only when clicking `"Save"`.

### 2. Validation Errors & Visual Feedback
- **Field Highlight**: Inputs that fail validation receive a solid red border (`border-red-500`, `#EF4444`, `1px solid`). [SEEN route: /invoices/create | IN-ui-screenshots/12-pass4-form-validation-visual.png]
- **Placement**: Validation error messages appear **4px below the input** (`mt-1`).
- **Typography**: `font-size: 12px` (`0.75rem`), `line-height: 16px`, `color: #EF4444` (`red-500`), `font-weight: 400`.
- **Global Toast Alert**: In addition to inline field borders, an alert banner floats in the top-right corner (`z-index: 50`) reading `"Something went wrong"` or naming the specific validation failure.

### 3. Locked and Disabled Field Styling
- On invoices that have been locked (or when user lacks edit permissions):
  - Input elements receive `disabled` and `readonly` attributes.
  - **Visual styling**: `background-color: #F4F4F5` (Light mode) / `#1F2E41` (Dark mode), `border-color: #E5E7EB`, `color: #717179`, `cursor: not-allowed; opacity: 0.75;`. [INSPECT]

### 4. Money and Currency Rendering Mechanics
- **While Typing (Active Focus)**:
  - Input displays raw unformatted numbers (e.g. `1250.50`).
  - No thousand separators (no commas) and no currency symbols inside the editable `<input>` value to prevent caret jumping.
  - Alignment: **Left-aligned** (`text-left`) inside form inputs.
- **On Blur / In Table View**:
  - Automatically reformats according to company localization settings.
  - Displays localized currency symbol/code and formatted thousands commas (e.g. `₹ 1,250.50` or `$ 1,250.50`).
  - Alignment: **Right-aligned** (`text-right`) in data tables and invoice totals blocks.

### 5. Line-Item Grid Detail
- **Column Decision**: Implemented as CSS Grid / Flexbox rows (`grid grid-cols-12 gap-3`).
- **Item & Description**: Consumes ~40% of horizontal line space. Long descriptions wrap onto multiple lines, expanding the row height from `44px` up to `90px` automatically without text truncation.
- **Drag Handle**: Six-dot drag grip icon (`DragHandle` `#A1A1AA`) sits on the far left edge of each line row.
- **Delete Control**: Red hover trash can icon (`Trash` `#EF4444`) sits on the far right edge.
- **Twenty Rows Density**: The table scrolls inside the primary viewport without fixed height clamping, allowing infinite vertical document extension.

---

## 4. Closing Lists

### 1. Measured from Code
- SVG base template: `public/Trash-B6digZTq.js:1` (`viewBox="0 0 18 18", strokeWidth="1.5"`)
- Empty state text: `public/forms-DEWnBS77.js:1`
- Validation alert style: `public/ValidationAlert-C_N94uoV.js:1`

### 2. Measured in the Browser
- Icon bounding box: [INSPECT `header svg` -> `width: 19.2px; height: 19.2px`]
- Empty state row height: [INSPECT `tbody tr` on empty table -> `height: 120px; text-align: center`]
- Error margin: [INSPECT `span.text-red-500` -> `margin-top: 4px; font-size: 12px; color: #ef4444`]

### 3. Screenshotted
- `IN-ui-screenshots/10-pass4-icons-navigation.png` — Main navigation icons on dashboard.
- `IN-ui-screenshots/11-pass4-empty-states.png` — Table empty state showing "No records found".
- `IN-ui-screenshots/12-pass4-form-validation-visual.png` — Validation error styling on invoice form.

### 4. Could Not Verify
- Custom SVG company logo upload rendering with extreme aspect ratios (tested default text company title).
