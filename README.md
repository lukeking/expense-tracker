# Expense Tracker

A personal, fully-automated expense tracking system. Credit card and mobile payment transactions are captured automatically via Android notification interception and enriched with government e-invoice data — all surfaced through a Discord bot interface.

## Architecture

```
Android App  ──POST──▶  Cloudflare Workers (TypeScript/Hono)
                               │
Discord Bot  ──webhook──▶      │──▶  Supabase (PostgreSQL)
                               │
Cron Triggers  ─────────▶     │──▶  Gemini API (NLP parsing)
                               │
                               └──▶  Discord (push notifications)
```

| Layer | Technology |
|---|---|
| Backend | Cloudflare Workers, TypeScript, Hono |
| Database | Supabase (PostgreSQL) |
| Android | Kotlin, NotificationListenerService, WorkManager, Room |
| Discord | Interactions Webhook (HTTP, no gateway) |
| AI | Gemini API (free-text expense parsing) |

## Features

### Auto-capture (95% of expenses)
- Android app intercepts bank and mobile payment push notifications
- Parses amount, bank name, and wallet type from notification text
- Deduplicates multi-app notifications for the same transaction (3-minute window)
- Queues offline with Room DB; syncs via WorkManager background retry

### Discord Bot Commands
| Command | Description |
|---|---|
| `/expense` | Log a cash or manual expense via free-text (e.g. `150 燙青菜 牛肉麵`) |
| `/fee` | Record a fee tied to a parent transaction |
| `/refund` | Record a refund against a parent transaction |
| `/amend` | Correct the NTD amount of an existing transaction (for forex settlement) |
| `/import` | Upload a government e-invoice CSV to match invoices to transactions |

### E-Invoice CSV Import (`/import`)
- Accepts Taiwan government e-invoice CSV (UTF-8 or Big5 encoding)
- Parses ROC calendar dates, groups multi-item invoices by invoice number
- **Primary match**: exact NTD amount ±2 days
- **Secondary match**: ±5% amount tolerance for forex settlements
- Auto-creates transaction records for unmatched invoices
- Reconciliation pass re-evaluates previously unmatched forex invoices after each import

### Budget Tracking
- Single monthly budget target
- Per-transaction free-form tags (food, transport, etc.)
- Discord notification on every transaction with month-to-date spend

### Cron Triggers
- **Invoice reminder**: Discord reminder every 2 months to upload the latest CSV

## Project Structure

```
expense-tracker/
├── backend/                    # Cloudflare Workers backend
│   ├── src/
│   │   ├── handlers/           # Discord, Android handlers
│   │   ├── services/           # Budget, CSV parser, invoice matcher, Gemini, Discord notify
│   │   ├── db/                 # Supabase client and query functions
│   │   └── types.ts
│   ├── supabase/
│   │   ├── schema.sql          # Full schema
│   │   └── migrations/         # Incremental migrations
│   ├── scripts/
│   │   └── register-commands.ts  # Discord slash command registration
│   └── tests/
├── android/                    # Kotlin Android app
│   └── app/src/main/java/com/expenses/
│       ├── service/            # NotificationListenerService
│       ├── parser/             # Notification text parser
│       ├── worker/             # WorkManager background sync
│       ├── db/                 # Room local DB (offline queue)
│       └── ui/                 # Manual input prompt activity
└── specs/                      # Feature specs and implementation plans
```

## Development

### Backend

```bash
cd backend
pnpm install
pnpm dev          # local dev via wrangler
pnpm test         # vitest
pnpm run register-commands  # register Discord slash commands
pnpm deploy       # deploy to Cloudflare Workers
```

### Required Secrets (wrangler secrets)

| Secret | Description |
|---|---|
| `DISCORD_PUBLIC_KEY` | Ed25519 public key for interaction verification |
| `DISCORD_BOT_TOKEN` | Bot token for outbound Discord API calls |
| `DISCORD_CHANNEL_ID` | Target channel for push notifications |
| `DISCORD_APPLICATION_ID` | Application ID for follow-up messages |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `GEMINI_API_KEY` | Gemini API key for NLP parsing |
| `ANDROID_API_KEY` | Static key for Android → Worker auth |

### Android

Open `android/` in Android Studio. Set `BASE_URL` and `API_KEY` in `local.properties` or the app's network config, then build and install on your device. Grant notification access in system settings.

## Design Principles

- **Single user** — no auth layer, no user_id partitioning; Discord webhook signature verification is the security boundary
- **Serverless boundary compliance** — all Discord interactions return `type:5` (deferred) within 3 seconds; heavy work runs in `ctx.waitUntil()`
- **Offline-first on Android** — every notification is written to Room DB before network; WorkManager retries until confirmed
- **Automation over manual input** — the system is designed so that normal credit card spending requires zero manual action
