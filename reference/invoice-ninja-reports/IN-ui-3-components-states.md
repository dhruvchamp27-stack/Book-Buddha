# Pass 3 — The Component Library, Atom by Atom

[SEEN route: /invoices/create | IN-ui-screenshots/06-pass3-button-variants.png]
[SEEN route: /invoices/create | IN-ui-screenshots/07-pass3-form-inputs-states.png]
[SEEN route: /invoices | IN-ui-screenshots/08-pass3-status-pills.png]
[SEEN route: /invoices/create | IN-ui-screenshots/09-pass3-modal-drawer.png]

---

## 1. Overview of the UI Component System

Invoice Ninja's React frontend relies on a consistent set of unstyled primitives (primarily Headless UI) styled with Tailwind CSS utility classes and controlled via runtime context tokens (`public/forms-DEWnBS77.js`). Every component adheres to an 8px grid alignment and a 6px default corner radius (`rounded-md`).

---

## 2. Reusable Component Inventory

### Component 1: Buttons (`Button.tsx`)
- **Where it appears**: Global headers, modal footers, table toolbars, form action bars.
- **Sizes**:
  - `sm`: Height `32px` (`py-1.5 px-3`), `font-size: 12px`, `border-radius: 6px`.
  - `md` (Standard Default): Height `38.4px` (`py-2 px-4`), `font-size: 14px`, `border-radius: 6px`. [INSPECT]
  - `lg`: Height `44px` (`py-2.5 px-6`), `font-size: 16px`, `border-radius: 6px`.
- **Variants and States**:

| Variant | State | Background Hex / Class | Text Hex | Border Value | Shadow |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Primary** | Default | `#121212` (`bg-black` / `bg-[#121212]`) [INSPECT] | `#FFFFFF` | `none` | `shadow-sm` |
| | Hover | `#27272A` (`hover:bg-zinc-800`) [INSPECT] | `#FFFFFF` | `none` | `shadow` |
| | Focus | `#121212` | `#FFFFFF` | `none` | `ring-2 ring-black ring-offset-2` |
| | Active | `#09090B` (`active:bg-zinc-950`) | `#FFFFFF` | `none` | `none` |
| | Disabled | `#121212` (`opacity-50 cursor-not-allowed`) | `#FFFFFF` | `none` | `none` |
| **Secondary (White)** | Default | `#FFFFFF` (Dark: `#121212`) [INSPECT] | `#2A303D` | `1px solid #D1D5DB` | `shadow-sm` |
| | Hover | `#F4F4F5` (Dark: `#1F2E41`) [INSPECT] | `#2A303D` | `1px solid #D1D5DB` | `shadow-sm` |
| | Focus | `#FFFFFF` | `#2A303D` | `1px solid #03B2CB` | `ring-2 ring-cyan-500/20` |
| | Disabled | `#F4F4F5` (`opacity-60 cursor-not-allowed`) | `#A1A1AA` | `1px solid #E5E7EB` | `none` |
| **Danger** | Default | `#DC2626` (`bg-red-600`) [INSPECT] | `#FFFFFF` | `none` | `shadow-sm` |
| | Hover | `#B91C1C` (`bg-red-700`) [INSPECT] | `#FFFFFF` | `none` | `shadow` |
| | Focus | `#DC2626` | `#FFFFFF` | `none` | `ring-2 ring-red-500 ring-offset-2` |
| **Icon Button** | Default | `transparent` [INSPECT] | `#717179` | `none` | `none` |
| | Hover | `#09090B0D` (`hover:bg-black/5 rounded-full`) | `#2A303D` | `none` | `none` |

---

### Component 2: Text Inputs & Numeric Fields (`InputField.tsx`)
- **Where it appears**: Invoice details panel, client form, product catalog, search bars.
- **Dimensions**: Height `37.33px` (`border-box`), padding `8px 12px`, `border-radius: 6px`. [INSPECT]
- **Typography**: `font-size: 14px`, `line-height: 20px`, `font-weight: 400`, color `#2A303D`. [INSPECT]
- **States**:
  - **Default**: `background: #FFFFFF`, `border: 1px solid rgba(9, 9, 11, 0.15)` (`border-[#09090B26]`), placeholder `#A1A1AA`. [CSS public/TaskDetails-CB1g_RPj.js:1]
  - **Hover**: `border-color: rgba(9, 9, 11, 0.3)`.
  - **Focus**: `border-color: #000000` (Light) / `#FFFFFF` (Dark), `outline: none`, `box-shadow: none` (relies on sharp border contrast).
  - **Disabled**: `opacity-75 cursor-not-allowed background: #F4F4F5`.
  - **Error**: `border-color: #EF4444`, `box-shadow: 0 0 0 1px #EF4444`.

---

### Component 3: Typeaheads & Comboboxes (`Combobox.tsx`)
- **Where it appears**: Client picker, Product picker, Currency and Country dropdowns.
- **Trigger**: Behaves identically to a text input with an inline search glyph or right-hand `ChevronDown` (`16x16px`, `#717179`).
- **Flyout Menu**:
  - `position: absolute; z-index: 50; width: 100%; margin-top: 4px;`
  - `background: #FFFFFF; border: 1px solid #E5E7EB; border-radius: 6px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);`
  - Max height: `240px` (`max-h-60 overflow-y-auto`).
- **Option Item**:
  - `padding: 8px 12px; font-size: 14px; color: #2A303D; cursor: pointer;`
  - Hover / Highlighted: `background: #F4F4F5; color: #000000;`
  - Selected state: Appends an inline checkmark icon (`Check` `#03B2CB`).

---

### Component 4: Checkboxes & Switches
- **Checkbox**:
  - Dimensions: `16px x 16px` (`w-4 h-4`), `border-radius: 4px` (`rounded`).
  - Default: `border: 1px solid #D1D5DB; background: #FFFFFF;`
  - Checked: `background: #000000; border-color: #000000; color: #FFFFFF;` (SVG checkmark rendered in white).
  - Focus: `focus:ring-0 focus:outline-none`.
- **Toggle Switch**:
  - Track: Width `44px` (`w-11`), Height `24px` (`h-6`), `border-radius: 9999px` (`rounded-full`).
  - Unchecked track: `#E5E7EB` (`bg-gray-200`).
  - Checked track: `#000000` (`bg-black`) or user accent.
  - Thumb: `20px x 20px`, `background: #FFFFFF`, `border-radius: 50%`, `box-shadow: 0 1px 3px rgba(0,0,0,0.2)`. Translates `20px` right upon activation (`transition-transform duration-200`).

---

### Component 5: Document Status Pills (`Badge.tsx` / `EntityStatus.tsx`)
All document badges follow a mathematical formula: **15% opacity background fill + 100% solid matching text color**, with `border-radius: 4px` (`rounded`), `padding: 4px 8px`, `font-size: 12px` (`text-xs`), and `font-weight: 500`. [CSS public/Badge-ChtnPWVb.js:1]

| Document Entity | Status Label | Badge Variant | Text Hex | Background Fill Hex / Alpha |
| :--- | :--- | :--- | :--- | :--- |
| **Invoice / Quote / Credit** | `Draft` [QUOTED] | `generic` | `#A1A1AA` | `rgba(161, 161, 170, 0.15)` |
| **Invoice / Quote** | `Sent` [QUOTED] | `blue` | `#60A5FA` (`blue-400`) | `rgba(96, 165, 250, 0.15)` |
| **Invoice** | `Paid` [QUOTED] | `green` | `#22C55E` (`green-500`) | `rgba(34, 197, 94, 0.15)` |
| **Invoice** | `Partial` [QUOTED] | `yellow` | `#EAB308` (`yellow-500`)| `rgba(234, 179, 8, 0.15)` |
| **Invoice** | `Past Due / Overdue` [QUOTED]| `red` | `#EF4444` (`red-500`) | `rgba(239, 68, 68, 0.15)` |
| **Invoice** | `Cancelled / Reversed` [QUOTED]| `black` | `#6B7280` (`gray-500`) | `rgba(107, 114, 128, 0.15)` |
| **Quote** | `Approved` [QUOTED] | `green` | `#22C55E` (`green-500`) | `rgba(34, 197, 94, 0.15)` |
| **Quote** | `Converted` [QUOTED] | `purple` | `#A855F7` (`purple-500`)| `rgba(168, 85, 247, 0.15)` |
| **Quote** | `Expired` [QUOTED] | `red` | `#EF4444` (`red-500`) | `rgba(239, 68, 68, 0.15)` |
| **Payment** | `Completed` [QUOTED] | `green` | `#22C55E` (`green-500`) | `rgba(34, 197, 94, 0.15)` |
| **Payment** | `Partially Unapplied` [QUOTED]| `orange` | `#F97316` (`orange-500`)| `rgba(249, 115, 22, 0.15)` |
| **Payment** | `Refunded` [QUOTED] | `black` | `#6B7280` (`gray-500`) | `rgba(107, 114, 128, 0.15)` |

**Critical Audit Answer**: Is document status ever shown by colour alone without text?
**NO.** Status is always rendered as an enclosed rectangular pill with explicit text label characters. Color alone is never used to convey document standing.

---

### Component 6: Modals & Right-Hand Drawers (`Modal.tsx`)
- **Backdrop**: `fixed inset-0 bg-black/50 backdrop-blur-sm z-50` [INSPECT]
- **Modal Dialog Box**:
  - `background: #FFFFFF` (Dark: `#121212`) [INSPECT]
  - `border-radius: 8px` (`rounded-lg`) [INSPECT]
  - `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1)` (`shadow-xl`) [INSPECT]
  - Max width: `512px` (`max-w-lg`) for alerts; `768px` (`max-w-3xl`) for entity creation sheets.
  - Internal padding: `24px` (`p-6`).
- **Right-Hand Drawer (Activity & History Slideover)**:
  - `position: fixed; top: 0; right: 0; bottom: 0; width: 384px;` (`w-96`)
  - `background: #FFFFFF; box-shadow: -10px 0 25px -5px rgba(0,0,0,0.1); z-index: 50;`
  - Header: `h-16 px-6 border-b border-gray-200 flex items-center justify-between`.

---

### Component 7: Toasts and Floating Alerts
- **Position**: `fixed top-4 right-4 z-50 flex flex-col space-y-2`.
- **Dimensions**: Min width `320px`, max width `420px`, `border-radius: 6px`, `box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1)`.
- **Variants**:
  - **Success Toast** (`"Successfully saved invoice"`): `background: #ECFDF5; border-left: 4px solid #10B981; color: #065F46;`
  - **Error Toast** (`"Something went wrong"`): `background: #FEF2F2; border-left: 4px solid #EF4444; color: #991B1B;`
- **Dismiss Control**: Right-aligned `XMark` icon (`16px`, `hover:opacity-75`). Auto-dismisses after `4000ms`.

---

## 3. Closing Lists

### 1. Measured from Code
- Button classes: `public/forms-DEWnBS77.js:1`
- Badge variant mappings: `public/Badge-ChtnPWVb.js:1`
- Status codes: `public/invoice-status-DCQE8V8S.js:1`
- Tailwind input styles: `public/src-Cls2ms66.css:1-120`

### 2. Measured in the Browser
- Button height: [INSPECT `/invoices/create` | `button[type="submit"]` -> `38.4px`]
- Input border & radius: [INSPECT `/invoices/create` | `input[name="number"]` -> `6px radius; 37.33px height`]
- Status pill metrics: [INSPECT `/invoices` | `span.rounded` -> `font-size: 12px; padding: 4px 8px; border-radius: 4px`]

### 3. Screenshotted
- `IN-ui-screenshots/06-pass3-button-variants.png` — Button variants on invoice form.
- `IN-ui-screenshots/07-pass3-form-inputs-states.png` — Input focus and active states.
- `IN-ui-screenshots/08-pass3-status-pills.png` — Table status pills across invoice rows.
- `IN-ui-screenshots/09-pass3-modal-drawer.png` — Inline modal dialog.

### 4. Could Not Verify
- Indeterminate checkbox tri-state rendering (used only binary checked/unchecked in transaction reconciling).
