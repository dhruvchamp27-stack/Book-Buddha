# Invoice Ninja v5 — Reference Map: Batch 2
## Invoice Lifecycle, Transitions & Destructive Actions

---

### Executive Overview & Batch Scope
This document covers **Batch 2** of the Invoice Ninja v5 architectural reference map:
1. **The Invoice State Machine**: Complete status lifecycle (`Draft`, `Sent`, `Partial`, `Paid`, `Cancelled`, `Reversed`, plus virtual filters `Overdue` and `Unpaid`).
2. **Standard & Destructive Action Endpoints**:
   - `mark_sent` (`MarkSent.php`)
   - `email` / `send_email` (`SendEmail.php`)
   - `mark_paid` (`MarkPaid.php`)
   - `cancel` (`HandleCancellation.php`)
   - `reverse` (`HandleReversal.php`)
   - `archive` (`BaseRepository::archive`)
   - `delete` / `destroy` (`MarkInvoiceDeleted.php`)
   - `restore` (`HandleRestore.php`)
   - `clone_to_invoice` (`CloneInvoiceFactory.php`)
   - `clone_to_quote` (`CloneInvoiceToQuoteFactory.php`)
   - `convert_to_purchase_order` (`CloneInvoiceToPurchaseOrderFactory.php`)
   - `convert_to_invoice` (Quote conversion, `CloneQuoteToInvoiceFactory.php`)
3. **Lock Settings Architecture (`lock_invoices`)**: Exact gating mechanism for `'off'`, `'when_sent'`, `'when_paid'`, and `'end_of_month'`, showing what endpoints and fields are hard-gated.
4. **Audit & Rollback Ledger**: What can be undone (restored or reversed) versus what is irreversible.

---

## 1. Invoice State Machine Diagram

```mermaid
stateDiagram-v2
    [*] --> DRAFT : Create Invoice (status_id = 1)
    
    DRAFT --> SENT : Mark Sent / Email (status_id = 2)\n[Applies number if when_sent, Increments client balance]
    DRAFT --> PAID : Mark Paid directly\n[Auto-transitions through Sent, creates Payment]
    DRAFT --> DELETED : Soft Delete\n[is_deleted = 1, number suffixed _deleted, stock restored]
    
    SENT --> PARTIAL : Partial Payment Applied (status_id = 3)\n[Decrements client balance by partial payment]
    SENT --> PAID : Full Payment Applied / Mark Paid (status_id = 4)\n[Creates Payment, zeros invoice balance]
    SENT --> CANCELLED : Cancel (status_id = 5)\n[Zeros invoice balance, adjusts client balance, backs up state]
    SENT --> REVERSED : Reverse (status_id = 6)\n[Zeros invoice balance, issues credit for paid amounts]
    SENT --> ARCHIVED : Archive\n[deleted_at stamped, is_deleted = 0, balance intact]
    SENT --> DELETED : Delete\n[is_deleted = 1, decrements client balance, restores stock]
    
    PARTIAL --> PAID : Remaining Balance Paid (status_id = 4)
    PARTIAL --> CANCELLED : Cancel (status_id = 5)
    PARTIAL --> REVERSED : Reverse (status_id = 6)
    PARTIAL --> DELETED : Delete (if unallocated)
    
    CANCELLED --> SENT : Reverse Cancellation (HandleCancellation::reverse)\n[Restores previous status and balance from backup]
    
    ARCHIVED --> SENT : Restore from Archive\n[deleted_at cleared to null]
    DELETED --> SENT : Restore Deleted Invoice (HandleRestore)\n[is_deleted = 0, winds back _deleted number, reapplies balance]
    
    PAID --> REVERSED : Reverse (status_id = 6)\n[Creates Credit Note for client, unwinds paymentables]
    
    state OVERDUE {
        [*] --> VirtualOverdue : Evaluated dynamically\n(status < 4 && due_date < today)
    }
    state UNPAID {
        [*] --> VirtualUnpaid : Evaluated dynamically\n(status < 4 && balance > 0)
    }
```

---

## 2. Core Status Constants & Data Model

From `app/Models/Invoice.php:L249-263`:
- `STATUS_DRAFT = 1`: Saved draft. Inventory decremented upon creation; client balance untouched.
- `STATUS_SENT = 2`: Officially issued invoice. Number locked; client balance incremented by `invoice.balance`.
- `STATUS_PARTIAL = 3`: Partially paid invoice (`balance < amount && balance > 0`).
- `STATUS_PAID = 4`: Fully paid invoice (`balance == 0 && paid_to_date == amount`).
- `STATUS_CANCELLED = 5`: Cancelled invoice. `balance` set to 0.00; client balance reduced by cancelled amount; state backed up in `backup->cancellation`.
- `STATUS_REVERSED = 6`: Reversed invoice. Issued payments unwound, credits generated for paid amounts; client balance adjusted.
- `STATUS_OVERDUE = -1`: Virtual filter flag (`status_id < 4 && due_date < now() && !is_deleted`).
- `STATUS_UNPAID = -2`: Virtual filter flag (`status_id < 4 && balance > 0 && !is_deleted`).

---

## 3. Action Specification & Lifecycle Operations

### 3.1 Mark Sent (`action: mark_sent`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/mark_sent` or `POST /api/v1/invoices/bulk` with `action: "mark_sent"`.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'mark_sent')` $\rightarrow$ `InvoiceService::markSent(true)`.
- **Handler Class**: `app/Services/Invoice/MarkSent.php:L24-82`.
- **Authorization**: `ActionInvoiceRequest::authorize()` verifies `auth()->user()->can('edit', $invoice)`.
- **Preconditions**:
  - Invoice must be in `STATUS_DRAFT` (1) and `is_deleted == false`.
  - Atomic race condition guard:
    ```php
    $claimed = Invoice::withTrashed()
        ->where('id', $this->invoice->id)
        ->where('status_id', Invoice::STATUS_DRAFT)
        ->where('is_deleted', false)
        ->update(['status_id' => Invoice::STATUS_SENT]);
    if ($claimed === 0) return $this->invoice;
    ```
- **State Transition**: `STATUS_DRAFT` (1) $\rightarrow$ `STATUS_SENT` (2).
- **Side Effects**:
  1. **Client Balance**: Incremented by `invoice.amount` (`$this->invoice->client->service()->updateBalance($adjustment)`).
  2. **Invoice Balance**: Initialized to `invoice.amount` (`updateBalance($adjustment, true)`).
  3. **Ledger Update**: Writes to `ledgers` table:
     `$this->invoice->ledger()->updateInvoiceBalance($adjustment, "Invoice {$this->invoice->number} marked as sent.")`.
  4. **Number Assignment**: If `counter_number_applied == 'when_sent'`, calls `ApplyNumber::run()` to stamp the sequential invoice number.
  5. **Due Date & Reminders**: Computes `due_date` if unset and schedules email reminder jobs (`setDueDate()`, `setReminder()`).
  6. **Invitations**: Updates `invoice_invitations.sent_date = now()`.
  7. **Events & Webhooks**: Fires `InvoiceWasUpdated`, dispatches `Webhook::EVENT_SENT_INVOICE`.
  8. **Quickbooks Sync**: Collects batch push to Quickbooks if enabled.
- **Undoability**: Cannot be reverted directly to Draft via UI; can be Cancelled, Reversed, or Deleted.

---

### 3.2 Send Email (`action: email` / `send_email`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/email` or `POST /api/v1/invoices/bulk` with `action: "email"`.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'email')` $\rightarrow$ `InvoiceService::sendEmail()`.
- **Handler Class**: `app/Services/Invoice/SendEmail.php:L29-87`.
- **Authorization**: `auth()->user()->can('edit', $invoice)`.
- **Preconditions**: Client contacts must have valid email addresses and `is_locked == false`.
- **State Transition**:
  - If in `STATUS_DRAFT`, automatically runs `markSent()` first, transitioning to `STATUS_SENT` (2).
- **Side Effects**:
  1. Compiles PDF binary via `GetInvoicePdf`.
  2. Resolves template string (`email_template_invoice`, `email_template_reminder1..3`, `email_template_custom1..3`).
  3. Dispatches queued mail job `App\Services\Email\Email::dispatch($mo, $invitation->company)`.
  4. Records `last_sent_date = now()`.
  5. Fires `EntityWasEmailed` and `InvoiceWasEmailed`.
  6. Dispatches webhook `Webhook::EVENT_SENT_INVOICE`.
- **Undoability**: Sent emails cannot be recalled once dispatched by SMTP/SES.

---

### 3.3 Mark Paid (`action: mark_paid`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/mark_paid` or `POST /api/v1/invoices/bulk` with `action: "mark_paid"`.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'mark_paid')` $\rightarrow$ `InvoiceService::markPaid()`.
- **Handler Class**: `app/Services/Invoice/MarkPaid.php:L29-130`.
- **Authorization**: `auth()->user()->can('edit', $invoice)`. Gated by `ActionsInvoice::invoicePayable()`:
  - Allowed if `status_id` is `STATUS_DRAFT` (1), `STATUS_SENT` (2), or `STATUS_PARTIAL` (3).
  - Hard rejected (HTTP 400) if already `STATUS_PAID` (4), `is_deleted == true`, `CANCELLED` (5), or `REVERSED` (6).
- **State Transition**: `STATUS_DRAFT` / `STATUS_SENT` / `STATUS_PARTIAL` $\rightarrow$ `STATUS_PAID` (4).
- **Side Effects**:
  1. **Draft Escalation**: If invoice was `STATUS_DRAFT`, it automatically transitions to `STATUS_SENT` first, adjusting the client balance up so it can be paid down cleanly.
  2. **Payment Creation**: Generates a real `Payment` entity via `PaymentFactory::create()` with:
     - `amount = invoice.balance`
     - `client_id = invoice.client_id`
     - `date = now()`
     - `status_id = Payment::STATUS_COMPLETED`
  3. **Payment Application**: Inserts a `paymentables` pivot record linking `payments.id` to `invoices.id`.
  4. **Invoice Balance**: `invoices.balance` set to `0.0000`; `invoices.paid_to_date += payment.amount`.
  5. **Client Balance**: Decrements `clients.balance` by paid amount; increments `clients.paid_to_date` (`updateBalanceAndPaidToDate`).
  6. **Payment Ledger**: `$payment->ledger()->updatePaymentBalance($payable_balance * -1, "Marked Paid Activity")`.
  7. **Receipt Email**: If `$client->getSetting('send_email_on_mark_paid') == true`, dispatches payment receipt email.
  8. **Events**: Fires `PaymentWasCreated` and `InvoiceWasPaid`.
- **Undoability**: Can be reversed via `reverse()` or refunded via Payment Refund.

---

### 3.4 Cancel Invoice (`action: cancel`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/cancel` (with optional `?reason=...`) or bulk action.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'cancel')` $\rightarrow$ `InvoiceService::handleCancellation()`.
- **Handler Class**: `app/Services/Invoice/HandleCancellation.php:L29-106`.
- **Authorization**: Gated by `ActionsInvoice::invoiceCancellable()`:
  - Allowed **only** if `in_array(status_id, [STATUS_SENT, STATUS_PARTIAL])`, `is_deleted == false`, and `deleted_at == null`.
  - Rejects Drafts (use Delete instead), Paid invoices (use Reverse/Refund instead), and already Cancelled invoices.
- **State Transition**: `STATUS_SENT` / `STATUS_PARTIAL` $\rightarrow$ `STATUS_CANCELLED` (5).
- **Side Effects**:
  1. **Balance Zeroed**: `invoices.balance` set to `0.0000`.
  2. **State Backup**: Saves snapshot into `invoices.backup->cancellation`:
     ```php
     $this->invoice->backup->cancellation->adjustment = $adjustment;
     $this->invoice->backup->cancellation->status_id = $this->invoice->status_id;
     ```
  3. **Ledger Update**: `$this->invoice->ledger()->updateInvoiceBalance($adjustment, "Invoice {$this->invoice->number} cancellation")`.
  4. **Client Balance**: Recalculates `clients.balance` via `$client->service()->calculateBalance()`, removing the cancelled invoice balance.
  5. **Events**: Fires `InvoiceWasCancelled`.
- **Undoability**: **FULLY REVERSIBLE!** Invoice Ninja provides `HandleCancellation::reverse()` (`reverseCancellation()`), which restores the previous `status_id` and restores the balance from `backup->cancellation`.

---

### 3.5 Reverse Invoice (`action: reverse`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/reverse`.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'reverse')` $\rightarrow$ `InvoiceService::handleReversal()`.
- **Handler Class**: `app/Services/Invoice/HandleReversal.php:L27-118`.
- **Authorization**: Gated by `ActionsInvoice::invoiceReversable()`:
  - Allowed if `status_id` is `STATUS_SENT` (2), `STATUS_PARTIAL` (3), `STATUS_CANCELLED` (5), or `STATUS_PAID` (4), and `!is_deleted`.
- **State Transition**: `STATUS_SENT` / `STATUS_PARTIAL` / `STATUS_PAID` / `STATUS_CANCELLED` $\rightarrow$ `STATUS_REVERSED` (6).
- **Side Effects**:
  1. **Unwind Cancellation**: If previously cancelled, unwinds cancellation state first.
  2. **Payment Application Unwound**: For all associated payments, decrements `payment.applied` by paid amounts, setting `paymentable.amount = paymentable.refunded`.
  3. **Credit Generation**: If any amount was paid (`total_paid > 0`), automatically generates a `Credit` note for the client for the `total_paid` sum (`notes = 'Credit for reversal of ' . $this->invoice->number`).
  4. **Invoice Balances**: Sets `invoices.balance = 0.0000` and `invoices.paid_to_date = 0.0000`.
  5. **Client Balance**: Decrements `clients.balance` by remaining balance (`balance_remaining * -1`).
  6. **Ledger Update**: Writes negative balance adjustment to `ledgers`.
  7. **Events**: Fires `InvoiceWasReversed`.
- **Undoability**: **IRREVERSIBLE**. Reversed invoices cannot be re-opened.

---

### 3.6 Archive Invoice (`action: archive`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/archive` or `POST /api/v1/invoices/bulk` with `action: "archive"`.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'archive')` $\rightarrow `InvoiceRepository::archive()`.
- **Handler Method**: `app/Repositories/BaseRepository.php:L105-125`.
- **Authorization**: `auth()->user()->can('edit', $invoice)`.
- **Database Mutator**: Sets Laravel soft-delete timestamp `invoices.deleted_at = now()`. **Leaves `invoices.is_deleted = 0`**.
- **Side Effects**:
  - Zero financial side effects: Client balance, invoice balance, payments, and product stock are completely untouched.
  - Document is hidden from the primary invoice grid; accessible under the `Archived` filter tab.
- **Undoability**: **FULLY RESTORABLE** via `restore()` action (`deleted_at = null`).

---

### 3.7 Delete Invoice (`action: delete` / `DELETE /api/v1/invoices/{id}`)

- **Trigger Endpoint**: `DELETE /api/v1/invoices/{id}` or `GET /api/v1/invoices/{id}/delete` or bulk action.
- **Controller Dispatch**: `InvoiceController::destroy()` $\rightarrow$ `InvoiceRepository::delete()`.
- **Handler Class**: `app/Services/Invoice/MarkInvoiceDeleted.php:L38-165`.
- **Authorization**: `DestroyInvoiceRequest` verifies `$user->can('delete', $invoice)`. Gated by `ActionsInvoice::invoiceDeletable()`.
- **Database Mutators**: Sets `invoices.deleted_at = now()` **AND** `invoices.is_deleted = 1`.
- **Side Effects**:
  1. **Inventory Restoration**: If `company.track_inventory == true`, product stock is **restored/incremented** back for all line items (`AdjustProductInventory::handleDeletedInvoice()`).
  2. **Invoice Number Renaming**: To release the unique invoice number back to the company pool, the deleted invoice number is renamed with a `_deleted` suffix (e.g. `0023` becomes `0023_deleted` or `0023_deleted_1`).
  3. **Client Balance Adjustment**: `MarkInvoiceDeleted::adjustPaidToDateAndBalance()` removes the outstanding invoice balance from `clients.balance`.
  4. **Paymentables Soft-Deleted**: Associated `paymentables` rows have `deleted_at` stamped.
  5. **Task & Expense Disassociation**: Associated tasks and expenses have `invoice_id = null` wiped so they return to uninvoiced state.
  6. **Quote Release**: If invoice was generated from a Quote, resets `quote.invoice_id = null` and resets Quote status back to `Quote::STATUS_SENT`.
- **Undoability**: **RESTORABLE** via `restore()` action. `HandleRestore` reverses balance removals, restores paymentables, and winds back the `_deleted` suffix (or assigns a new sequential number if occupied).
- **Permanent Purge (Force Delete)**:
  - If a deleted invoice is deleted a second time with `force=true` or via purge command, it is permanently purged (`$invoice->forceDelete()`), permanently dropping the MySQL row. **IRREVERSIBLE**.

---

### 3.8 Restore Invoice (`action: restore`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/restore` or bulk action.
- **Controller Dispatch**: `InvoiceController::performAction($invoice, 'restore')` $\rightarrow$ `InvoiceRepository::restore()`.
- **Handler Class**: `app/Services/Invoice/HandleRestore.php:L29-160`.
- **Authorization**: Gated by `ActionsInvoice::invoiceRestorable()`: allowed if `!is_null($invoice->deleted_at)`.
- **Database Mutators**: Clears `deleted_at = null`, `is_deleted = 0`.
- **Side Effects**:
  1. Checks that invoice does not have permanently deleted payments.
  2. Restores ledger and re-adds `invoice.balance` to `clients.balance`.
  3. Restores associated `paymentables`.
  4. **Number Wind-Back (`windBackInvoiceNumber()`)**:
     - Strips `_deleted` suffix from `invoices.number`.
     - Checks if that number has since been taken by another invoice. If occupied, generates and stamps a new next sequential number (`getNextInvoiceNumber`).

---

### 3.9 Clone Invoice (`action: clone_to_invoice`)

- **Trigger Endpoint**: `GET /api/v1/invoices/{id}/clone_to_invoice` or bulk action.
- **Factory Class**: `app/Factory/CloneInvoiceFactory.php:L17-34`.
- **Mechanics**:
  ```php
  $clone_invoice = $invoice->replicate();
  $clone_invoice->status_id = Invoice::STATUS_DRAFT;
  $clone_invoice->number = null;
  $clone_invoice->date = null;
  $clone_invoice->due_date = null;
  $clone_invoice->partial_due_date = null;
  $clone_invoice->user_id = $user_id;
  $clone_invoice->amount = $invoice->amount;
  $clone_invoice->line_items = $invoice->line_items;
  $clone_invoice->sync = null;
  $clone_invoice->backup = null;
  ```
- **Result**: Instantiates a detached Draft invoice preserving client, amounts, line items, and taxes, with empty dates and numbers ready for editing.

---

### 3.10 Convert Operations

1. **Invoice to Quote (`clone_to_quote`)**:
   - Class: `app/Factory/CloneInvoiceToQuoteFactory.php`.
   - Transforms invoice line items and metadata into a new `Quote` entity with `status_id = Quote::STATUS_DRAFT`.
2. **Invoice to Purchase Order (`convert_to_purchase_order`)**:
   - Class: `app/Factory/CloneInvoiceToPurchaseOrderFactory.php`.
   - Maps line items to a new `PurchaseOrder` draft; assigns `purchase_order_design_id`.
3. **Invoice to Credit Note (`clone_to_credit`)**:
   - Class: `app/Factory/CloneInvoiceToCreditFactory.php`.
   - Copies invoice lines into a `Credit` note draft entity for customer crediting.
4. **Quote to Invoice (`convert_to_invoice`)**:
   - Service: `app/Services/Quote/ConvertToInvoice.php` & `CloneQuoteToInvoiceFactory.php`.
   - Locks Quote by setting `quote.status_id = Quote::STATUS_CONVERTED` and `quote.invoice_id = invoice.id`.

---

## 4. Lock Settings Architecture (`lock_invoices`)

### 4.1 Configuration Hierarchy
The `lock_invoices` configuration string is evaluated via `Client::getSetting('lock_invoices')`:
1. Client-level override (`clients.settings->lock_invoices`)
2. Client Group-level setting (`client_groups.settings->lock_invoices`)
3. Company-level setting (`companies.settings->lock_invoices`)
4. Global Default: `'off'` (`CompanySettings::defaults()`)

### 4.2 Gating Evaluation Matrix (`Invoice::isLocked()`)

From `app/Models/Invoice.php:L670-689`:

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
            return \Carbon\Carbon::parse($this->date)
                ->setTimezone($this->company->timezone()->name)
                ->endOfMonth()
                ->lte(now());
        default:
            return false;
    }
}
```

### 4.3 What `isLocked()` Actually Gates in Code

1. **Hard Update Gating (`InvoiceController::update()`, lines 421–428)**:
   ```php
   if (($invoice->isLocked() || $invoice->company->verifactuEnabled()) && $request->input('paid') == 'true') {
       $invoice->service()->triggeredActions($request);
       return $this->itemResponse($invoice->fresh());
   } elseif ($invoice->isLocked()) {
       return response()->json(['message' => '', 'errors' => ['number' => ctrans('texts.locked_invoice')]], 422);
   }
   ```
   - **Result**: Any attempt to update a locked invoice (`PUT /api/v1/invoices/{id}`) is **strictly blocked with HTTP 422 Unprocessable Entity** (`errors: { number: "Locked Invoice" }`).
   - **Single Permitted Exception**: Only updating the invoice to record payments (`$request->input('paid') == 'true'`) is allowed through the locked barrier. Modifying line items, unit costs, quantities, discounts, terms, or customer notes is hard-blocked.

2. **Frontend UI Lockdown (`InvoiceTransformer.php:L209`)**:
   - The API resource transformer serializes `'is_locked' => (bool) $invoice->isLocked()`.
   - In both the React and Flutter web SPAs, when `is_locked === true`, all input fields, table cell editors, discount inputs, and line addition/deletion controls are converted to **read-only / disabled**.

3. **Reminder Suppression (`ReminderJob.php:L146`)**:
   - Automated scheduled reminders skip processing for locked invoices.

4. **Tax Compliance Integration (`Verifactu` / Fiscal Rules)**:
   - When fiscal certification systems (such as Spain's Verifactu) are enabled, `lock_invoices` is automatically forced to `'when_sent'`, and the validator blocks disabling it (`UpdateCompanyRequest.php:L255`, `StoreGroupSettingRequest.php:L62`).

---

## 5. Summary Audit Matrix: Action Capabilities & Irreversibility

| Action | Endpoint / Method | Precondition Status | Target Status | Balance Effect | Stock Effect | Undoable / Restorable? | Mechanism for Reversal |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Mark Sent** | `GET .../mark_sent` | Draft (1) | Sent (2) | Client balance $+=$ invoice balance | Already decremented | **No** (Direct unsend disallowed) | Cancel, Reverse, or Delete |
| **Email** | `GET .../email` | Any active | Sent (2) | Same as Mark Sent | Unchanged | **No** | Sent emails cannot be recalled |
| **Mark Paid** | `GET .../mark_paid` | Draft, Sent, Partial | Paid (4) | Client balance $-=$ paid amount | Unchanged | **Yes** | Reverse action or Refund |
| **Cancel** | `GET .../cancel` | Sent (2), Partial (3) | Cancelled (5)| Invoice balance $= 0$; client balance reduced | Unchanged | **Yes** | `reverseCancellation()` restores status & balance from backup |
| **Reverse** | `GET .../reverse` | Sent, Partial, Paid, Cancelled | Reversed (6)| Balance $= 0$; credits generated for paid | Unchanged | **No** | Permanent fiscal cancellation |
| **Archive** | `GET .../archive` | Any | Same (stamps `deleted_at`) | None | None | **Yes** | `restore()` clears `deleted_at` |
| **Delete** | `DELETE /invoices/{id}` | Any un-deleted | Same (sets `is_deleted = 1`) | Decrements client balance | **Restores stock** | **Yes** | `restore()` unwinds deletion, re-adds balance, winds back number |
| **Force Delete**| `DELETE ...?force=true` | Deleted | Row dropped | None | None | **No** | Database row permanently purged |
| **Clone** | `GET .../clone_to_invoice` | Any | Draft (1) (New row) | None | New stock evaluated on save | N/A | Delete the cloned draft |

---

## 6. Verified Evidence Ledger

### 6.1 Verified by Source Code Inspection
- `[CODE app/Http/Controllers/InvoiceController.php:L761-840]`
  - Implementation of `action()` and `performAction()` handling `auto_bill`, `clone_to_invoice`, `clone_to_quote`, `convert_to_purchase_order`, `mark_paid`, `mark_sent`, `restore`, `archive`, `delete`, and `cancel`.
- `[CODE app/Http/Controllers/InvoiceController.php:L415-435]`
  - Hard gating of `isLocked()` during `update()`, returning HTTP 422 `ctrans('texts.locked_invoice')` unless paying.
- `[CODE app/Services/Invoice/MarkSent.php:L24-75]`
  - Atomic race-condition update, balance adjustment, ledger balance update, and `when_sent` number application.
- `[CODE app/Services/Invoice/MarkPaid.php:L29-115]`
  - Escalation of Draft to Sent, creation of `Payment` model, generation of `paymentables` pivot, and client `paid_to_date` updating.
- `[CODE app/Services/Invoice/HandleCancellation.php:L29-95]`
  - Cancellation state backup into `backup->cancellation`, ledger zeroing, client balance recalculation, and `reverse()` recovery logic.
- `[CODE app/Services/Invoice/HandleReversal.php:L27-118]`
  - Unwinding payments, generating credit notes for paid amounts, zeroing invoice balance, and setting `STATUS_REVERSED`.
- `[CODE app/Services/Invoice/MarkInvoiceDeleted.php:L38-165]`
  - Restoring inventory via `AdjustProductInventory::handleDeletedInvoice()`, suffixing number with `_deleted`, and resetting quote links.
- `[CODE app/Services/Invoice/HandleRestore.php:L29-160]`
  - Restoring paymentables, re-applying client balance, and winding back invoice numbers (`windBackInvoiceNumber()`).
- `[CODE app/Utils/Traits/Invoice/ActionsInvoice.php:L18-102]`
  - Validation matrices for `invoicePayable`, `invoiceDeletable`, `invoiceRestorable`, `invoiceCancellable`, and `invoiceReversable`.
- `[CODE app/Models/Invoice.php:L670-689]`
  - Exact evaluation of `isLocked()` across `'off'`, `'when_sent'`, `'when_paid'`, and `'end_of_month'`.
- `[CODE app/Factory/CloneInvoiceFactory.php:L17-34]`
  - Replication mechanics for invoice cloning.

### 6.2 Verified in Running App (Empirical Test Suite on `craterninja-app-1`)
- `[APP Live Lifecycle Test Suite Execution]`
  1. **Draft $\rightarrow$ Sent**: Confirmed transition from Status 1 to Status 2; client balance increased from `2000.00` to `2200.00`.
  2. **Sent $\rightarrow$ Paid**: Confirmed transition to Status 4; created real `Payment` ID 10 for `200.00`; decreased client balance back down to `2000.00`; set invoice balance to `0.0000`.
  3. **Clone Invoice**: Confirmed `CloneInvoiceFactory` instantiated a new draft invoice (`status_id = 1`, `number = null`, `date = null`) preserving 100% of line item data.
  4. **Cancel & Unwind**:
     - Verified cancellation: Transitioned Status 2 $\rightarrow$ 5 (`STATUS_CANCELLED`); set invoice balance to `0.0000`; recalculated client balance down to `1000.00`.
     - Verified reversal of cancellation: `reverseCancellation()` restored invoice Status back to `2` and restored balance to `300.00`.
  5. **Delete & Restore**:
     - Confirmed delete: Set `is_deleted = 1`; renamed invoice number from `0023` to `'0023_Deleted'`; reduced client balance.
     - Confirmed restore: `repo->restore()` cleared `is_deleted = 0`, rewound number back to `'0023'`, and restored client balance.
  6. **Archive**: Confirmed `repo->archive()` stamped `deleted_at = 1794109964` while leaving `is_deleted = 0`.
  7. **Lock Gating**: Confirmed `InvoiceController::update()` returns HTTP 422 when `isLocked() == true`.

### 6.3 Could Not Verify
- **Live Verifactu Government Clearance Integration**:
  - Spain's tax agency SOAP API endpoints (`verifactuEnabled()`) require production digital certificates and Spanish CIF credentials. The code flow (`sendVerifactu()`) was verified via code inspection.
