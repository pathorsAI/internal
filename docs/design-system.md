# Design system

How Internal looks and moves, and the rules for keeping it that way. Read this before adding a
page or a component.

The system has one idea behind it: **neutral grays, one brand blue, and a small set of
"accessories" that each have a fixed place.** A page that follows the rules below looks right
without any page-specific styling.

## Where things live

| What | Where |
| --- | --- |
| Tokens (color, radius, shadow, type, motion), light and dark | `src/app/globals.css` — `@theme`, `:root`, `.dark` |
| Skin for shadcn components (via `[data-slot]`) | `src/app/globals.css` — "外皮" section |
| Accessory styles | `src/app/globals.css` — "配件" section |
| Accessory components | `src/components/ds/*` |
| shadcn originals — **do not edit**, restyle through tokens or at the call site | `src/components/ui/*` |

## Tokens

Use Tailwind classes backed by tokens (`bg-card`, `text-muted-foreground`, `border-border-soft`,
`text-primary`, `text-income`, `text-destructive`, `text-warning`, `shadow-xs`…). Never write a
hex value, `bg-white`, `text-black` or a palette class (`text-red-600`, `bg-emerald-50`) in a
page: it will be wrong in dark mode.

- **Color.** Neutral gray scale with no blue/green tint; brand blue `--primary` (#1469D4 light,
  #3B8AF0 dark) is the only accent. Semantic colors are for *status*, not decoration:
  `income` (green), `destructive` (red), `warning` (amber).
- **Radius.** `rounded-sm` 6px tags · `rounded-md` 8px buttons and inputs · `rounded-lg` 10px
  menus · `rounded-xl` 12px cards, sheets, dialogs. No pills (`rounded-full`) except avatars and dots.
- **Elevation.** One border + two shadows. Cards: `border` + `shadow-xs`. Floating things
  (menus, sheets, dialogs): `shadow-lg`. The page is `bg-background` (#FBFBFC), cards are `bg-card` (white).
- **Type.** Inter + Noto Sans TC, self-hosted through `next/font`. Sizes 12 / 13 / 14 / 16 / 20 / 24.
  Page title `text-xl font-semibold`; section title `text-sm font-medium text-muted-foreground`.
  Amounts and counts always get `tabular-nums`.
- **Spacing.** 4px grid. Page padding 24, card padding 16, table row height 40.
- **Motion.** Three durations (`--dur-1` 120ms, `--dur-2` 200ms, `--dur-3` 320ms) and two curves
  (`--ease-out-soft`, `--ease-in-out-soft`). Everything is off under `prefers-reduced-motion`.

## Amounts

Use `<Amount>` (`src/components/amount.tsx`) for every money value in a list or a detail view.

- income: green with `+` · expense / advance: ink with `−` · transfers and balances: no sign.
- **Expenses are not red.** Most rows in a ledger are expenses; a wall of red means nothing.
  Red (`text-destructive`) is reserved for things someone has to act on: overdue, failed, over budget.
- `amountKind(txn.type)` maps a transaction type to the right kind.

## Status

- `<StatusTag tone="…">` (`src/components/ds/status-dot.tsx`): pale tag with a colored dot.
  Use it instead of solid-colored badges. Tones: `neutral`, `primary`, `income`, `warning`, `risk`.
- `pulse` (a ring expanding from the dot) is only for **overdue** and **sync failed**.
- `<BookBadge book>` shows the book of a transaction with the twin-page mark.
- Destructive actions are quiet until hovered (`<DeleteButton>` is a ghost button that turns red).
  Never put a solid red button in a table row.

## Accessories

Each one has a place. Using one outside its place is a bug.

| # | Accessory | Component / class | Use it for | Never for |
| --- | --- | --- | --- | --- |
| 1 | Glow button | `<GlowButton>` | The single primary action of a page (`<CreateDialog>` already uses it) | Row actions, secondary actions, delete. **One per page.** |
| 2 | Grid paper | `<PageHeader>` (built in), `.grid-paper`, `.dot-paper` | Page header band, sign-in pages, landing hero, empty states | Behind tables or forms |
| 3 | Spotlight card | `<StatCard>` | Headline numbers on overview / board pages | Table rows, forms |
| 4 | Sparkline | `<StatCard spark={[…]}>`, `<Sparkline>` | Numbers that have a time series (≥ 2 points) | Numbers without history |
| 5 | Lit progress bar | `<Progress value max>` | Contract collection, subscription periods, reconciliation | Loading (use `Skeleton`) |
| 6 | Sliding indicator | sidebar (built in) | Sidebar | — |
| 7 | Twin-page mark | `<BookMark>`, `<BookBadge>`, `<LogoMark>` | Logo, book labels | — |
| 8 | Pulse dot | `<StatusDot pulse>` / `<StatusTag pulse>` | Overdue, sync failed | Normal states |
| 9 | Empty state | `<EmptyState icon message>`, `<EmptyRow>` | Any list with no data — icon + one sentence, optional CTA | — |

The glow uses the brand blue only. It is deliberately restrained in light mode and stronger in dark.

## Page anatomy

```tsx
<>
  <PageHeader title={…} description={…}>   {/* must be the first element */}
    <Button variant="outline" size="sm">…</Button>   {/* secondary actions */}
    <CreateDialog … />                                 {/* the one glow button */}
  </PageHeader>

  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">   {/* optional headline numbers */}
    <StatCard label={…} value={…} currency="TWD" spark={[…]} />
  </div>

  <TableCard title={…} action={…}>
    <Table>…</Table>
  </TableCard>
</>
```

- Tables: `<TableCard>` around a plain `<Table>`. Numbers right-aligned. Rows that open a dialog
  are clickable as a whole. Wide tables scroll inside their card.
- No card inside a card. No grid of bordered boxes for short text — use a table or a `dl`.
- Every string goes through `next-intl` in both `zh-TW` and `en` (`src/i18n/messages/*`).

## Motion inventory

| Motion | When | How |
| --- | --- | --- |
| Page enter | Navigating to another sidebar page | `<PageEnter>` in the dashboard layout, keyed by pathname |
| Row stagger | First 12 table rows, only right after a page enter | `.ds-entering` (not on filter / pagination) |
| Count-up | Headline numbers, once | `<CountUp>` inside `<StatCard>` |
| Draw-in | Sparklines, progress bars, charts | CSS keyframes / Recharts animation |
| Press & hover | Buttons scale to 97% when pressed; rows tint on hover | skin in `globals.css` |
| Overlays | Sheets, menus, dialogs, toasts | shadcn defaults + blurred backdrop |

Do not add an animation library. If a new motion is needed, add a keyframe and a token to
`globals.css` and list it here.

## Theme

Light, dark, or follow the system — switched from the user menu at the bottom of the sidebar (`<ThemeMenuItems>`), stored in
`localStorage.theme`, applied before first paint by the inline script in `src/app/layout.tsx`.
Check both themes before shipping a page.
