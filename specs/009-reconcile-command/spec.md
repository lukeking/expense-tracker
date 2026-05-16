# Feature Specification: Standalone Invoice Reconciliation Command

**Feature Branch**: `009-reconcile-command`
**Created**: 2026-05-10
**Status**: Draft
**Input**: User description: "Standalone /reconcile Discord command that triggers the invoice reconciliation pass without requiring a CSV re-upload. It should attempt to resolve both held_forex and ambiguous invoices against current transaction amounts in the database."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Retry Reconciliation After Transaction Correction (Priority: P1)

After correcting a transaction amount (e.g., via `/amend`), the user wants to re-attempt matching all held forex invoices without re-uploading a CSV file.

**Why this priority**: The `/amend` workflow for forex transactions was specifically designed anticipating that a `/reconcile` pass would follow. Without this command, users must re-upload a CSV just to trigger the reconciliation pass — adding friction to what should be a simple correction step.

**Independent Test**: With at least one `held_forex` invoice in the database whose corresponding transaction amount has since been corrected to an exact match, run `/reconcile`. Verify the invoice is auto-linked and the summary reports the resolution.

**Acceptance Scenarios**:

1. **Given** a `held_forex` invoice exists and the user has corrected the corresponding transaction to match the invoice's net amount exactly, **When** the user runs `/reconcile`, **Then** the invoice is auto-linked to that transaction and the reconciliation summary reports it as resolved.
2. **Given** `held_forex` invoices exist but no transaction amounts have changed since the last pass, **When** the user runs `/reconcile`, **Then** all invoices remain held and the summary reports 0 resolved.
3. **Given** a `held_forex` invoice exists and its only candidate transaction has since been deleted, **When** the user runs `/reconcile`, **Then** a new expense record is auto-created from the invoice data and the invoice is reported as resolved.
4. **Given** no held invoices of any kind exist, **When** the user runs `/reconcile`, **Then** the command completes immediately with a message confirming there are no outstanding held invoices.

---

### User Story 2 - Explicitly Resolve an Ambiguous Invoice (Priority: P2)

The user sees an ambiguous invoice (held because multiple candidate transactions matched on the same amount and date) and knows which transaction it actually corresponds to. They need a way to explicitly link it without re-uploading a CSV.

**Why this priority**: Ambiguous invoices have no auto-resolution path — the ambiguity cannot resolve itself without a user decision. Without this story, `ambiguous` invoices are permanently stuck in the held state.

**Independent Test**: With at least one `ambiguous` invoice in the database, use the Discord interface to view it with its candidates and select one. Verify the invoice is linked and no longer listed as held.

**Acceptance Scenarios**:

1. **Given** an `ambiguous` invoice with 2 candidate transactions is presented sequentially, **When** the user selects one candidate, **Then** the invoice is linked to that transaction, the other candidate remains unlinked, the invoice is removed from the held list, and the bot advances to the next `ambiguous` invoice.
2. **Given** an `ambiguous` invoice whose candidate count has dropped to 1 (the other candidate was deleted), **When** the reconciliation pass runs, **Then** the invoice is auto-linked to the remaining candidate and reported in the summary as "ambiguous resolved" — no user selection required.
3. **Given** an `ambiguous` invoice is presented, **When** the user skips it, **Then** the invoice remains held and the bot advances to the next `ambiguous` invoice (or ends the session if none remain).
4. **Given** an `ambiguous` invoice and the user selects a candidate transaction that is already matched to a different invoice, **When** the user attempts the link, **Then** the system rejects the attempt and reports the conflict so the user can choose a different candidate — the bot does not advance until the user links or skips.

---

### User Story 3 - View All Currently Held Invoices (Priority: P3)

The user wants to review what invoices are currently held before deciding whether to run `/amend`, re-upload a CSV, or resolve ambiguous ones manually.

**Why this priority**: Without visibility into held invoices after the import session ends, the user must rely on memory of past import summaries. A dedicated view enables informed triage at any time.

**Independent Test**: With a mix of `held_forex` and `ambiguous` invoices in the database, request the held invoice list. Verify all held invoices appear with correct details. When the database has no held invoices, verify an all-clear message is shown instead.

**Acceptance Scenarios**:

1. **Given** 3 held invoices (2 `held_forex`, 1 `ambiguous`) exist, **When** the user requests the held list, **Then** all 3 appear grouped by status, each showing seller name, net amount, invoice date, and — for `ambiguous` ones — the candidate transaction descriptions.
2. **Given** no held invoices exist, **When** the user requests the held list, **Then** a message confirms there are no outstanding held invoices.

---

### Edge Cases

- What if a `held_forex` invoice's exact-match candidate is already matched to a different invoice? → Skip the collision; invoice remains held and the conflict is flagged in the summary.
- What if the user runs `/reconcile` multiple times without any data changing? → The command is idempotent — already-linked invoices are skipped and results are identical across runs.
- What if a `held_forex` invoice's amount still falls within ±5% of a candidate but is not an exact match after retry? → Invoice remains held; not auto-linked, not auto-created.
- What if the user attempts to link an `ambiguous` invoice to a transaction that is already matched to another invoice? → The link is rejected with a conflict message; the invoice remains held.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a Discord command that triggers the full invoice reconciliation pass over ALL held invoices (`held_forex` and `ambiguous`) in the database without requiring a CSV upload. The command MUST return an immediate deferred acknowledgment to Discord and complete the full pass in the background, sending the reconciliation summary as a follow-up message once the pass is complete.
- **FR-002**: During the reconciliation pass, for each `held_forex` invoice, the system MUST first check for an exact-amount match within a ±2-day date window; if found, auto-link the invoice to the transaction. If the amount is still within ±5% of a candidate but not exact, leave the invoice held. If no candidate transaction exists at all, auto-create a new expense record using the same defaults as spec 004 FR-006 (`payment_method = cash`, AI-inferred tags).
- **FR-003**: During the reconciliation pass, the system MUST re-evaluate each `ambiguous` invoice's current candidate count. If exactly 1 candidate transaction remains (others since deleted or matched elsewhere), the invoice MUST be auto-linked to that candidate and reported in the summary as "ambiguous resolved". If 2 or more candidates still exist, the invoice MUST remain held and be resolved only through explicit user selection (FR-006).
- **FR-004**: After the reconciliation pass completes, the system MUST report a summary: count of `held_forex` invoices resolved (split into linked vs. auto-created), count still held, and any skipped collisions with a brief description of each conflict.
- **FR-005**: The system MUST provide a way for the user to list all currently held invoices via Discord, grouped by status (`held_forex`, `ambiguous`), showing seller name, net invoice amount, invoice date, and — for `ambiguous` — the candidate transaction descriptions.
- **FR-006**: After displaying the held invoice list, the system MUST walk through each `ambiguous` invoice sequentially — one at a time — presenting the invoice details and its candidate transactions with controls to link to one candidate or skip the invoice. The system MUST advance to the next `ambiguous` invoice only after the user responds (link or skip). The session ends when all `ambiguous` invoices have been presented or the user signals they are done.
- **FR-007**: When the user explicitly links an `ambiguous` invoice to a candidate transaction, the system MUST update the invoice status to linked, populate the transaction's invoice fields (`invoice_number`, `seller_name`, `seller_tax_id`, `is_matched = true`), and leave all other candidate transactions unaffected.
- **FR-008**: The system MUST reject an explicit link attempt if the chosen candidate transaction is already matched to a different invoice, and MUST report the conflict to the user without modifying any data.
- **FR-009**: During the reconciliation pass, if a `held_forex` invoice's exact-match candidate is already matched to another invoice, the system MUST skip that pair and include it in the summary's collision count rather than overwriting the existing match.
- **FR-010**: The reconciliation command MUST be idempotent — invoices already linked by a previous run are skipped; re-running with no data changes produces an identical summary.

### Key Entities

- **Held Invoice**: An invoice in `held_forex` or `ambiguous` status from a prior import. Key attributes: `invoice_number`, `seller_name`, `seller_tax_id`, `invoice_date`, net amount (`發票金額 - 折讓`), `status`, and (for `ambiguous`) the set of candidate transactions it was held against.
- **Transaction** (existing): An expense record eligible for invoice linking. Relevant attributes: unique identifier, amount, date, description, matched status, linked invoice number.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The user receives an immediate acknowledgment from `/reconcile` within 3 seconds of invoking the command. The full reconciliation summary is delivered as a follow-up message once the pass completes.
- **SC-002**: All `held_forex` invoices for which a corrected exact-match transaction now exists are resolved in a single run with zero misses — any failure to link under these conditions is a defect.
- **SC-003**: Running `/reconcile` multiple times with no intervening data changes produces identical summaries — the command is fully idempotent.
- **SC-004**: A user can view the held invoice list and explicitly resolve an `ambiguous` invoice within 60 seconds of initiating the command.

## Assumptions

- The `/reconcile` command is available to the same Discord user as `/import` — no additional access control is needed beyond what already governs the bot.
- The reconciliation matching logic (±2-day window, exact-amount first, ±5% forex fallback) is identical to the logic defined in spec 004 FR-012. No new matching semantics are introduced by this feature.
- Candidate transaction references for `ambiguous` invoices are persisted from the original import run. The command can retrieve them from the database without re-running the matching pass from scratch.
- Auto-created expense records (from `held_forex` invoices with no remaining candidate) follow the same defaults as spec 004 FR-006: `payment_method = cash`, AI-inferred category and tags.
- The command operates on the live transaction database. No dry-run or staging mode is required.
- Only `expense`-type transactions are eligible for invoice linking — `fee` and `refund` transactions are never matched.

## Clarifications

### Session 2026-05-10

- Q: Should `/reconcile` enforce a per-run processing limit, and if so, what behavior when the limit is hit? → A: No hard cap. The command returns an immediate deferred acknowledgment and runs the full pass in the background (same deferred response pattern mandated by the constitution for slow operations), then sends the summary as a follow-up message. No per-run limit is needed since the user is not waiting synchronously.
- Q: Should the reconciliation pass re-evaluate `ambiguous` invoices for a reduced candidate count and auto-resolve if now exactly 1 candidate remains? → A: Yes — if a previously-ambiguous invoice now has exactly 1 candidate (others deleted or matched elsewhere), auto-link it during the pass and report in the summary as "ambiguous resolved". If still 2+ candidates, leave held for explicit user selection.
- Q: How should the Discord interface present explicit `ambiguous` invoice resolution — all at once or one-by-one? → A: Sequential — after displaying the held invoice list, the bot walks through each `ambiguous` invoice one at a time with link/skip controls, advancing to the next only after the user responds.
