# Quickstart: Android Expense Prompt (Feature 002)

**Feature**: 002-android-expense-prompt | **Date**: 2026-05-06
**Prerequisite**: Feature 001 must be deployed (CF Worker running, Supabase schema applied, Android app installed).

---

## Integration Test Scenarios

These scenarios verify the end-to-end flow without mocking the backend.

### Scenario 1 — Plain Expense (online)

1. Open the app. The `PromptActivity` is accessible from the main screen (e.g., a FAB or menu item).
2. Type `250 星巴克 拿鐵` and tap **Submit**.
3. **Expected**: Confirmation message appears with "NT$250 — 星巴克 拿鐵" and a budget summary (total spent, remaining).
4. **Verify in Supabase**: A `transactions` row exists with `amount=250`, `transaction_type='expense'`, `items=[{name:"星巴克 拿鐵"}]`.
5. The text field is cleared and focused.

### Scenario 2 — EasyCard Payment

1. Type `80 悠遊卡 捷運` and submit.
2. **Expected**: Confirmation shows NT$80. In Supabase, `payment_method='easy_card'`.

### Scenario 3 — Parse Error

1. Type `吃了個東西` (no amount) and submit.
2. **Expected**: Error message shown inline (e.g., "無法解析金額"). Input text preserved. No Supabase row created.

### Scenario 4 — Offline Queuing

1. Enable airplane mode.
2. Type `150 便利商店` and submit.
3. **Expected**: "Saved offline — will sync when connected" message. Text field clears.
4. Disable airplane mode.
5. **Expected within 30 seconds**: A notification or in-app update confirms the expense was synced. Verify Supabase row exists.

### Scenario 5 — Fee Command (with candidate match)

1. Ensure a prior expense of NT$1,200 "Airbnb" exists in Supabase.
2. Type `fee 180 Airbnb` and submit.
3. **Expected**: Candidate list appears with the Airbnb transaction.
4. Tap the Airbnb candidate.
5. **Expected**: Confirmation shows NT$180 fee linked. In Supabase: a `transactions` row with `amount=180`, `transaction_type='fee'`, `parent_transaction_id=<airbnb UUID>`.

### Scenario 6 — Fee Command ("None of these")

1. Type `fee 47 某商店` and submit.
2. **Expected**: Candidate list appears (possibly empty or with unrelated results). Tap **None of these / record without link**.
3. **Expected**: NT$47 fee saved with `parent_transaction_id=NULL`.

### Scenario 7 — Fee Command (no description)

1. Type `fee 47` and submit (no description).
2. **Expected**: Candidate list shows the 20 most recent expense transactions. User selects one or taps "None of these".

### Scenario 8 — Refund Command

1. Ensure a prior `expense` for NT$800 "高鐵票" exists.
2. Type `refund 800 高鐵票` and submit.
3. Select the matching candidate.
4. **Expected**: In Supabase: `amount=800`, `transaction_type='refund'`, `parent_transaction_id=<ticket UUID>`. Budget total decreases by NT$800.

---

## Backend Route Testing (curl)

Replace `<API_KEY>` and `<WORKER_URL>` with actual values from `wrangler secret list` / deploy output.

### Plain expense

```bash
curl -X POST "<WORKER_URL>/android/input" \
  -H "X-Api-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"text": "250 星巴克 拿鐵"}'
```

**Expected**: `{"success":true,"message":"...","transaction_id":"...","budget_summary":{...}}`

### Parse error

```bash
curl -X POST "<WORKER_URL>/android/input" \
  -H "X-Api-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"text": "吃了個東西"}'
```

**Expected**: `{"success":false,"message":"無法解析金額..."}`

### Candidate list (with filter)

```bash
curl "<WORKER_URL>/android/transactions/recent?q=Airbnb" \
  -H "X-Api-Key: <API_KEY>"
```

**Expected**: `{"candidates":[{"id":"...","amount":1200,"description":"Airbnb",...}]}`

### Candidate list (no filter — last 20)

```bash
curl "<WORKER_URL>/android/transactions/recent" \
  -H "X-Api-Key: <API_KEY>"
```

---

## Definition of Done

- [ ] All 8 integration scenarios pass manually on a physical device or emulator
- [ ] Backend routes return correct response shapes for success, parse error, and 409
- [ ] Offline queued expenses appear in Supabase within 30 seconds of reconnecting
- [ ] `ManualInputSyncWorkerTest` passes: offline insert, sync success, 409 discard, retry backoff
- [ ] Existing `TransactionSyncWorker` tests remain green (no regressions)
