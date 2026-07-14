# UI Style Guide — `intervals-spa`

## 1. Purpose

This style guide defines the visual language for the `intervals-spa` frontend.
It is inspired by compact, data-first nutrition dashboards (e.g. FoodCoach), adapted for a
training interval planning context.

The UI should feel:
- **calm and utility-first** — clear, trustworthy, not playful or sales-driven
- **data-first** — intervals, zones, and durations should be readable at a glance
- **dense, never cramped** — pack information without sacrificing scanability

---

## 2. Design Tokens

### CSS Custom Properties

```css
:root {
  /* Surfaces */
  --bg:             #f8fafc;   /* slate-50  */
  --surface:        #ffffff;   /* white     */
  --surface-muted:  #f1f5f9;   /* slate-100 */
  --border:         #e2e8f0;   /* slate-200 */

  /* Text */
  --text:           #1e293b;   /* slate-800 */
  --text-secondary: #475569;   /* slate-600 */
  --text-muted:     #64748b;   /* slate-500 */

  /* Semantic */
  --success:        #10b981;   /* emerald-500 */
  --warning:        #f59e0b;   /* amber-500   */
  --danger:         #ef4444;   /* red-500     */
  --info:           #06b6d4;   /* cyan-500    */

  /* Layout */
  --radius-card:    12px;
  --radius-control: 8px;
  --shadow-card:    0 1px 2px rgba(15, 23, 42, 0.08);
}

.dark {
  --bg:             #020617;   /* slate-950 */
  --surface:        #0f172a;   /* slate-900 */
  --surface-muted:  #1e293b;   /* slate-800 */
  --border:         #1e293b;   /* slate-800 */
  --text:           #f8fafc;   /* slate-50  */
  --text-secondary: #cbd5e1;   /* slate-300 */
  --text-muted:     #94a3b8;   /* slate-400 */
}
```

### Zone Semantic Colors

| Zone | Color    | Tailwind             |
|------|----------|----------------------|
| Z1   | #10b981  | `emerald-500`        |
| Z2   | #06b6d4  | `cyan-500`           |
| Z3   | #f59e0b  | `amber-500`          |
| Z4   | #f97316  | `orange-500`         |
| Z5   | #ef4444  | `red-500`            |

---

## 3. Typography

```css
font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
```

| Role             | Size  | Weight   |
|------------------|-------|----------|
| Page titles      | 18px  | 600      |
| Section labels   | 11px  | 600, uppercase, tracked |
| Body text        | 14–15px | 400   |
| Metric labels    | 12–13px | 400   |
| Table / dense    | 11–12px | 400   |

Avoid oversized hero typography.

---

## 4. Spacing Scale

| Use                         | Value |
|-----------------------------|-------|
| Micro spacing               | 4px   |
| Control padding / chip gap  | 8px   |
| Dense card gap              | 12px  |
| Standard card padding       | 16px  |
| Section separation          | 24px  |

---

## 5. Component Patterns

### Section Card

Primary surface. Use for: workout summaries, interval lists, settings blocks.

```css
.card {
  border-radius: var(--radius-card);
  border: 1px solid var(--border);
  background: var(--surface);
  padding: 16px;
  box-shadow: var(--shadow-card);
}
```

Tailwind shorthand:
```
rounded-xl border border-slate-200 bg-white p-4 shadow-sm
dark:border-slate-800 dark:bg-slate-900
```

### Zone Badge

Compact pill indicating intensity zone.

- Z1 → green
- Z2 → cyan
- Z3 → amber
- Z4 → orange
- Z5 → red

### Progress Bar

Horizontal bar for duration or effort distribution.

- Use single semantic color per zone.
- Show label, value, and total.
- No animation unless already supported.

### Forms

- Labels above fields.
- Helper text in small muted style.
- Rounded bordered inputs (`border-radius: var(--radius-control)`).
- 2-column grid for related fields on desktop.
- Primary button: dark filled in light mode; light filled in dark mode.
- Secondary button: bordered neutral.

### Tables

- Fixed headers.
- Small text (11–12px).
- Numeric values right-aligned.
- Subtle row borders.
- Horizontal overflow container on mobile.

---

## 6. Layout Shell

### Header

Sticky, compact, translucent with backdrop blur.

```
[Brand] [Nav links ...]
```

- `max-width: 1280px` content column, centered.
- Single-column on mobile → multi-column grid on desktop for workout cards.

### Navigation

Plain text links. Active state: underline + `font-weight: 500`.

---

## 7. Dark Mode

Dark mode is a first-class theme — not an afterthought.

- Swap CSS tokens only; do not redesign component structure between themes.
- Preserve semantic zone colors (they remain readable on dark surfaces).
- Use `prefers-color-scheme` media query + manual toggle via class `.dark` on `<html>`.

---

## 8. Responsiveness

| Breakpoint | Layout            |
|------------|-------------------|
| Mobile     | Single-column stack |
| Tablet     | 2-column card grid |
| Desktop    | 3-column card grid |

Sticky header remains usable at all widths.

---

## 9. Motion

Minimal animation only:
- Expanding interval detail panels.
- Progress bar width changes.
- Theme transitions.

Avoid: entrance animations, parallax, animated backgrounds, bouncing counters.

---

## 10. Copy Conventions

Plain, short, operational:

| Good                              | Avoid                                      |
|-----------------------------------|--------------------------------------------|
| `No workouts planned`             | `Start your fitness journey today!`        |
| `Mark as completed`               | `Crush it! 💪`                             |
| `Training on 15 Jul 2026`         | `Your amazing threshold session`           |

---

## 11. Charts

- Use **Apache ECharts** for all chart visualisations.
- Default chart theme is **dark** on first load; light theme is available via UI toggle.
- Keep chart visuals neutral and data-first:
  - thin axis lines
  - compact legends
  - no decorative gradients
  - subtle transitions only
- Chart defaults by use case:
  - progression and trends: line charts
  - metric relationships: scatter charts
  - zone and distribution summaries: bar charts

---

## 12. Definition of Done for New UI Work

A new screen fits this style guide when it:
- Uses the neutral card-based shell.
- Preserves compact information density.
- Uses semantic zone colors for badges and bars.
- Keeps zone ordering canonical (Z1 → Z5).
- Works in light and dark mode.
- Favors simple bars, tables, and text over elaborate data visualisation.
