# Quickstart: Expense Tracker

## Prerequisites

- Node.js 20+ and pnpm
- Wrangler CLI (`npm install -g wrangler`)
- Android Studio (for Android app)
- Supabase account
- Cloudflare account (free tier sufficient)
- Discord developer account

---

## 1. Supabase Setup

1. Create a new Supabase project at supabase.com.
2. Copy your **Project URL** and **service role key** from Project Settings → API.
3. Run the schema migration in the SQL editor:

```sql
-- Run contents of backend/supabase/schema.sql
```

4. Note your Supabase URL and service role key for step 3.

---

## 2. Discord Application Setup

1. Go to discord.com/developers/applications → New Application.
2. Under **Bot**, create a bot (optional; not needed for interactions webhook).
3. Under **General Information**, copy the **Application ID** and **Public Key**.
4. Under **OAuth2 → URL Generator**, select `applications.commands` scope.
5. Register slash commands via:
   ```bash
   cd backend && pnpm run register-commands
   ```
6. Set the **Interactions Endpoint URL** to your deployed worker URL + `/discord/interactions` (set after step 3).

---

## 3. Cloudflare Workers Setup

```bash
cd backend
pnpm install

# Login to Cloudflare
wrangler login

# Set secrets
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_BOT_TOKEN        # for sending proactive messages
wrangler secret put GEMINI_API_KEY
wrangler secret put ANDROID_API_KEY          # generate a random 32-char string
wrangler secret put DISCORD_CHANNEL_ID       # Discord channel for proactive messages

# Deploy
wrangler deploy
```

Copy the deployed worker URL and set it as the Discord Interactions Endpoint URL.

---

## 4. Android App Setup

1. Open `android/` in Android Studio.
2. Create `android/app/src/main/res/values/secrets.xml`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <resources>
       <string name="worker_base_url">https://your-worker.workers.dev</string>
       <string name="android_api_key">your-ANDROID_API_KEY</string>
   </resources>
   ```
   (This file is in `.gitignore`.)
3. Build and install on your Android device.
4. Grant **Notification Access**: Settings → Notification Access → enable the app.
5. The app will now listen for bank/payment notifications and forward them to CF Workers.

---

## 5. Local Development

```bash
cd backend

# Run locally (emulates CF Workers environment)
wrangler dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test --watch
```

Local worker available at `http://localhost:8787`.

To test Discord interactions locally, use a tunnel (e.g. `cloudflared tunnel --url http://localhost:8787`) and temporarily set it as the Discord Interactions Endpoint URL.

---

## 6. Verify Setup

1. In Discord, type `/expense 150 燙青菜 牛肉麵` — should get a confirmation message.
2. Check Supabase → Table Editor → transactions — should see the new row.
