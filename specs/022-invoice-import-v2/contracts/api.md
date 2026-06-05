# API Contracts — Invoice Import v2

All endpoints live under the existing `pwaRouter` (`/pwa/*`) and follow its auth
pattern. JSON unless noted. Amounts are integers (TWD).

---

## POST /pwa/import

Upload a government e-invoice CSV and run the enrichment-only pipeline.

**Request:** `multipart/form-data` with field `file` (the CSV). Unchanged from v1.

**Response 200:**
```jsonc
{
  "filename": "invoices_202605.csv",
  "matched_exact": 8,
  "matched_near": 2,
  "ambiguous": 3,
  "skipped_unmatched": 1,
  "skipped_duplicate": 4,
  "skipped_voided": 1,
  "skipped_zero": 0,
  "matched": [
    {
      "seller_name": "全聯實業股份有限公司",
      "invoice_number": "AB12345678",
      "transaction_at": "2026-05-21T00:00:00Z",
      "amount": 480,
      "confidence": "exact",          // "exact" | "near"
      "items_outcome": "filled"        // "filled" | "kept"
    }
  ]
}
```

`matched_exact + matched_near + ambiguous + skipped_unmatched + skipped_duplicate +
skipped_voided + skipped_zero` accounts for 100% of parsed invoices (SC-004).
(Date-parse failures are skipped silently and not counted in any bucket — edge case.)

**Errors:** `400 INVALID_CSV`, `400 ROW_LIMIT_EXCEEDED` (>1000), `500 PIPELINE_ERROR`
— unchanged from v1.

**Invariant:** transaction count before === after (FR-005 / SC-003).

---

## GET /pwa/import/ambiguous

List all invoices currently held as `ambiguous`, each with its live candidate
transactions (re-derived per request, so candidates linked since import drop out).

**Response 200:**
```jsonc
{
  "ambiguous": [
    {
      "id": "uuid",
      "invoice_number": "CD98765432",
      "seller_name": "...",
      "invoice_date": "2026-05-20",
      "net_amount": 1250,
      "items": [ { "name": "...", "quantity": 1, "unit_price": 1250, "amount": 1250 } ],
      "candidate_source": "exact",     // "exact" | "forex"
      "candidates": [
        { "id": "uuid", "transaction_at": "2026-05-20T00:00:00Z",
          "amount": 1250, "note": "晚餐",
          "items": [ { "name": "...", "amount": 1250 } ] }
      ]
    }
  ]
}
```

`candidate_source` = `exact` when exact-amount candidates exist (±2-day window);
`forex` when sourced from the ±5% near-amount fallback (±7-day window).

---

## POST /pwa/import/resolve

Manually link an ambiguous invoice to a chosen transaction (FR-011).

**Request:**
```jsonc
{
  "invoice_id": "uuid",
  "transaction_id": "uuid",
  "replace_items": false
}
```

**Behavior (ordered writes; invoice status flips last → re-runnable on failure):**
1. Enrich the transaction (`is_matched`, `invoice_number`, `seller_name`,
   `seller_tax_id`, `matched_invoice_id`).
2. Items: `replace_items=true` → replace existing items with the invoice's
   positive-amount line items (outcome `replaced`); `false` → fill only if the
   transaction has zero items, else keep (outcome `filled`/`kept`).
3. Set invoice `match_status='matched'`, `matched_transaction_id`, and
   `match_confidence` = `exact` only if the tx is same calendar day **and**
   `amount === net_amount`, else `near` (forex resolves to `near`).

**Response 200:**
```jsonc
{
  "resolved": {
    "seller_name": "...",
    "invoice_number": "CD98765432",
    "transaction_at": "2026-05-20T00:00:00Z",
    "amount": 1250,
    "confidence": "exact",
    "items_outcome": "replaced"
  }
}
```

**Errors:**
- `404 NOT_FOUND` — invoice or transaction does not exist.
- `409 INVOICE_NOT_AMBIGUOUS` — invoice is not in `ambiguous` status.
- `409 TRANSACTION_ALREADY_LINKED` — chosen transaction already has
  `matched_invoice_id`.
- `400 INVALID_PAYLOAD` — malformed body.

---

## Removed (Discord)

The Discord `/import` and `/reconcile` slash commands and their interaction handlers
are removed. `register-commands.ts` no longer registers them; re-running it
deregisters them from Discord.
