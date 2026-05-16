# Data Model: Legacy Accounting Data Migration

**Branch**: `010-migrate-legacy` | **Date**: 2026-05-16

## Schema Change

### New Migration: `008_add_source_to_transactions.sql`

```sql
-- Add source column to track transaction origin
ALTER TABLE transactions
  ADD COLUMN source TEXT;

-- Index for efficient dedup queries during migration
CREATE INDEX idx_transactions_source ON transactions (source)
  WHERE source IS NOT NULL;
```

- `source` is nullable TEXT — existing rows remain `NULL`; legacy imported rows = `'legacy_migration'`
- No CHECK constraint — leaves room for future source values (e.g., `'einvoice_import'`) without another migration

---

## NaggingMoney CSV → Transaction Field Mapping

| NaggingMoney Column | Value Example | → Transactions Field | Mapped Value |
|---|---|---|---|
| `日期` | `2016-03-27 17:49:46` | `transaction_at` | ISO 8601 string with +08:00 timezone |
| `類型` | `支出` / `收入` | `transaction_type` | `'expense'` / `'refund'` |
| `支出帳戶` / `收入帳戶` | `現金` / (empty) | `payment_method` | See payment mapping table |
| `分類` + `項目` (before `)`) | `食` + `飲料` | `tags[]` | `["食:飲料"]` (category:subcategory tag) |
| `項目` (after `)`) | `紅茶拿鐵` | `note` + `items` | `note="紅茶拿鐵"`, `items=[{name:"飲料)紅茶拿鐵", amount}]` |
| `項目` (no `)`) | `早餐` | `note` + `items` + `tags` | `note="早餐"`, tag=`"食:早餐"`, `items=[{name:"早餐", amount}]` |
| `金額` | `45` | `amount` | Integer (strip "NT"/"NT$" prefix if present) |
| `備註` | `美式套餐` | `tags[]` | Appended as plain tag: `["食:飲料", "美式套餐"]` |
| `發票號碼` | (usually empty) | — | Ignored |
| `標籤` | (2 rows only) | — | Ignored |
| `貨幣` | `TWD` | — | Validated; non-TWD rows flagged in output |
| (hardcoded) | — | `source` | `'legacy_migration'` |
| (hardcoded) | — | `is_matched` | `false` |
| `99` rows | — | — | Skipped entirely |

### Payment Method Mapping

| `支出帳戶` / `收入帳戶` | `payment_method` |
|---|---|
| `現金` | `cash` |
| `信用卡` | `credit_card` |
| `悠遊卡` | `easy_card` |
| (empty string) | `cash` |
| (unrecognised) | `cash` + logged warning |

### Category Mapping Configuration (to be defined in `migrate-legacy.ts`)

| NaggingMoney `分類` | Meaning | Tag prefix |
|---|---|---|
| `食` | Food & drink | `食` |
| `行` | Transport | `行` |
| `他` | Other | `他` |
| `店` | Shopping / store | `店` |
| `醫` | Medical / health | `醫` |
| `住` | Housing | `住` |
| `衣` | Clothing | `衣` |
| `樂` | Entertainment | `樂` |
| `育` | Education | `育` |

---

## Dedup Strategy

**Key**: `${amount}|${transaction_at_iso}|${note}`

**Algorithm**:
1. Before any writes, query: `SELECT amount, transaction_at, note FROM transactions WHERE source = 'legacy_migration'`
2. Build in-memory `Set<string>` of `${amount}|${transaction_at}|${note}` strings
3. For each parsed CSV row, compute the same key; if in the set → skip (deduplicated), else → insert and add to set

**Why in-memory**: ~15k records = trivial memory; avoids N per-row DB round-trips; safe since the script runs as a single process.

---

## Parsed Row Interface (internal to script)

```typescript
interface ParsedLegacyRow {
  transaction_at: string;        // ISO 8601 with +08:00
  transaction_type: 'expense' | 'refund';
  amount: number;                // positive integer TWD
  note: string;                  // item description (after ')' or full item)
  items: { name: string; amount: number }[];  // single-element array
  tags: string[];                // [category:subcategory, ...備註 plain tags]
  payment_method: PaymentMethod;
  source: 'legacy_migration';
  is_matched: false;
  _dedup_key: string;            // internal only, not inserted
  _raw_line: number;             // CSV line number for error reporting
}
```

---

## Dry-Run Report Format

The timestamped output file (`dry-run-YYYYMMDD-HHMMSS.txt`) contains:

```
=== Dry Run Report: YYYY-MM-DD HH:MM:SS ===
Source file: <path>
Total rows read:       17221
  Skipped (type 99):   2018
  Income rows:            6
  Expense rows:       15197
  Parse failures:         0
  Non-TWD rows:           0

Category coverage (all 9 mapped):
  食  8982 rows
  行  1883 rows
  他  1140 rows
  店  1101 rows
  醫   338 rows
  住   292 rows
  衣   150 rows
  樂    63 rows
  育    16 rows
  (unmapped): 0

Unmapped account values: none

Sample output (first 10 rows):
  [table of: line | date | type | amount | tags | note | payment_method]

Would insert: 15203 records
Already imported (dedup): 0
```
