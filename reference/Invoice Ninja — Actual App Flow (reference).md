# Invoice Ninja — Actual App Flow (reference)

> **Inspected Application Version:** Invoice Ninja v5.13.43 (Backend configuration `app_version: 5.13.43` on Laravel 12.69.2, Flutter web package build 194 / `invoiceninja_flutter 5.0.194`, React SPA frontend, UI footer string: `"v Latest Build - 2026-09-18"`, running live in Docker on `craterninja-nginx-1` / `craterninja-app-1` at `http://localhost:8090`).  
> **Source Evidence Base:** Live headed/CDP browser session inspection at 1366×768 unscaled (100% zoom) directly on `http://localhost:8090` (18 live audit screenshots captured in `scratch/live_screenshots/`, authenticated DOM audits in `live_app_verified_audit.json`), combined with inspection datasets in `invoice-ninja-reports/` (Batches 0–12, UX Passes 0–9, UI Passes 1–7, Round 5 Audit Reports) and previous run screenshots.  
> **Documentation Standard:** Factual, literal UX flow reference. Quoted text reflects exact on-screen strings. Every click target, screen transition, route change, and state mutation is documented strictly as observed. Unverified items are explicitly marked **"cannot confirm"** or **"partially observed"**.

---

## 1. Primary journeys (arrow maps)

### 1.1 Login
`http://localhost:8090/login` [Step 1: Email] $\rightarrow$ Type email $\rightarrow$ Click `"Continue"` $\rightarrow$ [Step 2: Password card in-place] $\rightarrow$ Type password $\rightarrow$ Click `"Login"` (or `"Login with a Passkey"`) $\rightarrow$ Authenticated session established $\rightarrow$ Lands on `/dashboard`.

### 1.2 Create Invoice
`/dashboard` $\rightarrow$ Click sidebar `"Invoices"` $\rightarrow$ `/invoices` $\rightarrow$ Click `"New Invoice"` $\rightarrow$ `/invoices/create` $\rightarrow$ Select client from combobox (or click `"New Client"` slide-over drawer) $\rightarrow$ Set dates & metadata $\rightarrow$ Enter line item (`Item`, `Description`, `Unit Cost`, `Quantity`, `Discount`) $\rightarrow$ Click sticky header `"Save"` $\rightarrow$ Backend assigns sequential number (e.g. `"0047"`) $\rightarrow$ Toast `"Successfully created invoice"` $\rightarrow$ Route updates to `/invoices/:id/edit?table=products` in `"Draft"` status.

### 1.3 Record Payment
*Fastest Path (Contextual from Invoice):* `/invoices/:id/edit` $\rightarrow$ Click header `"Enter Payment"` $\rightarrow$ Slide-over modal opens with Client, Invoice #, and outstanding Balance pre-filled $\rightarrow$ Confirm payment date & method $\rightarrow$ Click `"Save"` $\rightarrow$ Invoice balance decreases; status pill updates (`"Paid"` or `"Partial/Deposit"`).  
*Universal Path:* Sidebar `"Payments"` $\rightarrow$ `/payments` $\rightarrow$ Click `"Enter Payment"` $\rightarrow$ `/payments/create` $\rightarrow$ Select Client $\rightarrow$ Open invoices table mounts dynamically $\rightarrow$ Check invoice(s) or type into `"Received"` input $\rightarrow$ Set `"Payment Type"` $\rightarrow$ Click `"Save"` $\rightarrow$ Toast `"Successfully created payment"` $\rightarrow$ Redirects to `/payments/:id/edit`.

### 1.4 Create Client
`/dashboard` $\rightarrow$ Click sidebar `"Clients"` $\rightarrow$ `/clients` $\rightarrow$ Click `"New Client"` $\rightarrow$ `/clients/create` $\rightarrow$ Fill tab `"Create"` (`Name`, `ID Number`, `VAT Number`, `Contacts`, `Address`) $\rightarrow$ Optional: configure `"Settings"` or upload `"Documents"` $\rightarrow$ Click `"Save"` $\rightarrow$ Toast `"Successfully created client"` $\rightarrow$ Route updates to `/clients/:id` (Client Overview with Standing metric card).

### 1.5 Create Product
`/dashboard` $\rightarrow$ Click sidebar `"Products"` $\rightarrow$ `/products` $\rightarrow$ Click `"New Product"` $\rightarrow$ `/products/create` $\rightarrow$ Fill `"Item*"` (mandatory SKU), optional `Description`, `Price`, `Default Quantity`, `Tax Category`, `In Stock` $\rightarrow$ Click `"Save"` $\rightarrow$ Toast `"Successfully created product"` $\rightarrow$ Route updates to `/products/:id/edit`.

### 1.6 Quote $\rightarrow$ Invoice
`/dashboard` $\rightarrow$ Click sidebar `"Quotes"` $\rightarrow$ `/quotes` $\rightarrow$ Click `"New Quote"` $\rightarrow$ Fill client, line items, `"Valid Until"` date $\rightarrow$ Click `"Save"` $\rightarrow$ Quote saved as `"Draft"` $\rightarrow$ On quote view `/quotes/:id/edit`, click action button `"Convert to Invoice"` $\rightarrow$ Backend copies quote lines into a new draft invoice, updates `quotes.invoice_id` $\rightarrow$ Quote status pill mutates to `"Converted"` $\rightarrow$ User is redirected to `/invoices/:new_id/edit` (or invoice list).

### 1.7 Recurring Invoice
`/dashboard` $\rightarrow$ Click sidebar `"Recurring Invoices"` $\rightarrow$ `/recurring_invoices` $\rightarrow$ Click `"New Recurring Invoice"` $\rightarrow$ `/recurring_invoices/create` $\rightarrow$ Select Client $\rightarrow$ Set cadence (`"Frequency"`, `"Remaining Cycles"`, `"Auto-Bill"`, `"Due Date"`) $\rightarrow$ Add line items $\rightarrow$ Click `"Save"` $\rightarrow$ Saved to active schedules $\rightarrow$ Cron worker evaluates daily and auto-generates child invoices on each trigger cycle.

### 1.8 Expense / Vendor / Purchase Order
*Create Vendor:* Sidebar `"Vendors"` $\rightarrow$ `/vendors` $\rightarrow$ Click `"New Vendor"` $\rightarrow$ Fill Name, Currency, Address, Contacts $\rightarrow$ Click `"Save"`.  
*Log Expense:* Sidebar `"Expenses"` $\rightarrow$ `/expenses` $\rightarrow$ Click `"New Expense"` $\rightarrow$ Select Vendor and/or Client $\rightarrow$ Set Amount, Date, Category $\rightarrow$ Toggle `"Should be Invoiced"` (billable) $\rightarrow$ Click `"Save"`.  
*Purchase Order:* Sidebar `"Purchase Orders"` $\rightarrow$ `/purchase_orders` $\rightarrow$ Click `"New Purchase Order"` $\rightarrow$ Select Vendor $\rightarrow$ Fill line items $\rightarrow$ Click `"Save"` $\rightarrow$ On PO view, click `"Mark Received"` $\rightarrow$ Stock increments in inventory.

### 1.9 Run and Export Report
`/dashboard` $\rightarrow$ Click sidebar `"Reports"` $\rightarrow$ `/reports` $\rightarrow$ Select `"Report"` dropdown (e.g. `"Invoices"`, `"Payments"`, `"Profit and Loss"`) $\rightarrow$ Select `"Date Range"` dropdown $\rightarrow$ Select `"Status"` dropdown $\rightarrow$ No on-screen table renders $\rightarrow$ Click top-right button `"Export"` $\rightarrow$ Browser downloads `<entity>_report_<date>.csv` file directly.

### 1.10 Configure Settings
`/dashboard` $\rightarrow$ Click sidebar `"Settings"` $\rightarrow$ `/settings` $\rightarrow$ 25-panel settings navigation mounts $\rightarrow$ Click target panel (e.g. `"Generated Numbers"`, `"Workflow Settings"`, `"Tax Settings"`, `"Custom Fields"`) $\rightarrow$ Adjust field toggles/inputs $\rightarrow$ Click bottom/header `"Save"` $\rightarrow$ Toast notification confirms persistence.

---

## 2. Screen-by-screen detail

#### Application Shell Layout
- Top Alert Banner: `"Something went wrong"` (conditional)
- Top Header Toolbar:
  - Global Search: `"Find invoices, clients, and more"`
  - Upsell Button: `"Purchase White Label"`
  - User controls: User Avatar and Notification bell
- Left Sidebar (17 flat navigation links):
  1. `Dashboard`
  2. `Clients`
  3. `Products`
  4. `Invoices`
  5. `Recurring Invoices`
  6. `Payments`
  7. `Quotes`
  8. `Credits`
  9. `Projects`
  10. `Tasks`
  11. `Vendors`
  12. `Purchase Orders`
  13. `Expenses`
  14. `Recurring Expenses`
  15. `Transactions`
  16. `Reports`
  17. `Settings`
- Main Workspace: Breadcrumbs (`/ Module / Sub-route`), sticky Action Cluster (e.g. `"New Invoice"`, `"Save"`), and dynamic content cards/grids.

---

### Module 1: Login & Password Recovery

#### Screen 1.1: Login — Step 1 (Email Submission)
- **Purpose:** Identity challenge entry point for unauthenticated users.
- **Source Citation:** `[SEEN /login | IN-ux-screenshots/01-login-screen.png]`.
- **On-Screen Content:**
  - Header title: `"Login"`
  - Field: `"Email address"` (text input, no placeholder)
  - Primary button: `"Continue"`
  - Version footer: `"v Latest Build - 2026-09-18"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Email input $\rightarrow$ Sets focus for typing identifier.
  - Button `"Continue"` $\rightarrow$ Submits email to backend via AJAX; validates account existence; transforms card in-place to Step 2.
- **Primary Action:** Click `"Continue"` (or press `Enter`).
- **Secondary Actions:** None on Step 1.
- **Loading / Empty / Error States:**
  - Empty email submitted $\rightarrow$ Browser native HTML5 validation flags empty field.
  - Unrecognized email $\rightarrow$ Displays top inline alert banner: `"These credentials do not match our records."`
- **Branches / Decision Points:**
  - Valid recognized email $\rightarrow$ In-place transition to Step 2 (Password).
  - Unrecognized email $\rightarrow$ Stays on Step 1 with error message.

#### Screen 1.2: Login — Step 2 (Password Submission)
- **Purpose:** Authenticate the submitted user identifier.
- **Source Citation:** `[SEEN /login | IN-ux-screenshots/01b-login-password.png]`.
- **On-Screen Content:**
  - Header: `"Login"`
  - Identity badge: submitted email string (e.g. `"admin@example.com"`)
  - Link beside email: `"Change"`
  - Link above password field: `"Forgot your password?"`
  - Field: `"Password"` (password input with mask)
  - Primary button: `"Login"`
  - Divider text: `"OR"`
  - Alternative button: `"Login with a Passkey"`
  - Version footer: `"v Latest Build - 2026-09-18"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Link `"Change"` $\rightarrow$ Reverses animation back to Step 1; re-enables email input.
  - Link `"Forgot your password?"` $\rightarrow$ Navigates to `/forgot_password`.
  - Password input $\rightarrow$ Sets focus for typing password.
  - Button `"Login"` $\rightarrow$ Submits credentials to `POST /api/v1/login`; sets session cookie/bearer token; redirects to `/dashboard`.
  - Button `"Login with a Passkey"` $\rightarrow$ Invokes browser WebAuthn API prompt for FIDO2/biometric challenge.
- **Primary Action:** Click `"Login"`.
- **Secondary Actions:** Click `"Change"`, click `"Forgot your password?"`, click `"Login with a Passkey"`.
- **Loading / Empty / Error States:**
  - While authenticating $\rightarrow$ Button `"Login"` displays small spinner icon and becomes disabled.
  - Incorrect password $\rightarrow$ In-card red text banner: `"These credentials do not match our records."`
- **Branches / Decision Points:**
  - Authentication success $\rightarrow$ Loads `/dashboard`.
  - Account has 2FA enabled $\rightarrow$ Redirects to two-factor OTP code challenge screen (cannot confirm visual layout of OTP screen).
  - Account locked/suspended $\rightarrow$ Red error banner displayed.

#### Screen 1.3: Password Recovery (`/forgot_password`)
- **Purpose:** Request an automated password reset email.
- **Source Citation:** `[CODE routes/web.php:L42, app/Http/Controllers/Auth/ForgotPasswordController.php]`.
- **On-Screen Content (partially observed):**
  - Card with header `"Reset Password"`
  - Field: `"Email address"`
  - Button: `"Send Password Reset Link"`
  - Link: `"Return to Login"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Send Password Reset Link"` $\rightarrow$ Dispatches reset email token via configured mail transport; displays confirmation toast `"We have emailed your password reset link!"`.
  - Link `"Return to Login"` $\rightarrow$ Navigates back to `/login`.
- **Primary Action:** Click `"Send Password Reset Link"`.
- **Secondary Actions:** Click `"Return to Login"`.
- **Loading / Empty / Error States:** Invalid or unconfigured SMTP logs error to system logs; UI reports `"We can't find a user with that email address."` if unlisted.

---

### Module 2: Dashboard (`/dashboard`)

- **Purpose:** Analytical overview of billing velocity, outstanding balances, upcoming obligations, and operational feeds.
- **Source Citation:** `[SEEN /dashboard | IN-ux-screenshots/02-dashboard-screen.png]`.
- **On-Screen Content:**
  - Company identity header: e.g. `"Shibook Media & Periodicals Distribution"`
  - Greeting text: `"Welcome! Glad to see you."`
  - Global search bar: `"Find invoices, clients, and more"`
  - Currency indicator pill: `"INR"` (or configured default)
  - Time granularity toggle buttons: `"Day"`, `"Week"`, `"Month"`, `"This Month"`
  - High-level metric summary cards:
    - `"Invoices"` (e.g. `₹ 370.00`)
    - `"Payments"` (e.g. `₹ 90,716.50`)
    - `"Expenses"` (e.g. `₹ 19,706.00`)
    - `"Outstanding"` (e.g. `₹ 270.00`)
    - `"Total Invoices Outstanding"` (e.g. `4`)
  - Chart widget: `"Overview Chart"` (Revenue vs Expenses grouped bar graph)
  - Six data tables:
    1. `"Recent Transactions"`
    2. `"Recent Activity"` (audit log entries, e.g. `"New User created invoice..."`)
    3. `"Recent Payments"` (columns: Number, Client, Amount)
    4. `"Upcoming Invoices"` (columns: Number, Client, Amount)
    5. `"Past Due Invoices"` (columns: Number, Client, Amount)
    6. `"Upcoming Recurring Invoices"` (columns: Number, Client, Amount)
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Company Switcher $\rightarrow$ Opens company tenant selector dropdown.
  - Global Search input $\rightarrow$ Opens predictive search dropdown across clients, invoices, and payments.
  - Button `"Purchase White Label"` $\rightarrow$ Opens white-label license checkout dialog.
  - Granularity buttons (`"Day"`, `"Week"`, `"Month"`, `"This Month"`) $\rightarrow$ Re-queries metrics and redraws the Overview Chart for the selected period.
  - Metric cards $\rightarrow$ Clicking a card filters corresponding underlying lists (e.g. clicking `"Invoices"` navigates to `/invoices`).
  - Table rows in `"Recent Payments"` $\rightarrow$ Clicks navigate directly to `/payments/:id/edit`.
  - Table rows in `"Upcoming Invoices"` / `"Past Due Invoices"` $\rightarrow$ Clicks navigate directly to `/invoices/:id/edit`.
  - Table rows in `"Upcoming Recurring Invoices"` $\rightarrow$ Clicks navigate to `/recurring_invoices/:id/edit`.
  - Sidebar links (17 items) $\rightarrow$ Navigate to respective modules.
- **Primary Action:** None. The screen is analytical only; there is no primary "Create Invoice" button on the dashboard content surface.
- **Secondary Actions:** Toggle date filters, click into recent records, search globally.
- **Loading / Empty / Error States:**
  - Loading: Chart displays placeholder pulse skeleton.
  - Empty data tables: Render centered text: `"No records found"`.
  - Error banner: Can render a sticky orange-red banner across the very top reading `"Something went wrong"`.
- **Branches / Decision Points:** User branches out to functional modules via the sidebar or by clicking into individual record rows.

---

### Module 3: Clients

#### Screen 3.1: Clients List (`/clients`)
- **Purpose:** Central management, search, and bulk operations for all debtor accounts.
- **Source Citation:** `[SEEN /clients | IN-ux-screenshots/16-pass3-clients-list.png]`.
- **On-Screen Content:**
  - Breadcrumb: `"/ Clients"`
  - Filter pills: `"Lifecycle:"` (`Active`, `Archived`, `Deleted`), `"Status:"`
  - Table search input: `"Search"`
  - Primary button: `"New Client"` (primary solid blue)
  - Data columns (10 default):
    1. `[Selection Checkbox]`
    2. `"Name"` (Customer company link)
    3. `"Contact Email"` (Primary billing email)
    4. `"ID Number"` (Business registration number)
    5. `"Balance"` (Total unpaid customer debt)
    6. `"Paid to Date"` (Cumulative historical receipts)
    7. `"Date Created"` (Timestamp)
    8. `"Last Login"` (Portal access timestamp)
    9. `"Website"` (Corporate URL link)
    10. `"Actions"` (Dropdown button per row)
  - Pagination controls: `"Total results: X"`, `"/ Y pages"`, `"rows:" [10 v]`, `[<] [>]`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Client"` $\rightarrow$ Navigates to `/clients/create`.
  - Checkbox (header) $\rightarrow$ Selects/deselects all visible client rows; reveals sticky `"Actions"` bulk dropdown.
  - Checkbox (row) $\rightarrow$ Toggles selection of specific client.
  - Link in `"Name"` column $\rightarrow$ Navigates to Client Overview `/clients/:id`.
  - Link in `"Website"` column $\rightarrow$ Opens URL in new browser tab.
  - Row `"Actions"` dropdown $\rightarrow$ Opens contextual menu:
    - `"Edit"` $\rightarrow$ Navigates to `/clients/:id/edit`.
    - `"Clone"` $\rightarrow$ Duplicates client record to new create draft.
    - `"View"` $\rightarrow$ Navigates to `/clients/:id`.
    - `"Statement"` $\rightarrow$ Opens statement generation modal.
    - `"Archive"` $\rightarrow$ Soft-archives client (`deleted_at = now()`, `is_deleted = 0`).
    - `"Delete"` $\rightarrow$ Soft-deletes client (`is_deleted = 1`).
  - Table settings gear icon $\rightarrow$ Opens 3-click column customizer dialog.
- **Primary Action:** Click `"New Client"`.
- **Secondary Actions:** Filter by lifecycle, search by name/email, perform bulk operations.
- **Loading / Empty / Error States:**
  - Loading: Table body renders gray pulse shimmer.
  - Empty: Displays `"No records found"`.
  - Delete toast: `"Successfully deleted client"`.

#### Screen 3.2: Create / Edit Client (`/clients/create`, `/clients/:id/edit`)
- **Purpose:** Full capture and maintenance of customer legal details, addresses, and settings.
- **Source Citation:** `[SEEN /clients/create | IN-ux-screenshots/17-pass3-client-create-empty.png]`, `[CODE app/Http/Requests/Client/StoreClientRequest.php]`.
- **On-Screen Content:**
  - Header: `"New Client"` (or `"Edit Client"`)
  - Sticky button: `"Save"`
  - Four top-level tabs:
    1. `"Create"` (or `"Details"`)
    2. `"Address"`
    3. `"Settings"`
    4. `"Documents"`
  - Tab 1 ("Create" / "Details") interactive inputs:
    - Top card: `Name`, `ID Number`, `VAT Number`, `Website`, `Phone`, `Currency`, `Language`, `Industry`, `Size`, `Classification`, `Tax Exempt` toggle, `Assigned User`.
    - Contacts card: `First Name`, `Last Name`, `Email`, `Phone`, `Primary` radio, `Send Email` toggle, `CC Only` toggle, `Can Sign` toggle.
    - Button: `"+ Add Contact"` (spawns additional contact rows).
  - Tab 2 ("Address") inputs:
    - Billing: `Address 1`, `Address 2`, `City`, `State`, `Postal Code`, `Country`.
    - Shipping: `Shipping Address 1`, `Shipping Address 2`, `Shipping City`, `Shipping State`, `Shipping Postal Code`, `Shipping Country`.
    - Checkbox: `"Copy billing to shipping"`.
  - Tab 3 ("Settings") inputs:
    - `Group Settings`, `Payment Terms`, `Public Notes`, `Private Notes`, `Custom Value 1..4`.
  - Tab 4 ("Documents") inputs:
    - Drag-and-drop file upload zone (accepts up to 100MB; 22 file extensions).
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Tabs (`"Create"`, `"Address"`, `"Settings"`, `"Documents"`) $\rightarrow$ Switches active sub-card.
  - Button `"+ Add Contact"` $\rightarrow$ Adds a new uninitialized contact input block.
  - Checkbox `"Copy billing to shipping"` $\rightarrow$ Copies billing address values into shipping inputs.
  - Sticky Header Button `"Save"` $\rightarrow$ Validates form; posts payload to `POST /api/v1/clients`; displays green toast `"Successfully created client"`; redirects to Client Overview.
  - Link `"Cancel"` / Breadcrumb `"/ Clients"` $\rightarrow$ Discards unsaved edits and returns to list.
- **Primary Action:** Click `"Save"`.
- **Secondary Actions:** Add multiple contacts, configure address, upload contracts.
- **Loading / Empty / Error States:**
  - Saving: Button `"Save"` displays spinner icon and disables.
  - Validation: No red required asterisks are shown on empty fields; an empty save completes without error, auto-assigning account number and labeling contact `"No Contact Set"`. Duplicate client names are permitted without warning.
  - Duplicate contact email across same client $\rightarrow$ Shows validation error: `"The contacts.X.email must be distinct."`

#### Screen 3.3: Client Overview (`/clients/:id`)
- **Purpose:** Comprehensive customer command center showing financial standing, details, and 12 linked transaction sub-ledgers.
- **Source Citation:** `[SEEN /clients/mWZdPwbKgR | IN-ux-screenshots/19-pass3-client-overview.png]`, `[CODE public/Client-W_IaKCyq.js]`.
- **On-Screen Content:**
  - Top Standing Financial Banner (4 metric boxes):
    1. `"Paid to Date"` (e.g. `₹ 84,500.00`)
    2. `"Outstanding"` (e.g. `₹ 12,450.00`)
    3. `"Credit Balance"` (unallocated credit notes)
    4. `"Payment Balance"` (unapplied cash deposits / overpayments)
  - Detail Summary Cards:
    - `details`: Account Number, ID/VAT, Primary Email, Assigned Rep.
    - `address`: Formatted billing and shipping blocks.
    - `contacts`: Roster of contacts with badges.
  - 12 Data Sub-Tabs:
    1. `"Invoices"`
    2. `"Quotes"`
    3. `"Payments"`
    4. `"Recurring Invoices"`
    5. `"Credits"`
    6. `"Projects"`
    7. `"Tasks"`
    8. `"Expenses"`
    9. `"Recurring Expenses"`
    10. `"History / Activity"`
    11. `"Documents"`
    12. `"Settings"`
  - Header Action Cluster: `"Edit Client"`, `"Enter Payment"`, `"New Invoice"`, `"More Actions"` (kebab).
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Sub-Tabs (1–12) $\rightarrow$ Mounts filtered entity list scoped strictly to `client_id = :id`.
  - Button `"Edit Client"` $\rightarrow$ Navigates to `/clients/:id/edit`.
  - Button `"Enter Payment"` $\rightarrow$ Opens payment entry form with this client pre-selected.
  - Button `"New Invoice"` $\rightarrow$ Navigates to `/invoices/create` with this client pre-selected.
  - Kebab `"More Actions"`:
    - `"Statement"` $\rightarrow$ Opens Client Statement generation modal.
    - `"Merge"` $\rightarrow$ Opens Client Merge modal.
    - `"Archive"` $\rightarrow$ Soft-archives client.
    - `"Delete"` $\rightarrow$ Soft-deletes client.
- **Primary Action:** Click `"New Invoice"` or `"Enter Payment"`.
- **Secondary Actions:** Switch sub-tabs, generate statement, execute account merge.

#### Screen 3.4: Client Statement Modal
- **Purpose:** Generate a unified statement of account and aging schedule for the customer.
- **Source Citation:** `[CODE app/Http/Controllers/ClientStatementController.php, app/Services/Client/Statement.php]`.
- **On-Screen Content:**
  - Modal title: `"Client Statement"`
  - Inputs:
    - `"Start Date"` / `"End Date"`
    - `"Status"` dropdown (`All`, `Unpaid`, `Paid`)
    - Checkbox: `"Show Payments Table"`
    - Checkbox: `"Show Aging Table"` (buckets: 0–30, 31–60, 61–90, 90+)
    - Checkbox: `"Show Credits Table"`
    - Checkbox: `"Send Email"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Download PDF"` (or Save when Send Email unchecked) $\rightarrow$ Streams binary PDF `statement.pdf` directly to browser.
  - Button `"Send Email"` (when Send Email checked) $\rightarrow$ Builds PDF, dispatches email to client contacts, returns toast `"Email queued"`.
  - Button `"Cancel"` $\rightarrow$ Closes modal.
- **Primary Action:** Click `"Download PDF"` or `"Send Email"`.

#### Screen 3.5: Client Merge Modal
- **Purpose:** Permanently merge a duplicate client into this target client.
- **Source Citation:** `[CODE app/Services/Client/Merge.php]`.
- **On-Screen Content:**
  - Modal title: `"Merge Client"`
  - Combobox: `"Select client to merge into this record"`
  - Warning text: Explains that all 15 child entities (invoices, payments, credits, quotes, tasks, etc.) will be re-parented to this client and the source client will be permanently purged.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Client combobox $\rightarrow$ Selects source client (`$mergable_client`).
  - Button `"Merge"` $\rightarrow$ Executes `Merge.php` inside database transaction; purges source; recalculates balances; writes audit entry; redirects to updated client overview.
  - Button `"Cancel"` $\rightarrow$ Closes modal without action.
- **Primary Action:** Click `"Merge"`.
- **Secondary Actions:** Click `"Cancel"`.

---

### Module 4: Products & Inventory

#### Screen 4.1: Products List (`/products`)
- **Purpose:** Catalog repository of billable items, standard rates, default descriptions, and physical stock counts.
- **Source Citation:** `[SEEN /products | IN-ux-screenshots/20-pass3-products-list.png]`.
- **On-Screen Content:**
  - Breadcrumb: `"/ Products"`
  - Search input: `"Search"`
  - Primary button: `"New Product"` (solid blue)
  - Data columns (6 default):
    1. `[Selection Checkbox]`
    2. `"Product"` (Item SKU/key link)
    3. `"Notes"` (Public description snippet)
    4. `"Price"` (Base sales price)
    5. `"Default Quantity"` (Standard line qty, defaults to 1.00)
    6. `"Actions"` (Dropdown per row)
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Product"` $\rightarrow$ Navigates to `/products/create`.
  - Link in `"Product"` column $\rightarrow$ Navigates to `/products/:id/edit`.
  - Row `"Actions"` dropdown $\rightarrow$ Contextual options: `"Edit"`, `"Clone"`, `"Archive"`, `"Delete"`.
  - Table settings gear icon $\rightarrow$ Column customization.
- **Primary Action:** Click `"New Product"`.
- **Secondary Actions:** Search catalog, bulk archive/delete items.
- **Loading / Empty / Error States:** Empty list renders `"No records found"`.

#### Screen 4.2: Create / Edit Product (`/products/create`, `/products/:id/edit`)
- **Purpose:** Create or modify a catalog item, selling price, default cost, tax category, and physical stock tracking.
- **Source Citation:** `[SEEN /products/create | IN-ux-screenshots/21-pass3-product-create-empty.png]`, `[CODE app/Models/Product.php]`.
- **On-Screen Content:**
  - Header: `"New Product"` (or `"Edit Product"`)
  - Sticky button: `"Save"`
  - Form Fields (13 distinct inputs):
    - `"Status"` (`Active`, `Archived`)
    - `"Item*"` (SKU identifier — **sole mandatory field with red asterisk**)
    - `"Description"` (Textarea)
    - `"Tags"` (Multi-select)
    - `"Price"` (Numeric unit price)
    - `"Default Cost"` (Unit acquisition cost)
    - `"Default Quantity"` (Default numeric qty)
    - `"Max Quantity"` (Purchase cap)
    - `"Tax Category"` (Dropdown)
    - `"Physical Goods"` (Toggle switch)
    - `"Image URL"` (Thumbnail path)
    - *Conditional Inventory Section (visible only when `track_inventory` is ON in Company Settings):*
      - `"Stock Quantity"` (Integer physical units on-hand)
      - `"Stock Notifications"` (Toggle)
      - `"Notification Threshold"` (Integer units floor)
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Sticky Header Button `"Save"` $\rightarrow$ Submits payload to `POST /api/v1/products` (attaches `?update_in_stock_quantity=true` if user touched stock field); displays toast `"Successfully created product"`; redirects to edit view.
  - Link `"Cancel"` $\rightarrow$ Returns to `/products`.
- **Primary Action:** Click `"Save"`.
- **Secondary Actions:** Toggle stock notifications, attach tax classifications.
- **Loading / Empty / Error States:**
  - If `"Item*"` is blank and user clicks Save $\rightarrow$ Field receives red border; save blocked.
  - Negative Stock Behavior: System allows negative stock numbers freely (e.g. `-3`); displays `-3` in red text without throwing validation errors.

---

### Module 5: Invoices

#### Screen 5.1: Invoices List (`/invoices`)
- **Purpose:** Operational ledger for all sales invoices, status tracking, search, and bulk lifecycle actions.
- **Source Citation:** `[SEEN /invoices | IN-ux-screenshots/03-invoices-list.png, 11-pass2-invoice-list-default.png]`.
- **On-Screen Content:**
  - Breadcrumbs: `"/ Invoices"`
  - Filters: `"Lifecycle:"` (`Active`, `Archived`, `Deleted`), `"Status:"` (multi-select for `Draft`, `Sent`, `Paid`, `Partial/Deposit`, `Past Due`, `Cancelled`, `Reversed`)
  - Search input: `"Search"`
  - Primary button: `"New Invoice"` (primary solid blue)
  - Table Column Headers (7 data columns + 2 utility):
    1. `[Selection Checkbox]`
    2. `"Status"` (Status pill badge)
    3. `"Number"` (Document identifier link)
    4. `"Client"` (Customer legal name link)
    5. `"Amount"` (Invoiced total)
    6. `"Balance"` (Remaining open balance)
    7. `"Date"` (Issuance date)
    8. `"Due Date"` (Payment due date)
    9. `"Actions"` (Per-row kebab dropdown)
  - Pagination text: `"Total results: 32"`, `"/ 4"`, `"rows:" [10 v]`, `[<] [>]`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Invoice"` $\rightarrow$ Navigates to `/invoices/create`.
  - Search input $\rightarrow$ Filters table instantly across Invoice Number, Client Name, Amount, and Line Item text.
  - Status pill in row $\rightarrow$ Visual indicator only (non-clickable).
  - Link in `"Number"` column $\rightarrow$ Navigates to `/invoices/:id/edit`.
  - Link in `"Client"` column $\rightarrow$ Navigates to Client Overview `/clients/:id`.
  - Row `"Actions"` dropdown $\rightarrow$ Contextual menu:
    - `"Edit"` $\rightarrow$ Navigates to `/invoices/:id/edit`.
    - `"Enter Payment"` $\rightarrow$ Opens payment modal pre-populated for this invoice.
    - `"Clone"` $\rightarrow$ Clones invoice to new draft.
    - `"Email Invoice"` $\rightarrow$ Dispatches invoice email to client.
    - `"Download PDF"` $\rightarrow$ Downloads rendered PDF.
    - `"Mark Sent"` $\rightarrow$ Advances draft to Sent.
    - `"Mark Paid"` $\rightarrow$ Fully marks invoice paid, generates payment record.
    - `"Cancel"` $\rightarrow$ Cancels invoice, zeroes balance.
    - `"Reverse"` $\rightarrow$ Reverses invoice, generates credit note for paid amounts.
    - `"Archive"` $\rightarrow$ Soft-archives document.
    - `"Delete"` $\rightarrow$ Soft-deletes document, decrements balance, restores inventory.
  - Table settings gear icon $\rightarrow$ Opens column selection modal (44 columns selectable).
- **Primary Action:** Click `"New Invoice"`.
- **Secondary Actions:** Search, filter by lifecycle/status, invoke row actions.
- **Loading / Empty / Error States:**
  - Loading: Table rows pulse in light gray.
  - Empty: Displays `"No records found"`.
  - Row Delete: Executes immediately without modal; shows green toast `"Successfully deleted invoice"`. Soft-deleted invoice can only be rescued by switching Lifecycle filter to `"Deleted"` and clicking `"Restore"`.

#### Screen 5.2: Create / Edit Invoice (`/invoices/create`, `/invoices/:id/edit`)
- **Purpose:** Document authoring studio for line items, taxes, discounts, delivery terms, and customer billing metadata.
- **Source Citation:** `[SEEN /invoices/create | IN-ux-screenshots/04-new-invoice-empty.png, 04b-new-invoice-filled.png, 06-pass1-inv1-simple.png, 07-pass1-inv2-multiline.png]`.
- **On-Screen Content:**
  - Header: Breadcrumbs `"/ Invoices / New Invoice"`, Sticky button `"Save"`.
  - Form Navigation Tabs: `"Create"`, `"Documents"`, `"Settings"`.
  - Client Section:
    - Client Combobox: `"Select Client"`
    - Button: `"+ New Client"` (opens 31-input slide-over drawer)
    - Contact Selector: `"Edit|View Contacts"`
  - Document Metadata:
    - `"Invoice Date"` (defaults to today, formatted `DD/MMM/YYYY`)
    - `"Due Date"` (calendar picker)
    - `"Partial/Deposit"` (numeric deposit requirement)
    - `"Tags"` (tag selector)
    - `"Invoice #"` (placeholder `"Auto Generate"`)
    - `"PO #"` (text input)
    - `"Discount"` (numeric input) + Type Toggle (`Amount` / `%`)
  - Line Items Section:
    - Dual Tab Switcher: `"Products"` tab and `"Tasks"` tab
    - `"Products"` Mode Grid Columns: Drag Grip (`::`), `"Item"`, `"Description"`, `"Unit Cost"`, `"Quantity"`, `"Discount"`, `"Line Total"`, Trash Icon (`x`)
    - `"Tasks"` Mode Grid Columns: Drag Grip (`::`), `"Service"`, `"Description"`, `"Rate"`, `"Hours"`, `"Discount"`, `"Line Total"`, Trash Icon (`x`)
    - Buttons below table: `"+ Add Item"`, `"+ Add Line"`
  - Accordion Drawers below line items:
    - `"Public Notes"`, `"Private Notes"`, `"Terms"`, `"Footer"`, `"Custom Fields"`
    - Rich Text Editor Toolbar (`Paragraph`, `Font`, `Size`, `B`, `I`, `U`)
  - Financial Totals Box (bottom-right):
    - `"Net"`
    - `"Subtotal"`
    - `"Total"`
    - `"Paid to Date"`
    - `"Balance"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Combobox `"Select Client"` $\rightarrow$ Opens client search dropdown.
  - Button `"+ New Client"` $\rightarrow$ Opens slide-over drawer to create a customer inline.
  - Button `"+ Add Item"` $\rightarrow$ Appends an empty product line item row.
  - Button `"+ Add Line"` $\rightarrow$ Appends an empty ad-hoc/free-text line item row.
  - Trash Icon (`x`) on row $\rightarrow$ Deletes row immediately without prompt; recalculates totals in 0.05s.
  - Drag Grip (`::`) $\rightarrow$ Reorders line items via pointer drag.
  - Accordion headers $\rightarrow$ Expands/collapses respective note and custom field drawers.
  - Sticky Header Button `"Save"` $\rightarrow$ Validates required fields; submits to backend; generates identifier; renders green toast `"Successfully created invoice"`; updates route to `/invoices/:id/edit?table=products`.
  - Header Toolbar (Post-Save Edit Mode):
    - Button `"Save"` $\rightarrow$ Persists updates.
    - Button `"Email Invoice"` $\rightarrow$ Sends invoice email to client contacts.
    - Button `"PDF"` $\rightarrow$ Opens/downloads rendered PDF.
    - Button `"View Portal"` $\rightarrow$ Opens customer view in client portal in new tab.
    - Button `"Enter Payment"` $\rightarrow$ Opens payment modal pre-populated with remaining balance.
    - Kebab `"More Actions"` $\rightarrow$ Options: `Clone Invoice`, `Mark Sent`, `Mark Paid`, `Delivery Note`, `Cancel`, `Reverse`, `Archive`, `Delete`.
- **Primary Action:** Click `"Save"`.
- **Secondary Actions:** Add lines, attach files under `"Documents"`, override settings under `"Settings"`.
- **Loading / Empty / Error States:**
  - Save without client $\rightarrow$ Save blocked; Client combobox receives red border; form remains on `/invoices/create`.
  - Save without line items $\rightarrow$ Save blocked.
  - Half-filled row (description only, no price/qty) $\rightarrow$ Incomplete row is silently dropped upon save without warning; valid lines are saved.
  - Letter in amount field $\rightarrow$ Keystrokes blocked immediately by input mask.
  - Duplicate Invoice # typed $\rightarrow$ Red alert toast: `"Invoice number already taken"`.
  - Locked Invoice View: If invoice is locked by `lock_invoices` rule, a `#4DA6FF` blue banner renders across the top reading `"Locked invoice"`; Save button is disabled with cursor `not-allowed`.

#### Screen 5.3: Bulk Actions Modal / Confirmations
- **Purpose:** Execute mass status updates or deletions across multiple selected invoices.
- **Source Citation:** `[SEEN /invoices | IN-ux-screenshots/15-pass2-bulk-actions.png, 36-pass7-destructive-confirm.png]`.
- **On-Screen Content:**
  - Sticky bulk toolbar with dropdown `"Actions"` (options: `Edit`, `Clone`, `Download`, `Email`, `Mark Sent`, `Mark Paid`, `Archive`, `Delete`, `Cancel`).
  - Destructive confirmation modal (for Delete/Cancel):
    - Header: Confirmation prompt
    - Message: `"Are you sure you want to delete these records?"`
    - Buttons: `"Cancel"` (neutral gray), `"Delete"` (solid red)
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Delete"` in modal $\rightarrow$ Soft-deletes selected rows, restores inventory for standard lines, decrements customer balance, updates list with toast.
  - Button `"Cancel"` $\rightarrow$ Dismisses modal without modifying records.
- **Primary Action:** Click `"Delete"` (or selected bulk action).

---

### Module 6: Payments & Credits

#### Screen 6.1: Payments List (`/payments`)
- **Purpose:** Track cash receipts, allocations across invoices, overpayments, and payment methods.
- **Source Citation:** `[SEEN /payments | IN-ux-screenshots/23-pass4-payments-list.png]`.
- **On-Screen Content:**
  - Breadcrumbs: `"/ Payments"`
  - Filters: `"Lifecycle:"`, `"Status:"` (options: `Pending`, `Completed`, `Partially Unapplied`, `Unapplied`, `Refunded`, `Failed`)
  - Primary button: `"Enter Payment"` (primary solid blue)
  - Data columns: `[Selection Checkbox]`, `"Status"`, `"Number"`, `"Client"`, `"Invoice Number"`, `"Amount"`, `"Payment Type"`, `"Date"`, `"Actions"`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Enter Payment"` $\rightarrow$ Navigates to `/payments/create`.
  - Link in `"Number"` column $\rightarrow$ Navigates to `/payments/:id/edit`.
  - Row `"Actions"` dropdown $\rightarrow$ Options: `"View"`, `"Edit"`, `"Refund Payment"`, `"Email Receipt"`, `"Archive"`, `"Delete"`.
- **Primary Action:** Click `"Enter Payment"`.
- **Secondary Actions:** Filter by payment status, refund payments.
- **Loading / Empty / Error States:** Empty list renders `"No records found"`.

#### Screen 6.2: Enter Payment (`/payments/create`)
- **Purpose:** Record cash, cheque, bank transfer, or gateway payment and allocate funds across open client invoices.
- **Source Citation:** `[SEEN /payments/create | IN-ux-screenshots/24-pass4-payment-entry-form.png, 25-pass4-payment-multi-invoice.png, 26-pass4-overpayment-handling.png]`.
- **On-Screen Content:**
  - Header: `"Enter Payment"`
  - Primary inputs:
    - `"Client"` (combobox)
    - `"Amount received"` (numeric currency input)
    - Explanatory Help Text: `"Enter a value here if the total amount received was MORE than the invoice amount, or when recording a payment with no invoices. Otherwise this field should be left blank."`
    - `"Payment Date"` (date picker, defaults to today)
    - `"Payment Type"` (dropdown: Cash, Bank Transfer, Cheque, Credit, etc.)
    - `"Transaction Reference"` (text input for cheque/UTR number)
    - `"Private Notes"` (textarea)
    - Checkbox: `"Email payment receipt to client"`
  - Dynamic Invoices Allocation Table (mounts upon selecting client):
    - Columns: `[Selection Checkbox]`, `"Number"`, `"Date"`, `"Balance"`, `"Received"`
    - Each row contains an editable numeric input for `"Received"` amount.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Client combobox $\rightarrow$ Selecting client fetches open invoices and renders allocation table.
  - Checkbox on invoice row $\rightarrow$ Checking row auto-populates that row's `"Received"` input with its exact remaining balance.
  - Numeric input `"Received"` on invoice row $\rightarrow$ Allows manual entry of partial allocation. Values greater than invoice balance are rejected with inline border highlight.
  - Sticky Button `"Save"` $\rightarrow$ Submits payment payload; allocates funds to invoices; reduces invoice balances; writes overpayment surplus (if any) to `clients.payment_balance`; redirects to `/payments/:id/edit` with green toast `"Successfully created payment"`.
- **Primary Action:** Click `"Save"`.
- **Secondary Actions:** Email payment receipt, enter unapplied deposit.
- **Loading / Empty / Error States:**
  - Overpayment handling: If `"Amount received"` exceeds total allocated across invoices, the surplus is accepted without error; payment badge is set to `"Partially Unapplied"` (or `"Unapplied"` if no invoices selected); customer `Payment Balance` increases.

#### Screen 6.3: Refund Payment Modal
- **Purpose:** Issue a full or partial refund against a previously recorded payment.
- **Source Citation:** `[SEEN /payments/:id/edit | IN-ux-screenshots/27-pass4-refund-modal.png]`.
- **On-Screen Content:**
  - Modal title: `"Refund Payment"`
  - Inputs:
    - `"Refund Amount"` (defaults to total unrefunded balance)
    - `"Gateway Refund Checkbox"` (if payment was processed via online gateway)
    - `"Refund Date"` (defaults to today)
    - `"Transaction Reference"`
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Refund"` $\rightarrow$ Unwinds invoice payment allocation; restores open balance on parent invoice; mutates payment status pill to `"Refunded"`; logs activity entry.
  - Button `"Cancel"` $\rightarrow$ Closes modal without refunding.
- **Primary Action:** Click `"Refund"`.

---

### Module 7: Quotes

#### Screen 7.1: Quotes List (`/quotes`)
- **Purpose:** Track pre-sales estimates, expiration dates, client approvals, and conversion to invoices.
- **Source Citation:** `[SEEN /quotes | IN-batch-6-other-documents.md]`.
- **On-Screen Content:**
  - Breadcrumbs: `"/ Quotes"`
  - Filters: `"Lifecycle:"`, `"Status:"` (`Draft`, `Sent`, `Approved`, `Converted`, `Expired`)
  - Primary button: `"New Quote"` (solid blue)
  - Data columns (7 data columns + 2 utility, confirmed live): `[Selection Checkbox]`, `"Status"`, `"Number"`, `"Client"`, `"Amount"`, `"Net Amount"`, `"Date"`, `"Valid Until"`, `"Actions"`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Quote"` $\rightarrow$ Navigates to `/quotes/create`.
  - Link in `"Number"` column $\rightarrow$ Navigates to `/quotes/:id/edit`.
  - Row action `"Convert to Invoice"` $\rightarrow$ Converts quote to invoice.
- **Primary Action:** Click `"New Quote"`.
- **Secondary Actions:** Email quote, convert quote.

#### Screen 7.2: Create / Edit Quote (`/quotes/create`, `/quotes/:id/edit`)
- **Purpose:** Author and issue sales quotations and estimates.
- **Source Citation:** `[SEEN /quotes/create | IN-ux-screenshots/28-pass5-quote-create.png]`.
- **On-Screen Content:**
  - Header: `"New Quote"`, Sticky button `"Save"`.
  - Form layout is visually identical to Invoice Create:
    - Entity Selector: `"Client"`
    - Date field: `"Valid Until"` (replaces `"Due Date"`)
    - Identifier: `"Quote #"`
    - Line Items Grid: Identical columns (`Item`, `Description`, `Unit Cost`, `Quantity`, `Discount`, `Line Total`).
    - Note: Total box confusingly displays label `"Balance Due: $0.00"` despite being a non-binding quotation.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Save"` $\rightarrow$ Saves quote as `"Draft"`.
  - Button `"Email Quote"` (on edit view) $\rightarrow$ Dispatches quote PDF to client.
  - Button `"Convert to Invoice"` (on edit view) $\rightarrow$ Executes `QuoteService::convert()`; creates new draft invoice; mutates quote status to `"Converted"`; updates route.
- **Primary Action:** Click `"Save"` (or `"Convert to Invoice"` when editing).
- **Secondary Actions:** Email quote, preview PDF.
- **Loading / Empty / Error States:** Stock is **not** decremented upon saving a quote; inventory is only decremented when the quote is converted to an invoice.

---

### Module 8: Recurring Invoices

#### Screen 8.1: Recurring Invoices List (`/recurring_invoices`)
- **Purpose:** Monitor automated billing schedules, cadence intervals, remaining cycles, and auto-bill statuses.
- **Source Citation:** `[SEEN /recurring_invoices | IN-batch-6-other-documents.md]`.
- **On-Screen Content:**
  - Breadcrumbs: `"/ Recurring Invoices"`
  - Columns: `[Selection Checkbox]`, `"Status"`, `"Number"`, `"Client"`, `"Frequency"`, `"Next Send Date"`, `"Remaining Cycles"`, `"Amount"`, `"Actions"`.
  - Primary button: `"New Recurring Invoice"`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Recurring Invoice"` $\rightarrow$ Navigates to `/recurring_invoices/create`.
  - Row action `"Stop"` / `"Start"` $\rightarrow$ Toggles active schedule state.
- **Primary Action:** Click `"New Recurring Invoice"`.

#### Screen 8.2: Create / Edit Recurring Invoice (`/recurring_invoices/create`)
- **Purpose:** Configure subscription templates, recurrence frequencies, auto-charge rules, and line items.
- **Source Citation:** `[SEEN /recurring_invoices/create | IN-ux-screenshots/31-pass5-recurring-invoice-create.png]`.
- **On-Screen Content:**
  - Header: `"New Recurring Invoice"`, Sticky button `"Save"`.
  - Left Panel Metadata (distinct scheduling inputs):
    - `"Frequency"` dropdown (options: `Weekly`, `Two weeks`, `Four weeks`, `Monthly`, `Two months`, `Three months`, `Four months`, `Six months`, `Annually`, `Two years`, `Three years`)
    - `"Remaining Cycles"` (default `-1`, representing infinite recurrence)
    - `"Auto-Bill"` dropdown (`Always`, `Opt-in`, `Opt-out`, `Disabled`)
    - `"Next Send Date"` (calendar picker)
    - `"Due Date"` terms dropdown (`Use payment terms`, `First day of the month`, `Last day of the month`)
  - Line Items Grid: Identical to standard invoice.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Save"` $\rightarrow$ Persists recurring schedule; registered for execution by daily cron.
- **Primary Action:** Click `"Save"`.
- **Secondary Actions:** Configure auto-bill parameters.

---

### Module 9: Credit Notes

#### Screen 9.1: Credits List (`/credits`)
- **Purpose:** Track credit notes issued to customers, unallocated balances, and credit applications.
- **Source Citation:** `[SEEN /credits | IN-batch-6-other-documents.md]`.
- **On-Screen Content:**
  - Breadcrumbs: `"/ Credits"`
  - Columns: `[Selection Checkbox]`, `"Status"`, `"Number"`, `"Client"`, `"Amount"`, `"Balance"` (unallocated credit), `"Date"`, `"Actions"`.
  - Primary button: `"Enter Credit"`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Enter Credit"` $\rightarrow$ Navigates to `/credits/create`.
  - Row action `"Apply Credit"` $\rightarrow$ Opens modal to apply credit against open client invoices.
- **Primary Action:** Click `"Enter Credit"`.

#### Screen 9.2: Enter Credit (`/credits/create`)
- **Purpose:** Issue a credit note to reduce a customer's accounts receivable debt or create a credit pool.
- **Source Citation:** `[SEEN /credits/create | IN-ux-screenshots/30-pass5-credit-create.png]`.
- **On-Screen Content:**
  - Header: `"Enter Credit"`, Sticky button `"Save"`.
  - Entity selector: `"Client"`
  - Date: `"Credit Date"`
  - Number: `"Credit #"`
  - Line Items Grid: Identical to invoice line grid. Unit costs are typed as positive numbers (e.g. `50.00`) and compute a positive line total `$50.00`. There is no red warning tint or negative currency sign in the entry grid.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Save"` $\rightarrow$ Saves credit note; increments `clients.credit_balance`; does **not** move physical inventory stock.
  - Button `"Apply Credit"` (on saved credit view) $\rightarrow$ Creates a payment record of type `Credit` linking credit note to chosen unpaid invoice.
- **Primary Action:** Click `"Save"`.

---

### Module 10: Expenses, Vendors & Purchase Orders

#### Screen 10.1: Vendors List & Create (`/vendors`, `/vendors/create`)
- **Purpose:** Maintain supplier records, contact directories, and accounts payable histories.
- **Source Citation:** `[CODE app/Models/Vendor.php, public/Vendor-HgcXztny.js, IN-batch-8-purchases-banking.md]`.
- **On-Screen Content:**
  - List columns: `[Selection Checkbox]`, `"Name"`, `"Phone"`, `"Email"`, `"Actions"`.
  - Create form tabs: `"Details"`, `"Contacts"`, `"Expenses"`, `"Documents"`.
  - Fields: `Name`, `Number`, `Classification` dropdown (`individual`, `business`, `company`, etc.), `Currency`, `VAT/Tax ID`, `Work Phone`, `Website`, `Address 1 & 2`, `City`, `State`, `Postal Code`, `Country`, `Private Notes`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Vendor"` $\rightarrow$ Opens `/vendors/create`.
  - Button `"Save"` $\rightarrow$ Persists vendor record.
- **Primary Action:** Click `"Save"`.

#### Screen 10.2: Expenses List & Create (`/expenses`, `/expenses/create`)
- **Purpose:** Log company expenditures, attach receipts, categorize costs, and convert billable expenses into invoice lines.
- **Source Citation:** `[CODE app/Models/Expense.php, IN-batch-8-purchases-banking.md]`.
- **On-Screen Content:**
  - List columns: `[Selection Checkbox]`, `"Status"` (dynamically calculated: `Logged`, `Pending`, `Invoiced`, `Paid`), `"Vendor"`, `"Client"`, `"Amount"`, `"Date"`, `"Category"`, `"Actions"`.
  - Create inputs:
    - `"Vendor"` (combobox)
    - `"Client"` (combobox — required if marking billable)
    - `"Amount"` (numeric currency)
    - `"Expense Date"`
    - `"Category"` (dropdown)
    - Toggles: `"Should be Invoiced"` (billable flag), `"Mark Paid"`
    - File upload zone: Attach receipts / invoices.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Expense"` $\rightarrow$ Navigates to `/expenses/create`.
  - Button `"Save"` $\rightarrow$ Saves expense.
  - Row action `"Invoice Expense"` $\rightarrow$ Converts billable expense into an invoice line item (`type_id = 3`); populates `expenses.invoice_id`.
- **Primary Action:** Click `"Save"`.

#### Screen 10.3: Purchase Orders (`/purchase_orders`, `/purchase_orders/create`)
- **Purpose:** Issue purchase commitments to vendors and receive incoming stock into inventory.
- **Source Citation:** `[SEEN /purchase_orders/create | IN-ux-screenshots/32-pass5-purchase-order-create.png]`.
- **On-Screen Content:**
  - Form layout is identical to Invoice Create, but entity combobox is labeled `"Vendor"`.
  - Columns: Drag Grip, `"Item"`, `"Description"`, `"Unit Cost"`, `"Quantity"`, `"Line Total"`.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Save"` $\rightarrow$ Saves PO in `"Draft"` status.
  - Button `"Mark Received"` (on PO edit view) $\rightarrow$ Increments product physical inventory (`in_stock_quantity`); marks status `Received`.
  - Action `"Convert to Expense"` $\rightarrow$ Transforms purchase order into an active expense.
- **Primary Action:** Click `"Save"` (or `"Mark Received"` upon physical delivery).

---

### Module 11: Projects & Tasks

#### Screen 11.1: Projects List & Overview (`/projects`, `/projects/:id`)
- **Purpose:** Group tasks, budgets, and expenses under a parent customer project.
- **Source Citation:** `[CODE app/Models/Project.php, public/Project-DwIVBcis.js, IN-batch-12-everything-else.md]`.
- **On-Screen Content:**
  - List columns: `"Name"`, `"Client"`, `"Budgeted Hours"`, `"Budgeted Amount"`, `"Due Date"`.
  - Overview screen tabs: `"Overview"`, `"Tasks"`, `"Expenses"`, `"Invoices"`, `"Quotes"`, `"Documents"`.
  - Overview tab displays: Budget progress bar (`logged_hours` vs `budgeted_hours`), assigned staff, color picker, client name.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"New Project"` $\rightarrow$ Opens project creation modal.
  - Project action `"Invoice Project"` $\rightarrow$ Aggregates all unbilled tasks and billable expenses into an invoice creation screen; upon saving, updates `tasks.invoice_id` and `expenses.invoice_id`.
- **Primary Action:** Click `"Save"` (or `"Invoice Project"`).

#### Screen 11.2: Tasks & Stopwatch (`/tasks`, `/tasks/create`)
- **Purpose:** Log billable time intervals, run live stopwatch timers, and invoice hourly labor.
- **Source Citation:** `[CODE app/Models/Task.php, IN-batch-12-everything-else.md]`.
- **On-Screen Content:**
  - Task table columns: `[Selection Checkbox]`, `"Status"`, `"Number"`, `"Client"`, `"Project"`, `"Description"`, `"Duration"` (formatted HH:MM:SS), `"Rate"`, `"Timer Control"` (Play/Stop button).
  - Stopwatch Widget: An active timer displays a green flashing dot and running time calculation.
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Button `"Start Timer"` $\rightarrow$ Sets `is_running = true`; appends `[start_time, 0, "", true]` to `time_log` JSON; begins live ticking.
  - Button `"Stop Timer"` $\rightarrow$ Sets `is_running = false`; updates tuple index 1 to `time()`; calculates final duration.
  - Bulk action `"Invoice Tasks"` $\rightarrow$ Converts selected tasks into invoice lines (`type_id = 2`); formats description with duration, rate, and dates; redirects to `/invoices/create`.
- **Primary Action:** Click `"Start Timer"` or `"Invoice Tasks"`.

---

### Module 12: Reports & Exports (`/reports`)

- **Purpose:** Filter and export financial, operational, and tax data.
- **Source Citation:** `[SEEN /reports | IN-ux-screenshots/33-pass6-reports-overview.png]`, `[CODE app/Export/CSV/BaseExport.php, app/Services/Report/ProfitLoss.php]`.
- **On-Screen Content:**
  - Breadcrumb: `"/ Reports"`
  - Three Filter Dropdowns:
    1. `"Report"` (28 selectable types: `Invoices`, `Invoice Items`, `Clients`, `Payments`, `Expenses`, `Tasks`, `Products`, `Product Sales`, `Profit and Loss`, `Aged Receivable Detailed`, `Aged Receivable Summary`, `Client Balance`, `Tax Summary`, `Tax Period`, `User Sales`, etc.)
    2. `"Date Range"` (`All`, `Today`, `Yesterday`, `This Month`, `Last Month`, `This Year`, `Last Year`, `Custom`)
    3. `"Status"` (`Active`, `Archived`, `Deleted`)
  - Content area: **No on-screen data table or chart renders**. Displays static placeholder instruction: `"Click Export to download your report in CSV format"`.
  - Top-Right Action Button: `"Export"` (primary solid blue).
- **Every Clickable Element $\rightarrow$ Action/Target:**
  - Dropdowns (`Report`, `Date Range`, `Status`) $\rightarrow$ Updates filter payload in React client state.
  - Button `"Export"` $\rightarrow$ Initiates immediate HTTP download stream of CSV file (`<report_name>_report_<date>.csv`).
- **Primary Action:** Click `"Export"`.
- **Secondary Actions:** Select different report types or date ranges.
- **Loading / Empty / Error States:** Navigating away from `/reports` and returning resets filter dropdowns back to defaults (`Invoices`, `All`). The browser triggers direct file download; no progress bar is shown.
- **Special Financial Logic (Profit & Loss):** Backend supports accrual basis (default) and cash basis flags; however, the UI dropdown exports data as a static summary file.

---

### Module 13: Settings (`/settings`)

- **Purpose:** System-wide administration across 25 dedicated panels divided between Basic and Advanced sections.
- **Source Citation:** `[SEEN /settings | IN-ux-screenshots/34-pass6-settings-findability.png]`, `[CODE app/DataMapper/CompanySettings.php, public/hooks-xq8zuwtp.js, IN-batch-10-settings.md]`.

#### Settings 25-Tab Navigation Structure

- **Basic Settings (13 Panels):**
  1. `Company Details` (`/settings/company_details`)
  2. `User Details` (`/settings/user_details`)
  3. `Localization` (`/settings/localization`)
  4. `Payment Settings` (`/settings/online_payments`)
  5. `Tax Settings` (`/settings/tax_settings`)
  6. `Product Settings` (`/settings/product_settings`)
  7. `Task Settings` (`/settings/task_settings`)
  8. `Tags` (`/settings/tags`)
  9. `Expense Settings` (`/settings/expense_settings`)
  10. `Workflow Settings` (`/settings/workflow_settings`)
  11. `Account Management` (`/settings/account_management`)
  12. `Backup & Restore` (`/settings/backup_restore`)
  13. `Import & Export` (`/settings/import_export`)

- **Advanced Settings (12 Panels):**
  14. `Invoice Design` (`/settings/invoice_design`)
  15. `Custom Fields` (`/settings/custom_fields`)
  16. `Generated Numbers` (`/settings/generated_numbers`)
  17. `Client Portal` (`/settings/client_portal`)
  18. `E-Invoicing` (`/settings/e_invoice`)
  19. `Email Settings` (`/settings/email_settings`)
  20. `Templates & Reminders` (`/settings/templates_and_reminders`)
  21. `Bank Accounts` (`/settings/bank_accounts`)
  22. `Group Settings` (`/settings/group_settings`)
  23. `Subscriptions` (`/settings/subscriptions`)
  24. `Schedules` (`/settings/schedules`)
  25. `User Management` (`/settings/users`)

#### Key Settings Panels Detail:
1. **Generated Numbers (`/settings/generated_numbers`):**
   - Configures numbering patterns for 10 entities (Invoices, Quotes, Credits, Payments, Recurring Invoices, Purchase Orders, Clients, Vendors, Tasks, Expenses).
   - Pattern Replacement Tokens: `{$counter}`, `{$year}`, `{$date:format}`, `{$client_number}`, `{$user_id}`.
   - Counter Padding (default: `4`, e.g. `0001`).
   - Reset Frequency dropdown: `Never`, `Daily`, `Weekly`, `Monthly`, `Annually`.
   - Shared Counter toggles: `"Shared Invoice/Quote Counter"`, `"Shared Invoice/Credit Counter"`.
2. **Custom Fields (`/settings/custom_fields`):**
   - Configures exactly 4 custom fields (`custom_value1..4`) per entity across 10 entities plus line items.
   - Syntax: Pipe-delimited string (`Label|type|options`), supporting Text, Dropdown, Date, Switch, and Number types.
3. **Tax Settings (`/settings/tax_settings`):**
   - Toggle: `"Inclusive Taxes"` (tax-inclusive pricing).
   - Tax Rates Table: Create, edit, and archive regional sales tax rates.
4. **Workflow Settings (`/settings/workflow_settings`):**
   - Dropdown `"Lock Invoices"`: `Off`, `When Sent`, `When Paid`, `End of Month`.
   - Dropdown `"Counter Number Applied"`: `When Saved`, `When Sent`.
   - Toggles: `"Auto Email Invoice"`, `"Auto Archive Invoice"`, `"Auto Convert Quote"`.
5. **Localization (`/settings/localization`):**
   - Dropdowns for `Currency`, `Timezone`, `Date Format` (14 options), `Language`.
   - Toggles for `24-Hour Military Time`, `Show Currency Code`.
6. **Company Details (`/settings/company_details`):**
   - Name, Address, VAT/Tax ID, Logo upload, Default Payment Terms.
7. **User Management (`/settings/users`):**
   - Multi-user invitations, Role assignment (`Administrator` vs `Standard User`), granular per-entity permissions (`Create`, `View`, `Edit`).
8. **Import & Export (`/settings/import_export`):**
   - CSV Importer supporting 11 mapped entity files; FreshBooks, Wave, Zoho, QuickBooks migration parsers; Full JSON export button.
9. **Backup & Restore (`/settings/backup_restore`):**
   - One-click full company JSON backup generation; database restore trigger (warning: restoring overwrites existing transactional data).

---

## 3. Secondary flows

### 3.1 Returning User Login
A user with an existing authenticated session cookie navigates to `http://localhost:8090/`. The backend middleware detects an active session and automatically bypasses the login card, redirecting immediately to `/dashboard`.

### 3.2 Forgot Password Flow
1. User clicks `"Forgot your password?"` on the login card.
2. Lands on `/forgot_password`.
3. Types registered email address $\rightarrow$ Clicks `"Send Password Reset Link"`.
4. System dispatches email containing a signed token link.
5. User clicks email link $\rightarrow$ Lands on `/reset_password/:token`.
6. Types new password and password confirmation $\rightarrow$ Clicks `"Reset Password"`.
7. Session authenticates; redirects to `/dashboard`.

### 3.3 Bulk Operations Flow
1. User navigates to any list screen (`/invoices`, `/clients`, `/payments`).
2. Toggles one or more row checkboxes (or the table header master checkbox).
3. The table header reveals a sticky button labeled `"Actions"`.
4. User clicks `"Actions"` $\rightarrow$ Selects target operation (e.g. `Mark Sent`, `Email`, `Download`, `Archive`, `Delete`).
5. Non-destructive actions execute immediately with a toast notification.
6. Destructive actions display a confirmation modal (`"Are you sure you want to delete these records?"`) with `"Cancel"` and `"Delete"` buttons.
7. Once confirmed, backend executes batch SQL; updates rows; updates toast counter.

### 3.4 Data Import Pipeline
1. User navigates to `/settings/import_export`.
2. Under `"Import"`, selects file type (`CSV`, `QuickBooks`, `Wave`, etc.).
3. Uploads CSV file(s) $\rightarrow$ Clicks `"Upload"`.
4. Backend executes `preimport` analysis: detects delimiter (`,`, `;`, `\t`, `|`), detects encoding, caches file.
5. Column Mapping Screen opens: displays source file headers on left and Invoice Ninja entity fields on right with predictive mapping suggestions.
6. User reviews and adjusts column mappings $\rightarrow$ Clicks `"Import"`.
7. Backend dispatches background queue job `CSVIngest`. Multi-row invoices sharing identical numbers are grouped into single invoices. Invalid rows are skipped and logged to an error array without halting the rest of the import.
8. Green completion banner displays number of ingested records.

### 3.5 Updating Company Settings
1. User navigates to `/settings` $\rightarrow$ Selects a sub-panel (e.g. `/settings/generated_numbers`).
2. Modifies desired field values (e.g. updates Invoice Number Pattern to `INV-{$year}-{$counter}`).
3. Clicks bottom or header button `"Save"`.
4. Button enters disabled state with spinner $\rightarrow$ Persists to `company.settings` JSON column.
5. Green toast confirms: `"Successfully updated settings"`.
6. All subsequently generated documents instantly reflect the updated numbering pattern.

---

## 4. Global states & patterns

### 4.1 Table & List Behavior
- **Default Density:** Defaults to `10` rows per page across all list screens. User can adjust to `25`, `50`, or `100` via dropdown.
- **Search Mechanics:** Instant live filtering on keyup; indexes document numbers, customer names, numeric totals, and line item descriptions without requiring an "Apply" button.
- **Filter Persistence:** Active lifecycle and status filter selections persist in React client memory during SPA route transitions, but reset upon hard browser reload (`F5`).
- **Sorting:** Supports natural numeric sorting (e.g. `0002` sorts before `0010`).
- **Column Customization:** Accessible via a small gear icon in the table header; opens a checklist of selectable columns; requires `3 clicks` to persist.

### 4.2 Status Badge Styling
- Status indicators render as uniform rounded pastel pill badges (`padding: 2px 8px`, `font-size: 12px`):
  - `Draft`: Neutral gray badge (`#F3F4F6`)
  - `Sent`: Soft sky blue badge (`#E0F2FE`)
  - `Paid`: Light green badge (`#DCFCE7`)
  - `Partial/Deposit`: Amber/yellow badge (`#FEF3C7`)
  - `Past Due`: Light rose/red badge (`#FFE4E6`)
  - `Cancelled` / `Reversed`: Dark gray/slate badge
- **Iconography:** Badges contain **zero status icons** (no checkmarks, clock icons, or warning triangles).

### 4.3 Dialogs, Modals & Destructive Confirmations
- **Single-Row Deletion:** Clicking `"Delete"` on a single invoice or client row deletes the item **immediately without any confirmation modal**. A toast banner displays `"Successfully deleted invoice"` but provides **no Undo button**. To rescue a soft-deleted item, user must filter lifecycle to `"Deleted"` and click `"Restore"`.
- **Bulk Deletion:** Mass deletion displays a modal dialog: `"Are you sure you want to delete these records?"` with `"Cancel"` and `"Delete"` buttons.

### 4.4 Save, Save & New, and Draft Protection
- **No "Save & New" Path:** There is **no Save & New button** on any document or master record form. Every save redirects to the record's Edit view, requiring 2 additional clicks to return to the list and spawn another new form.
- **No In-Flight Route Guard:** Navigating away from an uncommitted form (e.g. clicking a sidebar link while typing an invoice) provides **zero warning or confirmation prompt**. The view switches immediately, and **all unsaved entered content is permanently lost**.
- **Session Expiry Rescue:** When an API request fails with HTTP 412 (session timeout), the React SPA presents a password re-entry modal over the current screen, preserving entered form data.

### 4.5 Keyboard Shortcuts
- **Form Auto-Focus:** None. New form routes (`/invoices/create`, `/clients/create`, `/products/create`) open with focus on `<BODY>`. Keyboard entry requires Tab cycling or mouse click.
- **Standard Save Shortcut:** Pressing `Ctrl+S` or `Cmd+S` triggers the browser's native "Save Page As" dialog rather than saving the form.
- **Command Palette:** Global command search is invoked via shortcut or by clicking the header search input.

### 4.6 Toast & Notification Styling
- **Success Toasts:** Slide in at top-right in solid green (`#10B981`) with white text (e.g. `"Successfully created invoice"`, `"Successfully updated settings"`). Auto-dismiss after ~3.5 seconds.
- **Validation Error Alerts:** Top-right red floating toast (e.g. `"Invoice number already taken"`).
- **Generic Error Banner:** Sticky top banner reading `"Something went wrong"` across the screen header.

---

## 5. Click/link map (quick index)

| Screen | Element Label | Element Type | Opens / Links to | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Login (Step 1)** | `"Continue"` | Button | Step 2 (Password card) | Validates email existence via AJAX |
| **Login (Step 2)** | `"Login"` | Button | `/dashboard` | Authenticates and enters app |
| **Login (Step 2)** | `"Change"` | Link | Step 1 (Email card) | Allows re-typing email |
| **Login (Step 2)** | `"Forgot your password?"` | Link | `/forgot_password` | Opens password recovery |
| **Login (Step 2)** | `"Login with a Passkey"` | Button | WebAuthn prompt | Hardware key / biometric challenge |
| **Global Shell** | `"Dashboard"` | Sidebar link | `/dashboard` | Returns to analytics hub |
| **Global Shell** | `"Clients"` | Sidebar link | `/clients` | Opens clients list |
| **Global Shell** | `"Products"` | Sidebar link | `/products` | Opens product catalog |
| **Global Shell** | `"Invoices"` | Sidebar link | `/invoices` | Opens invoice management |
| **Global Shell** | `"Recurring Invoices"`| Sidebar link | `/recurring_invoices` | Opens recurring schedules |
| **Global Shell** | `"Payments"` | Sidebar link | `/payments` | Opens payments list |
| **Global Shell** | `"Quotes"` | Sidebar link | `/quotes` | Opens pre-sales quotes |
| **Global Shell** | `"Credits"` | Sidebar link | `/credits` | Opens credit notes list |
| **Global Shell** | `"Projects"` | Sidebar link | `/projects` | Opens project tracker |
| **Global Shell** | `"Tasks"` | Sidebar link | `/tasks` | Opens task & timer grid |
| **Global Shell** | `"Vendors"` | Sidebar link | `/vendors` | Opens vendor directory |
| **Global Shell** | `"Purchase Orders"` | Sidebar link | `/purchase_orders` | Opens vendor PO ledger |
| **Global Shell** | `"Expenses"` | Sidebar link | `/expenses` | Opens expense tracker |
| **Global Shell** | `"Recurring Expenses"`| Sidebar link | `/recurring_expenses` | Opens scheduled costs |
| **Global Shell** | `"Transactions"` | Sidebar link | `/bank_transactions` | Opens banking transaction rules |
| **Global Shell** | `"Reports"` | Sidebar link | `/reports` | Opens report export screen |
| **Global Shell** | `"Settings"` | Sidebar link | `/settings` | Opens settings hub |
| **Global Header** | `"Purchase White Label"`| Header button | Checkout modal | Commercial licensing prompt |
| **Global Header** | `"Find invoices..."` | Search input | Predictive search dropdown | Global fuzzy search |
| **Invoices List** | `"New Invoice"` | Primary button | `/invoices/create` | Starts blank invoice |
| **Invoices List** | `"Number"` column link | Table link | `/invoices/:id/edit` | Opens invoice editor |
| **Invoices List** | `"Client"` column link | Table link | `/clients/:id` | Opens client overview |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Edit"` | Menu item | `/invoices/:id/edit` | Direct edit route |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Enter Payment"`| Menu item | Payment slide-over modal | Pre-populates invoice & balance |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Mark Sent"`| Menu item | In-place update | Advances status to Sent |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Mark Paid"`| Menu item | In-place update | Auto-generates full payment |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Cancel"` | Menu item | In-place update | Zeroes balance; keeps stock |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Reverse"`| Menu item | In-place update | Issues credit note for paid amount |
| **Invoices List** | Row `"Actions"` $\rightarrow$ `"Delete"` | Menu item | In-place update | Soft-deletes; restores inventory |
| **Invoices List** | Table gear icon | Icon button | Column customizer modal | Configures visible columns |
| **Invoices List** | Master checkbox | Checkbox | Sticky bulk toolbar | Reveals bulk `"Actions"` |
| **Invoice Create** | `"Save"` | Sticky button | `/invoices/:id/edit` | Persists draft; assigns number |
| **Invoice Create** | `"+ New Client"` | Button | Slide-over drawer | 31-field inline client creation |
| **Invoice Create** | `"+ Add Item"` | Button | New row appended | Adds catalog product line |
| **Invoice Create** | `"+ Add Line"` | Button | New row appended | Adds free-text ad-hoc line |
| **Invoice Create** | Trash icon (`x`) | Row button | Row removed | Deletes line; recalculates total |
| **Invoice Edit** | `"Enter Payment"` | Header button | Payment slide-over modal | Contextual payment entry |
| **Invoice Edit** | `"Email Invoice"` | Header button | Email confirmation modal | Dispatches email to client |
| **Invoice Edit** | `"PDF"` | Header button | New browser tab / PDF stream | Renders printable document |
| **Invoice Edit** | `"View Portal"` | Header button | `/client/portal` in new tab | Passwordless magic portal view |
| **Invoice Edit** | `"Delivery Note"` | Kebab item | PDF download stream | Strips prices; produces packing slip |
| **Clients List** | `"New Client"` | Primary button | `/clients/create` | Starts blank client form |
| **Clients List** | `"Name"` column link | Table link | `/clients/:id` | Opens client command center |
| **Client Overview** | `"New Invoice"` | Action button | `/invoices/create` | Pre-selects this client |
| **Client Overview** | `"Enter Payment"` | Action button | `/payments/create` | Pre-selects this client |
| **Client Overview** | Sub-Tabs (1–12) | Tab button | Filtered sub-grid below | Swaps between customer ledgers |
| **Client Overview** | Kebab $\rightarrow$ `"Statement"` | Menu item | Statement modal | Generates statement / aging PDF |
| **Client Overview** | Kebab $\rightarrow$ `"Merge"` | Menu item | Merge modal | Permanently consolidates account |
| **Products List** | `"New Product"` | Primary button | `/products/create` | Starts blank catalog item |
| **Product Create** | `"Save"` | Sticky button | `/products/:id/edit` | Persists SKU and price |
| **Payments List** | `"Enter Payment"` | Primary button | `/payments/create` | Opens payment entry form |
| **Payment Create** | Invoice row checkbox | Table checkbox | In-place field fill | Allocates exact invoice balance |
| **Payment Create** | `"Save"` | Sticky button | `/payments/:id/edit` | Posts receipt; updates balances |
| **Payment Edit** | Kebab $\rightarrow$ `"Refund Payment"`| Menu item | Refund modal | Restores debt; marks refunded |
| **Quote Create** | `"Save"` | Sticky button | `/quotes/:id/edit` | Saves non-binding quotation |
| **Quote Edit** | `"Convert to Invoice"` | Action button | `/invoices/:new_id/edit` | Clones quote into draft invoice |
| **Recurring Create**| `"Save"` | Sticky button | `/recurring_invoices/:id` | Registers automated schedule |
| **Credit Create** | `"Save"` | Sticky button | `/credits/:id/edit` | Issues customer credit pool |
| **Purchase Order** | `"Mark Received"` | Action button | In-place state update | Increments physical stock |
| **Reports** | `"Export"` | Primary button | Browser file download | Streams CSV file directly |
| **Settings Hub** | Panel links (1–25) | Navigation link | `/settings/:subpanel` | Switches active configuration tab |
| **Settings Panel** | `"Save"` | Action button | In-place persistence | Updates company configuration |
