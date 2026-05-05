# Research: Auto Expenses Manager

**Branch**: `001-expense-tracker` | **Date**: 2026-05-05

## 1. CF Workers Testing Framework

**Decision**: Vitest + `@cloudflare/vitest-pool-workers`

**Rationale**: This is the official Cloudflare-recommended testing stack since 2024. It runs tests inside a Miniflare-based V8 isolate, providing accurate emulation of Workers environment (bindings, KV, D1, Service bindings). Integrates natively with `wrangler.toml` for binding configuration.

**Alternatives considered**:
- Jest + Miniflare directly — more manual setup, no official Cloudflare support going forward
- Integration tests only via `wrangler dev` — too slow for unit tests, no coverage

**Setup**:
```jsonc
// package.json (backend/)
"devDependencies": {
  "vitest": "^1.x",
  "@cloudflare/vitest-pool-workers": "^0.x"
}
```
```ts
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
export default defineWorkersConfig({ test: { poolOptions: { workers: { wrangler: { configPath: "./wrangler.toml" } } } } });
```

---

## 2. CF Workers Routing Framework

**Decision**: Hono

**Rationale**: Hono is purpose-built for edge runtimes (CF Workers, Deno, Bun). It provides Express-like DX with full TypeScript types, middleware support, and zero overhead. It handles the routing between `/discord/interactions`, `/api/notification`, and Cron Trigger handlers cleanly.

**Alternatives considered**:
- itty-router — lighter but less TypeScript support, fewer middleware options
- No framework (raw fetch handler) — viable for small APIs but becomes messy with multiple routes and middleware (signature verification, error handling)

---

## 3. Android Testing Framework

**Decision**: JUnit 4 + MockK

**Rationale**: JUnit 4 is the standard Android testing baseline. MockK is the Kotlin-idiomatic mocking library — unlike Mockito, it handles Kotlin final classes and coroutines natively without additional plugins.

**Alternatives considered**:
- Mockito — requires `mockito-kotlin` wrapper for Kotlin idioms, does not mock final classes without `@MockitoSettings(strictness = LENIENT)` plus the open plugin
- JUnit 5 — not natively supported by Android Gradle Plugin (requires extra setup)

---

## 4. Discord Interactions Webhook

**Decision**: Manual ed25519 verification using `@noble/ed25519` + JSON response

**Rationale**: Discord requires all Interactions Endpoint URLs to pass ed25519 signature verification. The `discord-interactions` npm package works but adds ~15KB gzip weight. `@noble/ed25519` is audited, tree-shakable, and CF Workers has native `crypto.subtle` — the verification is ~10 lines of code.

**Key constraint**: Discord requires a 200 response within 3 seconds. Any heavy processing (Gemini call, DB write) must be fire-and-forget (use `ctx.waitUntil()`) while returning an immediate ack (`type: 5` deferred response), then follow up with a PATCH to the interaction webhook URL.

**Alternatives considered**:
- `discord-interactions` npm package — fine but heavier; hides the ed25519 logic
- Discord.js — designed for gateway bots, incompatible with CF Workers (requires WebSocket, Node APIs)

**Interaction flow for slow operations**:
```
Client → Worker: POST /discord/interactions
Worker → Client: 200 { type: 5 }  (deferred, <100ms)
Worker (async, waitUntil): call Gemini → write DB → PATCH /webhooks/{id}/{token}/messages/@original
```

---

## 5. 財政部電子發票平台 API

**Decision**: Use 財政部 B2C API with mobile barcode carrier (type B2)

**Rationale**: The user confirmed they use 手機條碼 (mobile barcode). The API is provided by the Ministry of Finance at einvoice.nat.gov.tw. Authentication requires:
1. Carrier ID: `/` + 7 alphanumeric chars (user's barcode)
2. Verification code: 4-char code set by user on the platform
3. API key: obtained by registering an application on the platform

**Key endpoint**: `GET /PB2CAPIVAN/CarrierInvChk` — queries carrier invoices by date range.

**Sync strategy**: CF Workers Cron Trigger fires daily at 10:00 Taiwan time (`0 2 * * *` UTC). Fetches invoices for the previous day's date range. Stores raw response in `receipts` table, then triggers the matching algorithm.

**Constraints**:
- Rate limiting: ~100 requests/day on free tier
- Invoice data available T+1 (next day after purchase, after merchant batch upload)

---

## 6. Supabase Integration

**Decision**: Service role key on backend; static API key for Android via CF Worker proxy

**Rationale**: Single-user system with no public-facing Supabase access. The CF Worker holds the `SUPABASE_SERVICE_ROLE_KEY` secret and acts as the only Supabase client. Android sends notifications to the CF Worker via a static `ANDROID_API_KEY` secret (stored as a CF Workers secret, verified in the worker). RLS is not required.

**Supabase client**: `@supabase/supabase-js` v2 — works in CF Workers (uses `fetch` internally, no Node-specific APIs).

**Alternatives considered**:
- Direct Supabase access from Android — exposes service role key; not acceptable
- Supabase RLS with JWT — unnecessary complexity for single-user personal tool

---

## 7. Gemini API Integration

**Decision**: Raw HTTP fetch to Gemini API (`generateContent` endpoint)

**Rationale**: The official Gemini JS SDK adds Node.js dependencies incompatible with CF Workers. Raw `fetch` to `generativelanguage.googleapis.com` works perfectly in the Workers environment. Use `gemini-2.0-flash` (fast, cheap) for parsing cash expense prompts.

**Prompt strategy**: Structured output (JSON mode) to parse "150 燙青菜 牛肉麵" → `{ amount: 150, items: [{ name: "燙青菜" }, { name: "牛肉麵" }] }`.

---

## 8. Android Offline Handling

**Decision**: WorkManager with exponential backoff

**Rationale**: WorkManager is the Android-recommended library for deferrable background tasks that must complete even if the app is killed. A `OneTimeWorkRequest` is enqueued when a notification is parsed; if network is unavailable, WorkManager retries with exponential backoff (max 24h). Notifications are stored in a local Room database until successfully synced.

**Alternatives considered**:
- Firebase Cloud Messaging + immediate upload — simpler but requires network at notification time; fails offline
- Foreground service — overkill for this use case, battery-hostile
