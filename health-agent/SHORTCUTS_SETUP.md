# Apple Shortcuts Setup — Apple Watch Active Calories

## Create the Shortcut (2 minutes)

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** → name it "Log Calories"
3. Add these 3 actions:

**Action 1 — Get active calories:**
- Search for and add: `Find Health Samples Where`
- Tap "Health Category" → select **Active Energy**
- Tap "in the last" → change to **today**

**Action 2 — Sum them up:**
- Search for and add: `Calculate Statistics on Health Samples`
- Statistic: **Sum**

**Action 3 — POST to your server:**
- Search for and add: `Get Contents of URL`
- URL: `https://YOUR-NGROK-OR-SERVER-URL/webhook/apple-watch`
- Tap "Show More"
- Method: **POST**
- Request Body: **JSON**
- Tap "Add new field" → Key: `data`, Value: tap the variable icon and paste this:

```
{"metrics":[{"name":"active_energy","data":[{"qty": CALCULATED_RESULT}]}]}
```

Replace `CALCULATED_RESULT` with the magic variable output from Action 2 (tap the variable icon and select "Calculation Result").

---

## Automate It

1. Go to **Automation** tab → tap **+**
2. Select **Time of Day** → set to **9:00 PM**
3. Action: **Run Shortcut** → "Log Calories"
4. Toggle off **Ask Before Running**

That's it. Every evening at 9pm your active calories automatically get sent to the server, which adjusts your calorie target for the day.

---

## Test It

Run the shortcut manually once (tap the play button). Check your server terminal — you should see:

```json
{"status": "ok", "logged": [{"type": "active_energy", "calories": 350}]}
```
