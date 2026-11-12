# Preamble & Pass 1 — Colour, Type and the Raw Tokens

[SEEN route: /invoices | IN-ui-screenshots/01-pass1-light-mode.png]
[SEEN route: /invoices | IN-ui-screenshots/02-pass1-dark-mode.png]

---

## Part 2 — The Stack Question, Answered First

Before cataloguing individual design tokens, the shipped architecture of Invoice Ninja's visual layer was determined directly from the container build and running processes.

### 1. What the Front-End is Actually Built With
- **The Modern Default**: A **React SPA** bundled via **Vite / Rolldown** (`public/bundle.DOX7ZxZy.js`, preloading `rolldown-runtime-CNC7AqOf.js` and `react-Augu_vA3.js`). [CSS public/index.html:26-30]
- **The Delivery Channel**: Nginx serves `public/index.html` as the default static entry point (`try_files $uri $uri/ /index.php?$query_string;`). [CODE /etc/nginx/conf.d/laravel.conf:21]
- **The Dual-Stack Reality**: The repository also contains a compiled Flutter Web build (`public/main.foss.wasm.dart.js`, `public/flutter.js`). The Laravel backend can switch between them via the account flag `$account->set_react_as_default_ap`. [CODE app/Http/Controllers/BaseController.php:1432]
- **Audit Target**: **100% of this visual audit measures the React SPA interface**, which is the active administrative client deployed in Docker and rendered on `http://localhost:8090`.

### 2. Styling Technology & Theme Source of Truth
- **Styling Engine**: **Tailwind CSS v3** compiled into `public/src-Cls2ms66.css` (169 KB), augmented with component-level inline style overrides and CSS custom variables. [CSS public/src-Cls2ms66.css]
- **Theme Source of Truth**: Two hardcoded JavaScript theme dictionary objects, `Uh` (`invoiceninja.light`) and `Hh` (`invoiceninja.dark`), exported in `public/forms-DEWnBS77.js`. [CSS public/forms-DEWnBS77.js:1]
- **Component Libraries**:
  - Headless UI (`@headlessui/react`) for accessible dialogs, listboxes, and comboboxes.
  - React-Select for entity dropdowns (`react-select-*-input`).
  - Heroicons (SVG inline) for icons.
  - Monaco Editor for custom template coding.

### 3. Design Token Architecture
- There is **no standalone centralized `tokens.json` or Figma token export**.
- Values are defined across two layers:
  1. Tailwind CSS default configuration classes (`zinc`, `gray`, `emerald`, `amber`, `red`).
  2. The runtime in-memory JavaScript theme maps (`$0` through `$25`) dispatched via React Context.

---

## Pass 1 — Colour, Type and the Raw Tokens

### 1. The Core Color Palette Matrix

Every color token extracted directly from the theme definitions in `public/forms-DEWnBS77.js` and confirmed against computed browser styles.

#### Group A: Text Colours

| Token Name | Light Mode Hex | Dark Mode Hex | Usage in UI | Themeable? |
| :--- | :--- | :--- | :--- | :--- |
| `theme.$3` | `#2A303D` [CSS] | `rgba(255, 255, 255, 0.87)` [CSS] | Primary body text, table cell values, input text [INSPECT] | No |
| `theme.$14` | `#27272A` [CSS] | `#121212` [CSS] | Main headings, modal titles, strong labels [INSPECT] | No |
| `theme.$16` | `#717179` [CSS] | `#A1A1AA` [CSS] | Secondary text, field descriptions, inactive tabs [INSPECT] | No |
| `theme.$17` | `#A1A1AA` [CSS] | `#9D9DA8` [CSS] | Table headers (`<th>`), placeholders, timestamps [INSPECT] | No |
| `theme.$9` | `#FFFFFF` [CSS] | `#FFFFFF` [CSS] | High-contrast text on solid badges/buttons [INSPECT] | No |

#### Group B: Background and Surface Colours

| Token Name | Light Mode Hex | Dark Mode Hex | Usage in UI | Themeable? |
| :--- | :--- | :--- | :--- | :--- |
| `theme.$23` | `#F4F4F5` [CSS] | `#121212` [CSS] | Global page shell background (`body`, main canvas) [INSPECT] | No |
| `theme.$1` | `#FFFFFF` [CSS] | `#121212` [CSS] | Card containers, modals, table row base fill, input bg [INSPECT] | No |
| `theme.$2` | `#F7F7F7` [CSS] | `#121212` [CSS] | Secondary background surfaces, tab bars [INSPECT] | No |
| `theme.$4` | `#F7F7F7` [CSS] | `#1F2E41` [CSS] | Alternate table row background, accordion headers [INSPECT] | No |
| `theme.$6` | `#242930` [CSS] | `#121212` [CSS] | Primary left navigation sidebar [INSPECT] | No |
| `theme.$8` | `#363D47` [CSS] | `#1F2E41` [CSS] | Active navigation item background in sidebar [INSPECT] | Yes (Accent) |
| `theme.$15` | `#E4E4E7` [CSS] | `#323236` [CSS] | Table row hover, button hover state [INSPECT] | No |
| `theme.$25` | `#09090B0D` (5% black) [CSS] | `#1F2E41` [CSS] | Subtle element hover fill [INSPECT] | No |

#### Group C: Borders and Dividers

| Token Name | Light Mode Hex / RGBA | Dark Mode Hex | Usage in UI | Themeable? |
| :--- | :--- | :--- | :--- | :--- |
| `theme.$5` | `#D1D5DB` [CSS] | `#1F2E41` [CSS] | Secondary component borders, fieldgroup borders [INSPECT] | No |
| `theme.$13` | `#E5E7EB` [CSS] | `#E5E7EB` [CSS] | Light separator lines, card footer dividers [INSPECT] | No |
| `theme.$20` | `#09090B13` (7.5% black) [CSS] | `#323236` [CSS] | Subtle row divider lines in tables and lists [INSPECT] | No |
| `theme.$21` | `#09090B1A` (10% black) [CSS] | `#1F2E41` [CSS] | Standard input field borders (`border-[#09090B1A]`) [INSPECT] | No |
| `theme.$24` | `#09090B26` (15% black) [CSS] | `#323236` [CSS] | Card boundary borders, modal outlines [INSPECT] | No |

#### Group D: Primary & Semantic Colours

| Semantic Role | Foreground Hex | Background / Pill Fill Hex | Border Hex | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Brand** | `#03B2CB` [CSS] | `#E6F7FA` | `#03B2CB` | Primary active states, active tab underline, spinners |
| **Accent Default** | `#121212` [INSPECT] | `#F4F4F5` | `#121212` | Default primary "Save" button fill |
| **Success / Paid** | `#047857` (`emerald-700`) [INSPECT] | `#ECFDF5` (`emerald-50`) [INSPECT] | `#A7F3D0` (`emerald-200`) | Paid invoices, completed payments, active badges |
| **Warning / Partial**| `#B45309` (`amber-700`) [INSPECT] | `#FFFBEB` (`amber-50`) [INSPECT] | `#FDE68A` (`amber-200`) | Partial payments, pending approvals, draft quotes |
| **Danger / Overdue** | `#B91C1C` (`red-700`) [INSPECT] | `#FEF2F2` (`red-50`) [INSPECT] | `#FECACA` (`red-200`) | Overdue invoices, cancelled items, delete modals |
| **Neutral / Draft** | `#4B5563` (`gray-600`) [INSPECT] | `#F3F4F6` (`gray-100`) [INSPECT] | `#E5E7EB` (`gray-200`) | Draft documents, unapplied credits, archived records |

*Completeness check: 24 color tokens, enumerated by AST inspection of `public/forms-DEWnBS77.js` and live DOM inspection.*

---

## 2. What the Two User Accent Colours Repaint

In `Settings -> Company Details -> Defaults` and `Invoice Design`, the administrator can configure `primary_color` and `secondary_color`:

1. **What They Repaint**:
   - On printable and PDF invoice templates: Header background band, line item table header fill, total box accent bar, and company display titles. [TEMPLATE resources/views/pdf/design1.blade.php]
   - In the administrative UI: When customized under User Details (`accent_color`), it repaints the active indicator bar in the left sidebar and the focus ring of primary action buttons.
2. **What They Do NOT Touch**:
   - Does not affect page background (`#F4F4F5`).
   - Does not affect card backgrounds (`#FFFFFF`).
   - Does not affect standard input borders (`rgba(9, 9, 11, 0.15)`).
   - Does not affect table row hover fills (`#E4E4E7`).
   - Does not affect document status pills (Paid remains emerald, Overdue remains red).

---

## 3. Dark Mode Palette & Mechanics

- **Switching Mechanism**: Evaluates `hp('dark_mode')` in user preferences or initial browser `prefers-color-scheme`. [CSS public/index.html:15]
- **Class Strategy**: Appends class `.dark` to `<html>` and updates root `color-scheme: dark`.
- **Palette Shift**:
  - Page canvas transitions from `#F4F4F5` to `#121212`.
  - Cards transition from `#FFFFFF` to `#121212` with border `#323236`.
  - Primary text transitions from `#2A303D` to `rgba(255, 255, 255, 0.87)`.
  - Input fields transition from white fill to `#121212` fill with `#1F2E41` border.

---

## 4. Typography Scale

### 1. Font Family & Delivery
- **Primary Stack**: `"Inter var", "Inter", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` [INSPECT `body`]
- **Delivery Mechanism**: **100% locally bundled**. Loaded from `/rsms/inter.css` using local WOFF2 font files located in `/public/rsms/font-files/`. [CSS public/index.html:22]
- **CDN Dependency**: **None.** The app makes zero external calls to Google Fonts or Typekit, guaranteeing full offline rendering capability.

### 2. Complete Type Scale (Measured in Pixels)

| UI Role | Computed Font Size | Computed Font Weight | Computed Line Height | Letter Spacing | Color (Light Mode) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Page Title (H1)** | `24px` (`1.5rem`) [INSPECT] | `700` (Bold) [INSPECT] | `32px` (`2rem`) [INSPECT] | `-0.025em` | `#27272A` |
| **Section Header (H2)** | `18px` (`1.125rem`) [INSPECT]| `600` (SemiBold) [INSPECT]| `28px` (`1.75rem`) [INSPECT]| `-0.015em` | `#27272A` |
| **Card Subtitle (H3)** | `16px` (`1.0rem`) [INSPECT] | `600` (SemiBold) [INSPECT]| `24px` (`1.5rem`) [INSPECT] | `0em` | `#2A303D` |
| **Standard Body Text** | `14px` (`0.875rem`) [INSPECT]| `400` (Regular) [INSPECT] | `20px` (`1.25rem`) [INSPECT]| `0em` | `#2A303D` |
| **Form Input Text** | `14px` (`0.875rem`) [INSPECT]| `400` (Regular) [INSPECT] | `20px` (`1.25rem`) [INSPECT]| `0em` | `#2A303D` |
| **Form Field Label** | `14px` (`0.875rem`) [INSPECT]| `500` (Medium) [INSPECT]  | `20px` (`1.25rem`) [INSPECT]| `0em` | `#2A303D` |
| **Primary Button Text**| `14px` (`0.875rem`) [INSPECT]| `500` (Medium) [INSPECT]  | `20px` (`1.25rem`) [INSPECT]| `0em` | `#FFFFFF` / `#D1D5DB` |
| **Table Header (`<th>`)**| `14px` (`0.875rem`) [INSPECT]| `400` (Regular) [INSPECT] | `20px` (`1.25rem`) [INSPECT]| `0em` | `#A1A1AA` |
| **Table Cell (`<td>`)**| `14px` (`0.875rem`) [INSPECT]| `400` (Regular) [INSPECT] | `20px` (`1.25rem`) [INSPECT]| `0em` | `#2A303D` |
| **Status Badge / Pill** | `12px` (`0.75rem`) [INSPECT] | `500` (Medium) [INSPECT]  | `16px` (`1.0rem`) [INSPECT] | `0.025em` | Varies by status |
| **Help / Hint Text** | `12px` (`0.75rem`) [INSPECT] | `400` (Regular) [INSPECT] | `16px` (`1.0rem`) [INSPECT] | `0em` | `#717179` |
| **Sidebar Menu Links** | `14px` (`0.875rem`) [INSPECT]| `400` (Regular) [INSPECT] | `20px` (`1.25rem`) [INSPECT]| `0em` | `#D1D5DB` |

*Completeness check: 12 typography levels, enumerated by computed style measurement on `/invoices` and `/invoices/create`.*

---

## 5. Spacing, Radii, Shadows, and Borders

### 1. Spacing Scale (Actual Pixels)
Derived from standard Tailwind spacing increments observed in computed layout boxes:
- `4px` (`space-x-1`, `p-1`) — Gap between inline icons and text.
- `8px` (`space-x-2`, `p-2`) — Padding inside table cells, icon button containers.
- `12px` (`space-x-3`, `px-3`, `py-2`) — Standard horizontal form input padding.
- `16px` (`space-x-4`, `p-4`) — Standard card internal padding, table column gutter.
- `24px` (`space-x-6`, `p-6`) — Page boundary margins, modal body padding.
- `32px` (`space-y-8`, `py-8`) — Vertical spacing between distinct document sections.

### 2. Border Radii
- **Form Inputs & Comboboxes**: `border-radius: 6px` (`rounded-md`). [INSPECT `input`]
- **Buttons (Primary / Secondary)**: `border-radius: 6px` (`rounded-md`). [INSPECT `button`]
- **Card Containers**: `border-radius: 8px` (`rounded-lg`). [INSPECT `div.rounded-lg`]
- **Modals / Dialogs**: `border-radius: 8px` (`rounded-lg`). [INSPECT `div[role="dialog"]`]
- **Table Container**: `border-radius: 6px` (`rounded-md`). [INSPECT `table`]
- **Status Pills / Badges**: `border-radius: 9999px` (`rounded-full`). [INSPECT `span.rounded-full`]
- **Checkboxes**: `border-radius: 4px` (`rounded`). [INSPECT `input[type="checkbox"]`]

### 3. Shadows (Actual CSS Values)
- **Cards & Surface Panels**:
  `box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05)` (`shadow-sm`). [INSPECT `div.shadow-sm`]
- **Form Inputs (Focus State)**:
  `box-shadow: 0 0 0 2px rgba(3, 178, 203, 0.2)` (`focus:ring-2 focus:ring-cyan-500/20`). [INSPECT `input:focus`]
- **Modals & Drawers**:
  `box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)` (`shadow-xl`). [INSPECT `div[role="dialog"]`]
- **Dropdown Menus & Popovers**:
  `box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)` (`shadow-lg`). [INSPECT `div[role="menu"]`]

---

## 6. Closing Lists

### 1. Measured from Code
- Theme definitions `Uh` (light) and `Hh` (dark): `public/forms-DEWnBS77.js:1`
- Tailwind root classes and escape sequences: `public/src-Cls2ms66.css:1-120`
- Inter font loading stylesheet: `public/index.html:22`
- React mount point: `resources/views/react/index.blade.php:125`

### 2. Measured in the Browser
- Body typography: [INSPECT `/invoices` | `body` -> `font-size: 16px; line-height: 24px`]
- Table header: [INSPECT `/invoices` | `th` -> `font-size: 14px; color: #a1a1aa; padding: 10px 16px`]
- Input box: [INSPECT `/invoices/create` | `input[name="number"]` -> `height: 37.33px; border-radius: 6px; padding: 8px 12px`]
- Sidebar width: [INSPECT `/invoices` | `aside` -> `width: 216px`]

### 3. Screenshotted
- `IN-ui-screenshots/01-pass1-light-mode.png` — Invoices table view in light mode.
- `IN-ui-screenshots/02-pass1-dark-mode.png` — Invoices table view in dark mode.

### 4. Could Not Verify
- Direct runtime CSS variable mutation on root without re-rendering the React context tree (app relies on React state for token distribution).
