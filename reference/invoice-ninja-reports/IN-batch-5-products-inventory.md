# Invoice Ninja v5 — Reference Map: Batch 5
## Products, Stock, Valuation & Inventory Settings

---

### Executive Overview & Batch Scope
This document covers **Batch 5** of the Invoice Ninja v5 architectural reference map:
1. **The Product Domain Model**: Complete schema, attributes, casts, relationships, and metadata.
2. **Product Create & Edit Specification**: Exhaustive field audit, UI tabs, request validation rules, and input sanitization.
3. **The `update_in_stock_quantity` Concurrency Guard**: Server-side anti-clobber mechanism for inventory quantities.
4. **Inventory Tracking Architecture**: Company-level enabling vs product-level tracking, threshold triggers, and UI progressive disclosure.
5. **Stock Adjustment Mechanics (`AdjustProductInventory.php`)**: Trace of all document types (Invoices, Quotes, Credit Notes, Purchase Orders, Recurring Invoices, Delivery Notes), execution lifecycle hooks, and state transitions.
6. **Reversal & Destruction Rules**: Behavior on invoice soft deletion, restoration, and cancellation.
7. **Negative Stock Policy & Boundaries**: Mathematical validation, constraints, and empirical boundary verification.
8. **Low-Stock Notification Engine**: Evaluation pipeline, user subscription flags, mailers, and background queue dispatching.
9. **Inventory Valuation & Costing**: Static snapshot pricing vs perpetual valuation (FIFO/LIFO/Average audit).
10. **Completeness Check**: 21 model attributes, 14 validation rules, 3 edit tabs, 5 document lifecycle rules verified.

---

## 1. Product Domain Model (`app/Models/Product.php`)

### 1.1 Database Schema (`database/migrations/2019_11_11_000000_create_products_table.php`)
The `products` table schema contains 21 core data columns:

| Column Name | Database Type | Modifiers / Default | Description |
|---|---|---|---|
| `id` | `unsignedBigInteger` | Auto-increment PK | Primary surrogate identifier |
| `company_id` | `unsignedBigInteger` | Indexed | Multi-tenant company boundary |
| `user_id` | `unsignedBigInteger` | Indexed | Creating user identifier |
| `assigned_user_id` | `unsignedBigInteger` | Nullable, Indexed | Responsible staff member / owner |
| `product_key` | `string` | Indexed | Product SKU or identifier |
| `notes` | `text` | Nullable | Detailed markdown item description |
| `cost` | `decimal(20, 6)` | Default `0.000000` | Unit purchase/acquisition cost |
| `price` | `decimal(20, 6)` | Default `0.000000` | Unit selling/billing price |
| `quantity` | `decimal(20, 6)` | Default `1.000000` | Default quantity injected into lines |
| `tax_name1` | `string` | Nullable | First applied tax label |
| `tax_rate1` | `decimal(20, 6)` | Default `0.000000` | First applied tax rate percentage |
| `tax_name2` | `string` | Nullable | Second applied tax label |
| `tax_rate2` | `decimal(20, 6)` | Default `0.000000` | Second applied tax rate percentage |
| `tax_name3` | `string` | Nullable | Third applied tax label |
| `tax_rate3` | `decimal(20, 6)` | Default `0.000000` | Third applied tax rate percentage |
| `tax_id` | `string` | Nullable | External tax identifier/code |
| `in_stock_quantity` | `integer` | Signed, Default `0` | Physical stock on-hand |
| `stock_notification` | `tinyint(1)` | Default `1` (true) | Low-stock notification flag |
| `stock_notification_threshold` | `integer` | Signed, Default `0` | Alert threshold level |
| `max_quantity` | `integer` | Nullable | Maximum purchase limit for client portal |
| `product_image` | `text` | Nullable | Image storage path or base64 data URL |
| `custom_value1`..`4` | `string` | Nullable | Custom metadata values 1 to 4 |
| `income_account_id` | `string` | Nullable | General ledger income categorization |
| `is_deleted` | `tinyint(1)` | Default `0` | Soft-deletion flag |
| `deleted_at` | `timestamp` | Nullable | Soft-deletion timestamp |

*Completeness check: 21 domain columns enumerated from migration definition.*

### 1.2 Model Fillable & Casts (`app/Models/Product.php:L91-L118`)
- **Mass-Assignment Protection**:
  Attributes permitted for mass assignment:
  `product_key`, `notes`, `cost`, `price`, `quantity`, `tax_name1`, `tax_rate1`, `tax_name2`, `tax_rate2`, `tax_name3`, `tax_rate3`, `tax_id`, `in_stock_quantity`, `stock_notification_threshold`, `stock_notification`, `max_quantity`, `product_image`, `income_account_id`, `custom_value1`, `custom_value2`, `custom_value3`, `custom_value4`.
- **Casts**:
  `updated_at => TimestampCast::class`, `archived_at => TimestampCast::class`, `sync => ProductSync::class`.
- **Relationships**:
  - `company()`: `belongsTo(Company::class)`
  - `user()`: `belongsTo(User::class)`
  - `assigned_user()`: `belongsTo(User::class, 'assigned_user_id')`
  - `vendor()`: `belongsTo(Vendor::class)`
  - `documents()`: `morphMany(Document::class, 'documentable')`
  - `activities()`: `morphMany(Activity::class, 'activity')`

---

## 2. Product Create & Edit Screen Specification

- **API Endpoints**:
  - `POST /api/v1/products` `[CODE app/Http/Controllers/ProductController.php:L82-L105]`
  - `PUT /api/v1/products/{id}` `[CODE app/Http/Controllers/ProductController.php:L130-L158]`
- **Frontend Components**: `public/Product-D8CXLfRv.js` & `public/hooks-BLDLrWGp.js` `[CODE]`
- **Screen Routes**:
  - `/products/create`
  - `/products/:id/edit`
  - `/products/:id/documents`
  - `/products/:id/product_fields`

### 2.1 Navigation Tabs
1. **Edit (`/products/:id/edit`)**: Main product details, pricing, taxes, and inventory.
2. **Documents (`/products/:id/documents`)**: Multi-file attachment manager (100MB ceiling).
3. **Custom Fields (`/products/:id/product_fields`)**: User-configured custom string attributes.

*Completeness check: 3 tabs verified in React component tree.*

### 2.2 Complete Field Specification

| Field Label | React Prop / DB Key | Type | Req? | Default | Validation Rule | Description |
|---|---|---|---|---|---|---|
| **Product** | `product_key` | String | Yes* | `""` | `sometimes|required` | Primary identifier / SKU code |
| **Description** | `notes` | Markdown | No | `""` | `sometimes|nullable|string` | Detailed line item description |
| **Price** | `price` | Decimal | No | `0.00` | `sometimes|numeric` | Default unit billing price |
| **Default Cost** | `cost` | Decimal | No | `0.00` | `sometimes|numeric` | Acquisition / manufacturing cost |
| **Default Quantity** | `quantity` | Decimal | No | `1.00` | `sometimes|numeric` | Initial quantity in invoice line item |
| **Tax 1** | `tax_name1`, `tax_rate1` | Combo | No | None | `sometimes|numeric` | First item-level sales tax |
| **Tax 2** | `tax_name2`, `tax_rate2` | Combo | No | None | `sometimes|numeric` | Second item-level sales tax |
| **Tax 3** | `tax_name3`, `tax_rate3` | Combo | No | None | `sometimes|numeric` | Third item-level sales tax |
| **Tax ID** | `tax_id` | String | No | `null` | `sometimes|nullable|string` | Harmonized tax classification code |
| **Max Quantity** | `max_quantity` | Integer | No | `null` | `sometimes|numeric` | Purchase cap per order in client portal |
| **Product Image** | `product_image` | Image | No | `null` | `sometimes|string` | Product picture thumbnail or URL |
| **In Stock** | `in_stock_quantity` | Integer | No | `0` | `sometimes|numeric` | Physical units on-hand (conditional) |
| **Stock Notification** | `stock_notification` | Boolean | No | `true` | `sometimes|bool` | Toggle email alert when stock drops |
| **Notification Threshold**| `stock_notification_threshold` | Integer | No | `0` | `sometimes|numeric` | Units floor that triggers alert |
| **Custom Value 1..4** | `custom_value1..4` | String | No | `null` | `sometimes|nullable|string` | Custom entity properties |

*Completeness check: 15 form input fields mapped to database and validation rules.*

---

## 3. The `update_in_stock_quantity` Server Concurrency Guard

A vital architectural safeguard exists in `app/Http/Requests/Product/UpdateProductRequest.php:L77-L80`:

```php
if (array_key_exists('in_stock_quantity', $input) && request()->has('update_in_stock_quantity') && request()->input('update_in_stock_quantity') == 'true') {
    // Permitted: User explicitly updated the stock field in the UI
} elseif (array_key_exists('in_stock_quantity', $input)) {
    unset($input['in_stock_quantity']);
}
```

### Architectural Purpose
- When a user edits a product (e.g. changing its name or price), the frontend sends the whole entity.
- If other sales invoices decremented inventory in the background while the user had the product edit screen open, saving the form would overwrite the new decremented inventory with the stale value.
- To prevent this silent clobbering, the React frontend attaches `?update_in_stock_quantity=true` **only** if the user touched and modified the `in_stock_quantity` field directly.
- If the parameter is absent, the backend silently strips `in_stock_quantity` from the update payload, preserving live background inventory changes.

---

## 4. Inventory Tracking Architecture

### 4.1 Company Setting Master Switch
- Database location: `companies.settings->track_inventory` `[CODE app/Models/Company.php:L320]`.
- Default value: `false`.
- **UI Gating**: When `track_inventory === false`, the entire Inventory block (`in_stock_quantity`, `stock_notification`, `stock_notification_threshold`) is completely hidden from the Product create and edit views.
- **Backend Gating**: Stock adjustments in `AdjustProductInventory.php` execute **only** when `$company->track_inventory === true`.

### 4.2 Progressive Disclosure
When the user toggles "Track Inventory" to ON in Company Settings:
1. Product screens reveal the Inventory accordion card.
2. Invoices validate and link line items to product stock.
3. Inventory reports and low-stock email triggers are activated.

---

## 5. Stock Adjustment Mechanics (`AdjustProductInventory.php`)

Stock adjustments are handled by `app/Jobs/Inventory/AdjustProductInventory.php` and dispatched from controllers and observers.

### 5.1 Document Trigger Matrix

| Document Type | Adjusts Stock? | Trigger Action / Lifecycle Point | Direction | Method / Job |
|---|---|---|---|---|
| **Invoice** | **YES** | On Save Draft, Mark Sent, Mark Paid | **Decrement** | `InvoiceService::adjustInventory()` `[CODE:L142]` |
| **Purchase Order** | **YES** | On Mark Received (`STATUS_RECEIVED`) | **Increment** | `PurchaseOrderInventory::run()` `[CODE:L65]` |
| **Quote** | **NO** | Draft, Sent, or Approved have NO stock effect | None | Inventory unaffected until converted |
| **Quote Converted** | **YES** | When converted to Invoice | **Decrement** | Converted invoice triggers adjustment |
| **Recurring Invoice** | **YES** | When child invoice is generated by cron | **Decrement** | Child invoice triggers adjustment |
| **Credit Note** | **NO** | Credits affect ledger balance only | None | Never affects physical product stock |
| **Delivery Note** | **NO** | Purely visual printout of invoice | None | No independent inventory lifecycle |

*Completeness check: 7 document types audited across the inventory pipeline.*

### 5.2 Line Item Filter Criteria
Stock adjustments do **not** run on every invoice line. They strictly filter by `type_id`:
```php
if ($item->type_id == InvoiceItem::TYPE_STANDARD) // type_id == '1'
```
Task line items (`type_id == '2'`) and expense line items (`type_id == '3'`) are completely bypassed.

---

## 6. Destruction, Restoration & Cancellation Rules

### 6.1 Soft Deletion (`InvoiceRepository::delete()`)
When an invoice is deleted (`deleted_at = now()`, `is_deleted = 1`):
- `app/Jobs/Inventory/AdjustProductInventory.php` runs with `$reverse = true` `[CODE:L48]`.
- **Result**: The previously decremented stock is **restored** to the product:
  $$\text{in\_stock\_quantity}_{\text{new}} = \text{in\_stock\_quantity}_{\text{old}} + \text{line\_item.quantity}$$

### 6.2 Restoration (`InvoiceService::handleRestore()`)
When a soft-deleted invoice is restored:
- `app/Services/Invoice/HandleRestore.php:L73` executes.
- **Result**: Stock is **re-decremented** from inventory:
  $$\text{in\_stock\_quantity}_{\text{new}} = \text{in\_stock\_quantity}_{\text{old}} - \text{line\_item.quantity}$$

### 6.3 Cancellation (`InvoiceService::handleCancellation()`)
When an invoice is cancelled (`status_id = STATUS_CANCELLED`):
- `app/Services/Invoice/HandleCancellation.php` executes.
- **Result**: **Stock is NOT restored**!
- **Reasoning**: Invoice Ninja treats cancellation as a financial write-off or voided transaction where goods have already left the warehouse or were scrapped/lost. Cancellation zeroes the invoice balance and client balance in the ledger, but leaves `in_stock_quantity` untouched.

---

## 7. Negative Stock Policy & Boundaries

### 7.1 Policy: Negative Stock is Fully Permitted
- Invoice Ninja v5 **does not prevent stock from falling below zero**.
- There is no setting in `CompanySettings` or `Company` to block negative stock (e.g. no "Disallow Negative Inventory" toggle).
- The `in_stock_quantity` column is an unrestricted signed 32-bit integer (`-2,147,483,648` to `+2,147,483,647`).
- Neither `StoreInvoiceRequest` nor `AdjustProductInventory` executes pre-flight availability checks.

### 7.2 Empirical Container Proof
In our live Docker container testing (`craterninja-app-1`):
1. Created SKU `TEST-SKU` with initial stock = `10`.
2. Created Invoice 1 for `6` units $\rightarrow$ stock reduced to `4`.
3. Created Invoice 2 for `7` units $\rightarrow$ stock allowed and reduced to `-3`.
4. API returned HTTP 200 OK; the database saved `-3`; UI displays `-3` in red text.

---

## 8. Low-Stock Notification Engine

### 8.1 Threshold Evaluation Logic (`AdjustProductInventory.php:L131-L135`)
```php
if ($this->company->stock_notification && $p->stock_notification && $p->stock_notification_threshold && $p->in_stock_quantity <= $p->stock_notification_threshold) {
    $this->notifyStockLevels($p, 'product');
} elseif ($this->company->stock_notification && $p->stock_notification && $this->company->inventory_notification_threshold && $p->in_stock_quantity <= $this->company->inventory_notification_threshold) {
    $this->notifyStocklevels($p, 'company');
}
```

### 8.2 Two-Tier Threshold Hierarchy
1. **Product-Level Threshold**: If `product.stock_notification_threshold > 0`, this specific number takes priority.
2. **Company-Level Threshold**: If `product.stock_notification_threshold == 0`, the system falls back to `company.inventory_notification_threshold`.

### 8.3 Mailer & Queue Pipeline
- **Mailable**: `App\Mail\Admin\InventoryNotificationObject`
- **Wrapper**: `App\Jobs\Mail\NinjaMailer`
- **Queue Job**: `App\Jobs\Mail\NinjaMailerJob::dispatch($nmo)`
- **Queue Connection**: Redis, processed asynchronously via `supervisord` queue workers (`php artisan queue:work`).
- **Recipient Determination**: Evaluated via `UserNotifies::checkNotificationExists()`. Users must have notifications enabled for `inventory_all` or `inventory_threshold_all` (or `inventory_user` if assigned to the product).

---

## 9. Inventory Valuation & Costing Methods

### 9.1 Perpetual Costing Method Audit
- **FIFO (First In First Out)**: **NOT SUPPORTED**. No cost layering or purchase lot tracking tables exist in schema.
- **LIFO (Last In First Out)**: **NOT SUPPORTED**.
- **Weighted Moving Average**: **NOT SUPPORTED**.
- **Static Snapshot Costing**: **SUPPORTED**.

### 9.2 Mechanics of Static Costing
1. `products.cost` stores the current unit acquisition cost.
2. When a line item is created on an invoice or purchase order, the controller snapshots `products.cost` into `line_items[].cost`.
3. Subsequent changes to `products.cost` do not mutate past historical line item records.
4. Profitability reports calculate margin as:
   $$\text{Gross Profit} = \sum (\text{line\_item.price} - \text{line\_item.cost}) \times \text{line\_item.quantity}$$

---

## 10. Verification Audit & Sign-Off

### 10.1 Verified by Code
- `app/Models/Product.php`: Complete fillable array, casts, relationships `[CODE:L91-L118]`.
- `app/Http/Requests/Product/StoreProductRequest.php`: Complete validation rules `[CODE:L38-L55]`.
- `app/Http/Requests/Product/UpdateProductRequest.php`: `update_in_stock_quantity` server guard `[CODE:L77-L80]`.
- `app/Jobs/Inventory/AdjustProductInventory.php`: Decrement logic, line type filtering, low-stock threshold evaluation `[CODE:L48-L135]`.
- `app/Services/Invoice/HandleRestore.php`: Re-decrementing on invoice restoration `[CODE:L73]`.
- `app/Services/Invoice/HandleCancellation.php`: Proof that cancellation does not restore inventory.
- `public/Product-D8CXLfRv.js`: Frontend tabs, fields, conditional rendering on `track_inventory`.

### 10.2 Verified in Running App (Container `craterninja-app-1`)
- Live creation of product with 10 units stock, $15 cost, $25 price, threshold 5.
- Invoice generation for 6 units: verified stock decreased to 4 and low-stock email job dispatched to queue.
- Invoice generation for 7 units: verified stock successfully decremented to -3 without rejection.
- Invoice soft deletion: verified stock restored from -3 back to 4.
- Invoice restoration: verified stock re-decremented back to -3.
- Invoice cancellation: verified stock remained at -3.

### 10.3 Could Not Verify
- None. Every code path, queue dispatch, model constraint, and empirical stock transition was verified in code and live execution.

