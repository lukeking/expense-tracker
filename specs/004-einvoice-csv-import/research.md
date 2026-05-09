# Research: E-Invoice CSV Import + /amend Command

**Branch**: `004-einvoice-csv-import` | **Date**: 2026-05-09

---

## Decision 1: Discord file attachment URL in interaction payload

**Decision**: The file URL lives in `interaction.data.resolved.attachments[attachmentId].url`. The attachment option value is an attachment ID (string), not the URL itself.

```typescript
const attachmentId = options.find(o => o.name === 'file')?.value as string;
const url = interaction.data?.resolved?.attachments?.[attachmentId]?.url;
const response = await fetch(url);
const buffer = await response.arrayBuffer();
```

The `DiscordInteraction` type must be extended with:
```typescript
data?: {
  resolved?: {
    attachments?: Record<string, {
      id: string;
      filename: string;
      size: number;
      url: string;
      content_type?: string;
    }>;
  };
};
```

**Rationale**: Standard Discord Interactions API; this is the documented way to access uploaded files.
**Alternatives considered**: None — this is not a choice, it's the API spec.

---

## Decision 2: Big5 encoding detection and decoding in CF Workers

**Decision**: `TextDecoder` in CF Workers does NOT support Big5. Use the `big5` npm package (~8 KB, no Node.js APIs, compatible with CF Workers bundling via esbuild).

Detection strategy: try UTF-8 strict decode first; fall back to Big5 if it throws.

```typescript
import { decode as decodeBig5 } from 'big5';

function decodeCSVBuffer(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return decodeBig5(new Uint8Array(buffer));
  }
}
```

**Rationale**: Minimal bundle impact; fatal UTF-8 decode is a reliable heuristic since valid UTF-8 and valid Big5 are mutually exclusive on real government CSV files.
**Alternatives considered**: `iconv-lite` (~13 KB) — larger, more encodings, unnecessary here.

---

## Decision 3: ROC calendar date conversion

**Decision**: Taiwan's e-invoice CSV uses ROC (民國) year format: `YYY/MM/DD` where year 114 = 2025 CE. All date parsing must convert by adding 1911.

```typescript
function parseInvoiceDate(raw: string): Date {
  // raw: "114/04/18" → 2025-04-18
  const [rocYear, month, day] = raw.split('/').map(Number);
  return new Date(rocYear + 1911, month - 1, day);
}
```

**Rationale**: The government export uses ROC calendar throughout. Failing to convert produces dates in the 1900s, breaking all date-window matching.
**Alternatives considered**: None — this is a hard requirement of the data format.

---

## Decision 4: CSV row grouping (one row per line item)

**Decision**: The government CSV exports one row per line item, repeating invoice-level fields (invoice number, date, amount, seller) across all rows for the same invoice. Parsing must group rows by `發票號碼` and aggregate line items.

```typescript
// Group by invoice_number, collect items
const invoiceMap = new Map<string, ParsedInvoice>();
for (const row of rows) {
  const key = row['發票號碼'];
  if (!invoiceMap.has(key)) {
    invoiceMap.set(key, { ...invoiceMeta(row), items: [] });
  }
  if (row['消費明細_品名']) {
    invoiceMap.get(key)!.items.push({
      name: row['消費明細_品名'],
      quantity: Number(row['消費明細_數量']),
      unit_price: Number(row['消費明細_單價']),
      amount: Number(row['消費明細_金額']),
    });
  }
}
```

**Rationale**: Without grouping, an invoice with 3 line items would appear as 3 separate invoices and generate 3 false matches/auto-creates.
**Alternatives considered**: One row per invoice (single-item only) — rejected; real government exports include multi-item invoices.

---

## Decision 5: /amend command — amount stored in button custom_id

**Decision**: The desired new amount is encoded directly in the button `custom_id`: `amend_select:{newAmount}:{txId}`. No intermediate DB record is created before user selects a candidate (unlike /fee and /refund which insert-before-buttons).

Format: `amend_select:1523:550e8400-e29b-41d4-a716-446655440000`
Length: 13 + 7 + 1 + 36 = 57 chars (well within Discord's 100-char limit).

For retype modal: `amend_retype:{newAmount}` in `custom_id`; search term in the modal text input.

**Rationale**: `/amend` doesn't create a new transaction — it updates an existing one. No record needs to exist before the user selects a candidate, so the insert-before-buttons pattern is unnecessary and would leave orphan records on abandoned flows.
**Alternatives considered**: Store pending amend in DB — rejected (complexity cost, orphan records on abandoned flows).

---

## Decision 6: Post-import reconciliation pass scope

**Decision**: The reconciliation pass runs over ALL `held_forex` invoices in the `invoices` table (not just those from the current import). Each is re-evaluated using the same matching rules (exact first, ±5% secondary). If exact match found after `/amend`, auto-link it.

**Rationale**: This is the resolution path for the `/amend` → re-import workflow. Running it over all held invoices (not just the current batch) means the user doesn't need to re-upload the specific CSV that contained a held invoice.
**Alternatives considered**: Re-parse from CSV — rejected (user would need to re-upload the original file).

---

## Decision 7: Implementation order

**Decision**: `/amend` (Discord e2e only) is implemented first, before any CSV import work.

**Rationale**: User preference. `/amend` is also a prerequisite for resolving "likely forex match" invoices (FR-012) and is independently useful for any amount correction.
**Alternatives considered**: CSV import first — rejected per user direction.
