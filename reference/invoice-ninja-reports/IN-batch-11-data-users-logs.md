# Batch 11: Data, Users, and Logs Deep Dive Report

## Executive Summary
This report provides an exhaustive, line-by-line inspection of data migration, import/export mechanics, full company backups, disaster recovery / restore routines, audit logging, system operational logs, and user access control / permission enforcement within the Invoice Ninja codebase (`craterninja-app-1`).

---

## 1. Imports Architecture & Ingestion Engine

### 1.1 HTTP Endpoints and Request Contracts
Data ingestion is structured into a two-phase pipeline (pre-import analysis and asynchronous ingestion):

1. **Pre-Import Inspection**:
   - **Route**: `POST /api/v1/preimport` -> `App\Http\Controllers\ImportController::preimport()`
   - **Form Request**: `App\Http\Requests\Import\PreImportRequest`
   - **Validation Rules**:
     - `files`: `'required|array|min:1|max:6'`
     - `files.*`: `'file|mimetypes:text/csv,text/plain,application/octet-stream|max:20000'`
     - `import_type`: `'required'` (e.g. `csv`, `freshbooks`, `wave`, `zoho`, `invoice2go`, `invoicely`, `quickbooks`)
   - **Processing**:
     - Auto-detects delimiter via `ImportController::detectDelimiter()` (analyzing comma `,`, semicolon `;`, tab `\t`, pipe `|`).
     - Detects character encoding (UTF-8, Windows-1252, UTF-16).
     - Caches file contents in system cache for 1200 seconds under a unique hash.
     - Evaluates mapping scoring hints via `setImportHints()` and returns available column mappings to the client UI.

2. **Import Execution**:
   - **Route**: `POST /api/v1/import` -> `App\Http\Controllers\ImportController::import()`
   - **Form Request**: `App\Http\Requests\Import\ImportRequest`
   - **Validation Rules**:
     - `import_type`: `'required'`
     - `files`: `'required_without:hash|array|min:1|max:6'`
     - `hash`: `'nullable|string'`
     - `column_map`: `'required_with:hash|array'`
     - `skip_header`: `'required_with:hash|boolean'`
     - `bank_integration_id`: `'bail|required_with:column_map.bank_transaction|min:2'`
   - **Execution**: Dispatches `App\Jobs\Import\CSVIngest::dispatch($request->all(), $company)`.

3. **Full JSON Company Import / Restore**:
   - **Route**: `POST /api/v1/import_json` -> `App\Http\Controllers\ImportJsonController::import()`
   - **Form Request**: `App\Http\Requests\Import\ImportJsonRequest`
   - **Support**: Supports single file upload or multi-part chunked uploads (`handleChunkedUpload()`) with S3 or local disk storage.
   - **Execution**: Dispatches `App\Jobs\Company\CompanyImport::dispatch($user->company(), $user, $file_location, $request->except(['files','file']))`.

---

### 1.2 Import Definitions & Mapped Entities
Invoice Ninja provides 11 primary import definitions in `app/Import/Definitions/`:

| Map Class | Entity Type | Importable Fields Count | Key Supported Attributes |
| :--- | :--- | :--- | :--- |
| `ClientMap.php` | `client` | 40 | `client.name`, `client.id_number`, `client.vat_number`, `client.website`, `client.address1`, `client.city`, `client.postal_code`, `client.country_id`, `client.currency_id`, `client.custom_value1-4`, contact details (`first_name`, `last_name`, `email`, `phone`) |
| `ProductMap.php` | `product` | 21 | `product.product_key`, `product.notes`, `product.cost`, `product.price`, `product.quantity`, `product.tax_name1-3`, `product.tax_rate1-3`, `product.custom_value1-4` |
| `InvoiceMap.php` | `invoice` | 57 | `invoice.number`, `invoice.date`, `invoice.due_date`, `invoice.discount`, `invoice.po_number`, `invoice.terms`, `invoice.public_notes`, `invoice.private_notes`, line item details (`product_key`, `notes`, `cost`, `quantity`, `tax_name`, `tax_rate`), payment details |
| `PaymentMap.php` | `payment` | 15 | `payment.number`, `payment.amount`, `payment.refunded`, `payment.applied`, `payment.transaction_reference`, `payment.date`, `payment.payment_type`, `payment.private_notes`, `payment.custom_value1-4`, `payment.client_id` |
| `VendorMap.php` | `vendor` | 32 | `vendor.name`, `vendor.phone`, `vendor.id_number`, `vendor.vat_number`, `vendor.website`, `vendor.first_name`, `vendor.last_name`, `vendor.email`, `vendor.currency_id`, `vendor.address1-2`, `vendor.city`, `vendor.postal_code` |
| `PurchaseOrderMap.php` | `purchase_order` | 54 | `purchase_order.number`, `purchase_order.date`, `purchase_order.due_date`, `vendor.name`, `purchase_order.discount`, `purchase_order.po_number`, `purchase_order.terms`, line item details |
| `ExpenseMap.php` | `expense` | 30 | `expense.vendor`, `expense.client`, `expense.project`, `expense.category`, `expense.amount`, `expense.currency`, `expense.date`, `expense.payment_type`, `expense.transaction_reference`, `expense.is_billed`, `expense.should_be_invoiced` |
| `QuoteMap.php` | `quote` | 57 | `quote.number`, `quote.date`, `quote.due_date`, `client.name`, `quote.discount`, `quote.po_number`, `quote.terms`, line items |
| `RecurringInvoiceMap.php` | `recurring_invoice` | 60 | `invoice.number`, `invoice.next_send_date`, `invoice.due_date`, `client.name`, `invoice.frequency_id`, `invoice.remaining_cycles`, line items |
| `BankTransactionMap.php` | `bank_transaction` | 14 | `transaction.transaction_id`, `transaction.amount`, `transaction.currency`, `transaction.account_type`, `transaction.category`, `transaction.date`, `transaction.bank_account`, `transaction.description`, `transaction.base_type` |
| `TaskMap.php` | `task` | 21 | `task.number`, `task.rate`, `project.name`, `client.name`, `client.email`, `task.description`, `task.billable`, `task.start_date`, `task.end_date`, `task.duration`, `task.custom_value1-4` |

---

### 1.3 Third-Party Migration Providers
Located in `app/Import/Providers/`:
- `Csv.php`: Universal CSV ingestion engine supporting all 11 mapped entities.
- `Freshbooks.php`: Migrates FreshBooks clients and invoices.
- `Invoice2Go.php`: Migrates Invoice2go invoices and line items.
- `Invoicely.php`: Migrates Invoicely clients and invoices.
- `QBBackup.php`: Migrates QuickBooks company backup archives (clients, products, invoices, quotes, payments, vendors, expenses).
- `Wave.php`: Migrates Wave Accounting exports (clients, products, invoices, payments, vendors, expenses).
- `Zoho.php`: Migrates Zoho Books exports (clients, invoices).

---

### 1.4 Execution Pipeline & Ingestion Sequence
In `app/Jobs/Import/CSVIngest.php:handle()`:
1. Multi-database binding: `MultiDB::setDb($this->company->db)`.
2. Memory limit safety: `set_time_limit(0)`.
3. Sequential entity processing:
   ```php
   foreach (['client', 'product', 'invoice', 'payment', 'vendor', 'purchase_order', 'expense', 'quote', 'bank_transaction', 'recurring_invoice', 'task'] as $entity) {
       $engine->import($entity);
   }
   ```
4. Post-import finalization: `$engine->finalizeImport()`.
5. Automatic contact healing: `$this->checkContacts()` verifies every imported client and vendor has at least one valid primary contact record.

---

### 1.5 Duplicate Handling, Validation & Error Reporting
- **Products**: In `BaseImport::ingestProducts()`, the transformer checks `$this->transformer->hasProduct($entity['product_key'])`. If the product exists, it updates the existing record (`$product = $this->transformer->getProduct(...)`); otherwise, it creates a new record.
- **Clients & Vendors**: Multi-row records sharing identical client names or email addresses are grouped via `BaseImport::groupClients()` and merged into a single client with multiple contacts.
- **Invoices, Quotes, POs**: Multi-row line items sharing identical document numbers are aggregated via `BaseImport::groupInvoices()` into a single document record containing all line items.
- **Validation Failures**:
  - Each record is validated against its respective FormRequest validator (`$validator = $this->runValidation($entity)`).
  - Validation failures **do not abort the entire import**. Instead, the failed row is skipped and appended to `$this->error_array[$entity_type][]`:
    ```php
    $this->error_array[$entity_type][] = [
        $entity_type => $record,
        'error' => $validator->errors()->all(),
    ];
    ```
- **System Exceptions**: Caught via `BaseImport::handleImportFailure()` and reported with a UUID error reference string (`$this->system_error_reference`).
- **Free Hosted Plan Limits**: If on a free hosted account, `BaseImport::ingest()` enforces plan client ceilings (`$count > $hosted_client_count`), returning an explicit plan allowance error.

---

### 1.6 What CANNOT Be Imported
The CSV import pipeline explicitly cannot import:
1. **Credit Notes (`credits`)**: There is no `CreditMap.php` or `Credit` importer; credit notes cannot be ingested via CSV.
2. **Recurring Expenses (`recurring_expenses`)**: Only recurring invoices are supported; recurring expenses have no import map.
3. **Recurring Quotes (`recurring_quotes`)**: Cannot be imported via CSV.
4. **Standalone Projects (`projects`)**: Projects can only be created implicitly as side-effects of Task or Expense imports; standalone projects cannot be imported.
5. **Binary Document Attachments (`documents`)**: Cannot import raw PDF, PNG, or image attachments through CSV.
6. **Subscriptions (`subscriptions`)**: Cannot be imported via CSV.
7. **Custom Designs (`designs`)**: Custom invoice templates and HTML/CSS designs cannot be imported via CSV.
8. **Webhooks (`webhooks`)**: Webhook subscriptions and endpoints cannot be imported.
9. **Payment Gateway Credentials (`company_gateways`)**: Secret keys, tokens, and gateway credentials cannot be imported via CSV.
10. **Users and Company Users (`users`, `company_users`)**: Cannot import staff members, login credentials, or permissions via CSV.
11. **Audit Logs & History (`activities`, `system_logs`)**: Cannot import audit trails or historical activity logs.
12. **Tax Amount Overrides**: Invoice and quote line item tax amounts are always calculated dynamically from tax rates; raw tax amount overrides cannot be imported.

---

## 2. Exports Architecture

### 2.1 Tabular CSV Exports (Reports & Data Extracts)
Tabular exports are implemented under `app/Export/CSV/` (21 classes inheriting from `BaseExport.php`):
- `ClientExport.php`
- `ContactExport.php`
- `ProductExport.php`
- `ProductSalesExport.php`
- `InvoiceExport.php`
- `InvoiceItemExport.php`
- `QuoteExport.php`
- `QuoteItemExport.php`
- `CreditExport.php`
- `PurchaseOrderExport.php`
- `PurchaseOrderItemExport.php`
- `RecurringInvoiceExport.php`
- `RecurringInvoiceItemExport.php`
- `PaymentExport.php`
- `ExpenseExport.php`
- `VendorExport.php`
- `TaskExport.php`
- `ActivityExport.php`
- `DocumentExport.php`
- `LocationExport.php`

These classes format entity attributes and custom fields into streaming CSV rows via `League\Csv\Writer`, respecting user permissions (`$user->hasExactPermission('view_all') || $user->hasExactPermission('edit_all')`).

---

### 2.2 Full Company Export (JSON Backup)
- **Controller**: `app/Http/Controllers/ExportController.php`
- **Route**: `POST /api/v1/export`
- **Request Authorization**: `StoreExportRequest::authorize()` requires `auth()->user()->isAdmin()`.
- **Job**: `app/Jobs/Company/CompanyExport.php`
- **Mechanics**:
  - Generates a UUID download hash and signed temporary URL with 1-hour or 5-hour TTL (if activities > 10,000).
  - Streams a structured JSON export using `JsonMachine\File` directly into `sys_get_temp_dir()`.
  - Encodes primary keys to anonymized hashes (`$this->transformArrayOfKeys()`).
  - Calls `CompanyExport::zipAndSend()` which compresses the JSON dump, company logo, and customer invoice HTML backups into a single `.zip` file stored on the configured filesystem disk (`storage/app/backups/`).
  - Dispatches `App\Mail\DownloadBackup` email and `App\Notifications\DownloadAvailable` notification to the admin user.

---

## 3. Backup & Restore Architecture

### 3.1 What the Backup Archive Contains
As empirically verified from container storage (`storage/app/backups/<filename>.zip`), the ZIP archive contains:
1. `backup.json`: A single JSON document containing all 44 company data collections:
   - `activities`, `backups`, `users`, `client_contacts`, `client_gateway_tokens`, `clients`, `company` (complete configuration and `settings` JSON), `company_gateways`, `company_tokens`, `company_ledger`, `company_users`, `credits`, `credit_invitations`, `designs`, `documents` (metadata records), `expense_categories`, `expenses`, `group_settings`, `invoices`, `invoice_invitations`, `payment_terms`, `payments`, `products`, `projects`, `quotes`, `quote_invitations`, `recurring_expenses`, `recurring_invoices`, `recurring_invoice_invitations`, `subscriptions`, `system_logs`, `tasks`, `task_statuses`, `tax_rates`, `vendors`, `vendor_contacts`, `webhooks`, `purchase_orders`, `purchase_order_invitations`, `bank_integrations`, `bank_transactions`, `schedulers`, `e_invoicing_tokens`, `locations`.
2. `company_logo.png`: The raw binary image file of the company's uploaded logo.
3. `backups/<company_key>/<client_hash>/backups/<date>_<hash>.html`: Every rendered HTML snapshot/version of client invoices generated by the system.

### 3.2 What the Backup Archive Explicitly Does NOT Contain
1. **Raw Document Attachment Binaries**: Document records (`Document`) are included as metadata URLs, but binary files attached to expenses or invoices are not embedded inside `backup.json`.
2. **Plaintext Passwords**: User passwords remain hashed or stripped for security.
3. **Third-Party Payment Secrets**: Live gateway API secrets are omitted or masked.
4. **Activity Logs on Large Hosted Accounts**: If hosted and `total_activities > 10000`, `$this->export_data['activities']` is exported as an empty array `[]` to prevent memory/timeout exhaustion.
5. **System Sessions & Temporary Cache**: Transient state, queued jobs, and failed jobs are not exported.

---

### 3.3 Restore Mechanics (`CompanyImport.php`)
When a JSON or ZIP backup is uploaded via `POST /api/v1/import_json`, `app/Jobs/Company/CompanyImport.php` handles restoration:

1. **Unzipping & Pre-Flight Checks**:
   - `unzipFile()` extracts `backup.json` from the ZIP archive.
   - `preFlightChecks()` validates schema versions (`$this->import_version = $data->app_version`).
2. **Settings Restoration (`import_settings=true`)**:
   - `importSettings()`: Sanitizes blade expressions, scripts, and potential XSS vectors via `Purify::clean()`.
   - Strips malicious blade directives (`{!!`, `@php`, `<?php`, `@include`, etc.).
   - Validates external logo URLs using `App\Rules\SafeExternalUrl`.
   - `preserveCurrentCounterSettings()`: By default, retains the existing company's current invoice/quote counter numbers.
3. **Data Restoration & Purge (`import_data=true`)**:
   > [!CAUTION]
   > `CompanyImport::purgeCompanyData()` force-deletes all existing transactional data prior to restoring from backup!
   
   - **What it Purges / Overwrites**:
     Calls `forceDelete()` on:
     - `clients()`
     - `all_activities()`
     - `products()`
     - `projects()`
     - `tasks()`
     - `vendors()`
     - `expenses()`
     - `subscriptions()`
     - `purchase_orders()`
     - `bank_integrations()`
     - `bank_transactions()`
     - `schedulers()`
     - `system_log_relation()`
   - **What it Preserves**:
     - `CompanyUser` and user accounts are NOT force-deleted; existing users are matched and re-associated.
     - Account licensing and multi-company ownership structures are preserved.
     - Counter settings can be restored or preserved according to import options (`restoreCountersFromBackup()`).
   - **Topological Ingestion**: Restores records in strict dependency order, re-maps foreign key identifiers via `transformId()`, re-hashes customer portal tokens via `rehashImportedPortalIdentifiers()`, reconnects `paymentables`, and dispatches `App\Mail\Admin\ImportCompleted`.

---

## 4. Activity Log Audit Subsystem

### 4.1 Activity Model & Database Schema
- **Model**: `app/Models/Activity.php`
- **Table**: `activities` (defined in `database/migrations/2014_10_13_000000_create_users_table.php:L798` and `2020_07_08_065301_add_token_id_to_activity_table.php`)
- **Schema Columns**:
  - `id`: unsigned integer, primary key, auto-increment
  - `user_id`: unsigned integer, nullable, foreign key
  - `company_id`: unsigned integer, non-nullable, indexed
  - `client_id`: unsigned integer, nullable, indexed
  - `client_contact_id`: unsigned integer, nullable, indexed
  - `account_id`: unsigned integer, nullable
  - `project_id`: unsigned integer, nullable, indexed
  - `vendor_id`: unsigned integer, nullable, indexed
  - `payment_id`: unsigned integer, nullable, indexed
  - `invoice_id`: unsigned integer, nullable, indexed
  - `credit_id`: unsigned integer, nullable, indexed
  - `invitation_id`: unsigned integer, nullable, indexed
  - `task_id`: unsigned integer, nullable, indexed
  - `expense_id`: unsigned integer, nullable, indexed
  - `token_id`: unsigned integer, nullable
  - `quote_id`: unsigned integer, nullable
  - `subscription_id`: unsigned integer, nullable
  - `recurring_invoice_id`: unsigned integer, nullable
  - `recurring_expense_id`: unsigned integer, nullable
  - `recurring_quote_id`: unsigned integer, nullable
  - `purchase_order_id`: unsigned integer, nullable
  - `vendor_contact_id`: unsigned integer, nullable
  - `activity_type_id`: unsigned integer, nullable (identifies specific event type)
  - `ip`: string
  - `is_system`: boolean, default 0
  - `notes`: text
  - `created_at`: timestamp (precision 6)
  - `updated_at`: timestamp (precision 6)

---

### 4.2 Complete Enumeration of Activity Type Constants
`app/Models/Activity.php` declares 123 distinct activity constants:

```php
const CREATE_CLIENT = 1;
const ARCHIVE_CLIENT = 2;
const DELETE_CLIENT = 3;
const CREATE_INVOICE = 4;
const UPDATE_INVOICE = 5;
const EMAIL_INVOICE = 6;
const VIEW_INVOICE = 7;
const ARCHIVE_INVOICE = 8;
const DELETE_INVOICE = 9;
const CREATE_PAYMENT = 10;
const UPDATE_PAYMENT = 11;
const ARCHIVE_PAYMENT = 12;
const DELETE_PAYMENT = 13;
const CREATE_CREDIT = 14;
const UPDATE_CREDIT = 15;
const ARCHIVE_CREDIT = 16;
const DELETE_CREDIT = 17;
const CREATE_QUOTE = 18;
const UPDATE_QUOTE = 19;
const EMAIL_QUOTE = 20;
const VIEW_QUOTE = 21;
const ARCHIVE_QUOTE = 22;
const DELETE_QUOTE = 23;
const RESTORE_QUOTE = 24;
const RESTORE_INVOICE = 25;
const RESTORE_CLIENT = 26;
const RESTORE_PAYMENT = 27;
const RESTORE_CREDIT = 28;
const APPROVE_QUOTE = 29;
const CREATE_VENDOR = 30;
const ARCHIVE_VENDOR = 31;
const DELETE_VENDOR = 32;
const RESTORE_VENDOR = 33;
const CREATE_EXPENSE = 34;
const ARCHIVE_EXPENSE = 35;
const DELETE_EXPENSE = 36;
const RESTORE_EXPENSE = 37;
const VOIDED_PAYMENT = 39;
const REFUNDED_PAYMENT = 40;
const FAILED_PAYMENT = 41;
const CREATE_TASK = 42;
const UPDATE_TASK = 43;
const ARCHIVE_TASK = 44;
const DELETE_TASK = 45;
const RESTORE_TASK = 46;
const UPDATE_EXPENSE = 47;
const CREATE_USER = 48;
const UPDATE_USER = 49;
const ARCHIVE_USER = 50;
const DELETE_USER = 51;
const RESTORE_USER = 52;
const MARK_SENT_INVOICE = 53;
const PAID_INVOICE = 54;
const EMAIL_INVOICE_FAILED = 57;
const REVERSED_INVOICE = 58;
const CANCELLED_INVOICE = 59;
const VIEW_CREDIT = 60;
const UPDATE_CLIENT = 61;
const UPDATE_VENDOR = 62;
const INVOICE_REMINDER1_SENT = 63;
const INVOICE_REMINDER2_SENT = 64;
const INVOICE_REMINDER3_SENT = 65;
const INVOICE_REMINDER_ENDLESS_SENT = 66;
const CREATE_SUBSCRIPTION = 80;
const UPDATE_SUBSCRIPTION = 81;
const ARCHIVE_SUBSCRIPTION = 82;
const DELETE_SUBSCRIPTION = 83;
const RESTORE_SUBSCRIPTION = 84;
const CREATE_RECURRING_INVOICE = 100;
const UPDATE_RECURRING_INVOICE = 101;
const ARCHIVE_RECURRING_INVOICE = 102;
const DELETE_RECURRING_INVOICE = 103;
const RESTORE_RECURRING_INVOICE = 104;
const CREATE_RECURRING_QUOTE = 110;
const UPDATE_RECURRING_QUOTE = 111;
const ARCHIVE_RECURRING_QUOTE = 112;
const DELETE_RECURRING_QUOTE = 113;
const RESTORE_RECURRING_QUOTE = 114;
const CREATE_RECURRING_EXPENSE = 120;
const UPDATE_RECURRING_EXPENSE = 121;
const ARCHIVE_RECURRING_EXPENSE = 122;
const DELETE_RECURRING_EXPENSE = 123;
const RESTORE_RECURRING_EXPENSE = 124;
const CREATE_PURCHASE_ORDER = 130;
const UPDATE_PURCHASE_ORDER = 131;
const ARCHIVE_PURCHASE_ORDER = 132;
const DELETE_PURCHASE_ORDER = 133;
const RESTORE_PURCHASE_ORDER = 134;
const EMAIL_PURCHASE_ORDER = 135;
const VIEW_PURCHASE_ORDER = 136;
const ACCEPT_PURCHASE_ORDER = 137;
const PAYMENT_EMAILED = 138;
const VENDOR_NOTIFICATION_EMAIL = 139;
const EMAIL_STATEMENT = 140;
const USER_NOTE = 141;
const QUOTE_REMINDER1_SENT = 142;
const AUTOBILL_SUCCESS = 143;
const AUTOBILL_FAILURE = 144;
const EINVOICE_SENT = 145;
const EINVOICE_DELIVERY_SUCCESS = 146;
const EINVOICE_DELIVERY_FAILURE = 147;
const E_EXPENSE_CREATED = 148;
const EMAIL_CREDIT = 149;
const ACCOUNT_DELETED = 150;
const MERGE_CLIENT = 151;
const MERGE_VENDOR = 152;
const PURGE_CLIENT = 153;
const VERIFACTU_INVOICE_SENT = 154;
const VERIFACTU_INVOICE_SENT_FAILURE = 155;
const VERIFACTU_CANCELLATION_SENT = 156;
const VERIFACTU_CANCELLATION_SENT_FAILURE = 157;
const QUOTE_REJECTED = 158;
const INVOICE_DOCUMENT_SIGNED = 159;
const QUOTE_DOCUMENT_SIGNED = 160;
const CREDIT_DOCUMENT_SIGNED = 161;
const PURCHASE_ORDER_DOCUMENT_SIGNED = 162;
const CUSTOM_DOCUMENT_SIGNED = 163;
const QUICKBOOKS_PUSH_FAILURE = 164;
const QUICKBOOKS_PUSH_SUCCESS = 165;
const PURGE_USER = 166;
const EINVOICE_STATUS_UPDATED = 167;
const PAYMENT_METHOD_UPDATED = 168;
const PAYMENT_METHOD_REMOVED = 169;
```

---

### 4.3 What is NOT Recorded in the Activity Log
Audit inspection shows that the following operational changes do NOT generate `Activity` records:
1. **Line Item Modifications**: Changes to individual invoice/quote items (item descriptions, price tweaks, tax assignments) do not generate distinct line-level activities; only the parent document `UPDATE_INVOICE (5)` event is recorded.
2. **Product Catalog CRUD**: Creating, editing, or deleting products in the product catalog (`Product`) does not create an Activity record.
3. **Project Catalog CRUD**: Creating or editing projects (`Project`) does not create an Activity record.
4. **Tax Rate Modifications**: Creating, updating, or deleting tax rates does not create an Activity record.
5. **Company Settings Changes**: Modifying invoice design, number patterns, payment gateways, workflow toggles, or localization does not generate Activity records.
6. **Bank Transaction Synchronization**: Fetching, importing, or rules-matching bank transactions does not record activities.
7. **Webhook Events & Tokens**: Generating API tokens or updating webhooks does not record activities.

---

## 5. System Log Subsystem

### 5.1 SystemLog Model & Schema
- **Model**: `app/Models/SystemLog.php`
- **Table**: `system_logs`
- **Schema Columns**:
  - `id`: unsigned integer, primary key, auto-increment
  - `company_id`: unsigned integer, foreign key to `companies`
  - `user_id`: unsigned integer, nullable
  - `client_id`: unsigned integer, nullable
  - `category_id`: unsigned tiny integer (e.g., Mail, Gateway, PDF, Webhook)
  - `event_id`: unsigned small integer (specific operation status)
  - `type_id`: unsigned small integer (gateway/driver or sub-system identifier)
  - `log`: text / json payload containing raw upstream response or error trace
  - `created_at`, `updated_at`: timestamps

---

### 5.2 Categories, Events, and Types
In `app/Models/SystemLog.php`:

1. **Categories (`category_id`)**:
   - `CATEGORY_GATEWAY_RESPONSE = 1`
   - `CATEGORY_MAIL = 2`
   - `CATEGORY_WEBHOOK = 3`
   - `CATEGORY_PDF = 4`
   - `CATEGORY_SECURITY = 5`
   - `CATEGORY_LOG = 6`
   - `CATEGORY_VERIFACTU = 7`
   - `CATEGORY_PEPPOL = 8`

2. **Events (`event_id`)**:
   - Gateway/Payment: `EVENT_PAYMENT_RECONCILIATION_FAILURE = 10`, `EVENT_PAYMENT_RECONCILIATION_SUCCESS = 11`, `EVENT_GATEWAY_SUCCESS = 21`, `EVENT_GATEWAY_FAILURE = 22`, `EVENT_GATEWAY_ERROR = 23`
   - Mail: `EVENT_MAIL_SEND = 30`, `EVENT_MAIL_RETRY_QUEUE = 31`, `EVENT_MAIL_BOUNCED = 32`, `EVENT_MAIL_SPAM_COMPLAINT = 33`, `EVENT_MAIL_DELIVERY = 34`, `EVENT_MAIL_OPENED = 35`, `EVENT_INBOUND_MAIL_BLOCKED = 62`
   - Webhook: `EVENT_WEBHOOK_RESPONSE = 40`, `EVENT_WEBHOOK_SUCCESS = 41`, `EVENT_WEBHOOK_FAILURE = 42`
   - PDF: `EVENT_PDF_RESPONSE = 50`
   - Security/Auth: `EVENT_AUTHENTICATION_FAILURE = 60`, `EVENT_USER = 61`
   - E-Invoicing / Accounting: `EVENT_VERIFACTU_FAILURE = 70`, `EVENT_VERIFACTU_SUCCESS = 71`, `EVENT_PEPPOL_FAILURE = 72`, `EVENT_PEPPOL_SUCCESS = 73`, `EVENT_ACCOUNTING = 74`

3. **Types (`type_id`)**:
   - Gateway Drivers: `TYPE_PAYPAL = 300`, `TYPE_STRIPE = 301`, `TYPE_LEDGER = 302`, `TYPE_BRAINTREE = 307`, `TYPE_SQUARE = 320`, `TYPE_GOCARDLESS = 321`, `TYPE_RAZORPAY = 322`, `TYPE_AUTHORIZE = 305`, etc.
   - Subsystem Results: `TYPE_QUOTA_EXCEEDED = 400`, `TYPE_UPSTREAM_FAILURE = 401`, `TYPE_PDF_FAILURE = 600`, `TYPE_PDF_SUCCESS = 601`, `TYPE_LOGIN_SUCCESS = 800`, `TYPE_LOGIN_FAILURE = 801`, `TYPE_GENERIC = 900`.

---

## 6. User Management & Permission Matrix

### 6.1 User Creation & Invitation Architecture
- **Form Request**: `app/Http/Requests/User/StoreUserRequest.php`
  - Authorization: `authorize()` requires `auth()->user()->isAdmin()`.
  - Rules: `first_name` (`required|string|max:100`), `last_name` (`required|string|max:100`), `email` (`required|email|AttachableUser`).
  - Prepares default company user structure:
    ```php
    $input['company_user'] = [
        'is_admin' => $input['company_user']['is_admin'] ?? false,
        'permissions' => $input['company_user']['permissions'] ?? '',
        'settings' => $input['company_user']['settings'] ?? null,
    ];
    ```
- **Controller & Repo Flow**: `app/Http/Controllers/UserController.php:store()` calls `UserRepository::save()`.
  - Creates or attaches `User`.
  - Generates confirmation token `confirmation_code = $this->createDbHash($company->db)`.
  - Generates initial company token via `(new CreateCompanyToken($company, $user, $user_agent))->handle()`.
  - Emits `UserWasCreated` event which queues the invitation email with setup link.

---

### 6.2 Permission Storage & Evaluation
- **Pivot Table & Model**: `company_user` table -> `App\Models\CompanyUser.php`.
- **Columns**: `is_admin` (bool), `is_owner` (bool), `is_locked` (bool), `permissions` (text/string).
- **Evaluation Mechanism (`App\Models\User::hasPermission()`)**:
  ```php
  public function hasPermission($permission): bool
  {
      $parts = explode('_', $permission, 2);
      $all_permission = '____';
      $edit_all = '____';
      $edit_entity = '____';

      if (count($parts) > 1) {
          $all_permission = $parts[0] . '_all';
          if ($parts[0] == 'view') {
              $edit_all = 'edit_all';
              $edit_entity = "edit_{$parts[1]}";
          }
      }

      return $this->isSuperUser()
          || (stripos($this->token()->cu->permissions ?? '', $permission) !== false)
          || (stripos($this->token()->cu->permissions ?? '', $all_permission) !== false)
          || (stripos($this->token()->cu->permissions ?? '', $edit_all) !== false)
          || (stripos($this->token()->cu->permissions ?? '', $edit_entity) !== false);
  }
  ```
- **Permission Hierarchy**:
  - `isAdmin()` or `isOwner()` grants superuser bypass over all permission checks.
  - `edit_all` automatically grants `view_all` and `edit_{entity}`.
  - `edit_{entity}` automatically grants `view_{entity}`.
  - `view_all` automatically grants `view_{entity}` for every entity type.

---

### 6.3 React User Management UI Screen & Permission Matrix
As inspected in frontend bundles `public/Edit-DWaKvWys.js` and `public/Permissions-CUQrisQg.js`:
- **Screen Layout Tabs**:
  1. `user_details`: Inputs for `first_name`, `last_name`, `email`, signature canvas (`create_signature`, `type_signature`, `upload`), and initials canvas (`enter_initials`).
  2. `notifications`: Channel preferences (`receive_all_notifications`, `all`, `owned_by_user`, `none`, or `custom` checkboxes for individual entity triggers).
  3. `permissions`: The visual permissions matrix.
- **The Permissions Grid**:
  - **Administrator Switch**: `admin-toggle` (disables individual permission checkboxes when active).
  - **Permission Action Columns**:
    - `view` (id: 1)
    - `edit` (id: 2)
    - `delete` (id: 3)
    - `create` (id: 4)
    - `requires_approval` (id: 5 - specific to Documents)
  - **Entity Rows**:
    - `all` (master toggle across all rows)
    - `documents` (supports actions 1, 2, 3, 4, 5)
    - `templates` (supports actions 1, 2, 3, 4)
    - `blueprints` (supports actions 1, 2, 3, 4)
    - `clients` (supports actions 1, 2, 3, 4)

---

### 6.4 The Restricted User & "View Assigned Only" Behavior
When a user does NOT possess `view_all`, `edit_all`, or `view_{entity}` permissions, their access is governed by the following mechanics:

1. **Entity-Level Read Authorization (`App\Policies\EntityPolicy::view()`)**:
   ```php
   public function view(User $user, $entity): bool
   {
       return ($user->isAdmin() && $entity->company_id == $user->companyId())
           || ($user->hasPermission('view_' . \Illuminate\Support\Str::snake(class_basename($entity))) && $entity->company_id == $user->companyId())
           || ($user->owns($entity) && $entity->company_id == $user->companyId())
           || ($user->assigned($entity) && $entity->company_id == $user->companyId());
   }
   ```
   - If the user lacks the explicit view permission, access is **allowed if and only if**:
     - `$user->owns($entity)`: `$entity->user_id == $user->id` (user created the record), OR
     - `$user->assigned($entity)`: `$entity->assigned_user_id == $user->id` (record was assigned to the user).

2. **Collection Listing Queries (`BaseController.php:L407-L555` & `SearchController.php:L447-L523`)**:
   - When pulling entity collections into the frontend dashboard, the query is scoped down at SQL execution time:
   ```php
   'company.invoices' => function ($query) use ($updated_at, $user) {
       $query->where('updated_at', '>=', $updated_at)->with('invitations', 'documents', 'tags');

       if (! $user->hasPermission('view_invoice')) {
           $query->whereNested(function ($query) use ($user) {
               $query->where('invoices.user_id', $user->id)->orWhere('invoices.assigned_user_id', $user->id);
           });
       }
   }
   ```
   - This exact constraint applies to `clients`, `credits`, `expenses`, `invoices`, `payments`, `projects`, `quotes`, `purchase_orders`, `recurring_invoices`, and `tasks`.
   - Records belonging to other users that are unassigned are completely excluded from the query results returned to that user.

---

## 7. Empirical Live Container Verification

The following verification tests were executed directly in `craterninja-app-1`:

### Test 1: User Permission Scope Filtering
```
Active Company ID: 1
Admin User: admin@example.com (ID: 1)

--- TEST 1: User Permission Scope Filtering ---
Test User hasPermission('view_invoice'): FALSE
Admin visible test invoices: 2 (both B11-ASSIGNED-01 and B11-OTHER-02)
Restricted user visible count: 1
  - Visible Invoice: B11-ASSIGNED-01 (assigned_user_id: 2)
EntityPolicy::view() on assigned invoice: ALLOWED
EntityPolicy::view() on unassigned invoice: DENIED
```
- **Finding**: Confirmed that a restricted user lacking `view_invoice` is strictly limited to viewing invoices where `assigned_user_id` or `user_id` matches their own ID. Unassigned invoices or invoices assigned to other staff members are denied at both the collection query level and policy gate level.

---

### Test 2: Activity Logging Trigger
```
--- TEST 2: Activity Logging ---
Created Invoice Activity record:
  - Activity ID: 73
  - Activity Type ID: 4 (Constant CREATE_INVOICE = 4)
  - Invoice ID linked: 62
  - User ID linked: 1
  - Company ID linked: 1
```
- **Finding**: Confirmed that triggering an invoice lifecycle event creates an `activities` table entry with `activity_type_id = 4` (`Activity::CREATE_INVOICE`), correctly storing company, user, and invoice foreign keys.

---

### Test 3: Full Company Export & Backup ZIP Structure
```
--- TEST 3: Company Export JSON Structure & Collections ---
CompanyExport finished successfully!
Cache Hash: 7905e427-3997-4a03-946e-ed1e34c840f7
Cache Record: {"disk":"local","path":"backups\/2026-11-08_Shibook_Media_&_Periodicals_Distribution_pjiMNyHBwGsNoO9p56yN88VggXENJMDE.zip","download_name":"2026-11-08_Shibook_Media_&_Periodicals_Distribution_pjiMNyHBwGsNoO9p56yN88VggXENJMDE.zip","expires_at":1794159875}
Generated ZIP Archive Path: backups/2026-11-08_Shibook_Media_&_Periodicals_Distribution_pjiMNyHBwGsNoO9p56yN88VggXENJMDE.zip

Files inside zip: 30
  * backup.json (345246 bytes)
    Preview: {"app_version":"5.13.43","storage_url":"http:\/\/localhost:8090\/storage\/","activities":[{"user_id":"VolejRejNm","company_id":"VolejRejNm","client_id":"VolejRejNm"...
  * company_logo.png (135 bytes)
  * backups/pjiMNyHBwGsNoO9p56yN88VggXENJMDE/v048LQavMaLHbM3rPvvD9AvjgTzh9Xju3Jedj3bs/backups/2026_09_22_82fef0a0d07abef5bce0cf70b0b6f95f.html (14094 bytes)
  ... [additional 27 client invoice HTML version snapshots]
```
- **Finding**: Confirmed that `CompanyExport` assembles `backup.json` (345KB covering all 44 collections), the binary `company_logo.png`, and all client HTML invoice version snapshots into a packaged `.zip` file stored in `storage/app/backups/`.

---

## 8. Verification Status

### Verified by code
- `app/Http/Controllers/ImportController.php`, `ImportJsonController.php`, and `ExportController.php` routes and action handlers.
- `app/Jobs/Import/CSVIngest.php` sequential entity ingestion and contact auto-healing.
- All 11 import definitions under `app/Import/Definitions/` and all 7 third-party migration providers under `app/Import/Providers/`.
- `app/Jobs/Company/CompanyExport.php` streaming 44 collections via `JsonMachine\File` and creating ZIP packages in `zipAndSend()`.
- `app/Jobs/Company/CompanyImport.php` `purgeCompanyData()` force-delete routine, settings sanitation, and foreign key ID transformation.
- `app/Models/Activity.php` table migration, index definitions, and all 123 activity type constants.
- `app/Models/SystemLog.php` 8 categories, 16 events, and gateway/subsystem types.
- `app/Models/User.php` permission checks (`hasPermission()`, `hasExactPermission()`, `owns()`, `assigned()`).
- `app/Policies/EntityPolicy.php` policy gates for `view()` and `edit()`.
- `app/Http/Controllers/BaseController.php` (lines 407-555) query-level scoping for non-view permitted users.

### Verified in running app
- Live user permission scoping test: Restricted user without `view_invoice` constrained to seeing only assigned invoice (`assigned_user_id`); unassigned invoice rejected by `EntityPolicy::view()`.
- Live activity generation test: Invoice creation listener generated `Activity` record with `activity_type_id = 4` (`CREATE_INVOICE`).
- Live backup generation test: `CompanyExport` executed, verified ZIP archive in container `storage/app/backups/` containing `backup.json` (345KB), `company_logo.png`, and HTML version snapshots.

### Could not verify
- Large hosted account activity stripping threshold (`total_activities > 10000`) could not be tested directly on self-hosted container instance because self-hosted installations do not enable `Ninja::isHosted()` mode.

