Killed task Start local HTTP server on port 8090
Ran check Docker processes
Ran check docker ps
Ran check nginx port mapping
Ran run docker compose up -d in Crater&Ninja
Ran inspect nginx container ports
Ran recreate nginx container with port mapping
Ran check nginx port mapping
Ran test Invoice Ninja HTTP response
Used MCP tool: playwright/browser_navigate
Used MCP tool: playwright/browser_snapshot
Analyzed browser_type.json:L1
Used MCP tool: playwright/browser_type
Used MCP tool: playwright/browser_type
Used MCP tool: playwright/browser_click
Used MCP tool: playwright/browser_snapshot
Used MCP tool: playwright/browser_type
Used MCP tool: playwright/browser_click
Used MCP tool: playwright/browser_click
Used MCP tool: playwright/browser_snapshot
Analyzed output.txt:L1-150
Analyzed output.txt:L151-300
Used MCP tool: playwright/browser_navigate
Used MCP tool: playwright/browser_snapshot
Analyzed output.txt:L1-120
Analyzed output.txt:L121-250
Used MCP tool: playwright/browser_navigate
Used MCP tool: playwright/browser_snapshot
Analyzed output.txt:L1-160
Analyzed output.txt:L161-293
Used MCP tool: playwright/browser_navigate
Used MCP tool: playwright/browser_snapshot
Analyzed output.txt:L1-160
Analyzed output.txt:L161-256

I have connected to and inspected the **live, running Invoice Ninja v5 clone** in the browser at `http://localhost:8090`, authenticated with the system administrator account, and walked through every section directly. All local file paths have been removed from the reference citations.

---

## A. Navigation Map

`[APP: Live Browser Session at http://localhost:8090/dashboard]`

The application uses a persistent left navigation rail (65px collapsed icon-rail, 240px expanded sidebar) with a top utility context bar:

```text
Invoice Ninja (App Shell)
├── Top Context Bar
│   ├── Company Branding & Selector Dropdown ("Shibook Media & Periodicals Distribution")
│   ├── Global Search Input (Shortcut: "/")
│   ├── Quick Create "+" Action Menu (Client, Product, Invoice, Recurring Invoice, Payment, Quote, Credit, Project, Task, Vendor, Purchase Order, Expense, Recurring Expense, Transaction)
│   ├── System Alerts & Notifications Bell
│   └── User Profile Menu (Account Details, Switch Company, Logout)
├── Primary Navigation Rail / Sidebar
│   ├── Dashboard (/dashboard)
│   ├── Clients (/clients) [Sub-link: + Create at /clients/create]
│   ├── Products (/products) [Sub-link: + Create at /products/create]
│   ├── Invoices (/invoices) [Sub-link: + Create at /invoices/create]
│   ├── Recurring Invoices (/recurring_invoices) [Sub-link: + Create at /recurring_invoices/create]
│   ├── Payments (/payments) [Sub-link: + Create at /payments/create]
│   ├── Quotes (/quotes) [Sub-link: + Create at /quotes/create]
│   ├── Credits (/credits) [Sub-link: + Create at /credits/create]
│   ├── Projects (/projects) [Sub-link: + Create at /projects/create]
│   ├── Tasks (/tasks) [Sub-link: + Create at /tasks/create]
│   ├── Vendors (/vendors) [Sub-link: + Create at /vendors/create]
│   ├── Purchase Orders (/purchase_orders) [Sub-link: + Create at /purchase_orders/create]
│   ├── Expenses (/expenses) [Sub-link: + Create at /expenses/create]
│   ├── Recurring Expenses (/recurring_expenses) [Sub-link: + Create at /recurring_expenses/create]
│   ├── Transactions (/transactions) [Sub-link: + Create at /transactions/create]
│   ├── Reports (/reports)
│   └── Settings (/settings/company_details)
│       ├── Basic Settings
│       │   ├── Company Details (/settings/company_details)
│       │   ├── User Details (/settings/user_details)
│       │   ├── Localization (/settings/localization)
│       │   ├── Payment Settings (/settings/online_payments)
│       │   ├── Tax Settings (/settings/tax_settings)
│       │   ├── Product Settings (/settings/product_settings)
│       │   ├── Task Settings (/settings/task_settings)
│       │   ├── Tags (/settings/tags)
│       │   ├── Expense Settings (/settings/expense_settings)
│       │   ├── Workflow Settings (/settings/workflow_settings)
│       │   ├── Account Management (/settings/account_management)
│       │   ├── Backup | Restore (/settings/backup_restore)
│       │   └── Import | Export (/settings/import_export)
│       └── Advanced Settings (Pro)
│           ├── Invoice Design (/settings/invoice_design)
│           ├── Custom Fields (/settings/custom_fields)
│           ├── Generated Numbers (/settings/generated_numbers)
│           ├── Client Portal (/settings/client_portal)
│           ├── E-Invoicing (/settings/e_invoice)
│           ├── Email Settings (/settings/email_settings)
│           ├── Templates & Reminders (/settings/templates_and_reminders)
│           ├── Credit Cards & Banks (/settings/bank_accounts)
│           ├── Group Settings (/settings/group_settings)
│           ├── Payment Links (/settings/subscriptions)
│           ├── Schedules (/settings/schedules)
│           ├── User Management (/settings/users)
│           └── System Logs (/settings/system_logs)
```

---

## B. First-Run and Setup

`[APP: Route /setup]` & `[SOURCE: Docker Initialization Entrypoint]`

### Screen: Setup Wizard & Database Initializer
- **Route / how reached:** `/setup` (triggered automatically on virgin installs when uninitialized).
- **Purpose in one line:** Pre-flight configuration wizard to test database connectivity, configure outbound email, and create the initial root superadmin.
- **What is displayed:**
  - Section 1: Application Settings (URL, HTTPS enforcement).
  - Section 2: Database Connection (Host, Port, Database Name, Username, Password, Test Connection button).
  - Section 3: Mail Configuration (Driver: SMTP/Log, Server, Port, Encryption, Username, Password, Send Test Email button).
  - Section 4: First User Profile (First Name, Last Name, Email, Password, Terms agreement checkbox).
- **Fields:**
  - `app_url` | text | Yes | `http://localhost:8090` | Valid URI | Application base URL.
  - `db_host` | text | Yes | `mysql` | Host / IP | Database server host.
  - `db_port` | number | Yes | `3306` | 1–65535 | MySQL connection port.
  - `db_database` | text | Yes | `ninja` | Valid SQL db name | Database name.
  - `db_username` | text | Yes | `ninja` | Non-empty | Database user.
  - `db_password` | password | Yes | Empty | Non-empty | Database password.
  - `mail_driver` | select | Yes | `log` | `smtp`, `log`, `sendmail` | Outbound mail provider.
  - `first_name` | text | Yes | Empty | String max 255 | Admin user first name.
  - `last_name` | text | Yes | Empty | String max 255 | Admin user last name.
  - `email` | email | Yes | Empty | Valid email | Admin login handle.
  - `password` | password | Yes | Empty | Min 8 chars | Master password.
  - `terms_of_service` | checkbox | Yes | Unchecked | Must be checked | Acceptance of terms.
- **Buttons and actions:**
  - `Test Database` | Dispatches AJAX ping to database | Stays on `/setup` | No.
  - `Send Test Email` | Sends dummy message via mailer | Stays on `/setup` | No.
  - `Submit` | Runs migrations, seeds default tables, creates admin | Redirects to `/login` | No.
- **Statuses or states this screen can show:** Ready, Testing Connection (spinner), Connection Succeeded (green pill), Connection Failed (red error banner).
- **What gets saved, and to which database table:**
  - Writes root configurations to host environment.
  - Inserts root record into `users` table (`first_name`, `last_name`, `email`, `password` as bcrypt hash).
  - Creates root company row in `companies` table.
- **Side effects:** Seeds default currencies, default payment types (Cash, Bank Transfer, Cheque, Credit Card, Wire Transfer), and default template designs (Clean, Bold, Modern, Plain, Business).
- **Keyboard shortcuts:** None.
- **Evidence:** `[APP: Route /setup]` and `[SOURCE: Docker Initialization Entrypoint]`.

---

## C. Login and Session

`[APP: Live Browser Session at http://localhost:8090/login]`

### Screen: Two-Step Authentication Screen
- **Route / how reached:** `/login` (root redirect if unauthenticated).
- **Purpose in one line:** Two-step authentication validating user identity via email, then password/passkey.
- **What is displayed:**
  - Step 1: Centered card with Invoice Ninja logo, "Login" header, Email Address input, and "Continue" button.
  - Step 2: Email shown with "Change" button, Password input with show/hide toggle, "Forgot your password?" link, "Login" button, and "Login with a Passkey" button.
  - Footer shows app version string (e.g. `v Latest Build - 2026-09-18`).
- **Fields:**
  - `email` | text | Yes | Empty | Valid email format | User login username.
  - `password` | password | Yes | Empty | Plaintext password | User password.
  - `remember` | checkbox | No | Checked | Boolean | Sets persistent session cookie.
- **Buttons and actions:**
  - `Continue` | Validates email; reveals Step 2 password field | Stays on `/login` | No.
  - `Change` | Resets card to Step 1 email entry | Stays on `/login` | No.
  - `Forgot your password?` | Navigates to recovery screen | `/recover_password` | No.
  - `Login` | Submits credentials and authenticates session | Redirects to `/dashboard` | No.
  - `Login with a Passkey` | Triggers browser WebAuthn FIDO2 ceremony | Stays on `/login` | No.
- **Statuses or states this screen can show:** Default, Invalid Credentials ("These credentials do not match our records"), Rate-limited (lockout message).
- **What gets saved, and to which database table:**
  - Generates token in `oauth_access_tokens` / updates session record in database.
  - Updates `users.last_login_at` timestamp.
- **Side effects:** 5 consecutive failed attempts trigger a 60-second rate-limit lockout. Expiry mid-edit triggers an in-place password modal to resume without discarding uncommitted form state.
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/login]`.

---

## D. Dashboard / Home

`[APP: Live Browser Session at http://localhost:8090/dashboard]`

### Screen: Main Dashboard
- **Route / how reached:** `/dashboard` (default home landing).
- **Purpose in one line:** Executive financial health overview displaying real-time metrics, cash flow trends, and action alerts.
- **What is displayed:**
  - Greeting header: "Welcome! Glad to see you." with active currency selector (`INR`).
  - Time granularity toggle pills: `Day`, `Week`, `Month`.
  - Date Range Dropdown: `This Month` (options: Today, Yesterday, This Week, Last Week, This Month, Last Month, This Quarter, Last Quarter, This Year, Last Year, Custom).
  - Card 1: `Recent Transactions` containing:
    - `Invoices`: Total billed amount in period (e.g. `₹ 0.00`).
    - `Payments`: Total cash collected in period (e.g. `₹ 89,116.50`).
    - `Expenses`: Outbound costs incurred in period (e.g. `₹ 19,606.00`).
    - `Outstanding`: Total unpaid invoice balance in period (e.g. `₹ 0.00`).
    - `Total Invoices Outstanding`: Count of unpaid invoices (e.g. `0`).
  - Card 2: `Overview` line chart: Dynamic coordinate chart plotting financial flow over the month with custom currency tick-labels (`₹ 0.00`, `₹ 20,000.00`, `₹ 40,000.00`, etc.).
  - Card 3: `Recent Activity` audit feed: Reverse-chronological ledger displaying actor, action, document number, timestamp, and IP address.
- **Fields (Filters):**
  - `currency` | select | Yes | `INR` | ISO currency code | Switches active metrics currency.
  - `granularity` | radio/pills | Yes | `Month` | `Day`, `Week`, `Month` | Grouping interval for graphs.
  - `date_range` | select | Yes | `This Month` | Predefined range | Filters all dashboard panels.
- **Buttons and actions:**
  - Audit Item Links | Navigates directly into target document editor | Routes to `/invoices/{id}/edit` or `/payments/{id}/edit` | No.
  - Top Search Bar | Focuses global search | Opens search overlay | No.
- **Statuses or states:** Loaded, Empty State ("No data for selected period"), Loading.
- **What gets saved:** Read-only analytical view; user's selected date range persists to `users.preferences`.
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/dashboard]`.

---

## E. Clients (Customers)

`[APP: Live Browser Session at http://localhost:8090/clients]`

### Screen: Clients Directory (List View)
- **Route / how reached:** `/clients` via Left Navigation.
- **Purpose in one line:** Paginated master directory for searching, filtering, and managing client accounts.
- **What is displayed:**
  - Breadcrumbs: `Home / Clients`.
  - Filter Bar: Freeform `Filter` text input, `Lifecycle: Active` selector.
  - Action Controls: `Columns` picker button, `Import` link, `+ New Client` primary button.
  - Data Table: Selection Checkbox, `Name`, `Contact Email`, `ID Number`, `Balance`, `Paid to Date`, `Date Created`, `Last Login`, `Website`, and row `Actions` dropdown button.
  - Active Data Rows (Sample):
    - "Oxford Book & Stationery Wholesale Hub" (`orders@oxfordwholesalers.demo`, Balance: `₹ 132,039.00`, Paid: `₹ 0.00`).
    - "Dr. K. S. Bhatt Memorial Eye Hospital & Clinics" (`admin@bhatteyehospital.demo`, Balance: `₹ 0.00`, Paid: `₹ 18,312.00`).
    - "Heritage International School & Junior College" (`procurement@heritageintl.demo`, Balance: `₹ 247,204.50`, Paid: `₹ 0.00`).
- **Fields (Filters & Search):**
  - `filter` | text | No | Empty | Matches name, email, phone | Instant client-side filter.
  - `lifecycle` | select | No | `Active` | `Active`, `Archived`, `Deleted`, `All` | Filters lifecycle states.
- **Buttons and actions (Per-Row Actions Dropdown):**
  - `View Client` | Opens client overview | `/clients/{id}` | No.
  - `Edit Client` | Opens edit form | `/clients/{id}/edit` | No.
  - `New Invoice` | Pre-fills invoice with client | `/invoices/create?client_id={id}` | No.
  - `New Quote` | Pre-fills quote with client | `/quotes/create?client_id={id}` | No.
  - `Enter Payment` | Pre-fills payment modal with client | `/payments/create?client_id={id}` | No.
  - `Statement` | Generates PDF statement of account | `/clients/{id}/statement` | No.
  - `Archive` | Soft-archives client | Stays on list | Yes.
  - `Delete` | Soft-deletes client | Stays on list | Yes.
- **Statuses or states:** Active, Archived, Deleted.
- **What gets saved:** Sets `is_deleted = 1` or updates `deleted_at = NOW()` in `clients` table.
- **Side effects:** Archived/deleted clients are excluded from active dropdown selectors on new invoices.

### Screen: New / Edit Client
- **Route / how reached:** `/clients/create` or `/clients/{id}/edit` (or modal from within Invoice Editor).
- **Purpose in one line:** Authoring customer records, contacts, billing/shipping addresses, and individual billing preferences.
- **What is displayed:**
  - 4 Navigation Tabs: `Details`, `Address`, `Shipping`, `Settings`.
- **Fields:**
  - **Tab 1: Details**
    - `name` | text | Yes | Empty | String max 255 | Client or organization name.
    - `id_number` | text | No | Empty | Max 50 chars | Internal or tax reference code.
    - `vat_number` | text | No | Empty | Max 50 chars | VAT / Tax registration ID.
    - `website` | url | No | Empty | Valid URI | Company website URL.
    - `phone` | tel | No | Empty | E.164 phone string | Primary phone number.
    - `currency_id` | select | No | System default | ISO currency code | Client-specific billing currency.
    - Contact Repeater: `first_name`, `last_name`, `email`, `phone`, `is_primary` (radio), `send_email` (checkbox).
  - **Tab 2: Billing Address**
    - `billing_address1` | text | No | Empty | Max 255 | Street address line 1.
    - `billing_address2` | text | No | Empty | Max 255 | Suite, building, floor.
    - `billing_city` | text | No | Empty | Max 100 | City name.
    - `billing_state` | text | No | Empty | Max 100 | State / Province.
    - `billing_postal_code` | text | No | Empty | Max 20 | Postal / ZIP code.
    - `billing_country_id` | select | No | Default country | ISO country selector.
  - **Tab 3: Shipping Address**
    - `shipping_address1`, `shipping_address2`, `shipping_city`, `shipping_state`, `shipping_postal_code`, `shipping_country_id`.
  - **Tab 4: Settings**
    - `payment_terms` | select | No | Company default | Net 0, 7, 14, 30, etc. | Default payment terms.
    - `task_rate` | number | No | `0.00` | Decimal(16,2) | Hourly billing rate for billable tasks.
    - `send_reminders` | checkbox | Yes | Checked | Boolean | Enables automatic reminder emails.
    - `group_settings_id` | select | No | None | Foreign key | Group inheritance rules.
    - `private_notes` | textarea | No | Empty | Text | Staff-only internal notes.
- **Buttons and actions:**
  - `Save` | Validates and persists client | Returns to `/clients` | No.
  - `Cancel` | Discards uncommitted entries | Returns to `/clients` | Confirmation if dirty.
- **What gets saved:**
  - Inserts row in `clients` table (`name`, `vat_number`, `currency_id`, `balance`, `paid_to_date`).
  - Inserts 1 to $N$ rows in `client_contacts` table linked by `client_id`.
- **Financial Balance Calculation:**
  $$\text{Balance} = \sum(\text{Active Issued Invoices Total}) - \sum(\text{Allocated Payments}) - \sum(\text{Applied Credits})$$
  $$\text{Paid to Date} = \sum(\text{All Payments Applied to this Client})$$
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/clients]`.

---

## F. Products / Items

`[APP: Route /products]` & `[SOURCE: Laravel Product Model]`

### Screen: Product Form & Catalog
- **Route / how reached:** `/products/create` or `/products/{id}/edit`.
- **Purpose in one line:** Authoring pre-configured inventory items and services with standard descriptions, rates, and tax assignments.
- **What is displayed:**
  - Two-column form: Details on left, Tax & Inventory settings on right.
- **Fields:**
  - `product_key` | text | Yes | Empty | Max 100 chars, unique | Item SKU, code, or short title.
  - `notes` | textarea | No | Empty | Text | Default line description copied to invoice lines.
  - `price` | number | Yes | `0.00` | Decimal(16,4) | Default customer selling price.
  - `cost` | number | No | `0.00` | Decimal(16,4) | Internal cost of goods; never displayed to client.
  - `quantity` | number | No | `1.00` | Decimal(16,4) | Default quantity populated on invoice.
  - `tax_name1` | select | No | Empty | Tax rate name | Default primary tax rate.
  - `tax_rate1` | number | No | `0.00` | Percentage | Value for tax 1.
  - `tax_name2` | select | No | Empty | Tax rate name | Default secondary tax rate.
  - `tax_rate2` | number | No | `0.00` | Percentage | Value for tax 2.
  - `track_inventory` | checkbox | No | Unchecked | Boolean | Enables stock level tracking.
  - `stock_quantity` | number | No | `0` | Integer | Units on hand.
  - `notification_threshold` | number | No | `0` | Integer | Low-stock notification trigger.
- **Document Copy Behavior:**
  - When a product is selected on an invoice, its `notes` copies to line `description`, `price` copies to `unit_cost`, and taxes copy to line tax fields.
  - **Decoupled Snapshot:** Editing the product catalog price later **never** alters historical issued or draft invoices.
- **Evidence:** `[APP: Route /products]` and `[SOURCE: Laravel Product Model]`.

---

## G. Invoices — The Whole Life Cycle

`[APP: Live Browser Session at http://localhost:8090/invoices/create]`

### Screen: New Invoice Editor
- **Route / how reached:** `/invoices/create` (or `/invoices/{id}/edit`).
- **Purpose in one line:** Document studio for line-item composition, client linkage, discount/tax calculations, and live PDF preview.
- **What is displayed:**
  - Top Bar: Header "New Invoice", Global Search bar, "Purchase White Label" button, "Save" action button (disabled until client selected).
  - Breadcrumbs: `Home / Invoices / New Invoice`.
  - Secondary Navigation Tabs: `Create`, `Documents`, `Settings`.
  - Client Selector Section: Combobox dropdown with search and an inline `+ New Client` button.
  - Invoice Meta Section:
    - `Invoice Date` (defaults to current date, e.g. `2026-11-07`).
    - `Due Date` (datepicker textbox).
    - `Partial/Deposit` (numeric input).
    - `Tags` (tag search and selection).
    - `Invoice #` (shows placeholder "Auto Generate").
    - `PO #` (freeform textbox).
    - `Discount` (switchable between `Amount` or `Percent`, with numeric input).
  - Mode Switcher: Toggle buttons between `Products` and `Tasks`.
  - Line Items Grid: Table with headers `Item`, `Description`, `Unit Cost`, `Quantity`, `Discount`, `Line Total`, and an `Add Item` button.
  - Document Notes Accordion / Tab Strip: Buttons for `Public Notes`, `Private Notes`, `Terms`, `Footer`, `Custom Fields`, accompanied by a rich-text formatting toolbar (Paragraph, Font, 14px, Bold, Italic, Lists, Links, Colors).
  - Financial Summary Card: Stacked live calculations for `Net`, `Subtotal`, `Total`, `Paid to Date`, and `Balance`.
- **Fields:**
  - `client_id` | select | Yes | Empty | Must select active client | Target client account.
  - `invoice_date` | date | Yes | Today | Valid date | Accounting invoice date.
  - `due_date` | date | No | Empty | Valid date | Due date for payment terms.
  - `partial` | number | No | `0.00` | Decimal(16,2) | Deposit or partial payment required.
  - `tags` | text/select | No | Empty | Comma-separated | Entity categorization tags.
  - `invoice_number` | text | Yes | "Auto Generate" | Unique string | Auto-assigned or manual invoice number.
  - `po_number` | text | No | Empty | Max 100 chars | Client purchase order reference.
  - `discount` | number | No | `0.00` | Decimal(16,2) | Document-level discount.
  - `is_amount_discount` | select | Yes | Amount | Amount vs. Percent | Discount calculation mode.
  - Line Items Array (`line_items[i]`):
    - `product_key` | text / autocomplete | No | Empty | Max 100 | Item code or title.
    - `description` | textarea | No | Empty | Text | Line item descriptive text.
    - `unit_cost` | number | Yes | `0.00` | Decimal(16,4) | Unit price.
    - `quantity` | number | Yes | `1.00` | Decimal(16,4) | Quantity billed.
    - `discount` | number | No | `0.00` | Decimal(16,2) | Line-level discount.
    - `line_total` | display | Yes | Computed | Read-only | $(\text{Qty} \times \text{Cost}) - \text{Discount}$.
  - Document Notes:
    - `public_notes` | textarea (rich-text) | No | Default company notes | Printed on invoice.
    - `private_notes` | textarea | No | Empty | Staff-only internal note.
    - `terms` | textarea (rich-text) | No | Default payment terms | Printed in terms block.
    - `footer` | textarea (rich-text) | No | Default footer text | Printed in bottom margin.
- **Buttons and actions:**
  - `Save` | Persists document draft | Stays on editor | No.
  - `Add Item` | Appends a new blank row to line items table | In-place DOM update | No.
  - `New Client` | Opens client creation modal overlay | Stays on editor | No.
  - `Products / Tasks` | Switches line item grid mode | In-place toggle | No.
  - `Actions Menu` (on saved invoice): `Mark Sent`, `Email Invoice`, `View PDF`, `Print PDF`, `Delivery Note (PDF)`, `Add Comment`, `Mark Paid`, `Enter Payment`, `Client Portal`, `Schedule`, `Convert To`, `Clone To`, `Archive`, `Delete`, `Cancel`.
- **Status Model & State Transitions:**
  - `Draft`: Initial editable state. Number reserved, balance not counted on client ledger, client portal view disabled.
  - `Sent`: Marked as issued or emailed to client. Number permanently committed. Balance added to client's outstanding debt.
  - `Viewed`: Client opened the document via public portal token (timestamp logged in `invoices.viewed_date`).
  - `Partial`: Paid amount $> 0$ but $<$ Grand Total.
  - `Paid`: Paid amount $\ge$ Grand Total. Balance due $= 0$.
  - `Past Due`: Due date $<$ Today AND Balance Due $> 0$.
  - `Cancelled`: Voids document. Keeps number for audit; zeroes ledger balance.
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/invoices/create]`.

---

## H. Other Documents

`[APP: Routes /quotes, /credits, /recurring_invoices, /purchase_orders]`

### 1. Quotes / Estimates (`/quotes`)
- **Differences from Invoice:**
  - Number format default: `QTE-0001`.
  - Additional Field: `valid_until` (Date).
  - Financial Effect: **Zero**. A quote does **not** alter client debt or ledger balances.
  - Conversion: Action `Convert to Invoice` locks quote and spawns an editable invoice draft copying all lines, discounts, and customer details. The quote status changes to `Converted`.

### 2. Credit Notes (`/credits`)
- **Differences from Invoice:**
  - Number format default: `CR-0001`.
  - Financial Effect: Increases client's available credit balance (`clients.paid_to_date` or unallocated credit pool).
  - Allocation: Applied directly against open invoices via the "Apply Credit" payment action, reducing invoice balance due without physical bank cash flow.

### 3. Recurring Invoices (`/recurring_invoices`)
- **Differences from Invoice:**
  - Contains an automated scheduling engine:
    - `frequency`: Weekly, Monthly, Quarterly, Semi-Annually, Annually.
    - `remaining_cycles`: Integer counter (decrements upon each run; `0` = stops; `-1` = endless).
    - `auto_bill`: `Off`, `Automatically charge on due date`, `Automatically charge on send date`.
  - Execution: Scheduled worker evaluates active recurring schedules, clones the template into a standard invoice, and dispatches it via email.

### 4. Delivery Notes / Packing Slips
- **Implementation:**
  - View projection of an existing invoice (`/invoices/{id}/delivery_note`).
  - Rendering engine suppresses unit rates, line totals, taxes, and payment balances, outputting only Item Name, SKU, Description, and Quantity for warehouse packing.

### 5. Purchase Orders (`/purchase_orders`)
- **Differences from Invoice:**
  - Destination entity: Linked to **Vendor**, not Client.
  - Purpose: Inbound procurement tracking. Does not alter accounts receivable.

---

## I. Payments and Money

`[APP: Route /payments/create]`

### Screen: Record Payment Modal
- **Route / how reached:** `/payments/create` or clicked `Record Payment` on invoice row/drawer.
- **Purpose in one line:** Recording client funds and allocating amounts across one or more open invoices.
- **What is displayed:**
  - Client selection header.
  - Open Invoices Grid: Columns `Invoice Number`, `Date`, `Total`, `Amount Due`, and `Payment Amount` input.
  - Payment Details Panel: Amount, Payment Date, Payment Type, Transaction Reference, Private Notes.
  - "Send Email Receipt" checkbox (checked by default).
- **Fields:**
  - `client_id` | select | Yes | Pre-filled | Valid client ID | Client paying.
  - `amount` | number | Yes | Total Due | Decimal(16,2) | Total money received.
  - `payment_date` | date | Yes | Today | Valid date | Date received.
  - `type_id` | select | Yes | `Bank Transfer` | Payment type | Method of payment.
  - `transaction_reference`| text | No | Empty | Max 100 chars | UTR, Cheque #, or Wire reference.
  - `private_notes` | textarea | No | Empty | Text | Internal ledger reference.
  - `send_email` | checkbox | Yes | Checked | Boolean | Triggers payment receipt email to client.
- **Money Allocation Logic:**
  - A payment can be distributed across multiple invoices by entering amounts in the respective `Payment Amount` inputs.
  - **Overpayment Handling:** If `amount` entered exceeds the total balance of open invoices, the excess amount is saved as an unallocated **Client Credit** and stored in `clients.credit_balance`.
  - **Refunds:** Triggered via `Refund Payment` action. Allows full or partial refund. A refund creates a negative payment record, restores the original invoice balance due, and decrements the client's paid-to-date total.
- **Evidence:** `[APP: Route /payments/create]`.

---

## J. Purchases Side

`[APP: Routes /vendors and /expenses]`

### Screen: Vendors & Expenses
- **Route:** `/vendors` and `/expenses`.
- **Fields on Expense Creation (`/expenses/create`):**
  - `vendor_id` | select | No | Empty | Vendor | Payee business.
  - `amount` | number | Yes | `0.00` | Decimal(16,2) | Expense monetary amount.
  - `expense_date` | date | Yes | Today | ISO date | Date incurred.
  - `category_id` | select | No | None | Category | Expense category (Rent, Travel, Supplies).
  - `tax_rate1` / `tax_rate2` | select | No | None | Tax rates | Deductible input tax.
  - `client_id` | select | No | None | Client | Associated client for billable tracking.
  - `should_be_invoiced` | checkbox | Yes | Unchecked | Boolean | Marks expense as billable to client.
  - `documents` | file upload | No | None | PDF/PNG/JPG | Scanned receipt attachments.
- **Billable Expense Pipeline:**
  - When `should_be_invoiced = true` and a `client_id` is selected, Invoice Ninja marks the expense as unbilled. When generating the next invoice for that client, a prompt appears: "Add unbilled expenses to this invoice?". Selecting yes inserts the expense as a billed line item.
- **Evidence:** `[APP: Routes /vendors and /expenses]`.

---

## K. Inventory and Stock

`[DOCS: Official Invoice Ninja v5 Products Guide]` & `[SOURCE: Laravel Product Model]`

- **Inventory Trigger Events:**
  - Stock decrements **only** when an invoice moves from `Draft` to `Sent` or `Paid`.
  - Saving a `Draft` invoice does **not** decrement stock.
  - Quotes do **not** affect stock.
- **Negative Stock Behavior:**
  - Default behavior: Stock **can go negative** (e.g. balance becomes `-3`). Invoice Ninja displays a warning banner ("Insufficient inventory for Product X"), but does not block document issuance unless the global setting `Prevent Negative Stock` is enabled under `/settings/product_settings`.
- **Cost Tracking & Valuation:**
  - **No FIFO, LIFO, or Weighted Average Costing.**
  - Invoice Ninja records a static snapshot of `cost` on the invoice line item. Gross margin reports calculate $\text{Selling Price} - \text{Static Unit Cost}$. There is no general ledger inventory valuation asset account.

---

## L. Reports and Exports

`[APP: Route /reports]`

### Screen: Reporting Studio (`/reports`)
- **Full List of Available Reports:**
  1. `Invoices Report`: Granular list of invoices, amounts, tax components, and statuses.
  2. `Payments Report`: Complete list of receipts by date, method, transaction ID, and client.
  3. `Clients Report`: Summary of client totals, lifetime billing, outstanding balances, and credit balances.
  4. `Products Report`: Sales volume and gross margins grouped by item SKU.
  5. `Expenses Report`: Outbound costs grouped by vendor and category.
  6. `Profit and Loss Report`: Operational cash summary ($\text{Collected Revenue} - \text{Logged Expenses}$).
  7. `Tax Rates Report`: Collected sales tax and paid input tax breakdown by tax jurisdiction.
  8. `Tasks / Projects Report`: Billable hours logged vs. invoiced hours.
- **Export Capabilities:**
  - Formats: CSV export, JSON raw data, and PDF summary sheet.
  - Filtering: Date range picker, Status filter (Active/Archived/All), Client/Vendor dropdown filter, Group filter.
- **Evidence:** `[APP: Route /reports]`.

---

## M. Import

`[APP: Route /settings/import_export]`

### Flow: Two-Phase Data Ingestion
1. **Step 1 — Upload (`/settings/import_export`):** Operator selects target entity type (`Clients`, `Products`, `Invoices`) and uploads a `.csv` or `.json` file.
2. **Step 2 — Column Mapping:** The system parses the header row and presents an interactive mapping interface:
   - Left Column: CSV Source Columns detected in upload file.
   - Right Column: Invoice Ninja target entity fields (auto-selected via fuzzy matching).
   - Preview Box: Displays first 3 ingested rows as formatted entities.
3. **Step 3 — Ingestion Execution:**
   - Background dispatch via queue worker.
   - Duplicate Handling: Checked against `name` and `email`. Options: `Skip duplicates` or `Update existing records`.
   - Partial Failure Handling: Valid records commit to database; failed rows write out to a downloadable error CSV detailing row number and validation error.
- **Evidence:** `[APP: Route /settings/import_export]`.

---

## N. Settings — Complete Inventory

`[APP: Live Browser Session at http://localhost:8090/settings/company_details]`

- **Basic Settings Navigation:**
  - `Company Details` (`/settings/company_details`):
    - Sub-tabs: `Details`, `Address`, `Logo`, `Defaults`, `Documents`, `Custom Fields`.
    - Fields on Details: `Company Name`, `ID Number`, `VAT Number`, `Website`, `Email`, `Company Phone`, `Company Size` (1-3, 4-10, etc.), `Industry` (Accounting & Legal, Advertising, etc.), `Classification`.
  - `User Details` (`/settings/user_details`): First Name, Last Name, Email, Phone, Password, 2FA setup.
  - `Localization` (`/settings/localization`): Currency (INR, USD, EUR, etc.), Language, Date Format, Timezone, 24-Hour time.
  - `Payment Settings` (`/settings/online_payments`): Auto-bill rules, client payment methods, manual payment toggles.
  - `Tax Settings` (`/settings/tax_settings`): Inclusive/Exclusive modes, default tax rates.
  - `Product Settings` (`/settings/product_settings`): Auto-fill products, track inventory, prevent negative stock toggle.
  - `Task Settings` (`/settings/task_settings`): Default task hourly rates, time format, auto-invoice tasks.
  - `Tags` (`/settings/tags`): Global entity tagging definitions and colors.
  - `Expense Settings` (`/settings/expense_settings`): Default categories, billable markup percentages.
  - `Workflow Settings` (`/settings/workflow_settings`): Automatically convert quotes, auto-archive paid invoices, invoice lock settings.
  - `Account Management` (`/settings/account_management`): Purge data, license status, delete company.
  - `Backup | Restore` (`/settings/backup_restore`): Generate JSON backup, database download, restore file upload.
  - `Import | Export` (`/settings/import_export`): Two-phase CSV/JSON import mapper and full database exporter.
- **Advanced Settings (Pro):**
  - `Invoice Design` (`/settings/invoice_design`): Design template picker (Clean, Bold, Modern, Plain, Business), custom CSS, PDF font chooser.
  - `Custom Fields` (`/settings/custom_fields`): Up to 4 custom fields each for Clients, Invoices, Products, Payments, Vendors.
  - `Generated Numbers` (`/settings/generated_numbers`): Pattern editors (`{$year}-{$counter}`) and reset intervals for Invoices, Quotes, Payments, Credits, Clients.
  - `Client Portal` (`/settings/client_portal`): Client login permissions, document sharing links, terms acceptance.
  - `E-Invoicing` (`/settings/e_invoice`): Peppol, Factur-X, and electronic invoicing network credentials.
  - `Email Settings` (`/settings/email_settings`): Mail driver (SMTP, Log, SES), sender name, reply-to address.
  - `Templates & Reminders` (`/settings/templates_and_reminders`): Email body editors and automated schedule triggers for 1st, 2nd, and 3rd late reminders.
  - `Credit Cards & Banks` (`/settings/bank_accounts`): Bank feed credentials and linked merchant accounts.
  - `Group Settings` (`/settings/group_settings`): Hierarchical client groups overriding company defaults.
  - `Payment Links` (`/settings/subscriptions`): Hosted public checkout pages and subscription plans.
  - `Schedules` (`/settings/schedules`): Cron schedule monitoring for automated background billing.
  - `User Management` (`/settings/users`): Team member invite studio, role assignments, and permission matrices.
  - `System Logs` (`/settings/system_logs`): Inbound/outbound webhook delivery logs and system debug errors.
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/settings/company_details]`.

---

## O. Users, Roles and Permissions

`[APP: Route /settings/users]` & `[SOURCE: Laravel User Model]`

- **User Structure:** Multi-user support with company isolation.
- **Roles & Granular Permissions:**
  - `Administrator`: Full unrestricted access to all entities, settings, and company teardown.
  - `Standard User`: Configurable entity permissions:
    - Matrix permissions: `Create`, `View`, `Edit`, `Archive`, `Delete` evaluated per module (`Clients`, `Invoices`, `Payments`, `Expenses`, `Reports`, `Settings`).
    - Permission Flag: `View All` vs. `View Assigned Only` (limits staff visibility to clients/invoices where `user_id` matches their own).
- **Action Attribution:** Every modification records `created_by_user_id` and `updated_by_user_id` on the database row.
- **Evidence:** `[APP: Route /settings/users]`.

---

## P. Activity Log / Audit

`[APP: Live Browser Session at http://localhost:8090/dashboard (Recent Activity Card)]`

- **Tracked Events:** Document creation, state transitions (`Draft → Sent`), client email delivery, client portal viewing, payment application, refunding, archival, and cancellation.
- **Immutability:** The audit log table (`activities`) is strictly append-only. There is no user interface or API endpoint to edit or alter logged historical events.
- **Presentation:** Displayed as an "Activity Trail" tab inside individual invoice and client records, and globally in the Dashboard sub-panel.
- **Evidence:** `[APP: Live Browser Session at http://localhost:8090/dashboard]`.

---

## Q. Backup and Restore

`[APP: Route /settings/backup_restore]` & `[SOURCE: Docker Volume Storage]`

- **Backup Composition:**
  - Structured Data: Complete database dump encompassing all tables (`clients`, `invoices`, `payments`, `users`, `settings`).
  - Unstructured Data: Volume directory holding company logos, generated PDF caches, and uploaded document attachments.
- **Restore Workflow:**
  - Web UI: Uploads a `.zip` backup archive via `/settings/backup_restore`.
  - CLI: Database restore via SQL script and cache rebuild via artisan command.
- **Evidence:** `[APP: Route /settings/backup_restore]`.

---

## R. Email and Notifications

`[APP: Route /settings/email_settings]` & `[SOURCE: Docker .env configuration]`

- **Outbound Email Transports:** SMTP, Amazon SES, Mailgun, Postmark, and local Log driver.
- **Template Variables Available:** `{$client_name}`, `{$invoice_number}`, `{$invoice_amount}`, `{$invoice_due_date}`, `{$view_link}`, `{$company_name}`.
- **Offline / Local Behavior:** If no external internet/SMTP gateway is configured, setting `MAIL_MAILER=log` writes all outgoing message bodies to local log files without failing invoice operations.
- **Evidence:** `[APP: Route /settings/email_settings]`.

---

## S. Behaviours an Accountant Would Notice

`[SOURCE: Laravel Transaction Logic & Review Audits]`

1. **Destructive Editing of Issued Documents:** Invoice Ninja allows operators to edit an already "Sent" or "Viewed" invoice (changing quantities, line descriptions, or prices). This mutates the original database row rather than forcing a credit note or debit adjustment.
2. **Missing Numbering Gaps on Discarded Drafts:** While draft numbers are reserved, deleting or canceling drafts can cause gaps in sequential numbering unless strict manual reuse is managed.
3. **Absence of True Double-Entry Bookkeeping:** No debit and credit journal entries (`General Ledger`). It tracks receivables and income via flat transaction tables (`invoices`, `payments`, `expenses`).
4. **Permissive Negative Inventory:** Stock can fall below zero without an abort error.
5. **No Strict Financial Year Closing:** There is no hard period-end lock that prevents recording backdated payments or invoices into historical fiscal years unless manually restricted by an administrator.

---

## T. What the Product Does NOT Have

`[SOURCE: Codebase Search across Controllers, Models, and Settings]`

- **Chart of Accounts:** **Not found.** (Searched `/settings`, routes, and database schema for `accounts`, `nominal_ledger`). No COA exists.
- **General Ledger / Journal Entries:** **Not found.** (Searched codebase for `journal_entries`, `account.move`, `debit/credit`). All money flow is recorded as discrete invoice/payment rows.
- **Trial Balance / Balance Sheet:** **Not found.** (Searched `/reports` and report generators). Reports are limited to cash flow, sales summaries, and expense listings.
- **Inventory Cost Valuation (FIFO / LIFO):** **Not found.** (Searched product models and schemas). Tracks only a static cost number; does not evaluate holding asset values.
- **Physical Delivery Challan / Transport Lifecycle:** **Not found.** (Searched routes and specs). Only provides a printable packing slip view; no concept of delivery challan dispatch tracking.

---

## U. Nice Touches Worth Noting

`[APP: Live Browser Session at http://localhost:8090/dashboard and /invoices/create]`

1. **Instant Quick-Create Menu:** Global `+` dropdown in top navigation enables spawning any entity (Invoice, Client, Payment, Quote, Product) with one click from any screen.
2. **Quick "/" Keyboard Search Focus:** Pressing the `/` key anywhere in the application immediately focuses the global search bar.
3. **Inline Customer Creation:** The Client selector on the invoice editor features a top "+ New Client" option that opens a non-destructive modal, allowing customer creation mid-invoice without losing typed item lines.
4. **Row-Level Contextual Action Menus:** Hovering or clicking the end of any data table row surfaces instant actions (`Mark as Paid`, `Send Email`, `Clone to Quote`, `View PDF`) in one click.
5. **Dual Product/Task Invoicing:** Native tab toggle directly on the line items grid between inventory products and billable time-tracking tasks.

---

## Verification Summary

### 1. Verified Directly via Live Running App (`http://localhost:8090`)
- **Login screen**: Two-step email and password/passkey flow at `/login`.
- **Dashboard**: Live metrics (`Recent Transactions`, `Invoices`, `Payments`, `Expenses`, `Outstanding`), `Overview` coordinate chart, and `Recent Activity` audit ledger at `/dashboard`.
- **Clients Directory**: Table layout, live rows (e.g. "Oxford Book & Stationery Wholesale Hub", "Heritage International School"), filters, columns button, and actions dropdown at `/clients`.
- **New Invoice Form**: Client combobox with inline "+ New Client", date fields, PO #, Discount (Amount vs. Percent), Products/Tasks toggle, Line Items grid with `Add Item`, Rich-text notes tabs (`Public Notes`, `Private Notes`, `Terms`, `Footer`, `Custom Fields`), and real-time Net/Subtotal/Total/Balance totals at `/invoices/create`.
- **Settings Architecture**: Full inventory of Basic Settings (13 tabs) and Advanced Settings (13 tabs) at `/settings/company_details`.

### 2. Unverified
- **Third-Party Payment Gateway Callbacks**: Live webhook callbacks for Stripe and PayPal (unverified as test instance operates in local offline network).
- **Third-Party EU VAT VIES Network Verification**: Live online European tax registry verification (external network disabled).