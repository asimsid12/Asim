from datetime import datetime, date, timedelta

import database
from database import get_conn

HEIGHT_CM = 183.0
AGE = 36
DEFICIT_KCAL = 440
MAX_ADJ = 300
MIN_ADJ = -400
MAX_CARRY = 300
MIN_CARRY = -300


def _bmr(weight_kg: float) -> float:
    return (10 * weight_kg) + (6.25 * HEIGHT_CM) - (5 * AGE) + 5


def _tdee(weight_kg: float, active_kcal: int = 0) -> int:
    return round(_bmr(weight_kg) * 1.375) + active_kcal


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
    goal = database.get_or_create_goal()

    latest_weight = logs["weight_logs"][-1]["weight_kg"] if logs["weight_logs"] else 82.0
    active_kcal = sum(a["calories_burned"] for a in logs["activity_logs"])

    tdee = _tdee(latest_weight, active_kcal)
    calorie_target = tdee - DEFICIT_KCAL + goal["daily_calorie_adjustment"] + goal["carry_over_kcal"]
    total_intake = sum(m["calories"] for m in logs["meals"])

    activity_note = (
        f"{len(logs['activity_logs'])} session(s), {active_kcal} active kcal"
        if logs["activity_logs"]
        else "No Apple Watch data — sedentary TDEE used"
    )

    return {
        "date": date_str,
        "total_intake_kcal": total_intake,
        "calorie_target_kcal": calorie_target,
        "remaining_kcal": calorie_target - total_intake,
        "tdee_kcal": tdee,
        "net_kcal": total_intake - tdee,
        "meals_logged": len(logs["meals"]),
        "active_kcal_burned": active_kcal,
        "latest_weight_kg": latest_weight,
        "protein_target_g": goal["protein_target_g"],
        "carry_over_kcal": goal["carry_over_kcal"],
        "activity_note": activity_note,
    }


def calculate_calorie_target(date_str: str = "today") -> dict:
    s = calculate_daily_summary(date_str)
    return {
        "calorie_target_kcal": s["calorie_target_kcal"],
        "consumed_kcal": s["total_intake_kcal"],
        "remaining_kcal": s["remaining_kcal"],
        "tdee_kcal": s["tdee_kcal"],
        "active_kcal_today": s["active_kcal_burned"],
        "carry_over_kcal": s["carry_over_kcal"],
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


def get_goal_progress() -> dict:
    goal = database.get_or_create_goal()
    trend = get_weight_trend(days=7)
    current_weight = trend.get("current_weight_kg") or 82.0
    kg_to_go = round(current_weight - goal["target_weight_kg"], 2)
    weeks_remaining = round(kg_to_go / 0.4, 1) if kg_to_go > 0 else 0

    return {
        "current_weight_kg": current_weight,
        "target_weight_kg": goal["target_weight_kg"],
        "kg_to_go": kg_to_go,
        "estimated_weeks_remaining": weeks_remaining,
        "daily_calorie_adjustment": goal["daily_calorie_adjustment"],
        "carry_over_kcal": goal["carry_over_kcal"],
        "protein_target_g": goal["protein_target_g"],
    }


def save_chat_message(direction: str, content: str, context_type: str = None) -> dict:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO chat_history (timestamp, direction, content, context_type) VALUES (?, ?, ?, ?)",
            (datetime.now().isoformat(), direction, content, context_type),
        )
    return {"status": "saved"}


def get_recent_chat(n: int = 10) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT timestamp, direction, content, context_type FROM chat_history ORDER BY id DESC LIMIT ?",
            (n,),
        ).fetchall()
    return [dict(r) for r in reversed(rows)]


def close_day(date_str: str = "today") -> dict:
    s = calculate_daily_summary(date_str)
    target_date = date.today() if date_str == "today" else date.fromisoformat(date_str)

    surplus = s["calorie_target_kcal"] - s["total_intake_kcal"]
    carry = max(MIN_CARRY, min(MAX_CARRY, surplus))

    weight = s["latest_weight_kg"] if s["latest_weight_kg"] != 82.0 else None

    with get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO daily_logs
               (date, target_kcal, consumed_kcal, surplus_kcal, carry_kcal, weight_kg)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (target_date.isoformat(), s["calorie_target_kcal"], s["total_intake_kcal"], surplus, carry, weight),
        )
        conn.execute(
            "UPDATE goals SET carry_over_kcal = ?, updated_at = ? WHERE id = 1",
            (carry, datetime.now().isoformat()),
        )

    return {
        "date": target_date.isoformat(),
        "target_kcal": s["calorie_target_kcal"],
        "consumed_kcal": s["total_intake_kcal"],
        "surplus_kcal": surplus,
        "carry_to_tomorrow_kcal": carry,
    }


def get_weekly_calorie_log(weeks_back: int = 0) -> dict:
    today = date.today()
    monday = today - timedelta(days=today.weekday()) - timedelta(weeks=weeks_back)
    sunday = monday + timedelta(days=6)

    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date",
            (monday.isoformat(), sunday.isoformat()),
        ).fetchall()

    days = [dict(r) for r in rows]
    total_target = sum(d["target_kcal"] for d in days)
    total_consumed = sum(d["consumed_kcal"] for d in days)
    total_surplus = sum(d["surplus_kcal"] for d in days)

    return {
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "days": days,
        "totals": {
            "target_kcal": total_target,
            "consumed_kcal": total_consumed,
            "net_surplus_kcal": total_surplus,
            "days_logged": len(days),
        },
    }


def schedule_followup_reminder(meal_type: str, minutes: int = 60) -> dict:
    from scheduler import get_scheduler

    run_time = datetime.now() + timedelta(minutes=minutes)
    job_id = f"followup_{meal_type}_{run_time.strftime('%H%M')}"

    def _fire():
        from agent import run_agent
        run_agent(trigger=f"followup_{meal_type}")

    get_scheduler().add_job(
        _fire,
        "date",
        run_date=run_time,
        id=job_id,
        replace_existing=True,
    )
    return {"status": "scheduled", "meal_type": meal_type, "run_at": run_time.isoformat()}


def do_weekly_calorie_adjustment() -> dict:
    trend = get_weight_trend(days=7)
    if trend.get("trend") == "insufficient data":
        return {"status": "skipped", "reason": "insufficient data"}

    lost = -(trend["change_kg"])
    goal = database.get_or_create_goal()
    current_adj = goal["daily_calorie_adjustment"]

    if lost > 0.6:
        new_adj = current_adj + 100
        note = f"Lost {lost:.2f}kg this week (too fast). Adding 100 kcal/day."
    elif lost < 0.2:
        new_adj = current_adj - 100
        note = f"Lost {lost:.2f}kg this week (too slow). Reducing 100 kcal/day."
    else:
        new_adj = current_adj
        note = f"Lost {lost:.2f}kg this week. On track."

    new_adj = max(MIN_ADJ, min(MAX_ADJ, new_adj))

    with get_conn() as conn:
        conn.execute(
            "UPDATE goals SET daily_calorie_adjustment = ?, updated_at = ? WHERE id = 1",
            (new_adj, datetime.now().isoformat()),
        )
    return {"status": "adjusted", "new_adjustment_kcal": new_adj, "note": note}
