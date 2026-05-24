# Expense Tracker Data Model Philosophy

**Status**: Living doctrine. Distilled from architectural discussion across spec 011, 015, and the design notes for the future spec 016.

**Audience**: Future-self when starting a new feature; anyone forking this project who wants to understand why the schema looks the way it does.

---

## Why this document exists

Architecture decisions in this codebase have been re-debated more than once (spec 011's items table got designed, shipped, then proposed-to-be-reverted within weeks). Capturing the decisions as durable principles — rather than scattering them across feature plan.md files — lets future feature work converge on the same shape instead of re-litigating it.

This is **not** a generic data-model best-practices guide. It is the opinionated shape this specific personal expense tracker has settled into, after a single user actually used it daily for three weeks and discovered which abstractions held up and which didn't.

---

## Scope and bias

- **Single user**. No multi-tenant patterns; no user_id partitioning; no RLS. Constitution principle I.
- **Personal-power-user use case**. The owner does Discord automation, 載具 API integration, legacy CSV migration. The model accommodates these; it does **not** try to be a general-purpose expense tracker for less technical users (that's the explicitly separate "親友版" product whose model lives elsewhere).
- **Postgres, not abstract storage**. Decisions assume Supabase / Postgres semantics — VIEWs, JSONB, GIN indexes, `random()` sampling — are available. Porting to a different store would require revisiting many decisions.

---

## Core principles

### 1. Transaction is the aggregate root; `paid_total` is the contract

The `transactions` row is the unit of read/write/sync. Its `amount` column is **authoritative — what was actually charged**. Every other piece of data (items, adjustments, future things) must reconcile to it.

When the math doesn't add up, `transaction.amount` wins. Adjustments are the only place where the user records *why* the math doesn't trivially add up.

### 2. Items decompose what was bought; they only contribute positively

`transaction_items` represents "what was in the basket". Each item has a name, an `amount` (the receipt/MSRP value), an `effective_amount` (post-adjustment allocated share — future spec 016), and category tags. Items never have negative amounts; they are not modifiers, they are constituents.

Item-level category tags are the foundation of summary drill-in. Aggregation by category sums items, not transactions.

### 3. Adjustments modify amount; sign is implied by `kind`

`transaction_adjustments` captures every monetary modifier that isn't an item: fee, refund, discount, and any future "先墊後收" reimbursement-style flows. Same column shape across all kinds; the kind enum dictates the sign:

```text
transaction.amount = SUM(items.amount) + SUM(fee) − SUM(refund) − SUM(discount)
```

Adjustments are recorded as positive numbers; sign is computed at math time.

### 4. Tag namespace is split by location, never overlapping

| Field                       | Holds                                | Examples                            |
|-----------------------------|--------------------------------------|-------------------------------------|
| `transactions.tags`         | Plain context: store, platform, situation | `全家`, `蝦皮`, `日本旅遊`           |
| `transaction_items.tags`    | Category only: `major:subcategory`   | `食:午餐`, `行:計程車`, `樂:旅遊`    |

A tag containing `:` on `transactions.tags` is an invariant violation (audit catches it). A plain tag on `transaction_items.tags` is wrong (it belongs on the transaction). Strict separation makes summary drill-in unambiguous.

### 5. SSOT in base tables; derived views are non-writable

Base tables (`transactions`, `transaction_items`, `transaction_adjustments`, `categories`) are the single source of truth. Convenience views like `v_transactions_full` (aggregating items + adjustments back into a single browseable row) are **computed on read** and **never accept writes**.

No materialised views, no denormalised mirror columns, no triggers that copy values across tables. If you want to see the joined picture, query the view. If you want to know what's actually stored, query the base.

The cost is: when the owner wants to write a multi-table change, they need either the PWA edit endpoint or a tsx script. The benefit is: nothing in the DB lies. Every column value is exactly what was written.

### 6. Note carries the long tail; promote to `enum` only when math or UI needs it

Rare semantic distinctions live in `note` (free text). Examples that stay in note for now:

- `kind='refund'` vs `kind='reimbursement'` — note differentiates "店家退款" / "同事還錢" / "公司核銷"
- Point credit vs cash discount — note like "蝦皮幣折抵"
- Original-currency price for foreign transactions — note like "USD 9.99 (tax incl.?)"

Promote a note convention to a typed field (new enum value, new column, new tag) when **either**:

- The math needs structured access (the field shows up in a calculation, not just human review), OR
- The UI needs an affordance (a dedicated button, a filter, a chart segment) that a free-text note can't power cleanly

This rule keeps the schema lean during exploration and lets the owner's actual usage drive structure, rather than pre-emptively modelling every imaginable distinction.

### 7. Audit catches drift; the input flow prevents it

Data quality is a two-tier system:

- **Input flow** (PWA forms, Discord commands, invoice matcher) enforces invariants at write time. New code must not introduce ways to write invalid state.
- **Audit script** (spec 015) runs periodically and surfaces anomalies that slipped through (legacy data, code bugs, edge cases nobody anticipated). After the legacy backlog is cleaned, the audit transitions from cleanup tool to regression sentinel — same code, different role.

DB-level constraints (CHECK, FK) catch the absolute basics. Subtle invariants live in app code and audit. This avoids the "DB magic" trap (triggers, generated columns) that violates principle 5.

---

## Notable rejections (and why)

| Rejected approach | Why considered | Why rejected |
|---|---|---|
| NoSQL document store | Editing experience friction, schema flexibility during cleanup | Loses Supabase dashboard, RPCs, GIN indexes, all existing scripts. Cost dwarfs benefit at 17k rows / single user. |
| Items collapsed into `transactions.items JSONB` | Document-as-aggregate editing convenience | Item-level SQL aggregation valuable enough to keep table separate; principle 2 needs items first-class. |
| Fee/refund as standalone transactions with `parent_transaction_id` | Initial spec 003 design | They have no standalone meaning in this domain — always tied to a parent. Cleaner as adjustments (spec 016). |
| Materialised derived data (e.g. transactions.tags mirroring items category tags) | "Naked transaction row" looks awkward when browsing DB directly | Violates principle 5. Use a VIEW instead. |
| Multi-user / multi-tenant infrastructure | Sharing with friends/family | Different product entirely. Forks cleanly per the personal vs 親友版 split — don't pollute the personal schema with shared-data hooks. |
| Pre-emptive enum splits (point_credit vs discount, reimbursement vs refund, etc.) | Schema "completeness" | Principle 6. Wait for actual UI/aggregation demand before structuring. |
| Item-targeted discounts (`adjustments.target_item_id`) | Per-item discount accuracy | Frequency too low; allocation distortion across all items is tolerable; principle 6 + simplicity-first. |
| Service-side magic (triggers, generated columns, materialised views, RLS) | DB "intelligence" | Violates principle 5 SSOT; debugging surface widens; CF Worker doesn't gain from it. |

---

## Application examples (how to use this doc)

When designing a new feature, ask:

- **"Where does this new piece of data live?"** → Apply principles 1, 2, 3 — does it modify amount (adjustment), describe what was bought (item), or describe the event as a whole (transaction)?
- **"Should I add a new enum value or a new column?"** → Apply principle 6. Is the value going into a SQL aggregation or a UI affordance? If yes, structure it. If just human review, note it.
- **"How do I expose this complex join nicely?"** → Apply principle 5. View, not denormalisation.
- **"I want this auto-computed value visible in the DB"** → Apply principle 5. Computed at read time (view, RPC), not stored.
- **"Should I check this rule at write time or in audit?"** → Apply principle 7. Write-time prevention is the default; audit catches what slips through.
- **"This new edge case needs special handling"** → Apply principle 6 first. Most edge cases don't need schema — they need a convention.

---

## When to revise this doc

These principles are **not constitutional**. They are calibrated to current usage patterns. Trigger conditions for revisiting any principle:

- The owner finds themselves repeatedly fighting a principle in real usage (e.g. "I keep wanting derived data; principle 5 is in my way")
- A new use case is added that the principles cannot accommodate (e.g. cross-device sync would force revisiting principle 5; multi-currency at scale would force structured fields)
- A new contributor (親友版 fork, future maintainer) finds the principles obstruct legitimate work

Revision happens by amending this doc with a dated note and a brief rationale, the same way the constitution gets amended. The PR that touches the schema should reference the principle being adjusted.
