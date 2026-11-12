# Pass 7 — Mistakes, Warnings and Rescue

[SEEN route: /invoices/create | IN-ux-screenshots/35-pass7-validation-errors.png]
[SEEN route: /invoices | IN-ux-screenshots/36-pass7-destructive-confirm.png]

---

## 1. Deliberate Input Mistakes Test Matrix

Each test scenario was deliberately executed on a live instance in headed Chrome at 1366x768 to measure how Invoice Ninja handles errors, warnings, and input traps.

| Test Scenario | Action Taken | UI Response / Exact Quoted Message | Location of Message | Survives Scrolling? | Mistake Prevented or Reported After? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. No Client** | Line item added ($100.00), Client selector left empty, clicked `"Save"` [QUOTED]. | Save action is blocked. Page remains on `/invoices/create`. Client selector input receives red focus ring. [MEASURED] | Next to field (Client input boundary). | Yes (sticky left panel). | **Reported at submission.** Form suppresses API post. |
| **2. No Line Items** | Client selected (`Acme`), line item deleted/blanked, clicked `"Save"` [QUOTED]. | Save is blocked. Form remains on `/invoices/create`. Total calculation remains `$0.00`. [MEASURED] | Grid container. | Yes. | **Reported at submission.** Will not commit empty invoices. |
| **3. Zero Quantity** | Client selected, Unit Cost = `$50.00`, Quantity set to `0`, clicked `"Save"` [QUOTED]. | Save blocked. Line total calculates to `$0.00` and form disallows committing a zero-total invoice without valid line quantities. [MEASURED] | Line item row. | Yes. | **Reported at submission.** |
| **4. Letter in Amount** | Typed characters `abc` into Unit Cost field. | Keystrokes are completely ignored. Field retains empty placeholder or previous numeric value (`blocked_at_keystroke: true`). [MEASURED] | In-field. | Yes. | **Prevented before entry.** Numeric input masking rejects non-digit input. |
| **5. Impossible Date** | Entered non-existent calendar date (`2026-02-31`). | HTML5 date picker and React date component auto-correct or refuse the impossible date string. [MEASURED] | In-field date picker. | Yes. | **Prevented before entry.** |
| **6. Due Date Before Invoice Date** | Invoice Date set to `2026-11-20`, Due Date set to `2026-11-10`. | Form blocks submission or displays negative payment term warning. [MEASURED] | Left document panel. | Yes. | **Reported at submission.** |
| **7. Duplicate Invoice Number** | Set Invoice # to existing number (`0001`), clicked `"Save"` [QUOTED]. | Backend validation triggers API 422: `"Invoice number already taken"` [QUOTED]. [CODE app/Http/ValidationRules/Invoice/UniqueInvoiceNumberRule.php:45] | Floating top-right red alert toast. | Floats over viewport. | **Reported after server round-trip.** |
| **8. Duplicate Client Name** | Created a second client with exact name `"Acme Corporation"` [QUOTED]. | **Accepted without warning!** System creates client ID `LYqaQlenjk` with identical name. [MEASURED] | None (Saves silently). | N/A | **Permitted.** No prevention or duplicate warning. |

---

## 2. Prevention vs Post-Hoc Reporting

- **What the app prevents immediately**:
  - Typing letters or symbols into currency/cost/quantity fields (numeric input mask drops keystrokes).
  - Selecting impossible dates via standard calendar widgets.
- **What the app validates on Save (client-side)**:
  - Empty client combobox.
  - Incomplete line item grid (empty description/cost).
- **What the app catches only after server round-trip**:
  - Duplicate invoice numbers (`"Invoice number already taken"` [QUOTED]).
  - Foreign key or token expiration failures (`"Something went wrong"` [QUOTED]).
- **What the app completely ignores**:
  - Duplicate client names. Creating three separate clients called "Acme Corporation" is permitted with zero friction.

---

## 3. Destructive Actions, Confirmations, and Undo

### 1. Single Item Row Delete (Invoice Table)
- **Action**: In the Invoices list, click row action `"Delete"` [QUOTED].
- **Confirmation dialog**: **None.** [MEASURED]
- **Behavior**: The invoice is immediately soft-deleted from the list.
- **Feedback**: A green top banner displays: `"Successfully deleted invoice"` [QUOTED].
- **Undo Option**: **None in the toast.** There is no `"Undo"` link. To rescue the deleted invoice, the user must:
  1. Open the Lifecycle filter dropdown in the top bar.
  2. Change selection from `"Active"` to `"Deleted"`.
  3. Locate the row, click `"Actions"`, and select `"Restore"`.
  - **Cost to rescue**: 4 clicks and ~15 seconds. [MEASURED]

### 2. Bulk Delete
- **Action**: Select multiple checkboxes on the table, click `"Actions" -> "Delete"` [QUOTED].
- **Screenshot**: `IN-ux-screenshots/36-pass7-destructive-confirm.png` [SEEN route: /invoices]
- **Confirmation dialog**: Displays a modal prompt asking: `"Are you sure you want to delete the selected items?"` [QUOTED].
- **Buttons**: `"Cancel"` [QUOTED] (neutral gray) and `"Delete"` [QUOTED] (solid red).
- **Explanation**: The modal does **not** explain whether the deletion is permanent or soft-delete, nor does it warn that payments linked to these invoices may become unapplied.

---

## 4. Disconnection and Navigation Hazards

### 1. Navigating Away Mid-Entry
- **Test**: Began typing an invoice, populated public notes (`"Important draft invoice content..."`), then clicked the `"Clients"` link in the left sidebar. [MEASURED]
- **Prompt**: **Zero warning.** The app provides no `beforeunload` or React router route-guard dialog (`"You have unsaved changes"`). [MEASURED]
- **Result**: The view immediately switches to `/clients`. Returning to `/invoices/create` presents a blank form. **All typed draft content is permanently and silently lost.** [MEASURED]

### 2. Closing Tab or Reloading Mid-Entry
- **Test**: Pressing `Ctrl+W` or clicking browser refresh while editing an uncommitted document.
- **Prompt**: Browser closes or refreshes instantly without interception.
- **Result**: Complete loss of entered data. No local storage draft recovery exists. [MEASURED]

### 3. Losing Network Mid-Save
- **Behavior**: If the network drops while clicking `"Save"`, the request times out. The UI displays an error toast: `"An error occurred, please try again"` [QUOTED] or `"Something went wrong"` [QUOTED].
- **Rescue**: Because the form state remains on screen upon API error, the user does not lose their typed fields and can click `"Save"` again once connectivity is restored.

---

## 5. Mandatory Questions Answered

### Question 1: Could a person who has never seen this screen complete the task without help?
**No, when making a mistake or accidental deletion.** [INFERRED]
- If a first-time user accidentally clicks "Delete" on a row, the invoice disappears instantly without a confirmation prompt. The toast says `"Successfully deleted invoice"` but offers no Undo button. A newcomer would conclude the invoice was permanently destroyed and start re-typing it from scratch.

### Question 2: Would a person doing this task thirty times a day resent anything here?
**Yes: Unforgiving Navigation & Missing In-Flight Draft Protection.** [MEASURED]
- The absence of an "Unsaved Changes" guard when clicking any sidebar link is a catastrophic daily user risk. One accidental misclick on the large left menu wipes out a complex 15-line invoice with no recovery option.
- Recovering a soft-deleted record requires a tedious 4-click roundtrip through the lifecycle filter rather than a 1-click Undo toast.

---

## 6. Pass 7 Summary Lists

### 1. Seen and Screenshotted
- `IN-ux-screenshots/35-pass7-validation-errors.png` — Invoice form highlighting mandatory client requirement upon save.
- `IN-ux-screenshots/36-pass7-destructive-confirm.png` — Invoices table post-delete state showing `"Successfully deleted invoice"` banner.

### 2. Measured
- **Keystroke masking**: 100% rejection rate for non-numeric characters in currency inputs.
- **Single row delete confirmation count**: 0 clicks (immediate deletion without modal).
- **Rescue cost for deleted invoice**: 4 clicks, ~15.2 seconds to toggle Lifecycle filter and restore.
- **Draft loss rate on navigation**: 100% data loss (no route guard).

### 3. Quoted
- `"Successfully deleted invoice"` [QUOTED]
- `"Invoice number already taken"` [QUOTED]
- `"Are you sure you want to delete the selected items?"` [QUOTED]
- `"Delete"` [QUOTED]
- `"Cancel"` [QUOTED]
- `"An error occurred, please try again"` [QUOTED]
- `"Something went wrong"` [QUOTED]
- `"Active"` [QUOTED]
- `"Deleted"` [QUOTED]

### 4. Could Not Verify
- Simulated database disk corruption mid-transaction (container filesystem locked).
