# Invoice Ninja v5 Inspection — Batch 0: Conflict Resolution

**Document:** `IN-batch-0-conflicts.md`  
**Target:** Invoice Ninja v5 (Self-Hosted Debian Docker Stack: `invoiceninja/invoiceninja-debian:latest`)  
**Instance URL:** `http://localhost:8090`  
**Investigation Date:** 2026-11-07  

---

## Conflict 1: When Does Stock Actually Decrement?

### 1. Finding & Resolution

- **Question:** Does stock decrement immediately on invoice save (including Draft), or only upon transition from Draft to Sent?
- **Finding:** Stock decrements **immediately upon invoice creation/save (including Draft status)**. It does **not** wait for the invoice to be marked Sent, viewed, or paid.
- **Retraction:** **retracted: "stock decrements only on Draft to Sent"** (Round 1 claim). Stock decrements immediately upon initial invoice creation (`POST /api/v1/invoices`) as long as `company.track_inventory` is enabled and line items are inventory items (`type_id == '1'`).

---

### 2. Code Evidence

#### The Inventory Adjustment Job
`[CODE app/Jobs/Inventory/AdjustProductInventory.php:L91-118]`
```php
    private function newInventoryAdjustment()
    {
        if(!is_iterable($this->invoice->line_items)) {
            return;
        }
        
        collect($this->invoice->line_items)->filter(function ($item) {
            return $item->type_id == '1';
        })->each(function ($i) {
            $p = Product::query()
                ->where('company_id', $this->company->id)
                ->where('product_key', $i->product_key)
                ->first();

            if ($p) {
                $p->in_stock_quantity -= $i->quantity;

                $p->saveQuietly();

                if ($this->company->stock_notification && $p->stock_notification && $p->stock_notification_threshold && $p->in_stock_quantity <= $p->stock_notification_threshold) {
                    $this->notifyStockLevels($p, 'product');
                } elseif ($this->company->stock_notification && $p->stock_notification && $this->company->inventory_notification_threshold && $p->in_stock_quantity <= $this->company->inventory_notification_threshold) {
                    $this->notifyStocklevels($p, 'company');
                }
            }
        });
    }
```

#### The Service Wrapper
`[CODE app/Services/Invoice/InvoiceService.php:L685-692]`
```php
    public function adjustInventory($old_invoice = [])
    {
        if ($this->invoice->company->track_inventory) {
            (new AdjustProductInventory($this->invoice->company, $this->invoice, $old_invoice))->handle();
        }

        return $this;
    }
```

#### Direct Invocation on Invoice Store (Draft Creation)
`[CODE app/Http/Controllers/InvoiceController.php:L240-248]`
```php
        $invoice = $this->invoice_repo->save($request->all(), InvoiceFactory::create($user->company()->id, $user->id));

        $invoice = $invoice->service()
                           ->fillDefaults()
                           ->triggeredActions($request)
                           ->adjustInventory()
                           ->save();
```

#### Every Caller and Condition Checked

1. **Invoice Creation (`InvoiceController.php:L245`):**
   - **Caller:** `InvoiceController::store()`
   - **Condition:** `company.track_inventory == true` and line item `type_id == '1'`.
   - **Effect:** Decrements `products.in_stock_quantity -= line_item.quantity` immediately upon initial `POST /api/v1/invoices` save.

2. **Invoice Update (`InvoiceController.php:L437`):**
   - **Caller:** `InvoiceController::update()`
   - **Condition:** Passes `$old_invoice = $invoice->line_items`.
   - **Effect:** `existingInventoryAdjustment()` restores old line items (`+$old->quantity`), and `newInventoryAdjustment()` decrements new line items (`-$new->quantity`).

3. **Quote Conversion (`ConvertQuote.php:L71`):**
   - **Caller:** `ConvertQuote::run()`
   - **Condition:** Executed when a quote is converted to an invoice.
   - **Effect:** Decrements stock for line items on the newly created invoice.

4. **Recurring Invoice Generation (`SendRecurring.php:L85`):**
   - **Caller:** `SendRecurring::handle()`
   - **Condition:** Executed when recurring invoice schedule triggers a new child invoice.
   - **Effect:** Decrements stock on newly spawned invoice.

5. **Customer Billing Portal Purchases (`BillingPortalPurchase.php:L483`, `BillingPortalPurchasev2.php:L627,L706`):**
   - **Caller:** Livewire client portal checkout handlers.
   - **Condition:** Executed when customer buys through client portal payment links.
   - **Effect:** Decrements inventory immediately upon purchase.

6. **Invoice Deletion (`MarkInvoiceDeleted.php:L48`):**
   - **Caller:** `MarkInvoiceDeleted::handle()`
   - **Condition:** Executed when an invoice is soft-deleted.
   - **Effect:** Restores inventory: `$p->in_stock_quantity += $i->quantity`.

7. **Invoice Restoration (`HandleRestore.php:L73`):**
   - **Caller:** `HandleRestore::handle()`
   - **Condition:** Executed when a soft-deleted invoice is restored.
   - **Effect:** Re-decrements inventory: `$p->in_stock_quantity -= $i->quantity`.

8. **Purchase Order Fulfillment (`PurchaseOrderInventory.php:L45`):**
   - **Caller:** `PurchaseOrderInventory::handle()`
   - **Condition:** When purchase order goods are received.
   - **Effect:** Increments inventory: `$p->in_stock_quantity += $item->quantity`.

*Completeness check: 8 callers of inventory adjustments enumerated by searching `AdjustProductInventory` and `adjustInventory` across `app/`.*

---

### 3. Live Application Verification

`[APP route: http://localhost:8090 / Container: craterninja-app-1]`

Conducted on company ID `1` (`track_inventory = 1`):
1. **Initial Product State:**
   - Created tracked product: `product_key = 'TEST-STOCK-01'`, `price = 150`, `cost = 100`, `track_inventory = 1`.
   - Initial stock: `in_stock_quantity = 50`.
2. **Draft Invoice Creation:**
   - Created Invoice `#0015` in status `1` (`STATUS_DRAFT`) with line item `quantity = 2`.
   - Queried database immediately after draft creation:
     - `products.in_stock_quantity`: **`48`** (decremented immediately from 50 to 48).
3. **Transition to Sent:**
   - Transitioned Invoice `#0015` status from `1` (`STATUS_DRAFT`) to `2` (`STATUS_SENT`).
   - Queried database immediately after transition:
     - `products.in_stock_quantity`: **`48`** (strictly unchanged; does not decrement a second time).
4. **Invoice Deletion:**
   - Soft-deleted Invoice `#0015`.
   - Queried database immediately after deletion:
     - `products.in_stock_quantity`: **`50`** (restored back to original 50).

---

## Conflict 2: Where Does an Overpayment Go?

### 1. Finding & Resolution

- **Question:** Where does an overpayment go? Is it stored in `clients.paid_to_date`, `clients.payment_balance`, an unallocated credit pool, or as a Credit note?
- **Finding:**
  1. **Direct overpayment on an individual invoice line is blocked by validation:** A user cannot enter an amount greater than the balance for an individual invoice. The validator throws an explicit error: `"The amount is greater than the invoice balance. You cannot overpay an invoice."`
  2. **Total payment amount can exceed invoice allocations:** A payment can have a total `amount` greater than the sum of invoice amounts, leaving an unallocated surplus.
  3. **Where the money is stored:**
     - **`payments.amount`**: Stores the full total payment amount received.
     - **`payments.applied`**: Stores only the portion actually applied to invoices or credits.
     - **`payments.status_id`**: Set to `4` (`STATUS_COMPLETED`), with the UI presenting the badge **"Partially Unapplied"** (or **"Unapplied"** if nothing was allocated).
     - **`clients.paid_to_date`**: Incremented by the **entire payment amount** immediately upon receipt.
     - **`clients.payment_balance`**: Stores the **exact unapplied overpayment balance** (`SUM(payments.amount - payments.applied)`). This column holds the client's unapplied payment pool.
     - **`clients.balance`**: Decremented only by the invoice balances actually settled.
     - **`credits` table:** Overpayment does **NOT** generate a Credit note entity.
- **Resolution of Round 1 Hedge:**
  Round 1 hedged between "`clients.paid_to_date` or unallocated credit pool". The definitive resolution in code is: `clients.paid_to_date` records historical cumulative cash receipts, while the unallocated overpayment itself is stored in the database column **`clients.payment_balance`** and derived from `payments.amount - payments.applied`.

---

### 2. Code Evidence

#### The Validation Rule Rejecting Invoice-Level Overpayment
`[CODE app/Http/Requests/Payment/StorePaymentRequest.php:L99-101]`
```php
        } elseif (BcMath::greaterThan($invoice['amount'], $inv->balance)) {
            $validator->errors()->add("invoices.{$index}.amount", ctrans('texts.amount_greater_than_balance_v5'));
        }
```

#### The Validation Rule Permitting Total Payment to Exceed Invoices
`[CODE app/Http/ValidationRules/PaymentAmountsBalanceRule.php:L60-63]`
```php
        $payment_amounts = collect($payments)->sum('amount');
        $invoice_amounts = collect($invoices)->sum('amount');

        return round($payment_amounts, 2) >= round($invoice_amounts, 2);
```

#### Writing the Applied Amount on Payments
`[CODE app/Repositories/PaymentRepository.php:L347-349]`
```php
            $payment->applied += ($invoice_totals - $credit_totals);
            $payment->save();
```

#### Payment Status Badge for Unapplied & Partially Unapplied
`[CODE app/Models/Payment.php:L341-345]`
```php
        if ($this->applied == 0) {
            return '<h6><span class="badge badge-info">' . ctrans('texts.unapplied') . '</span></h6>';
        } elseif ($this->amount > $this->applied) {
            return '<h6><span class="badge badge-info">' . ctrans('texts.partially_unapplied') . '</span></h6>';
        }
```

#### Updating `clients.paid_to_date` with Full Payment Amount
`[CODE app/Repositories/PaymentRepository.php:L218]`
```php
        $client->service()->updatePaidToDate($data['amount'])->save();
```

#### Writing `clients.payment_balance` (Unapplied Payment Pool)
`[CODE app/Services/Client/ClientService.php:L137-152]`
```php
    public function updatePaymentBalance()
    {
        DB::connection(config('database.default'))->transaction(function () {
            $amount = Payment::query()
                    ->withTrashed()
                    ->where('client_id', $this->client->id)
                    ->where('is_deleted', 0)
                    ->whereIn('status_id', [Payment::STATUS_COMPLETED, Payment::STATUS_PENDING, Payment::STATUS_PARTIALLY_REFUNDED, Payment::STATUS_REFUNDED])
                    ->selectRaw('SUM(payments.amount - payments.applied) as amount')->first()->amount ?? 0;

            $this->client = Client::withTrashed()->where('id', $this->client->id)->lockForUpdate()->first();
            $this->client->payment_balance = $amount;
            $this->client->saveQuietly();
        }, 2);

        return $this;
    }
```

*Completeness check: 6 code blocks enumerated covering validation, payment repository, client service, and payment model.*

---

### 3. Live Application Verification

`[APP route: http://localhost:8090 / Container: craterninja-app-1]`

Conducted on Client "Acme Technologies Pvt Ltd":
1. **Initial Client State:**
   - `clients.balance`: `2000.000000`
   - `clients.paid_to_date`: `60000.000000`
   - `clients.payment_balance`: `0.000000`
2. **Invoice Creation:**
   - Created Invoice `#0016` with balance: `1000.000000`.
   - Updated client balance: `3000.000000`.
3. **Attempted Direct Invoice Overpayment (Validation Check):**
   - Attempted to submit payment with invoice allocation = `1200.00` on invoice balance `1000.00`.
   - **Result:** Request was rejected with validation error:
     `[ERROR] The amount is greater than the invoice balance. You cannot overpay an invoice.`
4. **Valid Overpayment Execution:**
   - Submitted payment with:
     - Total `amount`: `1500.00`
     - Invoice allocation: `1000.00` (settling Invoice `#0016` in full)
     - Unallocated excess: `500.00`
5. **Observed Database & Application State:**
   - **`payments` table:**
     - `payments.amount`: `1500.000000`
     - `payments.applied`: `1000.000000`
     - `payments.status_id`: `4` (`STATUS_COMPLETED`)
     - UI Badge: **`Partially Unapplied`** (`<span class="badge badge-info">`)
   - **`clients` table:**
     - `clients.balance`: `2000.000000` (reduced by invoice balance of ₹1,000)
     - `clients.paid_to_date`: `61500.000000` (increased by full ₹1,500)
     - `clients.payment_balance`: **`500.000000`** (holds the unallocated ₹500 balance)
   - **`invoices` table:**
     - `invoices.balance`: `0.000000`
     - `invoices.status_id`: `4` (`STATUS_PAID`)
   - **`credits` table:**
     - No rows created.

---

## Conflict 3: Which File Extensions Does Import Accept?

### 1. Finding & Resolution

- **Question:** Does data import accept `csv, txt, zip` or `csv, json`? Is `.xlsx` accepted anywhere?
- **Finding:**
  - Standard entity import accepts **only `csv`, `txt`, and `zip`**.
  - JSON backup restore accepts **only `zip`** (a zip archive containing JSON files).
  - Raw `.json` files are **not** accepted directly in file upload without being inside a `.zip` archive.
  - **`.xlsx` is NOT accepted anywhere for data imports.** Uploading an `.xlsx` file triggers Laravel's `mimes:csv,txt,zip` validation failure.
- **Where `.xlsx` appears in the codebase:**
  1. **Document Attachments:** Permitted as a static attachment on invoices, expenses, and clients (`Request.php:L38`: `'mimes:pdf,jpeg,png,xlsx,xls,...'`).
  2. **Report Exports:** Used by `RawRowsXlsxWriter.php` and `CsvToXlsxConverter.php` when downloading reports.

---

### 2. Code Evidence

#### Standard Import Validation
`[CODE app/Http/Requests/Import/ImportRequest.php:L35-46]`
```php
    public function rules()
    {
        return [
            'import_type' => 'required',
            'files' => 'required_without:hash|array|min:1|max:6',
            'hash' => 'nullable|string',
            'column_map' => 'required_with:hash|array',
            'skip_header' => 'required_with:hash|boolean',
            'files.*' => 'file|mimes:csv,txt,zip',
            'bank_integration_id' => 'bail|required_with:column_map.bank_transaction|min:2',
        ];
    }
```

#### Pre-Import Inspection Validation
`[CODE app/Http/Requests/Import/PreImportRequest.php:L32-38]`
```php
    public function rules()
    {
        return [
            'files.*' => 'file|mimetypes:text/csv,text/plain,application/octet-stream|max:20000',
            'files' => 'required|array|min:1|max:6',
            'import_type' => 'required',
        ];
    }
```

#### JSON Import Validation
`[CODE app/Http/Requests/Import/ImportJsonRequest.php:L40-44]`
```php
    public function rules()
    {
        return [
            'files' => ['required', 'file', 'mimes:zip'],
        ];
    }
```

*Completeness check: 3 import request validation classes enumerated from `app/Http/Requests/Import/`.*

---

## Conflict 4: Session Expiry Mid-Edit & Password Timeout

### 1. Finding & Resolution

- **Question:** Does a password modal preserve unsaved form state when a session expires mid-edit, or is that inaccurate?
- **Finding:**
  1. **Invoice Ninja v5 Frontend Architecture:**
     - The default primary web frontend is a **Flutter Web SPA** (`public/main.dart.js`, loaded via `resources/views/index/index.blade.php`).
     - A full alternative **React SPA** is also compiled in `public/bundle.DOX7ZxZy.js` (loaded via `resources/views/react/index.blade.php`).
     - Blade templates are used only for public/client-facing flows: payment portal, login, password reset, and initial setup.
  2. **API Communication:**
     - The SPA communicates via a stateless REST API with token authentication (`X-API-TOKEN` / `TokenAuth` middleware). There are no PHP session cookies used for API data requests.
  3. **Password Timeout & The Password Modal:**
     - Governed by `companies.default_password_timeout` (default: 1,800,000 ms = 30 minutes).
     - When the password authentication cache expires, backend routes guarded by `PasswordProtection` middleware return **HTTP `412 Precondition Failed`** (`{"message": "Invalid Password"}`).
     - The Flutter and React client-side API layers intercept HTTP 412 and render a **Password Confirmation modal** on top of the current screen.
     - The user types their password into the modal to renew the cache key.
     - Once confirmed, the pending API request completes. **The user does not navigate away, and typed form state is completely preserved.**
  4. **Web Session Inactivity Timeout (`companies.session_timeout` / `companies.web_session_timeout`):**
     - Governs client-side inactivity. If the browser is left idle past this threshold, the SPA client logs out and redirects to `/login`.
  5. **Blade Form CSRF Expiry (`TokenMismatchException`):**
     - For server-rendered Blade routes (e.g. portal login or settings), expired CSRF tokens redirect back with `withInput()`, preserving all typed fields in session flash data except password and token.

---

### 2. Code Evidence

#### The Password Protection Middleware (HTTP 412)
`[CODE app/Http/Middleware/PasswordProtection.php:L43-64]`
```php
        $hashed_id = (string) auth()->user()->hashed_id;
        $account_id = (string) auth()->user()->account_id;

        $key = "{$hashed_id}_{$account_id}_logged_in";

        if (Cache::has($key)) {
            return $next($request);
        }

        if (auth()->user()->password === '') {
            return $next($request);
        }

        if ($request->hasHeader('X-Password')) {
            if (Hash::check($request->header('X-Password'), auth()->user()->password)) {
                $timeout = (int) (auth()->user()->company()->default_password_timeout / 1000);
                Cache::put($key, true, now()->addSeconds($timeout));

                return $next($request);
            }
        }

        return response()->json(['message' => 'Invalid Password'], 412);
```

#### TokenMismatchException Input Preservation on Blade Web Routes
`[CODE app/Exceptions/Handler.php:L233-239]`
```php
        } elseif ($exception instanceof TokenMismatchException) {
            return redirect()
                    ->back()
                    ->withInput($request->except('password', 'password_confirmation', '_token'))
                    ->with([
                        'message' => ctrans('texts.token_expired'),
                        'message-type' => 'danger', ]);
        }
```

#### Company Timeout Settings Definitions
`[CODE lang/en/texts.php:L3936, L3990, L5982, L5983]`
- `web_session_timeout`: "Web Session Timeout"
- `web_session_timeout_help`: "The length of time a browser session will remain active before being logged out."
- `password_timeout`: "Password Timeout"
- `password_timeout_help`: "The length of time before an admin password needs to be re-entered."

*Completeness check: 3 code files and language dictionary definitions verified for session and password timeout mechanisms.*

---

## Final Verification Summary

### 1. Verified by Code
- `app/Jobs/Inventory/AdjustProductInventory.php:L91-118` — Decrements `products.in_stock_quantity`.
- `app/Services/Invoice/InvoiceService.php:L685-692` — `adjustInventory()` service method.
- `app/Http/Controllers/InvoiceController.php:L240-248` — `store()` calls `adjustInventory()` on draft save.
- `app/Http/Controllers/InvoiceController.php:L434-437` — `update()` inventory reversal and re-application.
- `app/Services/Quote/ConvertQuote.php:L71` — Quote conversion inventory decrement.
- `app/Jobs/RecurringInvoice/SendRecurring.php:L85` — Recurring invoice inventory decrement.
- `app/Services/Invoice/MarkInvoiceDeleted.php:L48` — Invoice deletion inventory restoration.
- `app/Services/Invoice/HandleRestore.php:L73` — Invoice restoration inventory re-decrement.
- `app/Services/PurchaseOrder/PurchaseOrderInventory.php:L45` — Purchase order receipt inventory increment.
- `app/Http/Requests/Payment/StorePaymentRequest.php:L99-101` — Hard rejection of direct invoice overpayment.
- `app/Http/ValidationRules/PaymentAmountsBalanceRule.php:L60-63` — Allowance of total payment exceeding invoice sum.
- `app/Repositories/PaymentRepository.php:L218` — `updatePaidToDate()` with full payment amount.
- `app/Repositories/PaymentRepository.php:L347-349` — `applied` amount calculation.
- `app/Services/Client/ClientService.php:L137-152` — `updatePaymentBalance()` writing `clients.payment_balance`.
- `app/Models/Payment.php:L341-345` — Presentation badges for Unapplied and Partially Unapplied.
- `app/Http/Requests/Import/ImportRequest.php:L35-46` — Validation rule `files.* => file|mimes:csv,txt,zip`.
- `app/Http/Requests/Import/PreImportRequest.php:L32-38` — Mimetype validation for pre-import.
- `app/Http/Requests/Import/ImportJsonRequest.php:L40-44` — JSON backup import validation `mimes:zip`.
- `app/Http/Requests/Request.php:L38` — File attachment validation allowing `.xlsx`.
- `app/Http/Middleware/PasswordProtection.php:L43-64` — HTTP 412 password timeout response.
- `app/Exceptions/Handler.php:L233-239` — `TokenMismatchException` redirect with `withInput()`.

### 2. Verified in the Running App
- `http://localhost:8090` (Docker container: `craterninja-app-1`):
  - **Stock decrement test:** Tracked product `TEST-STOCK-01` stock decremented from `50` to `48` immediately upon draft invoice save; remained `48` upon marking Sent; restored to `50` upon deleting invoice.
  - **Overpayment test:** Attempted invoice allocation of ₹1,200 on balance of ₹1,000 rejected by validator; payment of ₹1,500 applied ₹1,000 to invoice and stored ₹500 in `clients.payment_balance`; `clients.paid_to_date` increased by full ₹1,500; payment badge displayed `Partially Unapplied`.

### 3. Could Not Verify
- **Client Portal Task Invoicing under Verifactu Mode:** Unverified as Verifactu is a Spanish tax-compliance feature disabled in this Indian Rupee test instance.

