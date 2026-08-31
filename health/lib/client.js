/**
 * Google Health API v4 client (the API that replaced the Fitbit Web API).
 * Reference: https://developers.google.com/health/reference/rest/v4
 *
 * Every read endpoint returns the same envelope:
 *   { dataPoints: [...], nextPageToken?: "..." }
 */

const BASE_URL = "https://health.googleapis.com/v4";

/**
 * The data types we sync, and how each one is read.
 *   interval — a quantity accumulated over time; aggregated server-side per day.
 *   session  — a bounded event (a workout, a night's sleep); listed individually.
 *   daily    — already one value per day; listed as-is.
 * Full catalogue: https://developers.google.com/health/data-types
 */
const DATA_TYPES = {
  steps:                     "interval",
  distance:                  "interval",
  floors:                    "interval",
  totalCalories:             "interval",
  activeZoneMinutes:         "interval",
  exercise:                  "session",
  sleep:                     "session",
  dailyRestingHeartRate:     "daily",
  dailyHeartRateVariability: "daily",
  dailyHeartRateZones:       "daily",
  dailyOxygenSaturation:     "daily",
  weight:                    "daily",
  bodyFat:                   "daily",
};

/** Splits "YYYY-MM-DD" into the CivilDateTime shape the rollup endpoints take. */
function civilDateTime(date, endOfDay) {
  const [year, month, day] = date.split("-").map(Number);
  return endOfDay
    ? { year, month, day, hours: 23, minutes: 59, seconds: 59 }
    : { year, month, day, hours: 0,  minutes: 0,  seconds: 0  };
}

class GoogleHealthClient {
  constructor(getAccessToken) {
    this.getAccessToken = getAccessToken;
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────

  async request(method, path, { query, body } = {}) {
    const token = await this.getAccessToken();
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
    if (!res.ok) {
      // Google returns a field-level explanation here — surface it verbatim.
      throw new Error(`${method} ${path} failed: ${res.status}\n${text}`);
    }
    return text ? JSON.parse(text) : {};
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  /** Who the access token belongs to — the cheapest call to prove auth works. */
  identity() {
    return this.request("GET", "/users/me/identity");
  }

  /** Raw data points for a type, following pagination to the end. */
  async list(dataType, from, to) {
    const points = [];
    let pageToken;

    do {
      const page = await this.request("GET", `/users/me/dataTypes/${dataType}/dataPoints`, {
        query: {
          startTime: `${from}T00:00:00Z`,
          endTime:   `${to}T23:59:59Z`,
          pageSize:  200,
          pageToken,
        },
      });
      points.push(...(page.dataPoints || []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    return points;
  }

  /** One aggregated value per day, computed server-side. */
  async dailyRollUp(dataType, from, to) {
    const page = await this.request("POST", `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`, {
      body: {
        interval: {
          startTime: civilDateTime(from, false),
          endTime:   civilDateTime(to, true),
        },
      },
    });
    return page.dataPoints || [];
  }

  /** Reads one data type using whichever operation suits its shape. */
  fetch(dataType, from, to) {
    return DATA_TYPES[dataType] === "interval"
      ? this.dailyRollUp(dataType, from, to)
      : this.list(dataType, from, to);
  }
}

module.exports = { GoogleHealthClient, DATA_TYPES, BASE_URL };
