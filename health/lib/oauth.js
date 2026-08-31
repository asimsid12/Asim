/**
 * Google OAuth 2.0 (authorization code + PKCE) for the Google Health API.
 * Setup guide: https://developers.google.com/health/setup
 *
 * Tokens are stored in ~/.config/baro-health/tokens.json (mode 0600) — outside
 * the repo, so a stray `git add` can never pick them up.
 */

const crypto = require("crypto");
const http   = require("http");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const TOKEN_DIR  = path.join(os.homedir(), ".config", "baro-health");
const TOKEN_FILE = path.join(TOKEN_DIR, "tokens.json");

const REDIRECT_PORT = 3000;
const REDIRECT_URI  = `http://127.0.0.1:${REDIRECT_PORT}/callback`;

// Read-only scopes. Full list: https://developers.google.com/health/scopes
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];

// ── Token storage ────────────────────────────────────────────────────────────

function readTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
}

function writeTokens(tokens) {
  fs.mkdirSync(TOKEN_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function credentials() {
  const clientId     = process.env.GOOGLE_HEALTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_HEALTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing GOOGLE_HEALTH_CLIENT_ID / GOOGLE_HEALTH_CLIENT_SECRET.\n" +
      "Create an OAuth client in Google Cloud Console and add them to .env — see health/README.md."
    );
  }
  return { clientId, clientSecret };
}

// ── Authorization ────────────────────────────────────────────────────────────

function pkcePair() {
  const verifier  = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Runs the browser consent flow once and stores the resulting tokens. */
async function authorize() {
  const { clientId, clientSecret } = credentials();
  const { verifier, challenge } = pkcePair();
  const state = crypto.randomBytes(16).toString("hex");

  const url = `${AUTH_URL}?` + new URLSearchParams({
    client_id:             clientId,
    redirect_uri:          REDIRECT_URI,
    response_type:         "code",
    scope:                 SCOPES.join(" "),
    code_challenge:        challenge,
    code_challenge_method: "S256",
    access_type:           "offline",   // ask for a refresh token
    prompt:                "consent",   // force one, even on re-auth
    state,
  });

  console.log("\nOpen this URL in your browser and approve access:\n");
  console.log(url + "\n");

  const code = await waitForCallback(state);
  const tokens = await exchange({
    client_id:     clientId,
    client_secret: clientSecret,
    code,
    code_verifier: verifier,
    grant_type:    "authorization_code",
    redirect_uri:  REDIRECT_URI,
  });

  writeTokens(tokens);
  console.log(`Authorized. Tokens saved to ${TOKEN_FILE}`);
}

/** Listens on the loopback redirect URI for the one-time authorization code. */
function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code  = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font-family:system-ui;padding:3rem">
        <h2>${error ? "Authorization failed" : "Connected"}</h2>
        <p>${error ? error : "You can close this tab and return to the terminal."}</p>
      </body></html>`);
      server.close();

      if (error) reject(new Error(`Authorization denied: ${error}`));
      else if (state !== expectedState) reject(new Error("State mismatch — aborting."));
      else resolve(code);
    });

    server.on("error", reject);
    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
    });
  });
}

async function exchange(params) {
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params),
  });

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return { ...body, obtained_at: Date.now() };
}

// ── Access ───────────────────────────────────────────────────────────────────

/** Returns a valid access token, refreshing it first if it has expired. */
async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) {
    throw new Error("Not authorized yet. Run: npm run auth");
  }

  const expiresAt = tokens.obtained_at + tokens.expires_in * 1000;
  if (Date.now() < expiresAt - 60_000) return tokens.access_token;

  const { clientId, clientSecret } = credentials();
  const refreshed = await exchange({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type:    "refresh_token",
  });

  // A refresh response omits the refresh token — keep the one we already have.
  writeTokens({ refresh_token: tokens.refresh_token, ...refreshed });
  return refreshed.access_token;
}

module.exports = { authorize, getAccessToken, readTokens, SCOPES, TOKEN_FILE };
