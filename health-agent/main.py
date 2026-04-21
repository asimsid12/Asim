from contextlib import asynccontextmanager

from fastapi import FastAPI, Form, Request
from fastapi.responses import Response
from twilio.twiml.messaging_response import MessagingResponse

import tools
from agent import run_agent
from database import init_db
from scheduler import start_scheduler

WORKOUT_TYPE_MAP = {
    "HKWorkoutActivityTypeRunning": "run",
    "HKWorkoutActivityTypeCycling": "cycling",
    "HKWorkoutActivityTypeWalking": "walk",
    "HKWorkoutActivityTypeTraditionalStrengthTraining": "gym",
    "HKWorkoutActivityTypeHiking": "hike",
    "HKWorkoutActivityTypeSoccer": "football",
    "HKWorkoutActivityTypeSwimming": "swim",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    scheduler = start_scheduler()
    yield
    scheduler.shutdown()


app = FastAPI(lifespan=lifespan)


def _normalize_history(history: list) -> list:
    """Ensure strictly alternating inbound/outbound for Claude's messages array."""
    if not history:
        return []
    normalized = [history[-1]]
    for entry in reversed(history[:-1]):
        if entry["direction"] != normalized[0]["direction"]:
            normalized.insert(0, entry)
    # Claude messages must start with user/inbound role
    while normalized and normalized[0]["direction"] == "outbound":
        normalized.pop(0)
    return normalized


@app.post("/webhook/whatsapp")
async def whatsapp_webhook(
    Body: str = Form(default=""),
    MediaUrl0: str = Form(default=None),
    NumMedia: str = Form(default="0"),
):
    has_image = int(NumMedia) > 0
    inbound_text = Body if Body else None

    raw_history = tools.get_recent_chat(n=6)
    chat_history = _normalize_history(raw_history)

    tools.save_chat_message(
        direction="inbound",
        content=inbound_text or "[image]",
        context_type=None,
    )

    reply = run_agent(
        trigger="whatsapp",
        message=inbound_text,
        image_url=MediaUrl0 if has_image else None,
        chat_history=chat_history,
    )

    tools.save_chat_message(
        direction="outbound",
        content=reply,
        context_type=None,
    )

    twiml = MessagingResponse()
    twiml.message(reply)
    return Response(content=str(twiml), media_type="application/xml")


@app.post("/webhook/apple-watch")
async def apple_watch_webhook(request: Request):
    data = await request.json()
    metrics = data.get("data", {}).get("metrics", [])
    logged = []

    for metric in metrics:
        if metric.get("name") == "active_energy":
            for entry in metric.get("data", []):
                qty = int(entry.get("qty", 0))
                if qty > 0:
                    tools.log_activity(calories_burned=qty, source="apple_watch")
                    logged.append({"type": "active_energy", "calories": qty})

        elif metric.get("name") == "workouts":
            for entry in metric.get("data", []):
                active_energy = int(entry.get("activeEnergy", 0))
                duration = int(entry.get("duration", 0))
                raw_type = entry.get("workoutActivityType", "")
                workout_type = WORKOUT_TYPE_MAP.get(
                    raw_type,
                    raw_type.replace("HKWorkoutActivityType", "").lower(),
                )
                if active_energy > 0:
                    tools.log_activity(
                        calories_burned=active_energy,
                        workout_type=workout_type,
                        duration_minutes=duration,
                        source="apple_watch",
                    )
                    logged.append({"type": workout_type, "calories": active_energy, "duration_min": duration})

    return {"status": "ok", "logged": logged}


@app.get("/health")
def health_check():
    return {"status": "ok"}
