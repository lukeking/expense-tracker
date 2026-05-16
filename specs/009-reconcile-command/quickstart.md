# Quickstart: Standalone Invoice Reconciliation Command

**Branch**: `009-reconcile-command` | **Date**: 2026-05-10

## Prerequisites

- Existing expense-tracker backend deployed on Cloudflare Workers
- Discord bot registered with existing slash commands
- At least one `held_forex` or `ambiguous` invoice in the database (use `/import` to create them)

## 1. Register the New `/reconcile` Command

```bash
cd backend
DISCORD_APPLICATION_ID=<id> DISCORD_BOT_TOKEN=<token> npm run register-commands
```

Expected output: JSON array of registered commands including `reconcile`.

Allow up to 1 hour for the command to propagate globally in Discord (instant for guild commands).

## 2. Deploy the Updated Worker

```bash
cd backend
npm run deploy
```

## 3. Verify — Auto-reconciliation Pass (US1)

**Setup**: Have at least one `held_forex` invoice in the database. Correct the
corresponding transaction's amount using `/amend` so it now exactly matches the invoice's
net amount.

**Run**:
```
/reconcile
```

**Expected**:
1. Discord shows a "thinking..." indicator immediately.
2. A follow-up message arrives within a few seconds showing the reconciliation summary,
   e.g.:
   ```
   🔄 比對完成

   🔗 外幣已連結：1 筆
   ⏳ 仍待確認（外幣）：0 筆
   ```
3. The invoice's `match_status` in the database is now `matched`.
4. The transaction has `is_matched = true`, `invoice_number`, `seller_name`, `seller_tax_id` populated.

## 4. Verify — Ambiguous Invoice Sequential Prompt (US2)

**Setup**: Have at least one `ambiguous` invoice in the database (from a prior `/import`
where two same-amount transactions existed in the ±2-day window).

**Run**:
```
/reconcile
```

**Expected**:
1. Immediate deferred response.
2. Summary message shows `❓ 仍待手動確認（模糊）：1 筆` (or more).
3. A second message appears asking the user to select the correct transaction, with buttons
   labeled with amount, description, and date.
4. Clicking a button links the invoice and shows ✅ confirmation.
5. If more ambiguous invoices remain, a third message appears for the next one.

## 5. Verify — No Held Invoices (Edge Case)

**Setup**: Ensure database has no `held_forex` or `ambiguous` invoices.

**Run**:
```
/reconcile
```

**Expected**: Follow-up message reads `🔄 比對完成 — 無待確認發票`.

## 6. Verify — Idempotency

Run `/reconcile` twice in a row with no data changes between runs.

**Expected**: Both runs produce identical summaries. No duplicate records created.

## 7. Run Tests

```bash
cd backend
npm test
```

All existing tests should pass. New tests cover:
- `runReconciliationPass` with ambiguous invoices (1 candidate → auto-link, 0 candidates → auto-create, 2+ candidates → left held)
- `reconcile_link` component interaction (success, collision, no-candidates-remaining)
- `reconcile_skip` component interaction
- `/reconcile` command handler (deferred response, summary format)

## Troubleshooting

**`/reconcile` command not showing in Discord**: Wait up to 1 hour for global propagation,
or re-run `register-commands` with a guild-scoped flag for instant testing.

**Summary shows 0 resolved but you expect more**: Check that the target transaction's
`matched_invoice_id` is NULL — a prior run may have already linked it.

**Button click returns `❌ 發票不存在或已處理`**: The invoice was resolved by a concurrent
`/reconcile` run or the deferred pass. Run `/reconcile` again to see the updated state.
