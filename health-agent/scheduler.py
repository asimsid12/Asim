from apscheduler.schedulers.background import BackgroundScheduler
from agent import run_agent


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler()

    # 8am daily — weight reminder if not logged
    scheduler.add_job(
        lambda: run_agent("schedule_morning"),
        "cron",
        hour=8,
        minute=0,
    )

    # 1pm daily — lunch check-in if not logged
    scheduler.add_job(
        lambda: run_agent("schedule_lunch"),
        "cron",
        hour=13,
        minute=0,
    )

    # 8pm daily — full daily summary
    scheduler.add_job(
        lambda: run_agent("schedule_evening"),
        "cron",
        hour=20,
        minute=0,
    )

    # Sunday 7pm — weekly summary with weight trend
    scheduler.add_job(
        lambda: run_agent("schedule_weekly"),
        "cron",
        day_of_week="sun",
        hour=19,
        minute=0,
    )

    scheduler.start()
    return scheduler
