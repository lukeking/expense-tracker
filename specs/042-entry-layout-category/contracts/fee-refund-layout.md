# Contract: Fee/Refund form layout (EntryScreen + ParentSearch card)

**Feature**: 042-entry-layout-category | **Date**: 2026-06-29

UI contract for `pwa/src/screens/EntryScreen.tsx` (`FeeForm`, `RefundForm`) and the linked-state of `pwa/src/components/ParentSearch.tsx`. Reference: synced `pwa/design-preview/refined/entry-fee/optimized.html` + `entry-refund/optimized.html` + `analysis/fee-refund.html`. **Behavior is inherited from spec 041 unchanged** — this is layout/presentation only.

## Field order (both tabs share the skeleton)

| Slot | 手續費 (FeeForm) | 退款 (RefundForm) |
|---|---|---|
| 1 | 金額 — labeled/framed 「附加成本」 | 金額 — green 「+ NT$ … 退回」 framing |
| 2 | **連結原始交易** (rich card, primary) | **連結原始交易** (rich card + 全額退/部分退 + 原金額提示) |
| 3 | 付款方式 (已帶入 when linked) | 退款至 (已帶入, 原路退回) |
| 4 | 分類 (已帶入 when single-category) | — (no category field) |
| 5 | 說明 (選填, 置底) | 說明 (必填, 置底) |
| footer | inline ✓ readiness hint + 送出 · NT$amount | inline ✓ readiness hint + 送出 · NT$amount |

## ParentSearch linked-state "rich card"

When `value != null`, render a card (replacing the current minimal note+amount card):
- 🔗 + title (`note ?? item_names[0] ?? tags[0] ?? id.slice(0,8)`)
- meta line: `payment_method · category · NT$amount · M/D` (omit `category` segment if `null`)
- ✕ control → `onSelect(null)` (clears link; other field values untouched)

Unlinked state (search input + dropdown) is unchanged.

## Behavior (inherited, MUST be preserved)
- Auto-fill on link is non-destructive + create-time only; touched fields never overwritten; re-link refreshes only untouched fields; clearing the link changes nothing else (FR-004; spec 041 `contracts/autofill-ui.md`).
- 退款: `全額退款` one-tap sets `amount = parent.amount` (full); partial = user edits afterward; card surfaces 原金額 (FR-005).
- Validation unchanged: refund requires non-empty 說明; fee 說明 optional (defaults to 國外交易服務費); amount required on both (FR-006, SC-005).
- Readiness hint shows when `canSubmit` is true (FR-007).

## Acceptance (maps to spec)
- FR-001/FR-002/SC-001: identical field order, 說明 last, on both tabs.
- FR-003: 連結原始交易 directly under 金額 as a card with the listed fields + clear control.
- FR-008: fee amount = added-cost framing; refund amount = returned-amount framing (distinct).
- SC-006: shipped layout matches the synced design references.

## Non-functional
- No API/payload change (`ParentSearchResult` already carries every card field).
- New visible strings (附加成本, 退回, 全額退/部分退, 原金額, readiness hint, updated `entry.linkOriginal`) in zh + en.
