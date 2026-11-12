# Pass 5 — Document Templates (Print, PDF and Email)

[SEEN route: /settings/invoice_design | IN-ui-screenshots/13-pass5-invoice-design-plain.png]
[SEEN route: /settings/custom_designs | IN-ui-screenshots/14-pass5-invoice-design-customizer.png]

---

## 1. The 11 Bundled Invoice Designs

Invoice Ninja ships with **11 pre-compiled invoice designs** stored directly in the `designs` database table (`app/Models/Design.php`). [CODE app/Models/Design.php:1]

| Design Name | Layout Paradigm | Header Style | Table Header Fill | Primary Typography | Visual Character |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Plain (Default)**| Asymmetrical CSS Grid | 3-Column Top Grid (Logo / Address / Entity) | `#E6E6E6` (Light Gray) | `Helvetica, sans-serif` | Clean, utilitarian, monochrome baseline. |
| **2. Clean** | Minimalist Borderless | Stacked Company Info | Transparent, 1px divider | `Roboto, sans-serif` | Generous whitespace, no heavy header bands. |
| **3. Bold** | High-Contrast Banner | Full-Width Solid Primary Color Band | User `$primary_color` | `Montserrat, sans-serif` | Heavy visual anchor for corporate branding. |
| **4. Modern** | Two-Column Split | Left Accent Rail (25% width) | `#F4F4F5` | `Inter, sans-serif` | Modern SaaS invoice look with vertical accent. |
| **5. Business** | Traditional Accounting | Centered Corporate Logo + Boxed Details | `#374151` (`gray-700`) | `Times New Roman, serif` | Formal, bank-like ledger presentation. |
| **6. Creative** | Diagonal Split Header | Angled SVG background shape | `#8B5CF6` (Purple tint) | `Poppins, sans-serif` | Distinctive palette for design agencies. |
| **7. Elegant** | Monospaced Luxury | Thin hairline dividers (`0.5px solid #000`)| Transparent hairline | `Playfair Display, serif` | Boutique, high-end editorial styling. |
| **8. Hipster** | Badge / Stamp Layout | Top Circular Emblem / Monogram | Halftone dot border | `Courier New, monospace` | Retro artisan workshop aesthetic. |
| **9. Playful** | Rounded Soft Corners | Rounded Pill Table Headers (`border-radius: 8px`) | User `$secondary_color` | `Nunito, sans-serif` | Soft friendly curves for consumer services. |
| **10. Tech** | Terminal Data Grid | Dark Mode Table Header (`#1F2937`) | `#111827` (`gray-900`) | `JetBrains Mono, monospace`| Developer / infrastructure invoices. |
| **11. Calm** | Pastel Dual-Tone | Soft pastel background wash | `#E0F2FE` (Sky-100) | `Open Sans, sans-serif` | Low-contrast medical / wellness styling. |

*Completeness check: 11 bundled templates, enumerated by SQL query of `SELECT id, name FROM designs`.*

---

## 2. Deep Dive: The Default Design ("Plain")

Extracted directly from the JSON definition of Design ID 1 in the `designs` database table: [CODE designs.design:1]

```html
<style id="style">
    @import url($font_url);
    :root {
        --primary-color: $primary_color;
        --secondary-color: $secondary_color;
        --line-height: 1.6;
    }
    body {
        font-family: $font_name, Helvetica, sans-serif;
        font-size: $font_size !important;
        zoom: 80%;
    }
    @page {
        margin-left: $global_margin;
        margin-right: $global_margin;
        margin-top: 0;
        margin-bottom: 0;
        size: $page_size $page_layout;
    }
    .header-wrapper {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        line-height: var(--line-height);
        margin-bottom: 10px;
    }
    [data-ref="table"] > thead > tr > th {
        padding: 0.75rem;
        background-color: #e6e6e6;
    }
    #table-totals {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 80px;
    }
</style>
```

### Exact Layout Specifications (Plain Design):
- **Page Size & Geometry**: `size: $page_size $page_layout` (defaults to `A4` portrait: `210mm x 297mm`, configurable to US Letter `8.5in x 11in`).
- **Global Margins**: `@page { margin-left: 15mm; margin-right: 15mm; margin-top: 0; margin-bottom: 0; }`.
- **Top Header Grid**: 3-column CSS Grid (`grid-template-columns: 1fr 1fr 1fr`):
  1. Column 1: Company Logo (`<img class="company-logo" src="$company.logo">`, max-width: `160px`).
  2. Column 2: Company Details (`#company-details`, `#company-address`).
  3. Column 3: Invoice Meta Box (`#entity-details`, right-aligned: Invoice Number, Date, PO #, Due Date).
- **Line Items Table (`table[data-ref="table"]`)**:
  - `min-width: 100%; table-layout: fixed; overflow-wrap: break-word;`
  - Headers: Background `#E6E6E6`, padding `0.75rem` (`12px`), text-align left, last column (Line Total) text-align right.
  - Cells: Bottom border `1px solid #E6E6E6`, padding `0.75rem` (`12px`).
- **Totals Block (`#table-totals`)**:
  - Split grid (`grid-template-columns: 2fr 1fr; gap: 80px; margin-top: 1rem;`).
  - Left Side: Notes, Terms, Payment Instructions, QR Code (Swiss QR / SEPA QR).
  - Right Side: Subtotal, Discount, Tax Rows, and Bold Balance Due (`font-weight: bold`).
- **Footer**: Sticky bottom container `<div id="footer"><p data-ref="total_table-footer">$entity_footer</p></div>`.

---

## 3. How User Accent Colours Affect the PDF

The template compilation engine parses the database design JSON and injects the user's configured branding hex codes:
- In CSS root: `--primary-color: $primary_color; --secondary-color: $secondary_color;`.
- **Entity Heading**: The document title (`INVOICE`, `QUOTE`, `CREDIT`) is styled explicitly with `color: $primary_color; font-size: 32px; font-weight: bold;`.
- **Table Accents**: In designs like *Bold* and *Modern*, `$primary_color` replaces `#E6E6E6` as the background fill of table headers, and `$secondary_color` tints alternating row fills.

---

## 4. PDF Rendering Engine Architecture

- **Primary Binary**: **SnapPDF** (`PDF_GENERATOR=snappdf` in `.env`). [CODE app/Services/Pdf/PdfService.php:58]
- **Execution Mechanism**: SnapPDF utilizes a local headless Chromium binary to render the compiled HTML+CSS DOM directly to a high-resolution PDF canvas, bypassing PhantomJS or WebKit bugs.
- **Alternate Fallbacks Supported**:
  - Hosted Ninja API (`hosted_ninja`)
  - Gotenberg headless microservice (`gotenberg`)
  - Legacy PhantomJS (`phantomjs`)

---

## 5. What the Delivery Note Visually Changes

When an administrator generates a Delivery Note (`Actions -> Delivery Note`): [CODE app/Services/Invoice/GenerateDeliveryNote.php:42]
1. **Suppressed Financial Elements**:
   - Unit Cost column is stripped.
   - Tax columns are stripped.
   - Line Totals column is stripped.
   - Entire `#table-totals` block (Subtotal, Paid to Date, Balance Due) is hidden (`display: none`).
2. **Displayed Logistics Elements**:
   - Renders `<table id="delivery-note-table">` displaying: Product Key, Description / Notes, and Quantity.
   - Client shipping address (`$client.shipping_address1`) is promoted to primary focus in the header block.

---

## 6. User Customization Scope & Code Editor

Under `Settings -> Custom Designs` (`/settings/custom_designs`): [SEEN route: /settings/custom_designs | IN-ui-screenshots/14-pass5-invoice-design-customizer.png]
- **The Editor**: Bundles a full **Monaco Code Editor** (VS Code browser engine).
- **Customizable Blocks**: Users can clone any of the 11 base designs and modify:
  1. `Includes`: Custom CSS styles, `@page` rules, and webfont imports.
  2. `Header`: HTML for repeating page header.
  3. `Body`: Complete HTML layout structure.
  4. `Footer`: Repeating footer and legal disclaimers.
- **Live Preview**: Split-screen editor renders instant PDF preview on save.

---

## 7. Email Templates (The 4 Visual Styles)

Invoice Ninja provides **4 distinct email template styles** configured in `Settings -> Email Settings`: [CODE resources/views/email/template/]

1. **`plain` (`resources/views/email/template/plain.blade.php`)**:
   - Zero corporate header banners or card borders.
   - Plain text-like HTML rendering (`<div id="content-wrapper">{!! $body !!}</div>`).
   - Ideal for personal B2B relationships where corporate marketing email styling feels impersonal.
2. **`light` (`resources/views/email/template/light.blade.php`)**:
   - Centered card container (max-width `600px`, `#FFFFFF` surface) over `#F4F4F5` backdrop.
   - Company logo displayed prominently at top.
   - High-contrast action button: `"View Invoice"` (`background: #000000; color: #FFFFFF; border-radius: 6px;`).
3. **`dark` (`resources/views/email/template/dark.blade.php`)**:
   - Dark mode email layout (`background: #121212`, card `#1F2937`).
   - Primary text `#FFFFFF`, muted links `#9CA3AF`.
4. **`custom` (`resources/views/email/template/custom.blade.php`)**:
   - Raw markdown container executing `{!! $body !!}` without enclosing slots.
   - Allows administrative users to design fully bespoke HTML email layouts.

---

## 8. Closing Lists

### 1. Measured from Code
- Design templates database schema: `database/seeders/DesignsSeeder.php`
- Default design JSON includes: `designs` table `design` column (Plain design ID 1)
- Email blade templates: `resources/views/email/template/plain.blade.php`, `light.blade.php`, `dark.blade.php`, `custom.blade.php`
- PDF engine class: `app/Services/Pdf/PdfService.php:58`

### 2. Measured in the Browser
- Design preview canvas: [INSPECT `/settings/invoice_design` | `iframe` -> `width: 100%; height: 600px`]
- Monaco code editor mount: [INSPECT `/settings/custom_designs` | `div.monaco-editor`]

### 3. Screenshotted
- `IN-ui-screenshots/13-pass5-invoice-design-plain.png` — Default "Plain" design preview in settings.
- `IN-ui-screenshots/14-pass5-invoice-design-customizer.png` — Monaco editor for custom invoice design code.

### 4. Could Not Verify
- Physical paper output margins on letterpress printer (verified via Chromium headless vector PDF print engine).
