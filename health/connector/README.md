# Google Health connector

A remote MCP server that exposes your Google Health data to Claude as a **custom
connector** — so you can ask from your phone, with nothing running on your laptop.

Claude connects to this server from Anthropic's cloud, not from your device.
That is why it has to be deployed at a public HTTPS URL rather than run locally.

## How the two OAuth layers fit together

```
Claude (phone) ──OAuth #1──> this Worker ──OAuth #2──> Google Health API
                (proves it's you)        (your stored refresh token)
```

Signing in with Google *is* the authentication step, so both happen in one pass:
`/authorize` hands off to Google, `/callback` brings the result back and completes
Claude's authorization.

## Tools it exposes

| Tool | What it returns |
|------|-----------------|
| `get_daily_summary` | Steps, calories, active zone minutes, distance, resting HR, sleep per day |
| `get_workouts` | Exercise sessions with duration, heart rate, calories |
| `get_sleep` | Sleep sessions with stages and timing |
| `get_body_metrics` | Weight and body fat over time |
| `log_meal` | Records a meal with estimated macros — Claude calls this after looking at a photo |
| `get_meals` | Previously logged meals, for totalling calories and protein |

Date arguments are optional; each read defaults to the trailing 14 days.

## Deploy

### 1. Create the KV namespaces

```bash
cd health/connector
npm install
npx wrangler kv namespace create OAUTH_KV
npx wrangler kv namespace create HEALTH_KV
```

Paste the two ids into `wrangler.jsonc`, replacing the `REPLACE_WITH_*` placeholders.

### 2. Point your Google OAuth client at the Worker

Reuse the OAuth client from [../README.md](../README.md) — a client can hold several
redirect URIs. In Google Cloud Console, add:

```
https://google-health-connector.<your-subdomain>.workers.dev/callback
```

You will know the exact hostname after the first deploy, so deploy once, then add
the URI, then authorize.

### 3. Add secrets and deploy

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

Set `ALLOWED_EMAILS` in `wrangler.jsonc` to your own Google address. Without it,
anyone who finds the URL can connect *their* account — they would only ever see
their own data, but they would spend your Worker quota.

### 4. Add it to Claude

In **Settings → Connectors → Add custom connector**, paste:

```
https://google-health-connector.<your-subdomain>.workers.dev/mcp
```

Approve the Google consent screen. Adding a connector has to be done from the web
or desktop app — but once added, it works in the mobile apps too, which is the
whole point.

## Checking it works

```bash
curl https://<your-worker>/.well-known/oauth-protected-resource/mcp
curl -i -X POST https://<your-worker>/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

The first returns resource metadata. The second must return `401` with a
`WWW-Authenticate: Bearer` header — an unauthenticated request reaching your data
would mean the protection is not wired up.

`npx wrangler tail` streams live logs while Claude calls it.

## Notes

- **Protocol.** Stateless MCP over Streamable HTTP, negotiating 2025-03-26,
  2025-06-18 or 2025-11-25. No Durable Objects, so it runs on the free tier.
- **Resource identity.** `resourceMetadata.resource` is deliberately not pinned,
  so the provider derives it from the request. The same code works on
  `workers.dev` and on a custom domain with no config change.
- **Storage.** Your Google refresh token and logged meals live in `HEALTH_KV`.
  OAuth tokens Claude uses are stored hashed by the provider, and props are
  encrypted. Health data never enters the git repo.
- **Unverified request shapes.** The `dailyRollUp` body and `list` query
  parameters carry the same caveat as the CLI — see the note at the end of
  [../README.md](../README.md). `npx wrangler tail` shows Google's exact error if
  a data type comes back unavailable.
