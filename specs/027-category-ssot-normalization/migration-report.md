# Migration Report — Category SSOT Normalization (T025, FR-010 evidence)

**Executed:** 2026-06-11, after PR #42 merged (`acd8ea0`) and the backend auto-deploy went green — normalized writes were live in production before the migration ran (rollout order D7).
**Script:** `backend/scripts/normalize-category-ssot.ts` against the live Supabase DB.
**Sequence:** dry-run → review → `--apply` (run manually by Luke) → dry-run (idempotence proof).

## 1. Pre-apply dry-run

```
[normalize-category-ssot] mode: dry-run
[normalize-category-ssot] loaded 15302 transactions

── Report ─────────────────────────────────────
transactions:        15302
already normalized:  85
to update:           15214
  promotions (tx gains category): 15209
  item tags collapsed to inherit: 15257
guard-skipped:       3
  SKIP ecc4f96d-bd16-498a-9b45-127888a344ec (2026-06-07T09:33:41.915+00:00) — bucket mismatch (item amounts vs tx amount)
  SKIP e719c5e0-be4c-43f7-a07f-d4a1a1be6d7f (2026-06-08T05:19:09.159+00:00) — bucket mismatch (item amounts vs tx amount)
  SKIP dce7ab7d-b563-4c0c-bba5-3046a9b446bc (2026-06-10T10:38:14.405+00:00) — bucket mismatch (item amounts vs tx amount)
periods verified:    124
total drift:         NONE — per-period totals identical ✓
```

Consistent with the pre-merge baseline (15,299 txs / 15,211 to update on 2026-06-10); the deltas are the 3 transactions created since.

## 2. Apply

```
[normalize-category-ssot] done — 15214 transactions updated
```

Updated count matches the dry-run plan exactly. No `transaction_edit_history` rows were written (by design — the migration is invisible to edit history).

## 3. Post-apply dry-run (idempotence + equivalence proof)

```
── Report ─────────────────────────────────────
transactions:        15302
already normalized:  15299
to update:           0
  promotions (tx gains category): 0
  item tags collapsed to inherit: 0
guard-skipped:       3
  SKIP ecc4f96d-bd16-498a-9b45-127888a344ec (2026-06-07T09:33:41.915+00:00) — bucket mismatch (item amounts vs tx amount)
  SKIP e719c5e0-be4c-43f7-a07f-d4a1a1be6d7f (2026-06-08T05:19:09.159+00:00) — bucket mismatch (item amounts vs tx amount)
  SKIP dce7ab7d-b563-4c0c-bba5-3046a9b446bc (2026-06-10T10:38:14.405+00:00) — bucket mismatch (item amounts vs tx amount)
periods verified:    124
total drift:         NONE — per-period totals identical ✓
```

Zero pending changes; per-period per-category totals identical before/after across all 124 periods (SC-003).

## Guard-skipped transactions (3)

All three skips are the known pathology from research.md D3: item amounts exceed `tx.amount`, so stripping the item's category copy would shift bucket totals. They remain in the old (copied-tag) shape **intentionally** and display correctly via the FR-012 remainder dedupe. They are the SC-003 guard exception; fix is manual (adjust item amounts), not the migration's job.

| Transaction | Created |
| --- | --- |
| `ecc4f96d-bd16-498a-9b45-127888a344ec` | 2026-06-07 |
| `e719c5e0-be4c-43f7-a07f-d4a1a1be6d7f` | 2026-06-08 |
| `dce7ab7d-b563-4c0c-bba5-3046a9b446bc` | 2026-06-10 |

### Postscript — skips resolved (2026-06-11, same day)

All three were B1-era Discord entries: a category tag on a synthesized nameless, null-amount item, which aggregation ignores — so they bucketed under 其他 despite the recorded category. Luke re-saved each via the PWA edit sheet (no manual changes needed — the sheet's dual-source read derives the category from the item and the normalized PUT promotes it to tx level). This deliberately moved NT$602 from 其他 to 食. A subsequent dry-run reports:

```
transactions:        15302
already normalized:  15302
to update:           0
guard-skipped:       0
periods verified:    124
total drift:         NONE — per-period totals identical ✓
```

**The full history — 15,302 of 15,302 transactions — is normalized.**

## Verdict

- **FR-010 / SC-003:** totals provably unchanged — zero drift across 124 periods, guard exception limited to the 3 listed transactions. ✓
- **Idempotent:** second dry-run reports zero pending. ✓
- The old shape is no longer produced anywhere (all write paths normalized since deploy) and no longer exists in history outside the 3 guarded skips. 027 complete.
