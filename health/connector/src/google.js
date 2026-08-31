/**
 * Google Health API v4 access from the Worker.
 * Reference: https://developers.google.com/health/reference/rest/v4
 *
 * Each user's Google refresh token lives in HEALTH_KV under `google:<sub>`.
 * Access tokens are short-lived, so they are refreshed on demand and cached
 * alongside it.
 */

const BASE_URL  = "https://health.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO  = "https://openidconnect.googleapis.com/v1/userinfo";

export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
];

/** How each data type is read — see health/lib/client.js for the same table. */
const INTERVAL_TYPES = ["steps", "distance", "floors", "totalCalories", "activeZoneMinutes"];

// ── Google OAuth ─────────────────────────────────────────────────────────────

export async function exchangeCode(env, code, redirectUri) {
  return tokenRequest({
    client_id:     env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type:    "authorization_code",
    redirect_uri:  redirectUri,
  });
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams(params),
  });

  const body = await res.json();
  if (!res.ok) throw new Error(`Google token request failed: ${JSON.stringify(body)}`);
  return body;
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}

export async function storeTokens(env, sub, tokens) {
  await env.HEALTH_KV.put(`google:${sub}`, JSON.stringify({
    refresh_token: tokens.refresh_token,
    access_token:  tokens.access_token,
    expires_at:    Date.now() + tokens.expires_in * 1000,
  }));
}

/** Returns a live access token for a user, refreshing it when it has aged out. */
async function accessTokenFor(env, sub) {
  const raw = await env.HEALTH_KV.get(`google:${sub}`);
  if (!raw) throw new Error("This account is not connected to Google Health. Re-authorize the connector.");

  const stored = JSON.parse(raw);
  if (Date.now() < stored.expires_at - 60_000) return stored.access_token;

  const refreshed = await tokenRequest({
    client_id:     env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: stored.refresh_token,
    grant_type:    "refresh_token",
  });

  // A refresh response omits the refresh token — keep the one we already have.
  await storeTokens(env, sub, { ...refreshed, refresh_token: stored.refresh_token });
  return refreshed.access_token;
}

// ── Health API ───────────────────────────────────────────────────────────────

async function apiRequest(env, sub, method, path, { query, body } = {}) {
  const token = await accessTokenFor(env, sub);
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      Accept:         "application/json",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

function civilDateTime(date, endOfDay) {
  const [year, month, day] = date.split("-").map(Number);
  return endOfDay
    ? { year, month, day, hours: 23, minutes: 59, seconds: 59 }
    : { year, month, day, hours: 0,  minutes: 0,  seconds: 0  };
}

/** Reads one data type over a date range, using whichever operation suits it. */
export async function readDataType(env, sub, dataType, from, to) {
  if (INTERVAL_TYPES.includes(dataType)) {
    const page = await apiRequest(env, sub, "POST",
      `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
        body: { interval: { startTime: civilDateTime(from, false), endTime: civilDateTime(to, true) } },
      });
    return page.dataPoints || [];
  }

  const points = [];
  let pageToken;
  do {
    const page = await apiRequest(env, sub, "GET", `/users/me/dataTypes/${dataType}/dataPoints`, {
      query: { startTime: `${from}T00:00:00Z`, endTime: `${to}T23:59:59Z`, pageSize: 200, pageToken },
    });
    points.push(...(page.dataPoints || []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return points;
}
