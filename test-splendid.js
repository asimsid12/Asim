const fs   = require("fs");
const path = require("path");
const envFile = path.join(__dirname, "whatsapp-bot", ".env");
fs.readFileSync(envFile, "utf8").split("\n").forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return;
  const k = trimmed.slice(0, eq).trim();
  const v = trimmed.slice(eq + 1).trim();
  if (k) process.env[k] = v;
});

const key    = process.env.SPLENDID_API_KEY;
const secret = process.env.SPLENDID_API_SECRET;
const appId0 = process.env.SPLENDID_APP_ID;
const tenant = process.env.SPLENDID_TENANT;
const branch = process.env.SPLENDID_BRANCH_ID;

console.log("Tenant :", tenant);
console.log("Branch :", branch);
console.log("App ID :", appId0 || "(not set)");
console.log("Key    :", key ? key.slice(0, 8) + "…" : "MISSING");
console.log();

async function test(label, url, method = "GET", body, extraHeaders = {}) {
  const headers = {
    "X-Api-Key":    key,
    "X-Api-Secret": secret,
    "Content-Type": "application/json",
    "Accept":       "application/json",
    ...extraHeaders,
  };
  console.log(`Testing ${label} …`);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    console.log(`  Status : ${res.status}`);
    console.log(`  Body   : ${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`  ERROR  : ${e.message}`);
  }
  console.log();
}

(async () => {
  const base    = `https://app.splendidaccounts.com/api`;
  const appId   = appId0 ? { "X-App-Id": appId0 } : {};

  await test("GET /Companies",                    `${base}/Companies`,                                              "GET",  null, appId);
  await test(`GET /${tenant}/warehouses`,          `${base}/${tenant}/warehouses`,                                   "GET",  null, appId);
  await test(`GET /${tenant}/${branch}/Customers`, `${base}/${tenant}/${branch}/Customers?page=1&pageSize=1`,        "GET",  null, appId);
  await test(`POST Customers/Search`,              `${base}/${tenant}/${branch}/Customers/Search`,                   "POST", { name: { name: "test", exactMatch: false } }, appId);

  // Product endpoint tests
  await test(`GET BySKUOrName full variant name`,  `${base}/${tenant}/${branch}/Products/BySKUOrName?name=${encodeURIComponent("Masti Shirt | M | Pink")}`, "GET", null, appId);
  await test(`GET BySKUOrName partial name`,       `${base}/${tenant}/${branch}/Products/BySKUOrName?name=${encodeURIComponent("Masti Shirt")}`, "GET", null, appId);
  await test(`GET Products BySKU MST-PNK-M`,       `${base}/${tenant}/${branch}/Products/BySKU?sku=MST-PNK-M`,     "GET",  null, appId);
})();
