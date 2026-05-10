# Expense Tracker — Workflow & Setup Guide

---

## Part 1: Spec Kit Commands

Commands are Claude Code slash commands — type them in the Claude Code prompt.

### Standard order for a new feature

```
/speckit-specify   → creates specs/<feature>/spec.md from your description
/speckit-clarify   → asks up to 5 clarifying questions, writes answers into spec.md
/speckit-plan      → generates plan.md, data-model.md, contracts/, research.md, quickstart.md
/speckit-tasks     → generates tasks.md with phased, numbered task checklist
/speckit-implement → executes tasks, writes code, marks tasks [X] as they complete
```

Each command reads what the previous one produced.
Re-run any step after requirement changes — e.g. `/speckit-clarify` → `/speckit-tasks` → `/speckit-implement` to pick up only new tasks.

### Scoping an implement run

```
/speckit-implement Execute only Phase P tasks (T053–T061)
```

Pass a plain-English filter after the command name to limit which tasks run.

### Git auto-commit

Controlled by `.specify/extensions/git/git-config.yml`.
`default: true` enables auto-commit for every event.
Override individual events with `enabled: false` + optional custom `message:`.
Trigger manually any time: `/speckit-git-commit`.

### This project's artifacts

| Artifact | Path |
|---|---|
| Original description | `proposal.md` |
| Feature spec | `specs/001-expense-tracker/spec.md` |
| Implementation plan | `specs/001-expense-tracker/plan.md` |
| Data model | `specs/001-expense-tracker/data-model.md` |
| API contracts | `specs/001-expense-tracker/contracts/` |
| Task list | `specs/001-expense-tracker/tasks.md` |

---

## Part 2: One-Time Service Setup

Do these steps once before the first deploy. Order matters — Supabase and Discord must be ready before Cloudflare secrets are set.

### Step 1 — Supabase (database)

1. Create a project at **supabase.com** (free tier is fine).
2. **Project Settings → API** — copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **service role key** (under "Project API keys" — use service role, not anon)
3. Open **SQL Editor** → paste the full contents of `backend/supabase/schema.sql` → **Run**.
4. Confirm `transactions` table appears in **Table Editor**.

### Step 2 — Discord application

1. Go to **discord.com/developers/applications** → **New Application** → give it a name.
2. **General Information** — copy:
   - **Application ID**
   - **Public Key**
3. **Bot** → **Add Bot** → copy the **Bot Token** (you'll need this for proactive messages).
4. Invite the bot to your server:
   - **OAuth2 → URL Generator** → scope: `bot` + `applications.commands`
   - Permission: `Send Messages`, `Read Message History`
   - Open the generated URL and add the bot to your server.
5. Copy the **Channel ID** of the channel the bot should post to
   (Discord: enable Developer Mode in Settings → right-click the channel → Copy ID).
6. Leave the **Interactions Endpoint URL** blank for now — fill it in after Step 3.

### Step 3 — Cloudflare Workers

```bash
cd backend
pnpm install
wrangler login        # opens browser, log in to your Cloudflare account
```

Set all secrets (you'll be prompted to paste each value):

```bash
wrangler secret put SUPABASE_URL                # from Step 1
wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # from Step 1
wrangler secret put DISCORD_PUBLIC_KEY          # from Step 2
wrangler secret put DISCORD_APPLICATION_ID      # from Step 2
wrangler secret put DISCORD_BOT_TOKEN           # from Step 2
wrangler secret put DISCORD_CHANNEL_ID          # from Step 2
wrangler secret put GEMINI_API_KEY              # from aistudio.google.com → Get API key
wrangler secret put ANDROID_API_KEY             # generate any random 32-char string, e.g.:
                                                #   openssl rand -hex 16
```

Deploy:

```bash
wrangler deploy
# → prints your worker URL, e.g. https://expense-tracker.YOUR-SUBDOMAIN.workers.dev
```

Register Discord slash commands (run once, or after adding new commands):

```bash
pnpm run register-commands
```

Go back to **Discord Developer Portal → your app → General Information** and paste the worker URL + `/discord/interactions` into **Interactions Endpoint URL** → Save.
Discord will ping the endpoint to verify — the worker must already be deployed for this to succeed.

### Step 4 — Android app

1. Open `android/` in **Android Studio**.
2. Create `android/app/src/main/res/values/secrets.xml` (already in `.gitignore`):
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <resources>
       <string name="worker_base_url">https://expense-tracker.YOUR-SUBDOMAIN.workers.dev</string>
       <string name="android_api_key">YOUR_ANDROID_API_KEY</string>
   </resources>
   ```
3. **Build → Build APK** (or run directly on a connected device via **Run**).
4. Install on your phone. Grant **Notification Access**:
   - Settings → Notification Access (or Special App Access → Notification Access)
   - Enable **Expense Tracker**

### Step 5 — Verify everything works

1. In Discord type `/expense 150 燙青菜 牛肉麵` — expect a confirmation reply.
2. Check **Supabase → Table Editor → transactions** — the row should appear.
3. Trigger a manual invoice sync (dev only):
   ```bash
   cd backend && wrangler dev
   # then in browser: http://localhost:8787/__scheduled?cron=*+*+*+*+*
   ```
4. Make a real card purchase — phone should receive a bank notification and the
   transaction should appear in Discord automatically within ~30 seconds.

---

## Part 3: Local Development

```bash
cd backend
wrangler dev          # local worker at http://localhost:8787
pnpm test             # run Vitest suite
pnpm test --watch     # watch mode
```

To test Discord interactions locally, expose the local port with a tunnel:

```bash
cloudflared tunnel --url http://localhost:8787
# paste the tunnel URL into Discord Interactions Endpoint URL temporarily
```
