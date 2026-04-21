from apscheduler.schedulers.background import BackgroundScheduler

_scheduler: BackgroundScheduler = None


def get_scheduler() -> BackgroundScheduler:
    return _scheduler


def start_scheduler() -> BackgroundScheduler:
    global _scheduler
    _scheduler = BackgroundScheduler()

    # 8:00am — weight photo prompt
    _scheduler.add_job(lambda: _run("schedule_morning_weight"), "cron", hour=8, minute=0)

    # 10:00am — breakfast check
    _scheduler.add_job(lambda: _run("schedule_breakfast_check"), "cron", hour=10, minute=0)

    # 1:30pm — lunch check
    _scheduler.add_job(lambda: _run("schedule_lunch_check"), "cron", hour=13, minute=30)

    # 5:00pm — snack/coffee check
    _scheduler.add_job(lambda: _run("schedule_snack_check"), "cron", hour=17, minute=0)

    # 8:30pm — dinner check
    _scheduler.add_job(lambda: _run("schedule_dinner_check"), "cron", hour=20, minute=30)

    # 10:00pm — workout check (agent decides if needed)
    _scheduler.add_job(lambda: _run("schedule_workout_check"), "cron", hour=22, minute=0)

    # 11:59pm — close out the day, compute surplus, set tomorrow's carry-over
    _scheduler.add_job(lambda: _close_day(), "cron", hour=23, minute=59)

    # Sunday 7pm — weekly summary + calorie adjustment
    _scheduler.add_job(lambda: _weekly(), "cron", day_of_week="sun", hour=19, minute=0)

    _scheduler.start()
    return _scheduler


def _run(trigger: str):
    from agent import run_agent
    run_agent(trigger=trigger)


def _close_day():
    from tools import close_day
    close_day("today")


def _weekly():
    from tools import do_weekly_calorie_adjustment
    from agent import run_agent
    do_weekly_calorie_adjustment()
    run_agent(trigger="schedule_weekly")
