# Research: Legacy Accounting Data Migration

**Branch**: `010-migrate-legacy` | **Date**: 2026-05-16

## Decision 1: Category Tag Format

**Decision**: Use `category:subcategory` tag format matching the existing system — e.g., `"食:飲料"`.

**Rationale**: `aggregateByCategory` (in `services/summary.ts`) uses `tag.includes(':')` to detect category tags and `tag.split(':')[0]` for the category name. Tags without `:` fall into `其他`. For the migration to produce correct summary output, all imported records MUST carry a tag with `:`.

**Mapping rule**:
- Item with `)` separator: `{分類}:{text_before_paren}` → `"食:飲料"`, note = text after `)`
- Item without `)`: `{分類}:{full_item_text}` → `"食:早餐"`, note = full item text

**Alternatives considered**:
- Encoding NaggingMoney categories into English labels (e.g., 食→food) — rejected; the existing live system shows Chinese category names in Discord summaries and the user's historical mental model is in Chinese.
- Adding dedicated `category` and `subcategory` DB columns — rejected; the tag system is the established convention and adding columns would require changes to existing query and summary code.

---

## Decision 2: Description Storage

**Decision**: Store the human-readable description (item text after `)`, or full item text if no `)`) in the `note` field. Also populate `items: [{name, amount}]` to match how `/expense` command records work.

**Rationale**: The Discord handler uses `tx.items?.[0]?.name ?? tx.note ?? ...` as the display label throughout (lines 463, 785, 1049, 1123 in `discord.ts`). Both fields need to be set for the record to render correctly in existing views. `note` alone is used in `amendCommand` and match summaries; `items[0].name` is used in category drilldowns.

**Item content**: `{name: full_item_text, amount: row_amount}` — consistent with how `/fee` and `/refund` commands store single-item records.

---

## Decision 3: Source Column for Dedup

**Decision**: Add `source TEXT` column to `transactions` via new migration `009_add_source_to_transactions.sql`. All legacy records are inserted with `source = 'legacy_migration'`. Dedup query filters on this value.

**Rationale**: No existing mechanism to identify the origin of a transaction. Without a `source` column:
- Cannot distinguish legacy records from manually entered ones in queries
- Cannot safely re-run the migration (no dedup boundary)
- Cannot compute a reliable dedup hash set without full table scans

**Dedup hash**: `${amount}|${transaction_at_iso}|${note}` — unique enough given the source boundary; SHA-256 overkill for a one-time script. In-memory `Set<string>` loaded before the first batch write.

**Alternatives considered**:
- Encoding source as a tag (`"source:legacy_migration"`) — rejected; would pollute the tag-based category system and interfere with `aggregateByCategory` logic.
- Using a `UNIQUE` constraint on the hash — rejected; overly complex for a one-time script; in-memory set is simpler and sufficient.

---

## Decision 4: Payment Method Mapping

**Decision**: Map `支出帳戶` / `收入帳戶` to `payment_method` as follows:

| Source value | `payment_method` |
|---|---|
| `現金` | `cash` |
| `信用卡` | `credit_card` |
| `悠遊卡` | `easy_card` |
| empty | `cash` (default) |
| anything else | `cash` (default, logged as warning) |

**Rationale**: The actual CSV data shows `支出帳戶` is empty on the vast majority of expense rows; `現金` appears on some income rows. The mapping covers all realistic cases. Unknown values fall back to `cash` with a logged warning per FR-003/FR-008 (skip-and-log pattern).

---

## Decision 5: Dry-Run Output File Location

**Decision**: Write dry-run files to the repo root (same directory where the script is invoked), named `dry-run-YYYYMMDD-HHMMSS.txt`. Add the pattern to `.gitignore`.

**Rationale**: `backend/scripts/` is the script's home, but placing output there requires the user to navigate directories. Repo root is where the CSV source file lives, making it the natural working directory. Each run produces a distinct timestamped file per FR-007 (no overwrite).

---

## Decision 6: 備註 → Tags Mapping

**Decision**: The `備註` field value (free-text note) is appended to `tags[]` as a plain text entry (no `:` prefix). It is NOT added to `note` (which already holds the item description).

**Rationale**: Per clarification Q3, `備註` maps to the tags field. The existing tag system stores plain tags alongside category tags in the same array — `aggregateByCategory` reads only tags with `:`. A plain tag like `"補給"` or `"清原"` (a shop name) is surfaced in future tag-based filtering without interfering with category aggregation. Empty `備註` rows simply omit the extra tag.

---

## Decision 7: Transaction Type for `收入` Rows

**Decision**: Map `收入` rows to `transaction_type = 'income'`.

**Wait** — the existing `TransactionType` is `'expense' | 'refund' | 'fee'`. There is no `'income'` type.

**Resolution**: The 6 income rows in the CSV appear to be refund/reimbursement events (rental refunds, deposit returns). Map `收入` → `transaction_type = 'refund'`. This is consistent with the existing type system and ensures correct monthly spend calculation (refunds are subtracted in `getMonthlySpend`).

**Alternatives considered**:
- Adding an `'income'` type to the CHECK constraint — rejected; scope creep; 6 rows don't justify schema change; the constitution's Simplicity-First principle discourages it.
- Skipping `收入` rows — rejected; spec FR-010 requires them to be imported.
