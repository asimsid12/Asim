require("dotenv").config({ path: require("path").join(__dirname, "whatsapp-bot", ".env") });

const key    = process.env.SPLENDID_API_KEY;
const secret = process.env.SPLENDID_API_SECRET;
const appId  = process.env.SPLENDID_APP_ID;
const tenant = process.env.SPLENDID_TENANT;
const branch = process.env.SPLENDID_BRANCH_ID;

console.log("Tenant :", tenant);
console.log("Branch :", branch);
console.log("App ID :", appId || "(not set)");
console.log("Key    :", key ? key.slice(0, 8) + "…" : "MISSING");
console.log();

const headers = {
  "X-Api-Key":    key,
  "X-Api-Secret": secret,
  "Accept":       "application/json",
};
if (appId) headers["X-App-Id"] = appId;

async function test(label, url, method = "GET", body) {
  console.log(`Testing ${label} …`);
  try {
    const res = await fetch(url, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
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
  const base = `https://app.splendidaccounts.com/api`;

  // 1. Simple GET — does auth work at all?
  await test("GET /Companies", `${base}/Companies`);

  // 2. GET customers list
  await test(
    `GET /${tenant}/${branch}/Customers`,
    `${base}/${tenant}/${branch}/Customers?page=1&pageSize=1`
  );

  // 3. POST customer search
  await test(
    `POST /${tenant}/${branch}/Customers/Search`,
    `${base}/${tenant}/${branch}/Customers/Search`,
    "POST",
    { name: { name: "test", exactMatch: false } }
  );
})();
