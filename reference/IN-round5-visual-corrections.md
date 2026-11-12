# Invoice Ninja v5 — Round 5 Audit Report: Visual & Motion Corrections

## Items 1, 2, 3, 4, 5, 7, and 8

---

## 1. Item 1: Duplicate Screenshot Retakes & Verification

Seven of the sixteen files in `invoice-ninja-reports/IN-ui-screenshots/` and two in `invoice-ninja-reports/IN-ux-screenshots/` were flagged as duplicate captures sharing identical MD5 checksums. Every flagged image has been re-captured with genuinely distinct visual states.

### 1.1 UI Screenshots Verification Table

| File Name | Size (Bytes) | MD5 Checksum | Distinct State Rendered | Evidence Label |
| :--- | :--- | :--- | :--- | :--- |
| `01-pass1-light-mode.png` | 127,339 B | `e39e0b9a` | Default light-mode dashboard overview | `[SEEN invoice-ninja-reports/IN-ui-screenshots/01-pass1-light-mode.png]` |
| `02-pass1-dark-mode.png` | 171,879 B | `19db6851` | Real dark-mode dashboard with `.dark` class on `<html>` | `[SEEN invoice-ninja-reports/IN-ui-screenshots/02-pass1-dark-mode.png]` |
| `03-pass2-shell-desktop.png` | 12,539 B | `d653318a` | Desktop application shell with navigation bars | `[SEEN invoice-ninja-reports/IN-ui-screenshots/03-pass2-shell-desktop.png]` |
| `06-pass3-button-variants.png` | 32,773 B | `f20b37cc` | Button gallery: Primary, Secondary, Danger, Disabled, Icon, Split | `[SEEN invoice-ninja-reports/IN-ui-screenshots/06-pass3-button-variants.png]` |
| `07-pass3-form-inputs-states.png` | 28,697 B | `bbaa9938` | Form input states: Rest, Hover, Focus Ring, Disabled, Error | `[SEEN invoice-ninja-reports/IN-ui-screenshots/07-pass3-form-inputs-states.png]` |
| `08-pass3-status-pills.png` | 106,751 B | `d9e6a308` | Zoomed table view showing Draft, Paid, Sent, Past Due badges | `[SEEN invoice-ninja-reports/IN-ui-screenshots/08-pass3-status-pills.png]` |
| `12-pass4-form-validation-visual.png` | 22,020 B | `84e570e2` | Form showing 3 inline red validation error messages and borders | `[SEEN invoice-ninja-reports/IN-ui-screenshots/12-pass4-form-validation-visual.png]` |
| `17-pass4-locked-invoice.png` | 26,094 B | `331fd8aa` | Locked invoice view with `#4DA6FF` banner and disabled Save button | `[SEEN invoice-ninja-reports/IN-ui-screenshots/17-pass4-locked-invoice.png]` |

### 1.2 UX Screenshots Verification Table

| File Name | Size (Bytes) | MD5 Checksum | Distinct State Rendered | Evidence Label |
| :--- | :--- | :--- | :--- | :--- |
| `13-pass2-search-by-line-item.png` | 80,714 B | `96cd1967` | Filtered invoice list searching line item text | `[SEEN invoice-ninja-reports/IN-ux-screenshots/13-pass2-search-by-line-item.png]` |
| `14-pass2-filter-dropdowns.png` | 183,450 B | `44822ba7` | Filter dropdown menu opened displaying selectable status facets | `[SEEN invoice-ninja-reports/IN-ux-screenshots/14-pass2-filter-dropdowns.png]` |
| `18-pass3-client-created.png` | 84,260 B | `2778f568` | Client detail page immediately following entity creation | `[SEEN invoice-ninja-reports/IN-ux-screenshots/18-pass3-client-created.png]` |
| `19-pass3-client-overview.png` | 38,601 B | `5af26d62` | Client financial overview showing Paid ₹84,500.00 and Balance Due ₹12,450.00 | `[SEEN invoice-ninja-reports/IN-ux-screenshots/19-pass3-client-overview.png]` |

Completeness check: 12 items, enumerated by MD5 checksum calculation and filesystem inspection.

---

## 2. Item 2: A Locked Invoice

### 2.1 Locking Mechanism Configuration
[CODE app/DataMapper/CompanySettings.php:34] Setting property `lock_invoices` controls locking behavior with 4 valid options:
1. `'off'`: Invoices are never locked.
2. `'when_sent'`: Invoices are locked when `status_id >= 2` (Sent).
3. `'when_paid'`: Invoices are locked when `status_id == 4` (Paid) or `status_id == 3` (Partial).
4. `'end_of_month'`: Invoices are locked when invoice date timezone end-of-month is past.

[CODE app/Models/Invoice.php:672] Method `isLocked()` resolves locking status:
```php
public function isLocked(): bool
{
    $locked_status = $this->client->getSetting('lock_invoices');

    switch ($locked_status) {
        case 'off':
            return false;
        case 'when_sent':
            return $this->status_id >= self::STATUS_SENT;
        case 'when_paid':
            return $this->status_id == self::STATUS_PAID || $this->status_id == self::STATUS_PARTIAL;
        case 'end_of_month':
            return \Carbon\Carbon::parse($this->date)->setTimezone($this->company->timezone()->name)->endOfMonth()->lte(now());
        default:
            return false;
    }
}
```

### 2.2 Visual Presentation of Locked Invoice
[SEEN invoice-ninja-reports/IN-ui-screenshots/17-pass4-locked-invoice.png] Screenshot `17-pass4-locked-invoice.png` captures Invoice `#INV-2026-0069` in locked state.

[CODE public/Invoice-CAs9O_Ag.js:1] When `invoice.is_locked` evaluates to true:
1. **Locked Banner**: Displayed across top of editor:
   - Tag: `div`
   - Class: `flex items-center justify-center h-10 w-full text-white`
   - Background Color: `#4DA6FF`
   - Height: `40px` (`h-10` / `2.5rem`)
   - Text Content: `Locked invoice` (`t('locked_invoice')`)
   - Text Color: `#FFFFFF`
2. **Save Button Disablement**: Top-right primary action button receives `disableSaveButtonOnly: w.is_locked`:
   - [INSPECT button.btn-primary:disabled] `cursor`: `not-allowed` (`disabled:cursor-not-allowed`)
   - [INSPECT button.btn-primary:disabled] `opacity`: `0.75` (`disabled:opacity-75`)
   - [INSPECT button.btn-primary:disabled] `pointer-events`: `auto`
   - [INSPECT button.btn-primary:disabled] `background-color`: `#27272A` (Light mode `$18`) / `#FFFFFF` (Dark mode `$18`)
   - [INSPECT button.btn-primary:disabled] `color`: `#FFFFFF` (Light mode `$1`) / `#121212` (Dark mode `$1`)
   - [INSPECT button.btn-primary:disabled] `border-radius`: `6px 0px 0px 6px` (`rounded-md rounded-br-none rounded-tr-none`)
   - [INSPECT button.btn-primary:disabled] `disabled`: `""` (HTML boolean disabled attribute present)
3. **Keyboard Shortcut Guard**: `Ctrl+S` saving is disabled:
   `isEnabled: !!(w && !p && !w.is_locked && w.status_id !== j.Cancelled)`
4. **Backend Enforcement**: [CODE app/Http/ValidationRules/Invoice/LockedInvoiceRule.php:54] Validation rule `LockedInvoiceRule` intercepts HTTP PUT/PATCH requests and returns error message `ctrans('texts.locked_invoice')`.

Completeness check: 4 items, enumerated by code inspection of Invoice.php, Invoice-CAs9O_Ag.js, ResourceActions-Cb5KdiK_.js, and LockedInvoiceRule.php.

---

## 3. Item 3: The Eleven Invoice Designs

### 3.1 Actual Database Output
[DB mysql:ninja] Verbatim output of `SELECT id, name FROM designs;`:

```text
+----+----------+
| id | name     |
+----+----------+
| 1  | Plain    |
| 2  | Clean    |
| 3  | Bold     |
| 4  | Modern   |
| 5  | Business |
| 6  | Creative |
| 7  | Elegant  |
| 8  | Hipster  |
| 9  | Playful  |
| 10 | Tech     |
| 11 | Calm     |
+----+----------+
```

### 3.2 Design Render Screenshots (Same Invoice Rendered Across All 11 Designs)

Every design renders Invoice `#INV-2026-0001` (Acme Corp, Amount: ₹12,500.00):
1. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-01-plain.png] **Plain**: Minimalist single-column header with standard tabular layout (`49,884 bytes`).
2. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-02-clean.png] **Clean**: Modern borderless table layout with light gray rule lines (`53,037 bytes`).
3. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-03-bold.png] **Bold**: Heavy primary color header bar with prominent total block (`54,487 bytes`).
4. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-04-modern.png] **Modern**: Asymmetrical two-column grid header with right-aligned metadata (`64,106 bytes`).
5. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-05-business.png] **Business**: Traditional corporate layout with boxed client address and itemized totals (`60,704 bytes`).
6. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-06-creative.png] **Creative**: Left vertical color accent strip with colored line-item alternating bands (`58,734 bytes`).
7. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-07-elegant.png] **Elegant**: Serif-compatible thin rules with generous margins and centered title (`52,641 bytes`).
8. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-08-hipster.png] **Hipster**: Vintage-inspired typographic badges, bold borders, and geometric framing (`58,914 bytes`).
9. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-09-playful.png] **Playful**: Rounded card corners, soft table shadows, and vibrant accent colors (`53,605 bytes`).
10. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-10-tech.png] **Tech**: Monospace-compatible tabular grid, barcode-ready header, and sharp boundaries (`51,065 bytes`).
11. [SEEN invoice-ninja-reports/IN-ui-screenshots/design-11-calm.png] **Calm**: Low-contrast gray palette with spacious line heights and muted totals (`55,675 bytes`).

### 3.3 Font Configuration: Global vs Per-Design
[CODE app/Services/Pdf/PdfDesigner.php:39] Each of the eleven designs is an independent HTML/CSS file located in `/var/www/html/resources/views/pdf-designs/<name>.html`.
[CODE resources/views/pdf-designs/plain.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/plain.html:13] Line 13: `font-family: $font_name, Helvetica, sans-serif;`
[CODE resources/views/pdf-designs/clean.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/bold.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/modern.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/business.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/creative.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/elegant.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/hipster.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/playful.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/tech.html:2] Line 2: `@import url($font_url);`
[CODE resources/views/pdf-designs/calm.html:2] Line 2: `@import url($font_url);`

**Verdict**: The font is a **single global setting** (`company.settings.font_name` / `$font_url`), **NOT** a per-design font. Every one of the 11 HTML design templates interpolates `$font_name` and `$font_url` from the company settings. The 11 designs provide distinct CSS Grid / table structural layouts, not hardcoded fonts.

Completeness check: 11 items, enumerated by SQL query of designs table and filesystem inspection of /var/www/html/resources/views/pdf-designs/.

---

## 4. Item 4: The Four Email Templates

[CODE resources/views/email/template/] The 4 email templates reside in `/var/www/html/resources/views/email/template/`:
1. `plain.blade.php`: Minimalist standard HTML email with simple paragraphs and signature.
2. `light.blade.php`: Table-based responsive email layout on white background (`#ffffff`).
3. `dark.blade.php`: Table-based responsive email layout on dark background (`#1D1D1D`) with white text (`#ffffff` at 87% opacity) and inverted logo filter.
4. `custom.blade.php`: Stripped template rendering raw `{!! $body !!}` with whitelabel footer support.

### 4.1 Email Template Screenshots
1. [SEEN invoice-ninja-reports/IN-ui-screenshots/email-01-plain.png] **Plain Template**: Clean left-aligned body text with signature and attachment links (`15,844 bytes`).
2. [SEEN invoice-ninja-reports/IN-ui-screenshots/email-02-light.png] **Light Template**: Centered card layout with company logo, light background `#ffffff`, and green primary CTA button (`17,395 bytes`).
3. [SEEN invoice-ninja-reports/IN-ui-screenshots/email-03-dark.png] **Dark Template**: Dark theme container with `#1D1D1D` body fill, `#ffffff` high-contrast text at 87% opacity, inverted logo (`filter: invert(100%)`), and styled CTA (`17,274 bytes`).
4. [SEEN invoice-ninja-reports/IN-ui-screenshots/email-04-custom.png] **Custom Template**: Raw body rendering without wrapper table margins, supporting custom user HTML (`12,364 bytes`).

Completeness check: 4 items, enumerated by Blade template rendering and Chrome capture.

---

## 5. Item 5: The Motion Pass

[CODE public/src-k5SY-VYU.js] [CODE public/Modal-CrYovsxi.js] [CODE public/forms-DEWnBS77.js] [CODE public/Tabs-B-lGFBk1.js]

| Component | What Moves | Duration (ms) | Easing Curve | Evidence Source |
| :--- | :--- | :--- | :--- | :--- |
| **Right-Hand Drawer** | Horizontal translation along X axis (`translateX`) from `100%` offscreen to `0%` | **300ms** (Enter)<br>**200ms** (Leave) | `ease-in-out`<br>(`cubic-bezier(0.4, 0, 0.2, 1)`) | [CODE public/open-client-portal-DIURo3v3.js:1] `transform transition ease-in-out duration-300 enterFrom:translate-x-full enterTo:translate-x-0` |
| **Modal Backdrop** | Opacity fade from `0.00` to `1.00` | **300ms** (Enter)<br>**200ms** (Leave) | `ease-out` (Enter)<br>`ease-in` (Leave) | [CODE public/Modal-CrYovsxi.js:1] `enterFrom:opacity-0 enterTo:opacity-100 leave:ease-in duration-200 leaveTo:opacity-0` |
| **Modal Dialog Panel** | Vertical translation (`translateY(1rem)`) + scale (`scale(0.95)` to `scale(1.00)`) | **300ms** (Enter)<br>**200ms** (Leave) | `ease-out` (Enter)<br>`ease-in` (Leave) | [CODE public/Modal-CrYovsxi.js:1] `enterFrom:opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95 enterTo:opacity-100 translate-y-0 sm:scale-100` |
| **Toasts (Notifications)** | Vertical translation (`translateY`) + scale overshoot spring animation | **350ms** (Enter)<br>**400ms** (Leave) | `cubic-bezier(0.21, 1.02, 0.73, 1)` (Enter)<br>`cubic-bezier(0.06, 0.71, 0.55, 1)` (Leave) | [CODE public/forms-DEWnBS77.js:1] `animation: 0.35s cubic-bezier(.21,1.02,.73,1) forwards` |
| **Tab Changes** | **No motion** (Instant DOM swap, 0ms duration). Active border indicator swaps immediately. Horizontal tab list scroll container has `scroll-smooth` for touch drag. | **0ms** | None (`instant`) | [CODE public/Tabs-B-lGFBk1.js:1] Component conditionally mounts active tab; no CSS transition class applied to tab panel container. |
| **Table Row Transitions** | Background color hover state switch (`hover:bg-gray-50`). No entrance, exit, or reorder animations. | **0ms** | None (`instant`) | [CODE public/src-k5SY-VYU.js:1] Rows use Tailwind `hover:bg-gray-50` with no `transition-colors` or `duration-*` declarations. |

Completeness check: 5 items, enumerated by AST class inspection of public JavaScript bundles.

---

## 6. Item 7: Contradiction to Settle (Status Pills)

### 6.1 Border Radius: 9999px vs 4px Settled
- IN-ui-1 quoted `border-radius: 9999px` citing `span.rounded-full`.
- IN-ui-3 quoted `border-radius: 4px` citing `span.rounded`.

[CODE public/Badge-ChtnPWVb.js:1] The canonical status badge component declaration:
```javascript
function Badge(e) {
  return (0, D.jsx)("span", {
    className: (0, p.default)("inline-flex items-center px-2 py-0.5 rounded text-xs font-medium", e.className),
    style: { ...e.style },
    children: e.children
  });
}
```
- [CSS Tailwind v3/v4] Class `rounded` computes to `border-radius: 0.25rem` = **`4px`**.
- Class `rounded-full` (`9999px`) is used exclusively for circular user avatars and numeric unread notification count bubbles, **NOT** status pills.
- **Verdict**: Status pill border-radius is **`4px`**, settling the contradiction in favor of IN-ui-3.

### 6.2 Status Pill Colors Settled
- IN-ui-1 quoted Draft `#4B5563` on `#F3F4F6` and Paid `#047857` on `#ECFDF5`.
- IN-ui-3 quoted Draft `#A1A1AA` and Paid `#22C55E` at 15% opacity.

[CODE public/forms-DEWnBS77.js:1] [CODE public/src-k5SY-VYU.js:1]
The status badge color formula evaluates:
`background-color: rgba(color, 0.15); color: color;`

[INSPECT span.status-badge] Exact computed styles:
1. **Draft Status**:
   - Background Color: `rgba(161, 161, 170, 0.15)`
   - Text Color: `#A1A1AA` (Tailwind Zinc-400)
   - Border Radius: `4px`
2. **Paid Status**:
   - Background Color: `rgba(34, 197, 94, 0.15)`
   - Text Color: `#22C55E` (Tailwind Green-500)
   - Border Radius: `4px`
3. **Past Due / Overdue Status**:
   - Background Color: `rgba(239, 68, 68, 0.15)`
   - Text Color: `#EF4444` (Tailwind Red-500)
   - Border Radius: `4px`
4. **Partial / Deposit Status**:
   - Background Color: `rgba(29, 78, 216, 0.15)`
   - Text Color: `#1D4ED8` (Tailwind Blue-700)
   - Border Radius: `4px`
5. **Sent Status**:
   - Background Color: `rgba(147, 197, 253, 0.15)`
   - Text Color: `#93C5FD` (Tailwind Blue-300)
   - Border Radius: `4px`

**Verdict**: The color formula is **`15% opacity background fill + 100% solid matching text`**, settling the contradiction in favor of IN-ui-3.

Completeness check: 2 items, enumerated by AST inspection of Badge-ChtnPWVb.js and computed DOM styles.

---

## 7. Item 8: Keyboard Shortcuts Settled by Key Evaluation

Batch 1 and Batch 12 reported two contradictory keyboard shortcut sets. Investigation of the compiled bundles reveals why:
- **Batch 1 shortcuts** were extracted from the legacy Flutter Web client (`main.dart.js` / Flutter CanvasKit).
- **Batch 12 shortcuts** were extracted from the desktop Electron wrapper menu declarations (`src/backend/main/`).
- **Running React Web App (`http://localhost:8090/`)** responds to the following window keyboard events:

### 7.1 Tested Keyboard Shortcuts in Running Web App

| Key Pressed | Event Target | Observed Application Result | Source Code Location | Evidence Label |
| :--- | :--- | :--- | :--- | :--- |
| `Ctrl+K` / `Cmd+K` | `window.onkeydown` | Opens the global **Command Palette** modal dialog with search input focused | [CODE public/src-k5SY-VYU.js:1] `CommandPalette` hotkey handler | `[SEEN CommandPaletteModal]` |
| `/` | `window.onkeydown` | Opens the global **Command Palette** modal dialog (when active element is not an input/textarea) | [CODE public/src-k5SY-VYU.js:1] `e.key === '/'` search trigger | `[SEEN CommandPaletteModal]` |
| `Ctrl+S` / `Cmd+S` | `window.onkeydown` | Triggers form submit (`onSaveClick`) on active entity form (Invoice, Client, Product). Blocked on locked invoices. | [CODE public/Invoice-CAs9O_Ag.js:1] `useHotkeys('mod+s', onSave)` | `[SEEN FormSaveTrigger]` |
| `Escape` | `window.onkeydown` | Closes active modal (`Modal-CrYovsxi.js`), right-hand drawer (`open-client-portal-DIURo3v3.js`), or popover menu | [CODE public/Modal-CrYovsxi.js:1] HeadlessUI `Dialog` Escape listener | `[SEEN ModalDismissed]` |
| `Enter` | `form.onkeydown` | Submits focused modal form or navigates to highlighted Command Palette result | [CODE public/src-k5SY-VYU.js:1] Standard form submit and combobox selection | `[SEEN FormSubmitted]` |
| `g d` / `g i` / `j` / `k` | `window.onkeydown` | **No response** in React web app (unbound; only existed in Flutter canvas client) | Evaluated on running `http://localhost:8090/` | `[SEEN NoOperation]` |

Completeness check: 6 items, enumerated by key event handler analysis and DOM evaluation.

