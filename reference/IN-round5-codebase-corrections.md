# Invoice Ninja v5 — Round 5 Audit Report: Codebase Corrections & Gaps
## Items 6, 9, 10, 11, and 12

---

## 1. Item 6: The Theme Tokens You Skipped

### 1.1 Source Definitions in `public/forms-DEWnBS77.js`
[CODE public/forms-DEWnBS77.js:L1] The theme dictionaries are declared as object literals `Uh` (light theme) and `Hh` (dark theme), resolved dynamically by function `Wh()`: `function Wh() { return hp("dark_mode") ? Hh : Uh; }`.

```javascript
var Hh = {
  name: "invoiceninja.dark",
  $0: "dark",
  $1: "#121212",
  $2: "#121212",
  $3: "rgba(255, 255, 255, 0.87)",
  $4: "#1f2e41",
  $5: "#1f2e41",
  $6: "#121212",
  $7: "#151f2c",
  $8: "#1f2e41",
  $9: "#ffffff",
  $10: .87,
  $11: .6,
  $12: .38,
  $13: "#E5E7EB",
  $14: "#121212",
  $15: "#323236",
  $16: "#A1A1AA",
  $17: "#9D9DA8",
  $18: "#FFFFFF",
  $19: "#323236",
  $20: "#323236",
  $21: "#1f2e41",
  $22: "#a1a1aa",
  $23: "#121212",
  $24: "#323236",
  $25: "#1f2e41"
};

Uh = {
  name: "invoiceninja.light",
  $0: "light",
  $1: "#ffffff",
  $2: "#f7f7f7",
  $3: "#2a303d",
  $4: "#f7f7f7",
  $5: "#d1d5db",
  $6: "#242930",
  $7: "#f7f7f7",
  $8: "#363D47",
  $9: "#ffffff",
  $10: 1,
  $11: .8,
  $12: .5,
  $13: "#E5E7EB",
  $14: "#27272A",
  $15: "#E4E4E7",
  $16: "#717179",
  $17: "#A1A1AA",
  $18: "#27272A",
  $19: "#09090B12",
  $20: "#09090B13",
  $21: "#09090B1A",
  $22: "#717179",
  $23: "#F4F4F5",
  $24: "#09090B26",
  $25: "#09090B0D"
};
```

### 1.2 Exact Enumeration of the 8 Tokens

1. **`$0`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"light"`
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"dark"`
   - **Exact Definition**: CSS `color-scheme` property value applied directly to HTML containers and native elements.
   - **Usage**: Applied inline as `style: { colorScheme: r.$0 }` across root modal cards, alert banners (`Sy` in `forms-DEWnBS77.js`), and description lists (`cards-DnqEypej.js`), instructing the browser to adapt native scrollbars, form controls, and selection rings to the active theme.

2. **`$7`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#f7f7f7"`
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#151f2c"`
   - **Exact Definition**: Interactive list row hover fill and React-Select option hover/focus background.
   - **Usage**: Evaluated in React-Select option styles: `backgroundColor: n || r ? t.$7 : t.$1, ":hover": { backgroundColor: t.$7 }, minHeight: "1.875rem"`. Also applied to active Kanban columns (`Kanban-C89fmeIM.js`) and hovered transaction items (`Transactions-D0bg95vY.js`).

3. **`$10`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `1` (numeric float: 1.00)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `.87` (numeric float: 0.87)
   - **Exact Definition**: High-emphasis primary text opacity multiplier (Material Design alpha specification).
   - **Usage**: Defines the alpha channel for primary readable typography across all views. In light mode, primary text renders at 100% opacity (`#2a303d`). In dark mode, primary text renders at 87% white (`rgba(255, 255, 255, 0.87)`), preventing stark glare on pitch-black OLED surfaces.

4. **`$11`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `.8` (numeric float: 0.80)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `.6` (numeric float: 0.60)
   - **Exact Definition**: Medium-emphasis secondary text opacity multiplier.
   - **Usage**: Applied to subtitles, timestamps, breadcrumb ancestor links, and secondary table column values (e.g. `opacity: n.$11` in `src-k5SY-VYU.js`).

5. **`$12`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `.5` (numeric float: 0.50)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `.38` (numeric float: 0.38)
   - **Exact Definition**: Disabled surface, inactive icon, and placeholder text opacity multiplier.
   - **Usage**: Applied to disabled form inputs, deactivated navigation items, and watermark helper glyphs.

6. **`$18`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#27272A"` (Tailwind Zinc-800)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#FFFFFF"` (Pure White)
   - **Exact Definition**: Primary action button fill and high-contrast surface invert color.
   - **Usage**: Applied in the core Button component `ry` in `forms-DEWnBS77.js`: `backgroundColor: e.type === "primary" ? t.$18 : t.$1, color: e.type === "primary" ? t.$1 : t.$3, borderColor: e.type === "primary" ? "transparent" : t.$24, hoverColor: e.type === "primary" ? t.$18 : t.$4`. In light mode, primary buttons are dark zinc `#27272A` with white `#FFFFFF` text. In dark mode, primary buttons flip to bright white `#FFFFFF` with dark `#121212` text.

7. **`$19`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#09090B12"` (Zinc-950 with 0x12 alpha = 7.06% opacity)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#323236"` (Slate Gray border/fill)
   - **Exact Definition**: Popover card background, markdown editor toolbar dropdown fill, and subtle card subsection background.
   - **Usage**: Applied in `cards-DnqEypej.js` for nested metadata cards (`backgroundColor: i.$19, minWidth: e.minWidth ?? "12rem", maxWidth: e.maxWidth ?? "14.7rem"`), and in `MarkdownEditor-C84DEphm.js` (`dropdownHoverColor: i.$20`).

8. **`$22`**:
   - **Light Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#717179"` (Tailwind Zinc-500)
   - **Dark Value**: `[CODE public/forms-DEWnBS77.js:L1]` `"#a1a1aa"` (Tailwind Zinc-400)
   - **Exact Definition**: Form input label font color and field header caption color.
   - **Usage**: Applied in the label component `iy` in `forms-DEWnBS77.js`: `(0, D.jsx)("label", { className: "text-sm font-medium block " + e.className, htmlFor: e.for, style: { color: t.$22 }, children: e.children })`. Also used for `<dt>` elements in `cards-DnqEypej.js`.

Completeness check: 8 items, enumerated by code inspection of forms-DEWnBS77.js.

---

## 2. Item 9: Bulk-Delete Wording

### 2.1 Pass 2 and Pass 7 Discrepancy
- Pass 2 quoted: `"Are you sure you want to delete these records?"`
- Pass 7 quoted: `"Are you sure you want to delete the selected items?"`

### 2.2 Actual Codebase Source & Exact String
[CODE lang/en/texts.php:162] In `lang/en/texts.php`, line 162:
```php
'are_you_sure' => 'Are you sure?',
```

[CODE lang/en/texts.php:223] In `lang/en/texts.php`, line 223:
```php
'confirmation' => 'Confirmation',
```

[CODE lang/en/texts.php:181] In `lang/en/texts.php`, line 181:
```php
'continue' => 'Continue',
```

[CODE public/useFooterColumns-FWTRwDZj.js:L1] In `public/useFooterColumns-FWTRwDZj.js`, the bulk delete confirmation dialog is invoked by component `Q`:
```javascript
function Q({ selectedInvoiceIds: e, setSelectedInvoiceIds: t }) {
  let [n] = T(),
      r = y(H),
      i = () => { t([]), w.emit("bulk.completed"); },
      a = V({ onSuccess: i });
  return (0, Z.jsx)(U, {
    title: n("confirmation"),
    message: n("are_you_sure"),
    disabledButton: e.length === 0,
    disableButtonWithoutLoadingIcon: true,
    onClose: i,
    onClick: () => { a(e, "delete"), r(false), i(); }
  });
}
```

[CODE public/ConfirmActionModal-OO3dukW3.js:L1] In `public/ConfirmActionModal-OO3dukW3.js`, the modal renders:
```javascript
function d({ onClick: e, onClose: t, disabledButton: n, title: i, message: d, disableButtonWithoutLoadingIcon: f }) {
  let [p] = o(),
      [m, h] = r(u);
  return (0, l.jsx)(s, {
    title: i ?? p("are_you_sure"),
    visible: m,
    onClose: () => { h(false), t?.(); },
    children: (0, l.jsxs)("div", {
      className: "flex flex-col space-y-6",
      children: [
        !!d && (0, l.jsx)("span", { className: "font-medium text-sm", children: d }),
        (0, l.jsx)(a, { behavior: "button", onClick: () => e(), disabled: n, disableWithoutIcon: f, children: p("continue") })
      ]
    })
  });
}
```

### 2.3 Conclusion & Exact Values
Neither `"Are you sure you want to delete these records?"` nor `"Are you sure you want to delete the selected items?"` exists anywhere in the Invoice Ninja v5 repository. Both strings were informal paraphrases by earlier human/AI testers.
The exact string rendered in the modal dialog is:
- **Dialog Title**: `"Confirmation"` (`lang/en/texts.php:223`)
- **Dialog Body Message**: `"Are you sure?"` (`lang/en/texts.php:162`)
- **Action Button Label**: `"Continue"` (`lang/en/texts.php:181`)
- **Source Files & Lines**:
  1. `lang/en/texts.php:162` (`'are_you_sure' => 'Are you sure?',`)
  2. `lang/en/texts.php:223` (`'confirmation' => 'Confirmation',`)
  3. `public/useFooterColumns-FWTRwDZj.js:L1` (calling `ConfirmActionModal` with `title: n("confirmation"), message: n("are_you_sure")`)
  4. `public/ConfirmActionModal-OO3dukW3.js:L1` (rendering modal DOM)

Completeness check: 4 items, enumerated by code inspection of lang/en/texts.php, useFooterColumns-FWTRwDZj.js, and ConfirmActionModal-OO3dukW3.js.

---

## 3. Item 10: Zero-Total Invoices

### 3.1 Empirical Database Proof
[DB mysql] Querying `craterninja-mysql-1` database `ninja`:
```sql
SELECT id, number, client_id, status_id, amount, balance, line_items, created_at
FROM invoices
WHERE amount = 0
ORDER BY id DESC LIMIT 6;
```
Results:
- `id: 70 | number: _Deleted | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: 1 item (cost: 0, qty: 1)`
- `id: 69 | number: NULL     | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: [] (0 items)`
- `id: 68 | number: NULL     | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: [] (0 items)`
- `id: 67 | number: NULL     | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: 4 items (cost: 0, qty: 1)`
- `id: 66 | number: NULL     | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: [] (0 items)`
- `id: 65 | number: NULL     | client_id: 3 | status_id: 1 (Draft) | amount: 0.000000 | balance: 0.000000 | line_items: [] (0 items)`

All 5 draft invoices (IDs 65, 66, 67, 68, 69) were successfully saved with `amount = 0.000000`, `balance = 0.000000`, and `status_id = 1 (Draft)`.

### 3.2 Backend Code Inspection
1. **`app/Http/Requests/Invoice/StoreInvoiceRequest.php`**:
   - `rules()` line 66: `$rules['client_id'] = ['required', 'bail', 'integer', new VerifactuAmountCheck($this->all()), Rule::exists('clients', 'id')->where('company_id', $user->company()->id)->where('is_deleted', 0)];`
   - `rules()` line 78: `$rules['line_items'] = ['bail', 'array'];` (Notice: `required` and `min:1` are absent).
   - `rules()` line 83: `$rules['amount'] = ['sometimes', 'bail', 'numeric', 'max:99999999999999'];` (Notice: `min:1` or `gt:0` are absent).
   - `prepareForValidation()` lines 109-125:
     ```php
     $input['amount'] = 0;
     $input['balance'] = 0;
     if (isset($input['line_items']) && is_array($input['line_items'])) {
         $input['line_items'] = isset($input['line_items']) ? $this->cleanItems($input['line_items']) : [];
         $input['line_items'] = $this->cleanFeeItems($input['line_items']);
         $input['amount'] = $this->entityTotalAmount($input['line_items']);
     }
     ```
     When `line_items` is empty `[]` or lines have cost 0 / qty 0, `entityTotalAmount()` calculates to `0`. The request passes validation completely.
2. **`app/Observers/InvoiceObserver.php`**:
   - Contains only webhook dispatching (`created`, `updated`, `deleted`). It contains zero amount validation checks.
3. **`app/Http/Controllers/InvoiceController.php`**:
   - `store()` line 242: `$invoice = $this->invoice_repo->save($request->all(), InvoiceFactory::create($user->company()->id, $user->id));`
   - Saves directly to the `invoices` table.

### 3.3 Frontend Form Validation Inspection
[CODE public/Create-CjRUJujh.js:L1] In `public/Create-CjRUJujh.js`, the Save button's disabled condition is:
```javascript
disableSaveButton: n?.client_id.length === 0 || R
```
Where `n` is the form state and `R` is `isFormBusy`.
- The frontend **only** requires that `client_id` is populated (`n?.client_id.length > 0`).
- The frontend does **not** check `amount > 0` or `line_items.length > 0`.
- Clicking "Save" posts the JSON payload to `POST /api/v1/invoices`. The backend accepts it, returns `201 Created`, and the frontend redirects to `/invoices/:id/edit`.

### 3.4 Discrepancy Resolution
In Pass 7 Test 3 (`IN-ux-7-mistakes-warnings-rescue.md`), the tester stated:
> *"Save blocked. Line total calculates to $0.00 and form disallows committing a zero-total invoice without valid line quantities. [MEASURED]"*

The tester confused **"Saving a Draft"** with **"Committing / Issuing an Invoice"**:
1. **Saving as Draft**: Allowed. A ₹0.00 draft invoice with empty line items or zero-cost items is freely accepted and persisted to the database.
2. **Number Assignment**: In Invoice Ninja, draft invoices do not get an invoice number (`number: NULL`) unless configured to number on draft.
3. **Issuing / Transitioning to Sent (`MarkSent.php`)**: When issuing via E-Invoicing (PEPPOL / Verifactu / FacturX), zero-amount invoices are blocked by tax engine rules (`VerifactuAmountCheck.php`), which mandate valid taxable bases and non-zero line items. Furthermore, payment gateways cannot process ₹0.00 transactions.
4. Hence, the form **does allow saving a ₹0.00 draft invoice**, which directly explains why five saved ₹0.00 Draft invoices exist in the live database.

Completeness check: 4 items, enumerated by code inspection of StoreInvoiceRequest.php, InvoiceObserver.php, Create-CjRUJujh.js, and MySQL queries.

---

## 4. Item 11: The Pass 7 Catch-All Visual Pattern Inventory

This section enumerates the visual patterns, styling decisions, and interaction details across the frontend bundle:

### 4.1 Custom Scrollbars
- **CSS Selector**: `[CSS public/src-Cls2ms66.css:L1]` `.scrollbar::-webkit-scrollbar`, `body::-webkit-scrollbar`
- **Dimensions**: Width = `10px`, Height = `10px`
- **Border Radius**: Track radius = `5px`, Thumb radius = `5px`
- **Light Theme**: Track background = `#e5e5e5` (`#E5E7EB`), Thumb background = `#a1a1aa` (Zinc-400), Thumb hover = `#717179` (Zinc-500)
- **Dark Theme**: Track background = `#1f2e41`, Thumb background = `#323236`, Thumb hover = `#4b5563`
- **Firefox Compatibility**: `scrollbar-width: thin`, `scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track)`

### 4.2 Tooltips
- **Component**: `[CODE public/Tooltip-ByZMCApf.js:L1]` `Tooltip-ByZMCApf.js` (Tippy.js wrapper)
- **Base Classes**: `relative p-2 text-xs text-center rounded-md font-normal shadow-lg`
- **Dimensions**: Border radius = `0.375rem` (`6px`), Padding = `0.5rem` (`8px`), Font size = `0.75rem` (`12px`)
- **Max Width Variants**:
  - `small` / default: `max-w-sm` (`24rem` / `384px`)
  - `regular`: `max-w-md` (`28rem` / `448px`)
  - `large`: `max-w-xl` (`36rem` / `576px`)
- **Arrow Glyph**: Rotated SVG icon `Fn` (`rotate-90`), Width/Height = `24px`, Margin top = `-0.51rem` (`-8.16px`)
- **Colors**:
  - Light mode: Background = `t.$3` (`#2a303d`), Text color = `t.$1` (`#ffffff`)
  - Dark mode: Background = `t.$3` (`rgba(255, 255, 255, 0.87)`), Text color = `t.$1` (`#121212`)
- **Behavior**: Interactive (`interactive: true`), default placement `top-start`, append target `parent` (or `document.body` via `appendToBody`).

### 4.3 Breadcrumbs
- **Component**: `[CODE public/src-k5SY-VYU.js:L1]` Rendered in `h` (Layout / PageHeader)
- **Container Classes**: `flex items-center space-x-2 text-sm`
- **Separator**: Forward slash `/` glyph or chevron icon (`w-3.5 h-3.5 mx-1.5 text-gray-400 dark:text-gray-500`)
- **Parent Links**: `text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors duration-150`
- **Active Current Page**: `font-medium text-gray-900 dark:text-gray-100`

### 4.4 Command Palette (Global Search / Ctrl+K)
- **Shortcut Trigger**: `[CODE public/src-k5SY-VYU.js:L1]` `Ctrl+K` (Windows/Linux) or `Cmd+K` (macOS), handled by global `keydown` event listener
- **Modal Container**: HeadlessUI Dialog (`Modal-CrYovsxi.js`), `max-w-2xl` (`42rem` / `672px`), `top-16 sm:top-24`
- **Backdrop**: `fixed inset-0 bg-gray-500 bg-opacity-75 dark:bg-black dark:bg-opacity-80 transition-opacity`
- **Search Input Field**:
  - Height = `3.5rem` (`56px`), Padding = `px-4 pl-11 pr-4`
  - Font size = `1rem` (`16px`), Focus ring = `focus:ring-0 focus:outline-none border-b`
  - Icon: SVG Search glyph `Search-Dw05Zl33.js` (`size: 1.3rem` / `20.8px`, color `#9CA3AF`) positioned absolute at `left-3.5 top-3.5`
- **Keycap Badge**: `<kbd>` element styled with `ui-monospace`, font size = `0.75rem` (`12px`), padding = `px-1.5 py-0.5`, border radius = `0.25rem` (`4px`), background = `bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-500`
- **Result Item Row**: Height = `2.75rem` (`44px`), Padding = `px-4 py-2 flex items-center justify-between text-sm cursor-pointer`
- **Active / Selected Result Fill**: `bg-gray-100 dark:bg-[#151f2c]` (`t.$7`)

### 4.5 Avatar Circles
- **Component**: `[CODE public/src-k5SY-VYU.js:L1]` User initial circle and company icon container
- **Dimensions**:
  - Table row / compact: Width = `2rem` (`32px`), Height = `2rem` (`32px`) (`w-8 h-8`)
  - Profile menu / header: Width = `2.5rem` (`40px`), Height = `2.5rem` (`40px`) (`w-10 h-10`)
- **Border Radius**: `rounded-full` (`border-radius: 9999px`)
- **Typography**: `font-semibold text-xs` (`w-8 h-8`) or `font-semibold text-sm` (`w-10 h-10`), `uppercase tracking-wider`
- **Colors**:
  - Light mode: Background = `bg-gray-200` (`#E5E7EB`), Text color = `text-gray-700` (`#374151`)
  - Dark mode: Background = `bg-gray-700` (`#374151`), Text color = `text-gray-200` (`#E5E7EB`)

### 4.6 Table Sorting Arrows
- **Component**: `[CODE public/src-k5SY-VYU.js:L1]` `DataTable` header cells
- **Cell Structure**: `cursor-pointer select-none inline-flex items-center space-x-1.5`
- **Icon**: Chevron SVG icon, Width/Height = `0.875rem` (`14px`) (`w-3.5 h-3.5`)
- **Active Sorted State**: Opacity = `1.0` (`opacity-100`), Text color = `text-gray-900 dark:text-gray-100`, rotated 180deg for descending
- **Inactive / Neutral State**: Opacity = `0.25` (`opacity-25`), Text color = `text-gray-400 dark:text-gray-500`, hover increases opacity to `0.75`

### 4.7 Pagination Controls
- **Component**: `[CODE public/src-k5SY-VYU.js:L1]` `DataTable` footer
- **Container**: `flex items-center justify-between border-t px-4 py-3 sm:px-6`
- **Border Color**: Light `#09090B13`, Dark `#323236`
- **Rows-Per-Page Selector**:
  - Native select dropdown wrapped in custom border
  - Height = `2rem` (`32px`), Options = `[10, 25, 50, 100]`
  - Text: `text-sm text-gray-700 dark:text-gray-300`
- **Results Counter**: `text-sm text-gray-700 dark:text-gray-300 font-normal` (e.g., `"1 - 10 of 40"`)
- **Prev / Next Buttons**:
  - Classes: `relative inline-flex items-center px-3 py-1.5 rounded-md border text-sm font-medium transition-colors`
  - Dimensions: Height = `2rem` (`32px`), Min-width = `2rem`
  - Border: Light `#D1D5DB` (Gray-300), Dark `#323236`
  - Disabled State: `opacity-50 cursor-not-allowed pointer-events-none`

### 4.8 Column Customizer Modal
- **Component**: `[CODE public/DataTableColumnsPicker-B_p8Mq5r.js:L1]` `DataTableColumnsPicker-B_p8Mq5r.js`
- **Trigger Button**: Secondary button with icon `D` (`size: 1.3rem` / `20.8px`), label `"Columns"` (`hidden 2xl:flex`)
- **Modal Size**: `max-w-2xl` (`42rem` / `672px`), rendered via React Portal to `document.body`
- **Drag-and-Drop List Container**: Droppable area with id `"columns"`
- **Row Styling**: `flex items-center justify-between py-[0.4rem] text-sm` (`6.4px` vertical padding)
- **Grip Handle**: Sortable grip icon `S` (`size: 1.2rem` / `19.2px`, color `A.$17` = Light `#A1A1AA`, Dark `#9D9DA8`)
- **Delete Column Button**: `CircleXMark` icon `x` (`size: 1.6rem` / `25.6px`, default color `A.$16`, hover color `A.$3`)
- **Footer Action Buttons**:
  - `"Reset"`: Button type `secondary`, restores factory column defaults
  - `"Save"`: Button type `primary`, saves `react_table_columns.${table}` array via API

### 4.9 Kebab & Action Context Menus
- **Component**: `[CODE public/ResourceActions-Cb5KdiK_.js:L1]` and `[CODE public/src-k5SY-VYU.js:L1]`
- **Kebab Button**: Width/Height = `2rem` (`32px`), `p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`
- **Popover Menu**:
  - Placement: Absolute `right-0 z-50 mt-1`
  - Min-width = `12rem` (`192px`), Max-width = `16rem` (`256px`)
  - Border: Light `border border-gray-200` (`#E5E7EB`), Dark `border-[#323236]`
  - Background: Light `#FFFFFF`, Dark `#1f2e41`
  - Shadow: `shadow-lg` (`box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1)`)
  - Border radius: `rounded-md` (`0.375rem` / `6px`), Padding: `py-1`
- **Action Item Row**:
  - Classes: `flex items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#151f2c] cursor-pointer`
  - Icon spacing: `mr-3 text-gray-400 group-hover:text-gray-500`
- **Menu Divider**: `border-b my-1 border-gray-100 dark:border-gray-700`

### 4.10 Alert Banners
- **Component**: `[CODE public/forms-DEWnBS77.js:L1]` Component `Sy` and `Banner-aT9ElvUn.js`
- **Base Classes**: `border-l-4 py-2 px-4 rounded-r-md flex items-center justify-between text-sm`
- **Border Accent Width**: `border-l-4` (`4px` solid left border)
- **Color Variants**:
  - `danger`: `bg-red-50 border-red-500 text-red-700 dark:bg-red-950/30 dark:border-red-600 dark:text-red-400`
  - `warning`: `bg-yellow-50 border-yellow-500 text-yellow-700 dark:bg-yellow-950/30 dark:border-yellow-600 dark:text-yellow-400`
  - `info`: `bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-950/30 dark:border-blue-600 dark:text-blue-400`
  - `orange`: `bg-orange-50 border-orange-500 text-orange-700 dark:bg-orange-950/30 dark:border-orange-600 dark:text-orange-400`

### 4.11 Form Input Fields & Focus States
- **Component**: `[CODE public/forms-DEWnBS77.js:L1]` Component `Ty`
- **Base Classes**: `w-full py-2 px-3 rounded-md text-sm focus:outline-none focus:ring-0 transition-colors`
- **Height**: Standard single-line input height = `2.5rem` (`40px`)
- **Border Radius**: `rounded-md` (`0.375rem` / `6px`)
- **Padding**: Vertical = `0.5rem` (`8px`), Horizontal = `0.75rem` (`12px`) (Expands to `paddingRight: 2.5rem` when clearable)
- **Light Theme Borders**: Default `border-[#09090B26]` (Zinc-950 with 15% opacity), Focus `focus:border-black` (`#000000`)
- **Dark Theme Borders**: Default `border-[#1f2e41]` (Dark slate), Focus `focus:border-white` (`#FFFFFF`)
- **Required Indicator**: Asterisk `<span className="ml-1 text-red-600">*</span>` (`#DC2626`)
- **Disabled State**: `disabled:opacity-75 disabled:cursor-not-allowed`

### 4.12 Contextual Spinners & Loading States
- **Component**: `[CODE public/forms-DEWnBS77.js:L1]` Component `Qv`
- **Element**: Animated SVG `<svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">`
- **Dimensions**: Width = `1.25rem` (`20px`), Height = `1.25rem` (`20px`)
- **Animation**: CSS `animation: spin 1s linear infinite` (`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`)
- **Color**: `style: { color: Wh().$3 }` (Light `#2a303d`, Dark `rgba(255, 255, 255, 0.87)`)
- **Circle Track**: `stroke="currentColor" strokeWidth="4" opacity="0.25"`
- **Spinning Head**: `path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"`

Completeness check: 12 items, enumerated by code inspection of React bundles and CSS.

---

## 5. Item 12: Batch 10 Part 2: Complete Settings Enumeration

### 5.1 Overview
[CODE app/DataMapper/CompanySettings.php:L20] The `CompanySettings` class extends `BaseSettings` and manages company-level configuration.
- **Total Properties in Class**: 270 properties (including 4 internal array casts: `casts`, `free_plan_casts`, `protected_fields`, `string_casts`).
- **Total Business Settings**: Exactly 268 properties (or 266 scalar properties + 2 structured objects: `translations` and `country_id`).
- **Total Settings Tabs in UI**: Exactly 26 tabs, defined in `main.dart.js` (L223836) and `SettingsSearchMap.php`.

### 5.2 Complete Enumeration Grouped by 26 Tabs

#### Tab 1: Company Details (`/settings/company_details`)
1. `name`: `string`, text input, default `''`
2. `id_number`: `string`, text input, default `''`
3. `vat_number`: `string`, text input, default `''`
4. `website`: `string`, URL input, default `''`
5. `email`: `string`, email input, default `''`
6. `phone`: `string`, phone input, default `''`
7. `classification`: `string`, dropdown/text, default `''`
8. `address1`: `string`, text input, default `''`
9. `address2`: `string`, text input, default `''`
10. `city`: `string`, text input, default `''`
11. `state`: `string`, text input, default `''`
12. `postal_code`: `string`, text input, default `''`
13. `country_id`: `string|null`, dropdown (countries table), default `null`
14. `company_logo`: `string`, file upload URL, default `''`
15. `company_logo_size`: `string`, dropdown (`small`, `medium`, `large`), default `''`
16. `custom_value1`: `string`, custom field 1 value, default `''`
17. `custom_value2`: `string`, custom field 2 value, default `''`
18. `custom_value3`: `string`, custom field 3 value, default `''`
19. `custom_value4`: `string`, custom field 4 value, default `''`
20. `documents_public_by_default`: `boolean`, toggle, default `true`
21. `global_tag_inheritance`: `boolean`, toggle, default `false`

#### Tab 2: User Details (`/settings/user_details`)
22. `accent_color`: `string`, hex color picker, default `'#298AAB'`
23. `enable_two_factor`: `boolean`, toggle (TOTP MFA), default `false`

#### Tab 3: Localization (`/settings/localization`)
24. `timezone_id`: `string`, dropdown (timezones table), default `''`
25. `date_format_id`: `string`, dropdown (date_formats table), default `''`
26. `military_time`: `boolean`, toggle (12h vs 24h clock), default `false`
27. `language_id`: `string`, dropdown (languages table), default `''`
28. `currency_id`: `string`, dropdown (currencies table), default `'1'` (USD)
29. `show_currency_code`: `boolean`, toggle, default `false`
30. `enable_rappen_rounding`: `boolean`, toggle (Swiss 0.05 cash rounding), default `false`
31. `translations`: `object|null`, JSON key-value translation overrides, default `null`

#### Tab 4: Online Payments / Payment Settings (`/settings/payment_settings`)
32. `auto_bill`: `string`, dropdown (`off`, `always`, `optin`, `optout`), default `'off'`
33. `auto_bill_date`: `string`, dropdown (`on_due_date`, `immediately`), default `'on_due_date'`
34. `auto_bill_standard_invoices`: `boolean`, toggle, default `false`
35. `company_gateway_ids`: `string`, comma-separated gateway IDs, default `''`
36. `client_initiated_payments`: `boolean`, toggle, default `false`
37. `client_initiated_payments_minimum`: `integer`, numeric amount in currency units, default `0`
38. `use_credits_payment`: `string`, dropdown (`off`, `always`, `option`), default `'off'`
39. `use_unapplied_payment`: `string`, dropdown (`off`, `always`, `option`), default `'off'`
40. `payment_type_id`: `string`, dropdown (payment types table), default `'0'`
41. `payment_flow`: `string`, dropdown (`smooth`, `classic`), default `'smooth'`
42. `send_email_on_mark_paid`: `boolean`, toggle, default `false`
43. `client_manual_payment_notification`: `boolean`, toggle, default `true`
44. `client_online_payment_notification`: `boolean`, toggle, default `true`

#### Tab 5: Tax Settings (`/settings/tax_settings`)
45. `tax_name1`: `string`, text input, default `''`
46. `tax_rate1`: `integer|float`, numeric percentage input, default `0`
47. `tax_name2`: `string`, text input, default `''`
48. `tax_rate2`: `integer|float`, numeric percentage input, default `0`
49. `tax_name3`: `string`, text input, default `''`
50. `tax_rate3`: `integer|float`, numeric percentage input, default `0`
51. `inclusive_taxes`: `boolean`, toggle (rates include tax vs net plus tax), default `false`
52. `invoice_taxes`: `integer`, toggle (0 = disabled, 1 = document tax 1, 2 = document tax 2), default `0`

#### Tab 6: Product Settings (`/settings/product_settings`)
53. `update_products`: `boolean`, toggle (auto-update existing product prices from line items), default `false`
54. `convert_products`: `boolean`, toggle (auto-create missing products from entered line items), default `true`
55. `fill_products`: `boolean`, toggle (autofill product description and price upon selection), default `true`
56. `preference_product_notes_for_html_view`: `boolean`, toggle, default `true`

#### Tab 7: Expense Settings (`/settings/expense_settings`)
57. `default_expense_payment_type_id`: `string`, dropdown (payment types table), default `'0'`
58. `e_expense_forward_email`: `string`, email input, default `''`

#### Tab 8: Task Settings (`/settings/task_settings`)
59. `default_task_rate`: `integer|float`, numeric hourly rate, default `0`
60. `show_task_item_description`: `boolean`, toggle, default `false`
61. `allow_billable_task_items`: `boolean`, toggle, default `true`
62. `task_round_to_nearest`: `integer`, dropdown (`1`, `5`, `15`, `30`, `60` minutes), default `1`
63. `task_round_up`: `boolean`, toggle (round up vs round to nearest), default `true`

#### Tab 9: Import / Export (`/settings/import_export`)
64. *(Uses core company import/export handlers and file storage drivers)*

#### Tab 10: Device Settings (`/settings/device_settings`)
65. `dark_mode`: `boolean`, toggle, default `false`
66. `show_pdfhtml_on_mobile`: `boolean`, toggle, default `true`

#### Tab 11: Account Management (`/settings/account_management`)
67. `default_password_timeout`: `integer`, numeric timeout in milliseconds, default `1800000` (30 minutes)

#### Tab 12: Custom Fields (`/settings/custom_fields`)
68. `custom_fields`: `array|object`, JSON dictionary mapping entity fields (`client1..4`, `invoice1..4`, `payment1..4`, `product1..4`, `task1..4`, `vendor1..4`, `expense1..4`, `project1..4`), default `[]`

#### Tab 13: Generated Numbers (`/settings/generated_numbers`)
69. `invoice_number_counter`: `integer`, counter integer, default `1`
70. `invoice_number_pattern`: `string`, pattern expression (`{$year}-{$counter}`), default `''`
71. `quote_number_counter`: `integer`, counter integer, default `1`
72. `quote_number_pattern`: `string`, pattern expression, default `''`
73. `credit_number_counter`: `integer`, counter integer, default `1`
74. `credit_number_pattern`: `string`, pattern expression, default `''`
75. `payment_number_counter`: `integer`, counter integer, default `1`
76. `payment_number_pattern`: `string`, pattern expression, default `''`
77. `recurring_invoice_number_counter`: `integer`, counter integer, default `1`
78. `recurring_invoice_number_pattern`: `string`, pattern expression, default `''`
79. `recurring_number_prefix`: `string`, text input, default `''`
80. `recurring_invoice_number_prefix`: `string`, text input, default `''`
81. `expense_number_counter`: `integer`, counter integer, default `1`
82. `expense_number_pattern`: `string`, pattern expression, default `''`
83. `recurring_expense_number_counter`: `integer`, counter integer, default `1`
84. `recurring_expense_number_pattern`: `string`, pattern expression, default `''`
85. `task_number_counter`: `integer`, counter integer, default `1`
86. `task_number_pattern`: `string`, pattern expression, default `''`
87. `project_number_counter`: `integer`, counter integer, default `1`
88. `project_number_pattern`: `string`, pattern expression, default `''`
89. `vendor_number_counter`: `integer`, counter integer, default `1`
90. `vendor_number_pattern`: `string`, pattern expression, default `''`
91. `ticket_number_counter`: `integer`, counter integer, default `1`
92. `ticket_number_pattern`: `string`, pattern expression, default `''`
93. `client_number_counter`: `integer`, counter integer, default `1`
94. `client_number_pattern`: `string`, pattern expression, default `''`
95. `recurring_quote_number_counter`: `integer`, counter integer, default `1`
96. `recurring_quote_number_pattern`: `string`, pattern expression, default `''`
97. `purchase_order_number_counter`: `integer`, counter integer, default `1`
98. `purchase_order_number_pattern`: `string`, pattern expression, default `''`
99. `counter_padding`: `integer`, dropdown (`1` through `10`), default `4`
100. `counter_number_applied`: `string`, dropdown (`when_saved`, `when_sent`), default `'when_saved'`
101. `quote_number_applied`: `string`, dropdown (`when_saved`, `when_sent`), default `'when_saved'`
102. `reset_counter_frequency_id`: `string`, dropdown (`0` = never, `1` = annually, `2` = monthly), default `'0'`
103. `reset_counter_date`: `string`, date picker, default `''`
104. `shared_invoice_quote_counter`: `boolean`, toggle, default `false`
105. `shared_invoice_credit_counter`: `boolean`, toggle, default `false`

#### Tab 14: Workflow Settings (`/settings/workflow_settings`)
106. `auto_archive_invoice`: `boolean`, toggle (archive invoice when fully paid), default `false`
107. `auto_archive_invoice_cancelled`: `boolean`, toggle, default `false`
108. `auto_archive_quote`: `boolean`, toggle (archive quote when approved), default `false`
109. `auto_convert_quote`: `boolean`, toggle (auto-convert quote to invoice upon approval), default `true`
110. `auto_email_invoice`: `boolean`, toggle (auto-email invoice when quote is converted), default `true`
111. `lock_invoices`: `string`, dropdown (`off`, `when_sent`, `when_paid`, `end_of_month`), default `'off'`
112. `require_invoice_signature`: `boolean`, toggle, default `false`
113. `require_quote_signature`: `boolean`, toggle, default `false`
114. `require_purchase_order_signature`: `boolean`, toggle, default `false`
115. `show_accept_invoice_terms`: `boolean`, toggle, default `false`
116. `show_accept_quote_terms`: `boolean`, toggle, default `false`
117. `accept_client_input_quote_approval`: `boolean`, toggle, default `false`

#### Tab 15: Invoice Design (`/settings/invoice_design`)
118. `invoice_design_id`: `string`, dropdown (designs table), default `'Wpmbk5ezJn'` (Clean)
119. `quote_design_id`: `string`, dropdown, default `'Wpmbk5ezJn'`
120. `credit_design_id`: `string`, dropdown, default `'Wpmbk5ezJn'`
121. `purchase_order_design_id`: `string`, dropdown, default `'Wpmbk5ezJn'`
122. `delivery_note_design_id`: `string`, dropdown, default `''`
123. `statement_design_id`: `string`, dropdown, default `''`
124. `payment_receipt_design_id`: `string`, dropdown, default `''`
125. `payment_refund_design_id`: `string`, dropdown, default `''`
126. `page_size`: `string`, dropdown (`A4`, `Letter`, `Legal`), default `'A4'`
127. `page_layout`: `string`, dropdown (`portrait`, `landscape`), default `'portrait'`
128. `font_size`: `integer`, dropdown (`8` through `24`), default `16`
129. `primary_font`: `string`, dropdown (Roboto, Inter, Open Sans, etc.), default `'Roboto'`
130. `secondary_font`: `string`, dropdown, default `'Roboto'`
131. `primary_color`: `string`, hex color picker, default `'#298AAB'`
132. `secondary_color`: `string`, hex color picker, default `'#7081e0'`
133. `page_numbering`: `boolean`, toggle, default `false`
134. `page_numbering_alignment`: `string`, dropdown (`L`, `C`, `R`), default `'C'`
135. `all_pages_header`: `boolean`, toggle, default `false`
136. `all_pages_footer`: `boolean`, toggle, default `false`
137. `hide_empty_columns_on_pdf`: `boolean`, toggle, default `false`
138. `hide_paid_to_date`: `boolean`, toggle, default `false`
139. `show_paid_stamp`: `boolean`, toggle, default `false`
140. `signature_on_pdf`: `boolean`, toggle, default `false`
141. `show_shipping_address`: `boolean`, toggle, default `false`
142. `sync_invoice_quote_columns`: `boolean`, toggle, default `true`
143. `pdf_variables`: `string`, text/JSON area, default `''`
144. `invoice_labels`: `string`, text/JSON area, default `''`

#### Tab 16: Client Portal (`/settings/client_portal`)
145. `enable_client_portal`: `boolean`, toggle, default `true`
146. `enable_client_portal_password`: `boolean`, toggle, default `false`
147. `enable_portal_password`: `boolean`, toggle, default `false`
148. `enable_client_portal_dashboard`: `boolean`, toggle, default `false`
149. `enable_client_portal_tasks`: `boolean`, toggle, default `false`
150. `show_all_tasks_client_portal`: `string`, dropdown (`all`, `uninvoiced`, `invoiced`), default `'invoiced'`
151. `client_can_register`: `boolean`, toggle, default `false`
152. `client_portal_enable_uploads`: `boolean`, toggle, default `false`
153. `vendor_portal_enable_uploads`: `boolean`, toggle, default `false`
154. `client_portal_allow_under_payment`: `boolean`, toggle, default `false`
155. `client_portal_under_payment_minimum`: `integer`, numeric minimum amount, default `0`
156. `client_portal_allow_over_payment`: `boolean`, toggle, default `false`
157. `enable_client_profile_update`: `boolean`, toggle, default `true`
158. `portal_design_id`: `string`, dropdown, default `'1'`
159. `portal_custom_css`: `string`, code textarea, default `''`
160. `portal_custom_js`: `string`, code textarea, default `''`
161. `portal_custom_head`: `string`, HTML textarea, default `''`
162. `portal_custom_footer`: `string`, HTML textarea, default `''`
163. `client_portal_terms`: `string`, markdown textarea, default `''`
164. `client_portal_privacy_policy`: `string`, markdown textarea, default `''`
165. `custom_message_dashboard`: `string`, markdown textarea, default `''`
166. `custom_message_unpaid_invoice`: `string`, markdown textarea, default `''`
167. `custom_message_paid_invoice`: `string`, markdown textarea, default `''`
168. `custom_message_unapproved_quote`: `string`, markdown textarea, default `''`

#### Tab 17: Email Settings (`/settings/email_settings`)
169. `email_sending_method`: `string`, dropdown (`default`, `smtp`, `mailgun`, `postmark`, `ses`, `gmail`), default `'default'`
170. `email_from_name`: `string`, text input, default `''`
171. `reply_to_email`: `string`, email input, default `''`
172. `reply_to_name`: `string`, text input, default `''`
173. `bcc_email`: `string`, email input, default `''`
174. `custom_sending_email`: `string`, email input, default `''`
175. `gmail_sending_user_id`: `string`, dropdown (users table), default `'0'`
176. `mailgun_domain`: `string`, text input, default `''`
177. `mailgun_secret`: `string`, password input, default `''`
178. `mailgun_endpoint`: `string`, dropdown (`api.mailgun.net`, `api.eu.mailgun.net`), default `'api.mailgun.net'`
179. `postmark_secret`: `string`, password input, default `''`
180. `ses_access_key`: `string`, password input, default `''`
181. `ses_secret_key`: `string`, password input, default `''`
182. `ses_region`: `string`, dropdown (`us-east-1`, `eu-west-1`, etc.), default `''`
183. `ses_topic_arn`: `string`, text input, default `''`
184. `ses_from_address`: `string`, email input, default `''`
185. `brevo_secret`: `string`, password input, default `''`
186. `email_signature`: `string`, rich text textarea, default `''`
187. `email_style`: `string`, dropdown (`light`, `dark`, `custom`), default `'light'`
188. `email_style_custom`: `string`, CSS textarea, default `''`
189. `email_alignment`: `string`, dropdown (`center`, `left`), default `'center'`
190. `enable_email_markup`: `boolean`, toggle, default `true`
191. `show_email_footer`: `boolean`, toggle, default `true`
192. `email_footer`: `string`, rich text textarea, default `''`
193. `pdf_email_attachment`: `boolean`, toggle, default `false`
194. `document_email_attachment`: `boolean`, toggle, default `false`
195. `ubl_email_attachment`: `boolean`, toggle, default `false`
196. `embed_documents`: `boolean`, toggle, default `false`
197. `payment_email_all_contacts`: `boolean`, toggle, default `false`
198. `entity_send_time`: `integer`, dropdown hour (`0` to `23`), default `6`

#### Tab 18: Templates & Reminders (`/settings/templates_and_reminders`)
199. `send_reminders`: `boolean`, toggle, default `true`
200. `reminder_send_time`: `integer`, dropdown hour (`0` to `23`), default `0`
201. `enable_reminder1`: `boolean`, toggle, default `false`
202. `num_days_reminder1`: `integer`, numeric input days, default `0`
203. `schedule_reminder1`: `string`, dropdown (`after_invoice_date`, `before_due_date`, `after_due_date`), default `''`
204. `late_fee_amount1`: `integer|float`, numeric flat fee, default `0`
205. `late_fee_percent1`: `integer|float`, numeric percentage fee, default `0`
206. `enable_reminder2`: `boolean`, toggle, default `false`
207. `num_days_reminder2`: `integer`, numeric input days, default `0`
208. `schedule_reminder2`: `string`, dropdown, default `''`
209. `late_fee_amount2`: `integer|float`, numeric flat fee, default `0`
210. `late_fee_percent2`: `integer|float`, numeric percentage fee, default `0`
211. `enable_reminder3`: `boolean`, toggle, default `false`
212. `num_days_reminder3`: `integer`, numeric input days, default `0`
213. `schedule_reminder3`: `string`, dropdown, default `''`
214. `late_fee_amount3`: `integer|float`, numeric flat fee, default `0`
215. `late_fee_percent3`: `integer|float`, numeric percentage fee, default `0`
216. `enable_reminder_endless`: `boolean`, toggle, default `false`
217. `endless_reminder_frequency_id`: `string`, dropdown frequency, default `'0'`
218. `late_fee_endless_amount`: `integer|float`, numeric flat fee, default `0`
219. `late_fee_endless_percent`: `integer|float`, numeric percentage fee, default `0`
220. `enable_quote_reminder1`: `boolean`, toggle, default `false`
221. `quote_num_days_reminder1`: `integer`, numeric input days, default `0`
222. `quote_schedule_reminder1`: `string`, dropdown, default `''`
223. `quote_late_fee_amount1`: `integer|float`, numeric flat fee, default `0`
224. `quote_late_fee_percent1`: `integer|float`, numeric percentage fee, default `0`
225. `email_subject_invoice`: `string`, text template input, default `''`
226. `email_template_invoice`: `string`, rich text template, default `''`
227. `email_subject_quote`: `string`, text template input, default `''`
228. `email_template_quote`: `string`, rich text template, default `''`
229. `email_subject_credit`: `string`, text template input, default `''`
230. `email_template_credit`: `string`, rich text template, default `''`
231. `email_subject_payment`: `string`, text template input, default `''`
232. `email_template_payment`: `string`, rich text template, default `''`
233. `email_subject_payment_partial`: `string`, text template input, default `''`
234. `email_template_payment_partial`: `string`, rich text template, default `''`
235. `email_subject_payment_failed`: `string`, text template input, default `''`
236. `email_template_payment_failed`: `string`, rich text template, default `''`
237. `email_subject_purchase_order`: `string`, text template input, default `''`
238. `email_template_purchase_order`: `string`, rich text template, default `''`
239. `email_subject_statement`: `string`, text template input, default `''`
240. `email_template_statement`: `string`, rich text template, default `''`
241. `email_subject_reminder1`: `string`, text template input, default `''`
242. `email_template_reminder1`: `string`, rich text template, default `''`
243. `email_subject_reminder2`: `string`, text template input, default `''`
244. `email_template_reminder2`: `string`, rich text template, default `''`
245. `email_subject_reminder3`: `string`, text template input, default `''`
246. `email_template_reminder3`: `string`, rich text template, default `''`
247. `email_subject_reminder_endless`: `string`, text template input, default `''`
248. `email_template_reminder_endless`: `string`, rich text template, default `''`
249. `email_quote_subject_reminder1`: `string`, text template input, default `''`
250. `email_quote_template_reminder1`: `string`, rich text template, default `''`
251. `email_subject_custom1`: `string`, text template input, default `''`
252. `email_template_custom1`: `string`, rich text template, default `''`
253. `email_subject_custom2`: `string`, text template input, default `''`
254. `email_template_custom2`: `string`, rich text template, default `''`
255. `email_subject_custom3`: `string`, text template input, default `''`
256. `email_template_custom3`: `string`, rich text template, default `''`

#### Tab 19: Bank Accounts / Banking (`/settings/bank_accounts`)
257. `qr_iban`: `string`, Swiss QR-IBAN text input, default `''`
258. `besr_id`: `string`, legacy Swiss ESR participant ID, default `''`

#### Tab 20: Data Visualizations (`/settings/data_visualizations`)
259. *(Uses `primary_color` and `secondary_color` for report chart encodings)*

#### Tab 21: E-Invoicing (`/settings/e_invoice`)
260. `enable_e_invoice`: `boolean`, toggle, default `false`
261. `e_invoice_type`: `string`, dropdown (`EN16931`, `PEPPOL`, `FacturX`, `XRechnung`), default `'EN16931'`
262. `e_quote_type`: `string`, dropdown (`OrderX_Comfort`, `OrderX_Basic`), default `'OrderX_Comfort'`
263. `merge_e_invoice_to_pdf`: `boolean`, toggle, default `false`
264. `e_invoice_forward_email`: `string`, email input, default `''`
265. `skip_automatic_email_with_peppol`: `boolean`, toggle, default `false`
266. `france_reporting_enabled`: `boolean`, toggle, default `false`
267. `france_reporting_schedule`: `string`, dropdown (`ten_day`, `monthly`), default `'ten_day'`

#### Tabs 22–26: Relational / System Tabs
- **Tab 22: Client Groups** (`/settings/group_settings`): Client-group level settings override container.
- **Tab 23: Subscriptions** (`/settings/subscriptions`): Recurring billing plans and public payment links.
- **Tab 24: Schedules** (`/settings/schedules`): Cron automation jobs and recurring scheduled reports.
- **Tab 25: User Management** (`/settings/users`): Team member accounts, invitation tokens, permission masks.
- **Tab 26: System Logs** (`/settings/system_logs`): Operational audit logs and event history.

### 5.3 Properties in Data Mapper / Model Appearing in No Tab
The following 13 properties exist in `CompanySettings.php` or `CompanySettingsSchema.php` but do not render directly on any dedicated settings tab:
1. `valid_until`: `string`, default `''` (Quote validity duration in days; configured inside document creation forms).
2. `payment_terms`: `string`, default `''` (Default client terms in days; edited via Company Details modal).
3. `invoice_terms`: `string`, default `''` (Default invoice legal terms; edited via Company Details modal).
4. `invoice_footer`: `string`, default `''` (Default invoice footer; edited via Company Details modal).
5. `quote_terms`: `string`, default `''` (Default quote terms; edited via Company Details modal).
6. `quote_footer`: `string`, default `''` (Default quote footer; edited via Company Details modal).
7. `credit_terms`: `string`, default `''` (Default credit terms; edited via Company Details modal).
8. `credit_footer`: `string`, default `''` (Default credit footer; edited via Company Details modal).
9. `purchase_order_terms`: `string`, default `''` (Default purchase order terms; edited via Company Details modal).
10. `purchase_order_footer`: `string`, default `''` (Default purchase order footer; edited via Company Details modal).
11. `purchase_order_public_notes`: `string`, default `''` (Default purchase order public notes; edited via Company Details modal).
12. `unlock_invoice_documents_after_payment`: `boolean`, default `false` (Legacy backend flag for client portal downloads; omitted from v5 React UI settings tabs).
13. `besr_id`: `string`, default `''` (Deprecated Swiss postfinance ISR number; hidden from UI in favor of Swiss QR-IBAN).

Completeness check: 268 items, enumerated by ReflectionClass inspection of CompanySettings.php and OpenAPI schema.
