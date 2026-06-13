# Feature Specification: Local End-to-End Test Stack

**Feature Branch**: `028-e2e-test-stack`
**Created**: 2026-06-13
**Status**: Draft
**Input**: User description: "End-to-end test automation stack for the PWA expense tracker. Stand up a local, resettable test environment and automate the core user flows as a regression suite. Local datastore + local backend + browser-driven PWA, no cloud/CI dependency. Seed cases: the add-expense and view-summary walkthroughs. Category catalog must be seeded representatively (catalog SSOT is the live DB; the base migrations are only an initial seed). Known local port constraints must be accommodated. Goal: a reproducible, locally-runnable E2E suite that catches regressions in the entry and summary flows before merge."

## Clarifications

### Session 2026-06-13

- Q: Where does the local test DB get its category catalog? → A: A checked-in snapshot of the live catalog (~133 production rows) committed as a seed fixture, refreshed when the catalog meaningfully changes.
- Q: When running the suite, what does the test command start versus assume? → A: Hybrid — the test command auto-starts the backend and PWA and waits for readiness; the local datastore is a documented prerequisite, started and reset separately.
- Q: How often does the DB reset to the seed baseline? → A: Before each test (per-test identical baseline) for order-independence; the reset mechanism (fast truncate-and-reseed vs. full reset) is a planning detail.

## User Scenarios & Testing *(mandatory)*

The "user" of this feature is the developer/maintainer who ships changes to the expense tracker and needs confidence that the core flows still work before merging. Stories are ordered so that each builds a demonstrable slice on the previous one.

### User Story 1 - Reproducible local test environment (Priority: P1)

A developer can stand up a complete, isolated copy of the application — datastore, backend, and PWA — on their own machine, seeded with deterministic data, without touching production or any hosted service, and can reset it to a known clean state on demand.

**Why this priority**: Everything else depends on it, and it is the highest-risk/unknown piece (local datastore parity, seeding, port constraints). On its own it already delivers value: a safe sandbox for manual testing and for reproducing bugs against realistically-shaped data.

**Independent Test**: Start the stack, open the PWA, confirm it talks to the local backend and shows seeded data; run the reset and confirm it returns to the known baseline — all with no cloud credentials present.

**Acceptance Scenarios**:

1. **Given** a clean checkout, **When** the developer runs the documented startup sequence, **Then** the datastore, backend, and PWA are all running locally and the PWA loads without errors.
2. **Given** a running stack whose data has been modified, **When** the developer runs the reset, **Then** the datastore returns to the deterministic seed baseline.
3. **Given** no access to the production database or hosted services, **When** the stack is started, **Then** it runs fully against local-only resources.

---

### User Story 2 - Automated add-expense regression test (Priority: P2)

The suite drives the PWA through the add-expense journey end-to-end — entering an amount, choosing a category, adding item(s), selecting a payment method, and submitting — and verifies the expense is persisted and retrievable through the app.

**Why this priority**: Add-expense is the most-used write flow and the highest-value regression to guard. It is the first real automated test built on top of the US1 environment.

**Independent Test**: Run the single add-expense test against the seeded stack; it passes on known-good code and fails if the entry flow breaks.

**Acceptance Scenarios**:

1. **Given** the seeded stack, **When** the suite submits a valid expense through the PWA UI, **Then** the transaction is persisted and the app shows a success indication.
2. **Given** a submitted expense, **When** the suite reads it back through the app, **Then** the amount, category, item(s), and payment method match what was entered.
3. **Given** an invalid entry (e.g., zero amount), **When** the suite attempts to submit, **Then** submission is blocked, matching the app's existing guard.

---

### User Story 3 - Automated view-summary regression test (Priority: P3)

The suite drives the PWA to the summary view and verifies that aggregates reflect the seeded/added transactions, including at least one filter.

**Why this priority**: Read/aggregation flow that extends coverage beyond writes. Lower priority because a broken summary is less destructive than a broken entry path and is partially covered by existing backend unit tests.

**Independent Test**: Run the summary test against a known seed; assert the displayed totals and category breakdown match expected values.

**Acceptance Scenarios**:

1. **Given** a known set of seeded transactions, **When** the suite opens the summary, **Then** the displayed totals match the expected aggregate.
2. **Given** the summary view, **When** the suite applies a category or period filter, **Then** only matching transactions are reflected.

---

### Edge Cases

- What happens when a required port is unavailable (e.g., the locally-blocked range) — does startup fail loudly with guidance, or silently bind elsewhere and confuse the suite?
- How does the suite behave when the local datastore or backend is not running — a clear, actionable failure versus a confusing timeout?
- How is determinism guaranteed when tests run in sequence — does each test observe a known baseline regardless of run order?
- What happens when the seeded category catalog lacks a category that a test references?
- How does the suite handle the app's asynchronous write→read propagation so assertions don't flake by checking before data is queryable?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test environment MUST run entirely on the developer's machine with no dependency on the production database or any hosted service.
- **FR-002**: The test environment MUST reset to the identical deterministic seed baseline before each test, so tests are order-independent and a test's writes cannot perturb any other test's assertions.
- **FR-003**: The seed baseline MUST include a representative category catalog loaded from a checked-in snapshot of the live catalog (the production source of truth), sufficient to exercise the entry flow's category selection without depending on the live database.
- **FR-004**: The suite MUST drive the actual PWA user interface in a browser, exercising the same paths a real user does, rather than calling backend APIs directly.
- **FR-005**: The suite MUST cover the add-expense flow end-to-end and assert the resulting data is persisted correctly.
- **FR-006**: The suite MUST cover the view-summary flow and assert that aggregates reflect known seeded data, including at least one filter.
- **FR-007**: The suite MUST be runnable with a single command that starts the backend and PWA, waits for them to be ready, runs the tests, and reports a clear pass/fail result, assuming the local datastore is already running.
- **FR-008**: The startup procedure MUST accommodate the local environment's port constraints and document the required configuration so the stack comes up reliably.
- **FR-009**: A developer MUST be able to follow checked-in documentation to run the suite from a clean checkout without relying on undocumented knowledge.
- **FR-010**: The suite MUST fail when a covered core flow regresses (demonstrated by intentionally breaking a flow and observing a failing test).
- **FR-011**: Test runs MUST NOT mutate any production or shared data.
- **FR-012**: The local datastore MUST be started and reset to the seed baseline via a documented step separate from the test command (it is a prerequisite the test command relies on, not something it boots).

### Key Entities *(include if feature involves data)*

- **Seed fixture**: The deterministic baseline data loaded into the local datastore before a run — includes a representative category catalog and any baseline transactions the read-flow assertions depend on.
- **E2E test case**: An automated scenario that drives the PWA UI through a user journey and asserts observable outcomes.
- **Local stack**: The coordinated set of locally-running parts (datastore, backend, PWA) that the suite runs against.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can go from a clean checkout to a green E2E run by following the documented steps in under 15 minutes, excluding one-time tool installation.
- **SC-002**: The full suite completes a run in under 5 minutes on a typical developer machine.
- **SC-003**: Re-running the suite without code changes produces the same result every time — zero flaky failures across 10 consecutive runs.
- **SC-004**: Intentionally breaking the add-expense or summary flow causes the corresponding test to fail.
- **SC-005**: Running the suite touches zero production or hosted data, verified by the stack having no production credentials configured.
- **SC-006**: The suite covers both primary journeys — add-expense and view-summary — at launch.

## Assumptions

- The "user" of this feature is the solo developer/maintainer; there are no multi-user or permission concerns.
- Scope is the entry (add-expense) and summary (view-summary) journeys only. Other flows (edit, fee, refund, invoice import) are out of scope for this iteration; the framework should not preclude adding them later.
- The local datastore is a local instance of the same database engine used in production, started and reset via its CLI, giving schema parity without provisioning a second cloud project.
- The category catalog is seeded from a checked-in snapshot derived from the production catalog, rather than depending on the live database or assuming the base migrations alone are representative. Keeping that snapshot reasonably current is a maintenance cost accepted in exchange for deterministic, offline tests.
- Continuous-integration execution is out of scope for this iteration (no CI secrets; locally-runnable only). The suite is designed so it could later be wired into CI, but that is not delivered here.
- The existing application schema and migrations are assumed to apply cleanly to the local datastore.
- Browser automation runs headless by default, with a documented way to run headed for debugging.
