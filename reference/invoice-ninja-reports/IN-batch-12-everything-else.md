# Batch 12: Everything Else, and the Catch-All Deep Dive Report

## Executive Summary
This report delivers an exhaustive, line-by-line inspection of the 8 remaining product areas and all catch-all features within Invoice Ninja (`craterninja-app-1`). It covers Projects, Tasks, Bank Transactions, Tags, Client Portal, Payment Links & Subscriptions, Schedules, E-Invoicing (PEPPOL & Veri*factu), Multi-DB horizontal scaling, the Command Palette, live PDF rendering, automated currency rate feeds, white-label licensing, and the complete webhook architecture.

---

# Part 1: The 8 Undescribed Menu Areas

## 1. Projects Architecture & Billing

### 1.1 Model & Database Schema
- **Model**: `app/Models/Project.php`
- **Table**: `projects`
- **Fillable Columns**:
  - `name`: string (project title)
  - `client_id`: unsigned integer (assigned client)
  - `task_rate`: decimal (default hourly billing rate for tasks within this project)
  - `due_date`: date (project completion target)
  - `budgeted_hours`: decimal (allocated time budget)
  - `budgeted_amount`: decimal (allocated monetary budget)
  - `assigned_user_id`: unsigned integer (staff member managing the project)
  - `color`: string (hex color code for UI cards and calendar/Gantt views)
  - `number`: string (auto-generated or manual project identifier)
  - `private_notes`: text (internal notes visible only to company users)
  - `public_notes`: text (notes visible to client via portal)
  - `custom_value1`, `custom_value2`, `custom_value3`, `custom_value4`: custom string fields
  - `hash`: string (unique public token)

### 1.2 Relationships & Data Aggregation
- **BelongsTo**: `Company`, `Client`, `User` (creator), `AssignedUser`
- **HasMany**:
  - `tasks()`: All tasks belonging to the project.
  - `expenses()`: All direct project expenses.
  - `invoices()`: All invoices billed to this project.
  - `quotes()`: Estimates/quotes associated with this project.
  - `documents()`: Attached files and blueprints.
- **Budget & Metric Tracking**:
  - In `app/Services/Chart/AnalyticsQueries.php` and `ProjectReport.php`, project progress is tracked through:
    - `logged_hours`: Sum of task durations (`tasks.time_log`).
    - `budgeted_hours` vs `logged_hours` consumption percentage.
    - `invoiced_tasks` vs `uninvoiced_tasks`.
    - Total expenses logged vs `budgeted_amount`.

### 1.3 Project UI Screen & Tabs
As defined in `public/Project-DwIVBcis.js`:
- **Tabs**:
  1. `Overview`: Project metrics card, budget consumption bar, client selector, assigned user, due date, task rate, color picker.
  2. `Tasks`: Embedded task list/Kanban board for all tasks associated with `project_id`.
  3. `Expenses`: Expense tracking table linked to `project_id`.
  4. `Invoices`: Invoices that contain line items billed from this project.
  5. `Quotes`: Related quotes.
  6. `Documents`: Project file attachments.

### 1.4 How a Project is Invoiced
Projects are billed through their underlying billable items (tasks and expenses):
1. User selects "Invoice Project" in the project actions menu or aggregates unbilled tasks.
2. Unbilled tasks (`tasks.invoice_id IS NULL`) and unbilled billable expenses (`expenses.invoice_id IS NULL AND should_be_invoiced = 1`) are transformed into invoice line items.
3. Once the invoice is saved, `InvoiceService::linkEntities()` updates `tasks.invoice_id = invoice->id` and `expenses.invoice_id = invoice->id`.

---

## 2. Tasks Architecture & Stopwatch Mechanics

### 2.1 Model & Database Schema
- **Model**: `app/Models/Task.php`
- **Table**: `tasks`
- **Fillable Columns**:
  - `number`: string (task identifier)
  - `client_id`: unsigned integer (parent client)
  - `project_id`: unsigned integer, nullable (parent project)
  - `invoice_id`: unsigned integer, nullable (populated when billed)
  - `assigned_user_id`: unsigned integer, nullable
  - `status_id`: unsigned integer (foreign key to `task_statuses`)
  - `status_order`: integer (sort sequence in Kanban columns)
  - `description`: text (task notes and work breakdown)
  - `rate`: decimal (explicit hourly rate override)
  - `duration`: integer (total seconds logged)
  - `time_log`: JSON column storing individual interval sessions
  - `is_running`: boolean (stopwatch state)
  - `is_date_based`: boolean
  - `due_date`: date
  - `estimated_duration`: integer
  - `invoice_documents`: boolean
  - `custom_value1-4`: string

### 2.2 Time Log JSON Schema & Stopwatch Mechanics
The `time_log` column stores an array of interval tuples:
```json
[
  [1731045600, 1731052800, "Initial architecture wireframes", true],
  [1731056400, 0, "Current active session", true]
]
```
- **Tuple Structure**:
  - Index 0: `start_time` (Unix epoch timestamp).
  - Index 1: `end_time` (Unix epoch timestamp; `0` or `null` indicates timer is currently running).
  - Index 2: Optional session description / sub-task notes.
  - Index 3: `is_billable` (boolean flag).
- **Duration Calculation (`Task::calcDuration(bool $billable = false)`)**:
  - Iterates through intervals:
    ```php
    foreach ($parts as $part) {
        if ($billable && isset($part[3]) && !$part[3]) continue;
        $start_time = $part[0];
        $end_time = (count($part) == 1 || ! $part[1]) ? time() : $part[1];
        $duration += max($end_time - $start_time, 0);
    }
    return round($duration);
    ```
  - If a timer is currently active (`is_running = true`), `calcDuration()` calculates time dynamically up to `time()`!

### 2.3 Task Rate Resolution Hierarchy
In `app/Models/Task.php::getRate()`:
The billing rate per hour is resolved via a 4-level cascade:
1. **Explicit Task Rate**: If `$task->rate > 0`, use `$task->rate`.
2. **Project Task Rate**: If task belongs to a project and `$project->task_rate > 0`, inherit project rate.
3. **Client Default Task Rate**: If `$client->getSetting('default_task_rate') > 0`, inherit client setting.
4. **Company Default Task Rate**: Default to `$company->settings->default_task_rate ?? 0`.

### 2.4 Conversion to Invoice Line Items
In `Task::getQuantity()` and `InvoiceService::linkEntities()`:
- **Quantity**: `$quantity = round(($task->calcDuration(true) / 3600), 2)`.
- **Line Item Type**: Line item created with `type_id = "2"` (Task line item).
- **Line Item Fields**:
  - `type_id`: `2`
  - `task_id`: Hashed task ID
  - `product_key`: Task number
  - `notes`: Task description
  - `cost`: `task->getRate()`
  - `quantity`: Decimal hours
- **Lifecycle Transition**:
  - When the invoice is saved: `InvoiceService::linkEntities()` executes:
    `Task::whereIn('id', $tasks->pluck('task_id'))->update(['invoice_id' => $this->invoice->id]);`
  - When the invoice is deleted: `MarkInvoiceDeleted` executes:
    `$this->invoice->tasks()->update(['invoice_id' => null]);` (freeing tasks back to unbilled inventory).

---

## 3. Bank Feed Transactions & Reconciliation

### 3.1 Controller & Execution
- **Controller**: `app/Http/Controllers/BankTransactionController.php`
- **Routes**:
  - `GET /api/v1/bank_transactions` (list feed)
  - `POST /api/v1/bank_transactions` (manual bank transaction entry via `BankTransactionRepository::save()`)
  - `POST /api/v1/bank_transactions/match` (automated matching engine)

### 3.2 Matching Rules & Automated Reconciliation
In `app/Jobs/Bank/MatchBankTransactions.php` and `BankTransactionRule.php`:
- Matches incoming bank feed transactions against:
  1. Open unpaid invoices (matching amount, invoice number in memo/description, or client name).
  2. Existing payments (reconciling statement dates against recorded payments).
  3. Uncategorized vendor expenses.
- **Rule Actions**:
  - Auto-convert transaction to Payment (`convert_to_payment`).
  - Auto-convert transaction to Expense (`convert_to_expense`).
  - Auto-assign Client or Vendor.
- **Multi-Currency Reconciliation**:
  If the bank transaction currency differs from the company base currency, `MatchBankTransactions.php:L505` invokes `CurrencyApi::exchangeRate()` to calculate the exact historical rate on the transaction date.

---

## 4. Tags Subsystem & Polymorphic Taggables

### 4.1 Model & Schema
- **Model**: `app/Models/Tag.php`
- **Table**: `tags` (defined in `database/migrations/2026_05_31_120000_create_tags_table.php`)
- **Columns**: `id`, `company_id`, `user_id`, `entity_type`, `name`, `color` (hex code), timestamps, soft deletes.
- **Pivot Table**: `taggables`
  - `tag_id`: unsigned integer
  - `taggable_id`: unsigned integer
  - `taggable_type`: string (morph map or FQCN)
  - Unique composite index: `['tag_id', 'taggable_id', 'taggable_type']`.

### 4.2 All Supported Taggable Entity Types
`Tag::TAGGABLE_TYPES` supports exactly 15 entities:
1. `global` (`Company::class`)
2. `bank_transaction` (`BankTransaction::class`)
3. `client` (`Client::class`)
4. `credit` (`Credit::class`)
5. `expense` (`Expense::class`)
6. `invoice` (`Invoice::class` / morphed as `'invoices'`)
7. `payment` (`Payment::class`)
8. `product` (`Product::class`)
9. `project` (`Project::class`)
10. `purchase_order` (`PurchaseOrder::class`)
11. `quote` (`Quote::class`)
12. `recurring_expense` (`RecurringExpense::class`)
13. `recurring_invoice` (`RecurringInvoice::class`)
14. `task` (`Task::class`)
15. `vendor` (`Vendor::class`)

### 4.3 UI Tagging & Filtering
- Frontend selector: `public/TagPillSelector-ByRcRMXz.js` renders colored badges.
- Filtering: `public/useEntityTagFilters-D-LH7f06.js` and `app/Filters/TagFilters.php` allow multi-select filtering across data tables using `?tag_id=...`.

---

## 5. Client Portal Architecture & Access Control

### 5.1 Routes & Controller Directory
Defined in `routes/client.php` under route prefix `/client/`:
- 24 dedicated controllers in `app/Http/Controllers/ClientPortal/`.

### 5.2 Authentication Modes
1. **Magic Passwordless Links**:
   - Route: `/client/magic_link/{magic_link}` -> `ContactHashLoginController::magicLink()`
   - Emits signed single-use or timed tokens in email templates allowing clients to access invoices without remembering passwords.
2. **Contact Key Direct Authentication**:
   - Route: `/client/key_login/{contact_key}` -> `ContactHashLoginController::login()`
   - Validates `contact_key` on `client_contacts` table.
3. **Password Authentication**:
   - `InvitationController::setPasswordForm()` and `handlePasswordSet()` allow client contacts to define portal passwords.

### 5.3 Client Capabilities in Portal
- **Invoices**: View invoice HTML/PDF, initiate single payment (`pay.invoice`), initiate multi-invoice bulk payments (`invoices.bulk`), view delivery notes (`deliveryNote`).
- **Quotes**: View quote, approve quote (`approve`), reject quote (`reject`), sign quote document.
- **Credits**: View available credit notes and download statements.
- **Statements**: Generate and download real-time client account statement (`StatementController`).
- **Payment Methods**: Add, store, or remove credit card / ACH bank payment methods (`PaymentMethodController`).
- **Subscriptions**: Self-serve checkout pages, upgrade/downgrade subscription tiers, update payment methods, cancel subscription.
- **Document Attachment Unlocking**:
  If company setting `unlock_invoice_documents_after_payment` is true, attached files remain hidden until the invoice status transitions to `STATUS_PAID`, at which point `InvoiceService::unlockDocuments()` updates `documents.is_public = true`.

---

## 6. Payment Links & Subscriptions Subsystem

### 6.1 Model & Schema
- **Model**: `app/Models/Subscription.php`
- **Table**: `subscriptions`
- **Key Columns**:
  - `name`: plan name
  - `price`: recurring price
  - `currency_id`: billing currency
  - `frequency_id`: billing cycle (Monthly, Annually, etc.)
  - `auto_bill`: auto-charge switch (`always`, `optin`, `optout`, `off`)
  - `promo_code`, `promo_discount`, `is_amount_discount`: promotional coupon engine
  - `trial_enabled`, `trial_duration`: free trial periods
  - `per_seat_enabled`, `max_seats_limit`: per-user / per-seat tier limits
  - `allow_plan_changes`: self-service upgrade/downgrade permission
  - `allow_cancellation`: self-service cancellation switch
  - `refund_period`: allowable refund window in days
  - `webhook_configuration`: outbound webhooks triggered by subscription events
  - `product_ids`, `recurring_product_ids`: associated product catalog items
  - `steps`: multi-stage customer onboarding wizard configuration

### 6.2 Hosted Checkout & Payment Link Generation
- Hosted checkout URLs:
  - `/client/subscriptions/{subscription}/purchase` (v1 checkout)
  - `/client/subscriptions/{subscription}/purchase/v2` (v2 checkout)
  - `/client/subscriptions/{subscription}/purchase/v3` (v3 streamlined checkout)
- On checkout, Invoice Ninja auto-creates a new `Client`, primary `ClientContact`, stores gateway tokens, and generates the parent `RecurringInvoice`.

---

## 7. Schedules & The TaskScheduler Subsystem

### 7.1 Model & Recurrence Engine
- **Model**: `app/Models/Scheduler.php`
- **Table**: `schedulers`
- **Columns**: `company_id`, `user_id`, `name`, `frequency_id`, `next_run`, `next_run_client`, `template`, `is_paused`, `remaining_cycles`, `parameters`.
- **Next Run Date Calculation (`Scheduler::calculateNextRun()`)**:
  - Evaluates `frequency_id` (`DAILY`, `WEEKLY`, `TWO_WEEKS`, `FOUR_WEEKS`, `MONTHLY`, `TWO_MONTHS`, `THREE_MONTHS`, `FOUR_MONTHS`, `SIX_MONTHS`, `ANNUALLY`).
  - Advances `next_run` using `Carbon::addMonthNoOverflow()`, `addWeek()`, etc., adjusting for company timezone offsets.
  - Automatically decrements `remaining_cycles` and calls `$this->archiveCompleted()` when remaining cycles reach `0`.

### 7.2 The 5 Supported Scheduler Actions (`SchedulerService.php`)
1. `email_record`: Dispatches recurring email summaries.
2. `email_statement`: Runs `EmailStatementService` to compile and send client billing statements.
3. `email_report`: Runs `EmailReport` to execute any of the 28 system reports, generate CSV/PDF attachments, and email them to administrators.
4. `invoice_outstanding_tasks`: Runs `InvoiceOutstandingTasksService` to sweep unbilled tasks and automatically create invoices for clients.
5. `payment_schedule`: Runs `PaymentSchedule` to process milestone payments.

---

## 8. E-Invoicing: PEPPOL and Veri*factu

### 8.1 PEPPOL (UBL 2.1 XML Architecture)
Located in `app/Services/EDocument/Standards/Peppol/`:
- **XML Generation**: Implemented via `sabredav/xml` and `Peppol.php`, emitting standard OASIS UBL 2.1 Invoice and CreditNote XML documents.
- **Subsystem Builders**:
  - `PeppolPartyBuilder.php`: Formats sender (supplier) and receiver (customer) legal entity identifiers, tax schemes, endpoints, and physical addresses.
  - `PeppolLineBuilder.php`: Formats line item descriptions, standard commodity codes (UNSPSC), item quantities, unit codes (`C62`, `HUR`, etc.), net prices, and allowance/charge elements.
  - `PeppolTaxCalculator.php`: Maps local tax rates to UNECE 5305 tax category codes (`S` standard, `Z` zero-rated, `E` exempt, `AE` reverse charge).
  - `PeppolAttachmentBuilder.php`: Embeds base64-encoded PDF invoices into `<cac:AdditionalDocumentReference>` for hybrid human/machine compliance.
- **14 Country Profiles**:
  Specialized country handlers in `Peppol/`: Austria (`AT`), Belgium (`BE`), Germany (`DE` / XRechnung), Denmark (`DK`), Spain (`ES` / FacturaE), France (`FR`), India (`IN`), Italy (`IT` / FatturaPA), Poland (`PL` / KSeF), Romania (`RO`), Sweden (`SE`), Singapore (`SG`), etc.
- **Participant ID Schemes**:
  Supports ISO 6523 Electronic Address Schemes (e.g. `0088` EAN/GLN, `0192` Norway Org Number, `9930` Germany VAT, `0208` Belgium Enterprise Number, `0195` Singapore UEN).

---

### 8.2 Veri*factu (Spain Compliance & Cryptographic Hash Chaining)
Located in `app/Services/EDocument/Standards/Verifactu/`:
Implements the Spanish Royal Decree 1007/2023 for non-repudiation and anti-fraud fiscal enforcement:
- **Cryptographic Hash Chaining (`RegistroAlta.php:L276-L315`)**:
  - Every invoice is chained to the immediately preceding invoice issued by the company:
  ```php
  if ($this->v_log) {
      $registro_anterior = new RegistroAnterior();
      $registro_anterior->setIDEmisorFactura($this->v_log->nif);
      $registro_anterior->setNumSerieFactura($this->v_log->invoice_number);
      $registro_anterior->setFechaExpedicionFactura($this->v_log->date->format('d-m-Y'));
      $registro_anterior->setHuella($this->v_log->hash); // Previous SHA-256 fingerprint!
      $encadenamiento->setRegistroAnterior($registro_anterior);
  } else {
      $encadenamiento->setPrimerRegistro('S'); // 'S' for initial record
  }
  ```
- **Fiscal Hash Calculation (`SendToAeat.php:L257`)**:
  Computes SHA-256 hash of concatenating: Issuer NIF + Invoice Number + Date + Invoice Type + Total Tax + Total Amount + Previous Invoice Hash.
- **Fiscal QR Code**:
  Generates a high-density QR code printed on the invoice PDF containing the AEAT verification URL, NIF, invoice number, date, and verification hash for customer tax verification.

---

# Part 2: The Catch-All

### 1. Command Palette (`Ctrl+K`) & Keyboard Shortcuts (`?`)
- **Command Palette**: Triggered via `Ctrl+K` (or `Cmd+K` on macOS) or clicking the top search bar. Provides instant fuzzy search across clients, invoices, quotes, products, settings, and navigation actions.
- **Keyboard Shortcuts Directory (`?`)**:
  - `?`: Toggle Keyboard Shortcuts modal
  - `Ctrl/Cmd + E`: Quick Jump to Settings
  - `Ctrl/Cmd + D`: Duplicate currently selected entity
  - `Ctrl/Cmd + L`: Toggle label visibility
  - `Ctrl/Cmd + R`: Toggle required/optional field state
  - `Del` / `Backspace`: Delete selected record

### 2. Multi-Company Database Architecture (`MultiDB`)
- **Class**: `app/Libraries/MultiDB.php`
- **Dynamic Database Routing**:
  Allows a single Invoice Ninja deployment to scale horizontally across multiple isolated MySQL databases:
  `public static $dbs = ['db-ninja-01', 'db-ninja-02', 'db-ninja-03'];`
- **Runtime Connection Switching**:
  `MultiDB::setDB($db)` dynamically updates `config(['database.connections.mysql.database' => $db])` and purges active connection pools.
- **Tenant Resolvers**:
  Finds tenant database by domain (`findAndSetDbByDomain`), company key (`findAndSetDbByCompanyKey`), contact key (`findAndSetDbByContactKey`), or payment hash (`findAndSetByPaymentHash`).

### 3. Live PDF Preview Drawer
- Implemented in React using PDF worker streaming and debounced rendering (`public/builder.es-*.js`).
- Updates in real-time as users add line items, toggle tax rates, adjust discounts, or switch designs, with side-by-side split drawer viewing.

### 4. Exchange Rate Auto-Fetcher
- **Job**: `app/Jobs/Util/UpdateExchangeRates.php`
- **Mechanics**:
  - Connects to Open Exchange Rates API: `https://openexchangerates.org/api/latest.json?app_id={KEY}`.
  - Loops through all registered currencies in `currencies` table and updates `exchange_rate`.
  - Rebuilds cache across all tenant databases: `Cache::forever('currencies', $currencies)`.

### 5. White-Label License & Branding Removal
- Handled in `app/Http/Controllers/LicenseController.php` and `app/Models/Account.php`.
- Plan: `Account::PLAN_WHITE_LABEL`.
- Validates license key against `https://invoiceninja.com/license/validate`.
- Removes `Created by Invoice Ninja` footer link from PDF invoices, emails, and client portal pages.

### 6. API Webhooks & Event Hooks
- **Model**: `app/Models/Webhook.php`
- Features **65 distinct event triggers** (`EVENT_CREATE_CLIENT`, `EVENT_CREATE_INVOICE`, `EVENT_UPDATE_INVOICE`, `EVENT_DELETE_INVOICE`, `EVENT_CREATE_PAYMENT`, `EVENT_CREATE_EXPENSE`, `EVENT_CREATE_TASK`, etc.) with customizable HTTP headers, signing secrets, and REST POST delivery.

---

# Part 3: Empirical Live Container Verification

The following verification tests were executed in Docker container `craterninja-app-1`:

### Test 1: Project & Task Invoicing Pipeline
```
Active Company ID: 1
Active User: admin@example.com

--- TEST 1: Project & Task Billing Pipeline ---
Task Number: B12-TASK-001
Inherited Effective Rate: $85/hr (From Project task_rate = 85.000000)
Calculated Duration: 7200 seconds (2 hrs)
Calculated Billed Quantity: 2 hrs
After Invoicing: Task invoice_id = 64 (Invoice ID: 64)
After Invoice Delete/Reset: Task invoice_id = NULL (UNINVOICED)
```
- **Finding**: Confirmed that a task with rate 0 inherits the parent project's task rate ($85.00), accurately computes elapsed duration and decimal hours from `time_log`, links to invoice `64` upon invoicing, and releases back to `NULL` when the invoice is unlinked.

---

### Test 2: Polymorphic Tagging (`Tag` & `taggables`)
```
--- TEST 2: Polymorphic Tagging (Tag & taggables) ---
Tag Name: VIP Critical (Color: #ef4444)
Clients with this tag: 1
Invoices with this tag: 1
```
- **Finding**: Confirmed polymorphic `taggables` association to both `Client` and `Invoice` (using morph map alias `'invoices'`), with active query resolution through `whereHas('tags')`.

---

### Test 3: Scheduler Recurrence Mechanics
```
--- TEST 3: Scheduler Recurrence Mechanics ---
Scheduler Name: Weekly Automated Task Invoicing
Template Action: invoice_outstanding_tasks
Frequency ID: 2 (Weekly)
Calculated Next Run: 2026-11-15 00:30:00
Calculated Next Run Client: 2026-11-15 00:00:00
```
- **Finding**: Confirmed `Scheduler::calculateNextRun()` advances the next run timestamp by 1 week (`2026-11-15 00:30:00`) taking into account the company's 30-minute timezone offset.

---

## Verification Status

### Verified by code
- `app/Models/Project.php` schema, fillables, relationships, and analytics queries.
- `app/Models/Task.php` schema, stopwatch calculation (`calcDuration`), rate cascade (`getRate`), and JSON `time_log` schema.
- `app/Services/Invoice/InvoiceService.php` (`linkEntities`, `unlockDocuments`) task linking and unlinking.
- `app/Models/Tag.php` polymorphic `TAGGABLE_TYPES` (all 15 entity types) and `taggables` composite table index.
- `routes/client.php` all 24 client portal controllers and authentication flows (`ContactHashLoginController`).
- `app/Models/Subscription.php` hosted checkout flows and pricing options.
- `app/Models/Scheduler.php` and `SchedulerService.php` 5 template tasks and recurrence calculation.
- `app/Services/EDocument/Standards/Peppol/` UBL builders and 14 country profiles.
- `app/Services/EDocument/Standards/Verifactu/` cryptographic SHA-256 hash chaining (`RegistroAlta.php:L276-L315`).
- `app/Libraries/MultiDB.php` horizontal multi-tenant database routing.
- `app/Jobs/Util/UpdateExchangeRates.php` Open Exchange Rates automated currency sync.
- `app/Models/Webhook.php` 65 webhook events.

### Verified in running app
- Project task rate inheritance ($85/hr) and billing quantity calculation (2 hrs from 7200s session).
- Invoice task line item creation and automatic `tasks.invoice_id` synchronization and unlinking.
- Polymorphic tag creation and querying across clients and invoices.
- Scheduler `calculateNextRun()` weekly frequency advancement with timezone offset.

### Could not verify
- Direct transmission of Verifactu SOAP XML to Spain AEAT tax servers, as testing live tax submission requires genuine Spanish tax credentials and digital certificates.

