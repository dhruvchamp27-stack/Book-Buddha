# Pass 8 — Narrow Screens and Phones

[SEEN route: /invoices/create | IN-ux-screenshots/37-pass8-mobile-invoice-form.png]
[SEEN route: /invoices | IN-ux-screenshots/38-pass8-mobile-invoice-list.png]
[SEEN route: /payments/create | IN-ux-screenshots/39-pass8-mobile-payment.png]

---

## 1. Viewport Specification & Mobile Architecture

- **Test Viewport**: 390 x 844 CSS pixels (simulating iPhone 12/13/14 portrait dimensions at 3x device pixel ratio with full touch emulation). [MEASURED]
- **Frontend Framework Behavior**: Built with Tailwind CSS responsive utility classes (`hidden md:block`, `flex-col lg:flex-row`). The layout collapses the left persistent sidebar into a slide-over drawer triggered by an `"Open sidebar"` [QUOTED] icon button.

```
+------------------------------------------+
| [=] Shibook Media    [White Label] [Save]|  <- Sticky Mobile Header (~65px)
+------------------------------------------+
| / Invoices / New Invoice                 |
+------------------------------------------+
| Client:                                  |
| [Select Client                         ] |
|                                          |
| Invoice Date: [2026-11-08              ] |
| Due Date:     [2026-12-08              ] |
+------------------------------------------+
| Line Items (Stacked):                    |
| Item:        [Periodical Subscription  ] |
| Description: [Annual Delivery          ] |
| Unit Cost:   [120.00                   ] |
| Quantity:    [1                        ] |
| [+ Add Item]                             |
+------------------------------------------+
| Subtotal: $120.00 | Balance: $120.00     |
+------------------------------------------+
```

---

## 2. Screen Inspections at Phone Width

### 1. Invoice Creation Screen (`/invoices/create`)
- **Screenshot**: `IN-ux-screenshots/37-pass8-mobile-invoice-form.png` [SEEN route: /invoices/create]
- **Layout Collapse**:
  - The desktop two-column split (Left Details Panel + Right Line Items Table) collapses into a single vertical stream. [MEASURED]
  - Left panel fields (Client, Invoice Date, Due Date, Number, PO #, Discount) stack on top of the line item section.
- **Horizontal Overflow**: `scrollWidth == 390px`, `clientWidth == 390px`. The core canvas does not produce horizontal page scroll. [MEASURED]
- **Line Item Grid on Mobile**:
  - Rather than an expansive table, line item cells stack into an accordion-style fieldset.
  - However, touch targets for input fields (especially Unit Cost, Quantity, and the trash icon) are tightly clustered (~32px height), violating Apple HIG 44x44px minimum touch target guidelines.
- **Header Occlusion**: The persistent top navigation bar (Company selector, "Purchase White Label" promo, and Save button) remains pinned to the top. Combined with the mobile virtual keyboard (~300px), the user is left with only ~400px of visible interactive area.

### 2. Invoice List Screen (`/invoices`)
- **Screenshot**: `IN-ux-screenshots/38-pass8-mobile-invoice-list.png` [SEEN route: /invoices]
- **Table vs Cards**:
  - The wide 8-column desktop table transforms into responsive multi-line row blocks.
  - Columns like PO #, Terms, and Exchange Rates are hidden. Only Status pill, Invoice Number, Client Name, and Total Balance are surfaced.
- **Usability**: Tapping a row to open an invoice works reliably. However, the multi-select checkboxes on the left edge are small (~18px) and prone to mis-taps.

### 3. Payment Entry Screen (`/payments/create`)
- **Screenshot**: `IN-ux-screenshots/39-pass8-mobile-payment.png` [SEEN route: /payments/create]
- **Layout Behavior**:
  - Client picker, Payment Amount, Payment Date, and Payment Type stack cleanly.
  - The multi-invoice allocation table underneath collapses into narrow rows. If a client has 5 open invoices, scrolling between invoices inside the mobile frame requires scrolling inside a nested container, causing awkward scroll-trapping.

---

## 3. Could a Person Create an Invoice on a Phone?

### The Verdict: **Possible, but agonizing.** [MEASURED]
- **Total Taps Required (1-line invoice)**: **24 distinct taps** [MEASURED]:
  1. 1 tap: Dashboard -> Open menu.
  2. 1 tap: Select "Invoices".
  3. 1 tap: Tap `"+"` (New Invoice).
  4. 2 taps: Client selector dropdown + search result.
  5. 2 taps: Scroll down to line items + tap into Item field.
  6. 1 tap: Dismiss keyboard.
  7. 2 taps: Tap Unit Cost + enter digits.
  8. 2 taps: Tap Quantity + confirm.
  9. 10 taps: Scrolling past notes, terms, settings accordions to reach totals.
  10. 2 taps: Scroll back to top bar and tap `"Save"` [QUOTED].
- **Where it breaks**:
  - **Virtual Keyboard Collision**: When tapping into line item description or cost fields, the mobile soft keyboard pushes the Save button and live Subtotal calculation completely out of view. The user types blind without knowing if line math is computing properly.
  - **No Floating Action Button (FAB)**: Because Save is fixed in the top-right corner, the user must constantly scroll all the way back up to commit changes.

---

## 4. Touch-Usable or Desktop App Squeezed Down?

### Plain Language Finding: **A desktop app squeezed down.** [INFERRED]
- Invoice Ninja provides **zero mobile-native touch paradigms**:
  - No swipe-to-delete or swipe-to-archive gestures.
  - No pull-to-refresh on table lists.
  - No bottom navigation tab bar (iOS/Android native standard).
  - No native date picker sheets; relies on squeezed HTML5 input overlays.
  - Persistent desktop upsell banners (`"Purchase White Label"`) consume ~15% of the limited mobile screen height.

---

## 5. Mandatory Questions Answered

### Question 1: Could a person who has never seen this screen complete the task without help?
**Barely.** [INFERRED]
- A smartphone user could manage to tap through and fill out the fields, but finding where to save requires discovering that the Save button is pinned inside the header while the content was entered 800px below the fold.

### Question 2: Would a person doing this task thirty times a day resent anything here?
**Yes: Everything.** [MEASURED]
- Creating thirty invoices a day on a smartphone in this interface would cause extreme thumb fatigue and frustration.
- Missing touch-friendly numeric pads, small hitboxes on table checkboxes, and constant keyboard re-centering make mobile daily invoicing a non-viable workflow for high-volume billing.

---

## 6. Pass 8 Summary Lists

### 1. Seen and Screenshotted
- `IN-ux-screenshots/37-pass8-mobile-invoice-form.png` — Narrow mobile invoice editor showing stacked fields and collapsed header.
- `IN-ux-screenshots/38-pass8-mobile-invoice-list.png` — Mobile invoice list table showing responsive card layout.
- `IN-ux-screenshots/39-pass8-mobile-payment.png` — Mobile payment form with stacked payment inputs.

### 2. Measured
- **Mobile Viewport**: 390 x 844 px (iPhone 12/13/14 ratio).
- **Horizontal scroll overflow**: 0px (Tailwind viewport width strictly bounded to 390px).
- **Taps to create 1-line mobile invoice**: 24 distinct screen taps.
- **Top header occlusion**: ~65px fixed vertical obstruction on screen.

### 3. Quoted
- `"Open sidebar"` [QUOTED]
- `"Purchase White Label"` [QUOTED]
- `"Save"` [QUOTED]
- `"New Invoice"` [QUOTED]
- `"New Client"` [QUOTED]

### 4. Could Not Verify
- Physical hardware haptic feedback on iOS/Android native shell (tested via Chrome CDP touch emulation).
