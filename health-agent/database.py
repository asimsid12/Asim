import sqlite3
from contextlib import contextmanager
from datetime import datetime

DB_PATH = "health.db"


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS meals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                description TEXT NOT NULL,
                calories INTEGER NOT NULL,
                meal_type TEXT DEFAULT 'meal'
            );

            CREATE TABLE IF NOT EXISTS weight_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                weight_kg REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                calories_burned INTEGER NOT NULL,
                workout_type TEXT,
                duration_minutes INTEGER,
                source TEXT DEFAULT 'apple_watch'
            );

            CREATE TABLE IF NOT EXISTS chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                direction TEXT NOT NULL,
                content TEXT NOT NULL,
                context_type TEXT
            );

            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY,
                target_weight_kg REAL NOT NULL DEFAULT 78.0,
                height_cm REAL NOT NULL DEFAULT 183.0,
                age INTEGER NOT NULL DEFAULT 36,
                protein_target_g INTEGER NOT NULL DEFAULT 170,
                daily_calorie_adjustment INTEGER NOT NULL DEFAULT 0,
                carry_over_kcal INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS daily_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL UNIQUE,
                target_kcal INTEGER NOT NULL,
                consumed_kcal INTEGER NOT NULL,
                surplus_kcal INTEGER NOT NULL,
                carry_kcal INTEGER NOT NULL,
                weight_kg REAL
            );
        """)
        conn.execute(
            """INSERT OR IGNORE INTO goals
               (id, target_weight_kg, height_cm, age, protein_target_g,
                daily_calorie_adjustment, carry_over_kcal, created_at, updated_at)
               VALUES (1, 78.0, 183.0, 36, 170, 0, 0, ?, ?)""",
            (datetime.now().isoformat(), datetime.now().isoformat()),
        )


def get_or_create_goal() -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM goals WHERE id = 1").fetchone()
    return dict(row)


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
