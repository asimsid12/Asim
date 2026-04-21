# Apple Shortcuts Setup — Apple Watch Data

This replaces Health Auto Export. The iOS Shortcut reads HealthKit data and
POSTs it to your server in the same JSON format the webhook expects.

## Create the Shortcut

1. Open the **Shortcuts** app on your iPhone
2. Tap **+** to create a new shortcut, name it "Log Health Data"

### Actions to add (in order):

**Action 1 — Get today's active energy:**
- Add action: `Find Health Samples Where`
- Type: `Active Energy`
- Time: `is today`

**Action 2 — Get total:**
- Add action: `Calculate Statistics on [Health Samples]`
- Statistic: `Sum`
- This gives you a single number (total active kcal for today)

**Action 3 — Get today's workouts:**
- Add action: `Find Health Samples Where`
- Type: `Workouts`
- Time: `is today`

**Action 4 — POST to your server:**
- Add action: `Get Contents of URL`
- URL: `https://YOUR-SERVER-URL/webhook/apple-watch`
- Method: `POST`
- Request Body: `JSON`
- Add key: `data`
- Value (JSON):
```json
{
  "metrics": [
    {
      "name": "active_energy",
      "data": [{ "qty": [result from Action 2], "date": "[current date]" }]
    }
  ]
}
```

> **Note:** For workout type/duration detail, the free Shortcuts app is limited.
> The server will still log active calories correctly. Workout type is optional.

## Automate It

1. Go to the **Automation** tab in Shortcuts
2. Tap **+** → **Time of Day**
3. Set time: **9:00 PM** (runs after your day is mostly done)
4. Action: **Run Shortcut** → select "Log Health Data"
5. Turn off "Ask Before Running"

You can also add a second automation triggered **after a workout** for real-time logging.

## Test It

Run the shortcut manually once. You should see your server log:
```
{"status": "ok", "logged": [{"type": "active_energy", "calories": 350}]}
```

If your server isn't running yet, you'll get a connection error — that's expected.
Start the server first (`uvicorn main:app --port 8000`) and use ngrok to expose it.
