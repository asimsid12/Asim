import sqlite3
from contextlib import contextmanager

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
        """)


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
