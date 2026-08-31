# Health — Google Health → Claude

Pulls your Google Health data (the app formerly called Fitbit) onto your own
machine so Claude can review your training, sleep and diet.

## Why this shape

Google's health APIs moved twice recently, so only one path actually works now:

| Route | Status |
|-------|--------|
| Google Fit REST API | Shutting down end of 2026, closed to new signups since May 2024 |
| Health Connect | On-device Android only — no cloud API for a laptop tool to call |
| Fitbit Web API | Sunsets September 2026 |
| **Google Health API v4** | **Current. What this uses.** |

## Setup

### 1. Create an OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com) and create a project.
2. **APIs & Services → Library** → enable the **Google Health API**.
3. **APIs & Services → OAuth consent screen** → External. Add yourself as a test
   user; you do not need to publish or get verified for personal use.
4. Add the read-only scopes listed in `lib/oauth.js`.
5. **Credentials → Create credentials → OAuth client ID → Web application**.
   Add this authorized redirect URI exactly:

   ```
   http://127.0.0.1:3000/callback
   ```

6. Copy the client ID and secret into the repo's `.env`:

   ```
   GOOGLE_HEALTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_HEALTH_CLIENT_SECRET=...
   ```

### 2. Authorize and sync

```bash
cd health
npm install
npm run auth      # opens a consent URL; approve, then the tab closes itself
npm run doctor    # confirms auth and probes every data type
npm run sync      # pulls the last 30 days
```

`npm run sync -- --days 90` pulls a longer window.

### 3. Ask Claude

```
read health/data/latest.json and review my training week
```

For food, just send a photo of the meal — Claude estimates the macros and appends
it to `data/food-log.json`.

## Using it from a phone

The CLI above needs a computer to run on. If you want to ask from your phone
instead, deploy `connector/` — a remote MCP server you add to Claude as a custom
connector. Same API underneath, but Anthropic's cloud calls it, so nothing runs
on your machine. See [connector/README.md](connector/README.md).

## Keeping it current

Sync before you ask for a review, or add a cron entry:

```
0 7 * * * cd ~/Asim/health && npm run sync
```

## What lands where

```
health/
├── cli.js              auth | doctor | sync | food add
├── lib/oauth.js        Google OAuth 2.0 + PKCE, token refresh
├── lib/client.js       Google Health API v4 wrapper
└── data/               gitignored — your data never leaves the machine
    ├── latest.json     most recent sync
    ├── food-log.json   logged meals
    └── food-photos/    meal photos
```

OAuth tokens are stored outside the repo at `~/.config/baro-health/tokens.json`
(mode 0600), so no git operation can reach them.

## If a data type fails

`npm run doctor` probes each type separately and prints Google's own error, which
names the offending field. Request shapes live in one place — `lib/client.js`,
the `list` and `dailyRollUp` methods. Check them against the
[API reference](https://developers.google.com/health/reference/rest/v4) and fix
there; nothing else needs to change.
