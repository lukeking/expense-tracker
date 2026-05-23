# Quickstart: Legacy Data Audit Catalog

**Feature**: 015-legacy-audit-catalog | **Date**: 2026-05-23

This runbook shows how to execute the audit script after it has been implemented per `plan.md` / `tasks.md`.

---

## Prerequisites

1. `backend/.env` populated with:
   ```dotenv
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   ```
   (Same as `migrate-legacy.ts` — if that script runs, this one will too.)

2. Migrations `011_categories.sql` and `012_legacy_categories.sql` applied. (FR-014 depends on the `categories` table being authoritative.)

3. Node.js + the `backend/` package's dependencies installed (`pnpm install` or `npm install` under `backend/`).

---

## Run an audit

From the `backend/` directory:

```bash
# Full audit, all sources
npx tsx scripts/audit-legacy.ts

# Audit only legacy-migrated rows (the dirty source)
npx tsx scripts/audit-legacy.ts --source legacy_migration

# Audit only manually-entered rows (regression sentinel — should be near-clean)
npx tsx scripts/audit-legacy.ts --source pwa
```

Console output during the run:

```text
[audit] connecting to Supabase ...
[audit] running invariant.transactions_without_items ... 87 matches (215 ms)
[audit] running invariant.items_sum_mismatch ... 298 matches (180 ms)
[audit] running invariant.fee_refund_without_parent ... 0 matches (45 ms)
[audit] running invariant.orphan_parent_reference ... 3 matches (62 ms)
[audit] running invariant.category_tag_on_transaction ... 1840 matches (200 ms)
[audit] running invariant.orphan_category_tag_on_item ... 18 matches (110 ms)
[audit] running sampler.transactions_by_shape ... 17204 considered (90 ms)
[audit] running sampler.transactions_by_source ... 17204 considered (320 ms)
[audit] running sampler.longest_notes ... 17204 considered (40 ms)
[audit] running sampler.longest_tags_arrays ... 17204 considered (40 ms)
[audit] running sampler.longest_item_names ... 17204 considered (40 ms)
[audit] diff loaded from 2026-05-22T09-15-00Z
[audit] wrote specs/015-legacy-audit-catalog/audit-reports/2026-05-23T14-30-00Z.md
[audit] wrote specs/015-legacy-audit-catalog/audit-reports/2026-05-23T14-30-00Z.json
[audit] done (1.4 s wall)
```

Reports land in `specs/015-legacy-audit-catalog/audit-reports/<UTC-timestamp>.{md,json}`. Open the `.md` in any markdown viewer.

---

## The cleanup loop

```text
1. Run the audit.
2. Skim the report; pick the invariant with the highest count and `suggested cleanup: bulk`.
3. Write a tsx fix script (or one-off SQL) addressing that pattern.
4. Run the fix. Verify visually via the v_transactions_full VIEW (once spec 018 lands) or by spot-querying.
5. Re-run the audit. Read the "Diff vs <prior>" section to confirm the count dropped by the expected amount.
6. Repeat until the invariant counts are all zero or acceptable.
```

The diff section is the heart of the loop — it answers "did my last script actually move the needle?" in one glance.

---

## Reading a report

### Diff section (skip to first non-zero delta)

```markdown
## Diff vs 2026-05-22T09-15-00Z

| Check                                          | Prior | Current |  Delta |
|------------------------------------------------|------:|--------:|-------:|
| invariant.transactions_without_items           |  4521 |      87 |  -4434 |
| invariant.items_sum_mismatch                   |   312 |     298 |    -14 |
```

→ Your last cleanup fixed 4,434 missing-items issues. The sum-mismatch check moved by only 14, so that pattern is mostly untouched and is your next target.

### Per-check section

```markdown
### invariant.items_sum_mismatch

> Transactions where every item has a non-null amount and SUM(item.amount) ≠ transaction.amount.

**Count**: 298 | **Suggested cleanup**: case-by-case
```

→ 298 rows where you'll have to read each one (no bulk pattern). Open the sample table, click any `transaction_id`, look at it in Supabase, figure out which side is wrong, fix that row.

### Sampler section (no judgement, just data)

```markdown
### sampler.longest_notes

> Top 20 transactions ordered by LENGTH(note) descending.
```

→ Eyeball the longest notes. If you see "150 牛奶 200 麵包 80 餅乾" patterns, that's a candidate for a new pattern-detector check ("note contains multiple price+name fragments") — add it to the registry on the next iteration.

---

## Adding a new check (developer)

When the structural samplers surface a pattern worth detecting in subsequent runs:

1. Add a new function in `backend/scripts/audit-legacy.ts` under the `// -- Checks --` section. Follow the `Check` signature from `contracts/check-function.md`.
2. Append it to the `CHECKS` array at the bottom of the file.
3. Re-run the audit. The new check appears as its own section in the report and shows as `(new)` in the diff.

No other code changes required (FR-018 / SC-004).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `[audit] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY` | `.env` not loaded | Run from the `backend/` directory; check `backend/.env` exists |
| Single check shows `ERROR: ...` in the report | That check threw an exception; others continued | Read the console stack trace; fix the check; re-run |
| Diff section missing on a fresh report dir | No prior report exists | Expected — diff appears from the second run onwards |
| All counts in non-legacy sources are non-zero | The "live entry paths are clean" assumption may be wrong | Investigate the entry path that produced the row (PWA / Discord / invoice / Android) |
| Run takes longer than 5 minutes | Network latency to Supabase, or a check is doing a full-table scan inefficiently | Look at per-check `[audit] running ...` timings in console output to isolate |

---

## File layout reference

```text
backend/scripts/audit-legacy.ts                                # the script
specs/015-legacy-audit-catalog/
├── audit-reports/                                             # auto-created
│   ├── 2026-05-23T14-30-00Z.md                                # one pair per run
│   └── 2026-05-23T14-30-00Z.json
└── (other artefacts)
```

Reports are checked into git **only if** you want them as a historical record of cleanup progress. Otherwise add `audit-reports/` to `.gitignore` for this spec directory — they're cheap to regenerate.
