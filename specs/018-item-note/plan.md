# Implementation Plan: Item Row Redesign (018)

**Branch**: `018-item-note` | **Date**: 2026-05-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/018-item-note/spec.md`

## Summary

Redesign the expense entry form's item rows: two-line layout (name/amount line + note/Max line), required pre-populated item, Max button with gross-up for % discounts, adjustments section moved to expand arrow on the amount field, per-item note stored in DB. One migration, one backend field, two frontend files changed.

## Technical Context

**Language/Version**: TypeScript (React 18 + Vite), PostgreSQL 15 via Supabase, Cloudflare Workers
**Primary Dependencies**:
- `pwa/src/components/ItemRow.tsx` — rewrite
- `pwa/src/screens/EntryScreen.tsx` — adjustments placement, pre-populate, submit guard
- `backend/src/handlers/pwa.ts` — per-item note, backend guard for category tags
- `backend/src/db/queries.ts` — `insertTransactionItems` signature
**Storage**: PostgreSQL — `transaction_items.note TEXT CHECK (char_length <= 200) NULLABLE`
**Testing**: Manual PWA smoke test per quickstart.md
**Target Platform**: PWA (mobile browser)
**Performance Goals**: Max computation is synchronous from form state — no async calls
**Constraints**:
  - Fee and refund tabs unchanged
  - ItemRow component reused by 019 (edit transaction) — props must remain stable
  - No reactive live-update for Max; computes at tap time only
**Scale/Scope**: Single-user PWA; no concurrency concerns

## Constitution Check

- [x] **I. Simplicity-First** — Surgical changes to 4 files + 1 migration. No new abstractions, no new components.
- [x] **II. Offline-First on Android** — N/A; PWA + backend only, no Android changes.
- [x] **III. Serverless Boundary Compliance** — No new CF Worker operations; POST /pwa/expense is unchanged in structure.
- [x] **IV. Automation Over Manual Input** — Max button eliminates manual arithmetic for item amounts.
- [x] **V. Security at System Boundaries** — `note` is validated at DB level (CHECK constraint). Category tag filter prevents data leakage to wrong column.

All gates pass. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```
specs/018-item-note/
├── plan.md              ← this file
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── schema-ddl.sql
└── tasks.md
```

### Source Code Changes

```
backend/supabase/migrations/018_item_note.sql      ← new migration
backend/src/db/queries.ts                          ← insertTransactionItems: add note param
backend/src/handlers/pwa.ts                        ← per-item note; category tag filter
pwa/src/components/ItemRow.tsx                     ← two-line layout, Max button, note field
pwa/src/screens/EntryScreen.tsx                    ← showAdj state, pre-populate, submit guard
```

---

## Phase A — Migration

**File**: `backend/supabase/migrations/018_item_note.sql`

```sql
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS note TEXT CHECK (char_length(note) <= 200);
```

Apply via Supabase SQL Editor. Idempotent.

---

## Phase B — Backend

### `backend/src/db/queries.ts`

Extend `insertTransactionItems` item type to include optional `note`:

```ts
items: { name: string; amount?: number | null; tags?: string[]; sort_order?: number; note?: string | null }[]
```

In the `rows` mapping, add: `note: item.note ?? null`

### `backend/src/handlers/pwa.ts`

**1. Category tag guard** (fixes audit `category_tag_on_transaction` bug):

```ts
const free_tags = rawTags
  .map((t) => t.replace(/^[#\s]+|[#\s]+$/g, ''))
  .filter(Boolean)
  .filter((t) => !t.includes(':'));   // category tags belong only on items
```

**2. Per-item note** — in the `insertTransactionItems` call for POST /pwa/expense, add `note` to each item:

```ts
items: items.map((i) => ({
  name: i.name,
  amount: i.amount,
  tag: i.tagOverride,
  note: i.note?.trim() || null,   // ← new
})),
```

---

## Phase C — ItemRow component

**File**: `pwa/src/components/ItemRow.tsx`

### `ItemRowData` changes

```ts
export interface ItemRowData {
  id: string;
  tagOverride: string | null;
  name: string;
  amount: number | null;
  note: string;         // new — empty string when blank
  approxFlag: boolean;  // new — set externally by onMax; cleared on manual amount edit
}
```

### New prop

```ts
onMax: (() => void) | null;   // null = disabled; called when Max button tapped
```

### Layout

```tsx
<div className="flex flex-col border-b border-gray-100 dark:border-gray-700 last:border-0 py-2 gap-1">
  {/* Line 1 — existing row */}
  <div className="flex items-center gap-2">
    {/* tag, name, −, amount, +, × — unchanged */}
  </div>
  {/* Line 2 — note + Max */}
  <div className="flex items-center gap-2 pl-1">
    <input
      type="text"
      value={item.note}
      onChange={(e) => onChange({ ...item, note: e.target.value })}
      placeholder="備註"
      maxLength={200}
      className="flex-1 text-xs border-0 outline-none bg-transparent text-gray-500 dark:text-gray-400 placeholder-gray-300"
    />
    <button
      type="button"
      onClick={() => onMax?.()}
      disabled={onMax === null}
      className="flex-shrink-0 text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-30"
    >
      {item.approxFlag ? '≈Max' : 'Max'}
    </button>
  </div>
</div>
```

### Amount edit clears `approxFlag`

In `handleAmountInput`, `increment`, `decrement`: add `approxFlag: false` to the `onChange` call.

---

## Phase D — EntryScreen

**File**: `pwa/src/screens/EntryScreen.tsx`

### State changes

```ts
const [items, setItems] = useState<ItemRowData[]>([newItem()]);   // was []
const [showAdj, setShowAdj] = useState(false);                    // new
```

### `newItem()` update

```ts
function newItem(): ItemRowData {
  return { id: crypto.randomUUID(), tagOverride: null, name: '', amount: null, note: '', approxFlag: false };
}
```

### `onMax` factory — computed per item

```ts
function makeOnMax(itemId: string): (() => void) | null {
  if (!amountVal) return null;
  return () => {
    const otherSum = items
      .filter((i) => i.id !== itemId && i.amount !== null)
      .reduce((s, i) => s + (i.amount as number), 0);

    const absGross = adjustments.reduce((s, a) => {
      const amt = resolveAdjAmount(a, 1);   // resolve as absolute only
      if (amt == null) return s;
      return a.kind === 'fee' ? s - amt : s + amt;
    }, 0);

    const pctGross = adjustments.reduce((s, a) => {
      if (a.mode !== 'percentage' || a.value == null) return s;
      return a.kind === 'fee' ? s - a.value : s + a.value;
    }, 0);

    const divisor = 1 - pctGross / 100;
    if (divisor <= 0) return;
    const rawGross = (amountVal + absGross) / divisor;
    const grossTotal = Math.round(rawGross);
    const maxVal = grossTotal - otherSum;
    if (maxVal <= 0) return;

    const approxFlag = Math.abs(rawGross - grossTotal) > 0.001;
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, amount: maxVal, approxFlag } : i))
    );
  };
}
```

### Amount field row — expand arrow

```tsx
<div className="flex items-center gap-2">
  <input /* existing amount input */ className="flex-1 ..." />
  <button
    type="button"
    onClick={() => setShowAdj((v) => !v)}
    className="flex-shrink-0 text-gray-400 px-1"
    aria-label="折抵設定"
  >
    {showAdj ? '▾' : '▸'}
  </button>
</div>
```

### Adjustments section — inline (not `<details>`)

Replace the existing `<details>` block with:

```tsx
{showAdj && (
  <div className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 pb-3 pt-2">
    {adjustments.map((adj) => (
      <AdjustmentRow ... />
    ))}
    <button type="button" onClick={() => setAdjustments(prev => [...prev, newAdjustment()])} ...>
      ＋ 新增折抵
    </button>
  </div>
)}
```

Rendered **between** amount field and items list.

### Submit guard

```tsx
const canSubmit = amountVal > 0 && items.length > 0;
```

Show error when `items.length === 0`:

```tsx
{items.length === 0 && (
  <p className="text-xs text-orange-500">請至少新增一個品項</p>
)}
```

### Form reset on success

```ts
setItems([newItem()]);  // was setItems([])
setShowAdj(false);
```

### Pass `onMax` to each ItemRow

```tsx
<ItemRow
  key={item.id}
  item={item}
  inheritedTag={categoryTag}
  extraTags={freeTags}
  onMax={makeOnMax(item.id)}
  onChange={(updated) => updateItem(item.id, updated)}
  onRemove={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
/>
```

### Submit payload — add `note`

```ts
items: items.map((i) => ({ name: i.name, amount: i.amount, tag: i.tagOverride, note: i.note.trim() || null })),
```
