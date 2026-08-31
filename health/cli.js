#!/usr/bin/env node
/**
 * Google Health → local data, for Claude to analyze.
 *
 *   npm run auth              one-time browser consent
 *   npm run doctor            check credentials and probe every data type
 *   npm run sync              pull the last 30 days into health/data/
 *   node cli.js sync --days 90
 *   node cli.js food add '{"date":"2026-08-31","meal":"lunch",...}'
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs   = require("fs");
const path = require("path");

const { authorize, getAccessToken, readTokens, TOKEN_FILE } = require("./lib/oauth");
const { GoogleHealthClient, DATA_TYPES } = require("./lib/client");

const DATA_DIR  = path.join(__dirname, "data");
const FOOD_LOG  = path.join(DATA_DIR, "food-log.json");

// ── Dates ────────────────────────────────────────────────────────────────────

const isoDate = (d) => d.toISOString().slice(0, 10);

function dateRange(days) {
  const to   = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: isoDate(from), to: isoDate(to) };
}

// ── Commands ─────────────────────────────────────────────────────────────────

async function doctor() {
  const missing = ["GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET"]
    .filter((key) => !process.env[key]);

  console.log(missing.length
    ? `Credentials:   MISSING ${missing.join(", ")} — see health/README.md`
    : "Credentials:   found in .env");

  console.log(readTokens()
    ? `Tokens:        ${TOKEN_FILE}`
    : "Tokens:        none yet — run `npm run auth`");

  if (missing.length || !readTokens()) return;

  const client = new GoogleHealthClient(getAccessToken);

  try {
    const identity = await client.identity();
    console.log(`Identity:      OK ${JSON.stringify(identity)}`);
  } catch (err) {
    console.log(`Identity:      FAILED\n${err.message}`);
    return;
  }

  // Probe each type over a single day. A failure here names the exact field
  // the request got wrong, which is all you need to correct lib/client.js.
  const { from, to } = dateRange(2);
  console.log("\nProbing data types:");
  for (const dataType of Object.keys(DATA_TYPES)) {
    try {
      const points = await client.fetch(dataType, from, to);
      console.log(`  ${dataType.padEnd(26)} OK (${points.length} points)`);
    } catch (err) {
      console.log(`  ${dataType.padEnd(26)} FAILED — ${err.message.split("\n")[0]}`);
    }
  }
}

async function sync(days) {
  const { from, to } = dateRange(days);
  const client = new GoogleHealthClient(getAccessToken);

  // Fail fast on auth, so a bad token isn't reported as 13 empty data types.
  await getAccessToken();

  console.log(`Syncing ${from} → ${to} ...`);
  const data = { syncedAt: new Date().toISOString(), from, to, dataTypes: {}, errors: {} };

  for (const dataType of Object.keys(DATA_TYPES)) {
    try {
      const points = await client.fetch(dataType, from, to);
      data.dataTypes[dataType] = points;
      console.log(`  ${dataType.padEnd(26)} ${points.length} points`);
    } catch (err) {
      data.errors[dataType] = err.message;
      console.log(`  ${dataType.padEnd(26)} skipped — ${err.message.split("\n")[0]}`);
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `health-${to}.json`);
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(data, null, 2));

  console.log(`\nWrote ${outFile}`);
  console.log("Ask Claude: \"read health/data/latest.json and review my training week\"");
}

function foodAdd(json) {
  const entry = JSON.parse(json);
  if (!entry.date) throw new Error("Food entries need a `date` field (YYYY-MM-DD).");

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.existsSync(FOOD_LOG) ? JSON.parse(fs.readFileSync(FOOD_LOG, "utf8")) : [];

  log.push({ loggedAt: new Date().toISOString(), ...entry });
  log.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(FOOD_LOG, JSON.stringify(log, null, 2));

  console.log(`Logged ${entry.meal || "meal"} for ${entry.date} (${log.length} entries total).`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "auth":
      return authorize();
    case "doctor":
      return doctor();
    case "sync": {
      const flag = args.indexOf("--days");
      return sync(flag === -1 ? 30 : parseInt(args[flag + 1], 10));
    }
    case "food":
      if (args[0] !== "add") throw new Error("Usage: food add '<json>'");
      return foodAdd(args[1]);
    default:
      console.log("Usage: cli.js auth | doctor | sync [--days N] | food add '<json>'");
  }
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
