from datetime import datetime, date, timedelta
from database import get_conn

RESTING_TDEE = 1850


def read_health_logs(date_str: str = "today", days_back: int = 1) -> dict:
    target = date.today() if date_str == "today" else date.fromisoformat(date_str)
    start = target - timedelta(days=days_back - 1)

    with get_conn() as conn:
        meals = conn.execute(
            "SELECT * FROM meals WHERE date(timestamp) >= ? AND date(timestamp) <= ? ORDER BY timestamp",
            (start.isoformat(), target.isoformat()),
        ).fetchall()

        weights = conn.execute(
            "SELECT * FROM weight_logs WHERE date(timestamp) >= ? AND date(timestamp) <= ? ORDER BY timestamp",
            (start.isoformat(), target.isoformat()),
        ).fetchall()

        activities = conn.execute(
            "SELECT * FROM activity_logs WHERE date(timestamp) >= ? AND date(timestamp) <= ? ORDER BY timestamp",
            (start.isoformat(), target.isoformat()),
        ).fetchall()

    return {
        "meals": [dict(m) for m in meals],
        "weight_logs": [dict(w) for w in weights],
        "activity_logs": [dict(a) for a in activities],
        "date_range": {"from": start.isoformat(), "to": target.isoformat()},
    }


def log_meal(description: str, calories: int, meal_type: str = "meal") -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO meals (timestamp, description, calories, meal_type) VALUES (?, ?, ?, ?)",
            (datetime.now().isoformat(), description, calories, meal_type),
        )
    return {"status": "logged", "description": description, "calories": calories}


def log_weight(weight_kg: float) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO weight_logs (timestamp, weight_kg) VALUES (?, ?)",
            (datetime.now().isoformat(), weight_kg),
        )
    return {"status": "logged", "weight_kg": weight_kg}


def log_activity(
    calories_burned: int,
    workout_type: str = None,
    duration_minutes: int = None,
    source: str = "apple_watch",
) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO activity_logs (timestamp, calories_burned, workout_type, duration_minutes, source) VALUES (?, ?, ?, ?, ?)",
            (datetime.now().isoformat(), calories_burned, workout_type, duration_minutes, source),
        )
    return {"status": "logged", "calories_burned": calories_burned}


def calculate_daily_summary(date_str: str = "today") -> dict:
    logs = read_health_logs(date_str, 1)

    total_intake = sum(m["calories"] for m in logs["meals"])
    active_calories = sum(a["calories_burned"] for a in logs["activity_logs"])

    if not logs["activity_logs"]:
        total_burned = RESTING_TDEE
        activity_note = "No Apple Watch data — using resting TDEE (1,850 kcal)"
    else:
        total_burned = RESTING_TDEE + active_calories
        activity_note = f"{len(logs['activity_logs'])} session(s), {active_calories} active kcal"

    latest_weight = logs["weight_logs"][-1]["weight_kg"] if logs["weight_logs"] else None

    return {
        "date": date_str,
        "total_intake_kcal": total_intake,
        "total_burned_kcal": total_burned,
        "net_kcal": total_intake - total_burned,
        "meals_logged": len(logs["meals"]),
        "latest_weight_kg": latest_weight,
        "activity_note": activity_note,
    }


def get_weight_trend(days: int = 7) -> dict:
    logs = read_health_logs("today", days)
    weights = logs["weight_logs"]

    if len(weights) < 2:
        return {"trend": "insufficient data", "readings": weights}

    first = weights[0]["weight_kg"]
    last = weights[-1]["weight_kg"]

    return {
        "days": days,
        "start_weight_kg": first,
        "current_weight_kg": last,
        "change_kg": round(last - first, 2),
        "readings": weights,
    }
