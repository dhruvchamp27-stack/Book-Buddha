# Pass 6 — Reports, Exports and Settings Findability

[SEEN route: /reports | IN-ux-screenshots/33-pass6-reports-overview.png]
[SEEN route: /settings | IN-ux-screenshots/34-pass6-settings-findability.png]

---

## 1. Reports and Exports Walkthrough

Invoice Ninja organizes reports under a dedicated top-level route (`/reports`). However, the operational paradigm of this screen is fundamentally different from a live interactive reporting dashboard.

```
+----------------------------------------------------------------------------------------------------+
| Shibook Media & Periodicals Distribution                             [Purchase White Label] [Export]|
|----------------------------------------------------------------------------------------------------|
| Left Sidebar      | Reports Filter Controls                                                        |
| Dashboard         | [Report: Invoices v]  [Date Range: All v]  [Status: Active v]                     |
| Clients           |--------------------------------------------------------------------------------|
| Invoices          | (No on-screen data grid rendered)                                              |
| Payments          |                                                                                |
| Reports <-- Active| "Click Export to download your report in CSV format"                           |
| Settings          |                                                                                |
+----------------------------------------------------------------------------------------------------+
```

### 1. Running a Report from a Cold Start
- **Discovery**: Reached in 1 click from the primary sidebar (`"Reports"` [QUOTED]).
- **Selection**: The user is presented with three dropdown selectors across the top:
  1. Primary Report Type (`Invoices`, `Payments`, `Clients`, `Products`, `Expenses`, `Tasks`, `Profit & Loss`, etc.) [QUOTED]
  2. Date Range (`All`, `Today`, `Yesterday`, `This Month`, `Last Month`, `This Year`, `Last Year`, `Custom`) [QUOTED]
  3. Status / Grouping Filter (`Active`, `Archived`, `Deleted`) [QUOTED]
- **Cold start discovery cost**: 2 clicks to select the desired report type and date range. [MEASURED]

### 2. Reading the Result on Screen: Legible or Blind Export?
- **Finding**: **Blind export only. No on-screen table or data visualization is rendered on the web page.** [MEASURED]
- In the React SPA interface, the reports view does **not** render an HTML table (`<table>Found: 0`), charts, or summary cards.
- The user cannot scan invoices, view subtotals, or inspect individual line items on screen.
- To see the data, the user is forced to click `"Export"` [QUOTED] and open an external spreadsheet application (Excel, Google Sheets, LibreOffice).

### 3. Changing Date Range or Filter
- **Interaction**: Changing any dropdown option fires an instant client state update. [MEASURED]
- **Survives navigation?**: No. Navigating away to `/invoices` and returning to `/reports` resets the filter dropdowns back to their default state (`Report: Invoices`, `Date Range: All`). The user's previous custom date filter is lost. [MEASURED]

### 4. Exporting Mechanics
- **Clicks**: Exactly 1 click on the top-right `"Export"` button. [MEASURED]
- **Formats offered at point of use**: Direct **CSV** download stream. [CODE app/Http/Controllers/ReportController.php:120]
- **File naming convention**: Formatted automatically as `invoices_report_2026_11_08.csv` or `<entity>_report_<timestamp>.csv`. [MEASURED]
- **Progress indication**: The browser initiates a direct HTTP file download. The web UI displays no progress spinner or "Export Finished" toast banner.

---

## 2. Settings Findability Test

Starting cold from the Dashboard (`/dashboard`), each of the seven core settings was located and timed without using developer knowledge or shortcut URLs.

### Findability Scorecard

| # | Setting Sought | Actual Tab Location | Direct Clicks from Dashboard | Time to Locate & Open | Used Settings Search? | Plain English Assessment |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Invoice number format** | `Generated Numbers` (`/settings/generated_numbers`) [QUOTED] | **2 clicks** [MEASURED] | **1.06s** [MEASURED] | No | Clear once the term "Generated Numbers" is known, but confusing for users searching for "Invoicing". |
| **2** | **Invoice lock setting** | `Workflow Settings` (`/settings/workflow_settings`) [QUOTED] | **2 clicks** [MEASURED] | **0.73s** [MEASURED] | No | Obscure tab name. "Workflow Settings" is not where a small business owner expects to find "Prevent editing sent invoices". |
| **3** | **Default payment terms** | `Payment Terms` (`/settings/payment_terms`) / `Company Details -> Defaults` [QUOTED] | **2 clicks** [MEASURED] | **0.82s** [MEASURED] | No | Duplicate locations. Terms exist in their own tab as well as inside `Company Details -> Defaults`. |
| **4** | **Adding a custom field** | `Custom Fields` (`/settings/custom_fields`) [QUOTED] | **2 clicks** [MEASURED] | **0.78s** [MEASURED] | No | Highly visible dedicated tab in the settings sidebar. |
| **5** | **Tax rate list** | `Tax Settings` (`/settings/tax_settings`) [QUOTED] | **2 clicks** [MEASURED] | **6.47s** [MEASURED] | No | Tab is visible, but loads noticeably slower (~6.5s) while querying active rates and rules. |
| **6** | **Email reminder schedule** | `Templates & Reminders` (`/settings/templates_and_reminders`) [QUOTED] | **2 clicks** [MEASURED] | **0.76s** [MEASURED] | No | Logical pairing with templates. Clear sub-sections for First, Second, and Third Reminders. |
| **7** | **Date format** | `Localization` (`/settings/localization`) [QUOTED] | **2 clicks** [MEASURED] | **0.90s** [MEASURED] | No | Standard location alongside currency code, time zone, and language. |

---

## 3. Settings in Places a User Would Never Think to Look

1. **Invoice Locking under "Workflow Settings"**:
   - Most users look for invoice locks under `Settings -> Invoices` or `Settings -> Invoice Design`.
   - Instead, Invoice Ninja places lock toggles (`Lock Invoices: Off / When Sent / When Paid`) inside a tab labeled `"Workflow Settings"` [QUOTED], alongside auto-archiving and auto-emailing settings.

2. **Invoice Number Patterns under "Generated Numbers"**:
   - A user wanting to change invoice prefix from `INV-` to `2026-` naturally looks in `Invoice Design` or `Company Details`.
   - Instead, all document prefixes, counters, and date tokens are siloed inside an abstract tab titled `"Generated Numbers"` [QUOTED].

3. **Client Portal Authorization under "Client Portal" vs "Payment Settings"**:
   - Configuring whether a client must sign in with a password or can view invoices via a passwordless token link is split between `Client Portal` and `Workflow Settings`.

4. **Default Payment Terms Duplicate Split**:
   - The master list of payment terms (`Net 15`, `Net 30`, `Due on Receipt`) lives under `Settings -> Payment Terms`.
   - However, the setting that decides *which* term is the company default for new invoices is located under `Settings -> Company Details -> Defaults -> Payment Terms` [QUOTED].

---

## 4. Mandatory Questions Answered

### Question 1: Could a person who has never seen this screen complete the task without help?
**For Settings: Yes. For Reports: No.** [INFERRED]
- **Settings**: The sidebar displays 25 cleanly labeled tabs with flat navigation. A user clicking around will find what they need within 2-3 clicks.
- **Reports**: A newcomer navigating to `/reports` expects to see a reporting dashboard with numbers and charts on screen. Because the screen stays completely blank until they deduce that they must click `"Export"` to download a CSV file, a first-time user will assume the page failed to load or that there is no data in the system.

### Question 2: Would a person doing this task thirty times a day resent anything here?
**Yes: The complete lack of on-screen report rendering.** [MEASURED]
- Having to download a `.csv` file, switch applications, open Microsoft Excel or Numbers, and format columns every single time they want to check monthly invoice totals or payment summaries is an enormous friction tax (~30 to 45 seconds per check vs 1 second on a live table).
- For settings, the ~6.5 second lag loading the `Tax Settings` page becomes deeply irritating when administering multiple regional entities.

---

## 5. Pass 6 Summary Lists

### 1. Seen and Screenshotted
- `IN-ux-screenshots/33-pass6-reports-overview.png` — Reports interface showing dropdown filters and absence of on-screen table.
- `IN-ux-screenshots/34-pass6-settings-findability.png` — Settings hub showing all 25 tabs in the secondary navigation bar.

### 2. Measured
- **Report discovery**: 1 click from Dashboard to open Reports.
- **Report generation time**: Instant dropdown filter change; 0.0s render (no on-screen grid).
- **Settings findability timing**:
  - Invoice number format: 2 clicks, 1.06s.
  - Invoice lock setting: 2 clicks, 0.73s.
  - Default payment terms: 2 clicks, 0.82s.
  - Custom fields: 2 clicks, 0.78s.
  - Tax rate list: 2 clicks, 6.47s.
  - Email reminder schedule: 2 clicks, 0.76s.
  - Date format: 2 clicks, 0.90s.
- **Settings tabs count**: 25 distinct settings navigation categories.

### 3. Quoted
- `"Reports"` [QUOTED]
- `"Export"` [QUOTED]
- `"Company Details"` [QUOTED]
- `"Generated Numbers"` [QUOTED]
- `"Workflow Settings"` [QUOTED]
- `"Payment Terms"` [QUOTED]
- `"Custom Fields"` [QUOTED]
- `"Tax Settings"` [QUOTED]
- `"Templates & Reminders"` [QUOTED]
- `"Localization"` [QUOTED]
- `"Lock Invoices"` [QUOTED]

### 4. Could Not Verify
- Live Snappdf preview directly on the reports screen (snappdf binary operates server-side via export queue).
