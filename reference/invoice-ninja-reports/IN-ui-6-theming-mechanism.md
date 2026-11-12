# Pass 6 — The Theming Mechanism, Accessibility and Contrast

[SEEN route: /settings/user_details | IN-ui-screenshots/15-pass6-theme-customizer.png]
[SEEN route: /invoices | IN-ui-screenshots/16-pass6-zoom-200-percent.png]

---

## 1. The Theming Mechanism Architecture

Invoice Ninja combines runtime React Context state with compiled Tailwind utility classes to provide theming, dark mode, and user accent customization.

```
+----------------------------------------------------------------------------------------------------+
|                                      THEME RESOLUTION PIPELINE                                     |
|                                                                                                    |
|  [User Setting / LocalStorage]                                                                     |
|  hp('dark_mode') = true/false  ----->  Wh() Theme Resolver  ----->  Provides Uh (Light) or Hh (Dark) |
|                                                                     Theme Map ($0 ... $25)         |
|                                                                               |                    |
|  [OS prefers-color-scheme]                                                    v                    |
|  Initial HTML Boot Script      ----->  Adds '.dark' to <html> ------>  Tailwind dark: Utility Classes |
+----------------------------------------------------------------------------------------------------+
```

### 1. The Theme Resolution Pipeline
- **Theme Source of Truth**: Evaluated at runtime via `function Wh() { return hp('dark_mode') ? Hh : Uh; }` inside `public/forms-DEWnBS77.js`. [CODE public/forms-DEWnBS77.js:1]
- **Storage**: Theme preferences are stored in the user profile record (`users.dark_mode`) and cached in browser `localStorage`.
- **Pre-Hydration Defense**: To avoid flash-of-unthemed-content (FOUC), an inline script in `public/index.html` evaluates `window.matchMedia('(prefers-color-scheme: dark)')` before React mounts and sets `document.documentElement.style.backgroundColor = '#18181b'`. [CODE public/index.html:15]

### 2. Accent Colour Customizer
- **Location**: `Settings -> User Details -> Accent Color` (`/settings/user_details`). [SEEN route: /settings/user_details | IN-ui-screenshots/15-pass6-theme-customizer.png]
- **Component**: Built-in color picker component (`ColorPicker-c18MJlRC.js`) allowing custom hex input or RGB sliders.
- **Scope of Customization**:
  - Sets user accent color (default `#03B2CB` / `#121212`).
  - Dynamically computes a 15% opacity tint for badges using `useAdjustColorDarkness-Ba6EO9yY.js` (`rgba(r, g, b, 0.15)`). [CODE public/Badge-ChtnPWVb.js:1]
  - Repaints active sidebar link left border indicator and primary button focus rings.

---

## 2. WCAG AA Contrast Audit (Measured Values)

Using the standard W3C relative luminance formula:
$$L = 0.2126 \cdot R + 0.7152 \cdot G + 0.0722 \cdot B$$
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

Every core color pairing was measured directly against its container background:

| Element Pair | Foreground Hex | Background Hex | Measured Contrast Ratio | WCAG AA Threshold | Compliance Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Body Text on Page** | `#2A303D` [INSPECT] | `#F4F4F5` [INSPECT] | **11.9 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AAA)** |
| **Input Text on Fill** | `#2A303D` [INSPECT] | `#FFFFFF` [INSPECT] | **12.8 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AAA)** |
| **Primary Button** | `#FFFFFF` [INSPECT] | `#121212` [INSPECT] | **18.4 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AAA)** |
| **Secondary Button** | `#2A303D` [INSPECT] | `#FFFFFF` [INSPECT] | **12.8 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AAA)** |
| **Table Header Text** | `#A1A1AA` [INSPECT] | `#F4F4F5` [INSPECT] | **2.37 : 1** [MEASURED] | 4.5 : 1 | **FAILS WCAG AA** |
| **Table Cell Muted Text**| `#717179` [INSPECT] | `#FFFFFF` [INSPECT] | **4.68 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AA)** |
| **Status: Paid** | `#047857` [INSPECT] | `#ECFDF5` [INSPECT] | **5.82 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AA)** |
| **Status: Overdue** | `#B91C1C` [INSPECT] | `#FEF2F2` [INSPECT] | **5.91 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AA)** |
| **Status: Partial** | `#B45309` [INSPECT] | `#FFFBEB` [INSPECT] | **4.74 : 1** [MEASURED] | 4.5 : 1 | **PASSES (AA)** |
| **Status: Draft** | `#A1A1AA` [INSPECT] | `rgba(161,161,170,0.15)` | **2.35 : 1** [MEASURED] | 4.5 : 1 | **FAILS WCAG AA** |

### Critical Accessibility Failures Identified:
1. **Table Headers (`<th>`)**: `#A1A1AA` text on `#F4F4F5` background yields only **2.37:1** contrast, falling far short of the mandatory 4.5:1 ratio. Column names like "Number", "Client", and "Date" are washed out and illegible for users with low vision.
2. **Draft Status Pill**: `#A1A1AA` text on its 15% opacity gray fill yields only **2.35:1** contrast, making the default status pill for newly created invoices difficult to read under bright lighting.

---

## 3. Focus Indicators & Interactive States

- **Keyboard Focus Style**:
  - Buttons and standard inputs use Tailwind focus rings: `focus:outline-none focus:ring-2 focus:ring-offset-2`.
  - Color: `#000000` (Light mode) or `#FFFFFF` (Dark mode) or user accent.
  - Ring offset: `2px` white gutter between element border and focus ring (`focus:ring-offset-white`).
- **Defects Observed**:
  - The line-item grid cells (Item description, Unit cost, Quantity) rely on subtle border-color changes (`focus:border-black`) with **zero outer glow or focus ring** (`focus:ring-0`), making rapid tabbing hard to track visually.

---

## 4. Usability at 200% Browser Zoom

- **Test Condition**: Chrome scaled to 200% zoom (viewport equivalent: 683 x 384 CSS pixels). [SEEN route: /invoices | IN-ui-screenshots/16-pass6-zoom-200-percent.png]
- **Responsive Adaptation**:
  - The interface automatically transitions down past the `768px` breakpoint into tablet/mobile mode.
  - The left navigation sidebar collapses into a hidden drawer.
  - The table columns collapse into narrow stacked cells.
- **Usability Verdict**: **Functional but cramped**. No critical buttons clip off-screen, and horizontal scrolling is prevented (`scrollWidth: 683px`). However, only 3 table rows fit on screen vertically.

---

## 5. Colour Reliance & Form Labels

- **Is Status Ever Shown by Colour Alone?**:
  - **NO.** Every document status pill, payment badge, and table marker contains an explicit alphanumeric text string (`Draft`, `Paid`, `Sent`). Color is used strictly as a secondary reinforcement.
- **Form Labels: Real Labels vs Placeholders**:
  - Real semantic `<label>` elements are used for nearly all standard settings and client inputs.
  - **Exception in Line Items Grid**: Inside the invoice item grid, table header labels (`<th>`) serve as column headers, while the actual `<input>` elements use `placeholder="0.00"` or `placeholder="Description"` without individual `<label>` tags, relying on `aria-label` or column alignment for screen readers.

---

## 6. Closing Lists

### 1. Measured from Code
- Theme resolver logic: `public/forms-DEWnBS77.js:1`
- Accent color adjustment: `public/useAdjustColorDarkness-Ba6EO9yY.js:1`
- Color picker component: `public/ColorPicker-c18MJlRC.js:1`

### 2. Measured in the Browser
- Body text contrast: [MEASURED `#2A303D` on `#F4F4F5` -> `11.9:1`]
- Table header contrast failure: [MEASURED `#A1A1AA` on `#F4F4F5` -> `2.37:1`]
- 200% zoom viewport width: [MEASURED `683px`]

### 3. Screenshotted
- `IN-ui-screenshots/15-pass6-theme-customizer.png` — User details accent color customizer view.
- `IN-ui-screenshots/16-pass6-zoom-200-percent.png` — Invoices table rendered at 200% browser zoom.

### 4. Could Not Verify
- VoiceOver / NVDA screen reader live audio synthesis timing (tested DOM ARIA attributes and semantic role tags).
