---
name: health-coach
description: Analyze Asim's Google Health data (workouts, sleep, heart rate, steps) and meal photos to give training and diet guidance. Use when he shares a photo of food, asks about his workouts, training load, sleep, recovery, calories, protein, or what to eat or train next.
---

# Health Coach

Reads synced Google Health data plus a photo-based food log, and turns them into
concrete training and diet guidance.

## Where the data lives

| Path | What it holds |
|------|---------------|
| `health/data/latest.json` | Most recent sync — steps, sleep, exercise, heart rate, weight |
| `health/data/food-log.json` | Logged meals with estimated macros |
| `health/data/food-photos/` | The meal photos themselves |

All of it is gitignored. Never commit, paste, or send this data anywhere outside
the machine it lives on.

If `latest.json` is missing or its `syncedAt` is more than a couple of days old,
say so and suggest `cd health && npm run sync` rather than analyzing stale data.

Each data type in `latest.json` sits under `dataTypes`. Interval types (`steps`,
`distance`, `totalCalories`, `activeZoneMinutes`) arrive pre-aggregated as one
value per day. Sessions (`exercise`, `sleep`) arrive as individual events. The
`errors` object lists any type the sync could not read — check it before
concluding a metric is simply absent.

## Logging a meal photo

When Asim sends a photo of food:

1. Look at it and identify the dishes and rough portions. He is in Karachi, so
   expect desi food — roti, naan, daal, karahi, biryani, nihari, chai. Judge
   portions against the plate, not against US restaurant sizing.
2. Estimate calories and macros. Give a single number, not a range — a usable
   estimate beats a hedge. Note the one or two assumptions that move the number
   most (oil/ghee content and meat portion usually dominate in desi cooking).
3. Save the photo to `health/data/food-photos/YYYY-MM-DD-<meal>.jpg`.
4. Append the entry:

```bash
cd health && node cli.js food add '{
  "date": "2026-08-31",
  "meal": "lunch",
  "items": ["2 roti", "chicken karahi ~200g"],
  "calories": 720, "protein_g": 48, "carbs_g": 62, "fat_g": 29,
  "photo": "data/food-photos/2026-08-31-lunch.jpg",
  "assumptions": "moderate ghee; bone-in chicken"
}'
```

Then say what it means in context — how the day's protein and calories are
tracking, not just the numbers for that plate.

## Giving guidance

Ground every recommendation in what the data actually shows, and say which
number drove it. "Your resting HR is up 6 bpm over your two-week baseline and
you slept 5h20m — take today easy" is useful. "Make sure to rest and stay
hydrated" is not.

Worth checking before advising:

- **Training load** — frequency, duration and intensity of `exercise` sessions
  over the last 1–4 weeks. Flag a jump of more than ~30% week over week.
- **Recovery** — resting heart rate and HRV against their own trailing baseline,
  plus sleep duration and consistency. These override a planned hard session.
- **Protein** — the macro most often short. Compare against roughly 1.6–2.2 g
  per kg bodyweight if he is training for muscle.
- **Gaps** — an untrained movement pattern, no rest day in ten days, weekday
  meals logged but weekends missing.

Prefer the smallest change that addresses what you found. One or two specific
adjustments he will actually make beat a restructured week he will not.

## Limits

This is fitness guidance from consumer wearable data, not medical advice. Consumer
sleep staging and HRV are noisy — trust trends across weeks, not single nights.
If something in the data looks clinically concerning (a sustained resting heart
rate climb, an arrhythmia notification, oxygen saturation dropping overnight),
say plainly that it is worth a doctor's look rather than coaching around it.
