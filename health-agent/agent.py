import base64
from datetime import datetime

import anthropic
import httpx

import config
import tools as tool_fns
import whatsapp

TOOLS = [
    {
        "name": "read_health_logs",
        "description": "Read the user's health logs (meals, weight, activity) for a date or date range.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_str": {"type": "string", "description": "Date as YYYY-MM-DD or 'today'"},
                "days_back": {"type": "integer", "description": "How many days back to include (default 1)"},
            },
        },
    },
    {
        "name": "log_meal",
        "description": "Log a meal the user has eaten.",
        "input_schema": {
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "What was eaten"},
                "calories": {"type": "integer", "description": "Estimated calories"},
                "meal_type": {
                    "type": "string",
                    "enum": ["breakfast", "lunch", "dinner", "snack"],
                    "description": "Type of meal",
                },
            },
            "required": ["description", "calories"],
        },
    },
    {
        "name": "log_weight",
        "description": "Log the user's weight reading.",
        "input_schema": {
            "type": "object",
            "properties": {
                "weight_kg": {"type": "number", "description": "Weight in kg"},
            },
            "required": ["weight_kg"],
        },
    },
    {
        "name": "log_activity",
        "description": "Log an activity or workout from Apple Watch or manual entry.",
        "input_schema": {
            "type": "object",
            "properties": {
                "calories_burned": {"type": "integer", "description": "Active calories burned"},
                "workout_type": {"type": "string", "description": "e.g. 'run', 'gym', 'walk'"},
                "duration_minutes": {"type": "integer", "description": "Duration in minutes"},
                "source": {
                    "type": "string",
                    "enum": ["apple_watch", "manual"],
                    "description": "Data source",
                },
            },
            "required": ["calories_burned"],
        },
    },
    {
        "name": "calculate_daily_summary",
        "description": "Calculate and return a full daily summary including net calories.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_str": {"type": "string", "description": "Date as YYYY-MM-DD or 'today'"},
            },
        },
    },
    {
        "name": "calculate_calorie_target",
        "description": "Get today's calorie budget status: target, consumed so far, and remaining.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_str": {"type": "string", "description": "Date as YYYY-MM-DD or 'today'"},
            },
        },
    },
    {
        "name": "get_weight_trend",
        "description": "Get weight trend over a number of days.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of days to analyze (default 7)"},
            },
        },
    },
    {
        "name": "get_goal_progress",
        "description": "Get overall progress toward the 78kg goal: kg to go, estimated weeks remaining.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_weekly_calorie_log",
        "description": "Get the day-by-day calorie log for a week (target vs consumed vs carry-over).",
        "input_schema": {
            "type": "object",
            "properties": {
                "weeks_back": {"type": "integer", "description": "0 = current week, 1 = last week"},
            },
        },
    },
    {
        "name": "close_day",
        "description": "Close out a day: compute surplus/deficit, write daily_logs, set tomorrow's carry-over. Call this if user asks about closing the day manually.",
        "input_schema": {
            "type": "object",
            "properties": {
                "date_str": {"type": "string", "description": "Date as YYYY-MM-DD or 'today'"},
            },
        },
    },
    {
        "name": "save_chat_message",
        "description": "Save a message to chat history with an optional context_type label.",
        "input_schema": {
            "type": "object",
            "properties": {
                "direction": {"type": "string", "enum": ["inbound", "outbound"]},
                "content": {"type": "string"},
                "context_type": {
                    "type": "string",
                    "description": "e.g. morning_weight, breakfast_check, lunch_check, snack_check, dinner_check, workout_check",
                },
            },
            "required": ["direction", "content"],
        },
    },
    {
        "name": "get_recent_chat",
        "description": "Get recent chat history to understand conversation context.",
        "input_schema": {
            "type": "object",
            "properties": {
                "n": {"type": "integer", "description": "Number of recent messages (default 10)"},
            },
        },
    },
    {
        "name": "schedule_followup_reminder",
        "description": "Schedule a one-time follow-up reminder for a meal check-in N minutes from now.",
        "input_schema": {
            "type": "object",
            "properties": {
                "meal_type": {
                    "type": "string",
                    "enum": ["breakfast", "lunch", "dinner", "snack"],
                },
                "minutes": {"type": "integer", "description": "Minutes from now (default 60)"},
            },
            "required": ["meal_type"],
        },
    },
    {
        "name": "send_whatsapp",
        "description": "Send a WhatsApp message to the user.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Message text to send"},
            },
            "required": ["message"],
        },
    },
]

TOOL_MAP = {
    "read_health_logs": tool_fns.read_health_logs,
    "log_meal": tool_fns.log_meal,
    "log_weight": tool_fns.log_weight,
    "log_activity": tool_fns.log_activity,
    "calculate_daily_summary": tool_fns.calculate_daily_summary,
    "calculate_calorie_target": tool_fns.calculate_calorie_target,
    "get_weight_trend": tool_fns.get_weight_trend,
    "get_goal_progress": tool_fns.get_goal_progress,
    "get_weekly_calorie_log": tool_fns.get_weekly_calorie_log,
    "close_day": tool_fns.close_day,
    "save_chat_message": tool_fns.save_chat_message,
    "get_recent_chat": tool_fns.get_recent_chat,
    "schedule_followup_reminder": tool_fns.schedule_followup_reminder,
    "send_whatsapp": whatsapp.send_message,
}

SYSTEM_PROMPT = """You are a proactive personal health tracking agent for Asim.

## Profile
Age: 36, Height: 183cm, Current weight: ~82kg, Male
Goal: Reach 78kg with visible abs (six-pack) within 10-12 weeks
Strategy: 440 kcal/day deficit from TDEE, 160-180g protein/day

## Calorie math
- TDEE = Mifflin-St Jeor BMR × 1.375 + today's active calories from Apple Watch
- Daily calorie target = TDEE − 440 + weekly_adjustment + carry_over from yesterday
- At 82kg with no activity: target ≈ 2,010 kcal
- Target rises if Apple Watch logs active calories — exercising earns back calories
- Yesterday's surplus (capped ±300 kcal) carries into today's target automatically

## After every food or weight log
Always call calculate_calorie_target then reply with ALL of the following:
1. What was logged (name + kcal)
2. Total consumed today vs daily target
3. Remaining kcal for the day
4. Next-meal split: divide remaining kcal across meals still to come. Examples:
   - Only dinner left: "Keep dinner under X kcal"
   - Snacks + dinner left: "~Y kcal for snacks, ~Z kcal for dinner"
   - All meals done: "You're done for today — great job" or "You're Xkcal over, offset with a lighter tomorrow"

## Carry-over
- At 11:59pm the system automatically closes the day and carries your surplus/deficit (±300 kcal max) into tomorrow's target
- If you under-ate by 400 kcal → tomorrow gets +300 kcal bonus
- If you over-ate by 200 kcal → tomorrow loses 200 kcal
- Always mention the carry-over in the evening summary so the user knows what tomorrow looks like

## Handling ambiguous user replies (1/2/3, "later", "yes", "no")
Always call get_recent_chat(6) first. Find the context_type of the last outbound message.
Context types: morning_weight | breakfast_check | lunch_check | snack_check | dinner_check | workout_check

For meal checks (breakfast_check, lunch_check, dinner_check, followup_*):
- Reply "1" / "won't eat" / "skip" → log 0-calorie entry: description="skipped [meal]", meal_type=[meal], show updated budget
- Reply "2" / "later" / "will eat later" → call schedule_followup_reminder(meal_type, 60), reply "Got it — I'll check back in an hour"
- Reply "3" / "sending" / sends a photo → analyze and log the meal, show full calorie breakdown

## Scheduled trigger instructions
When trigger starts with "schedule_" or "followup_", MUST call send_whatsapp to deliver the message.

**schedule_morning_weight** (8:00am):
Send: "Good morning! Send me a photo of your weight scale."
Save outbound with context_type="morning_weight"

**schedule_breakfast_check** (10:00am):
Check if any breakfast logged today — if yes, do nothing.
Otherwise send:
"Did you have breakfast?
1) Skip — won't eat
2) Will eat later (I'll remind you)
3) Sending photo now"
Save outbound with context_type="breakfast_check"

**schedule_lunch_check** (1:30pm):
Same 3-option pattern. Save with context_type="lunch_check"

**schedule_snack_check** (5:00pm):
Send: "Any coffee or snacks today? Send photos or describe them and I'll log them."
Save with context_type="snack_check"

**schedule_dinner_check** (8:30pm):
Same 3-option pattern. Save with context_type="dinner_check"

**schedule_workout_check** (10:00pm):
Check today's activity_logs — if any exist, do nothing.
Otherwise send: "Did you work out today? If yes, tell me what you did and roughly how long."
Save with context_type="workout_check"

**schedule_weekly** (Sunday 7pm):
Call get_weight_trend(7), get_goal_progress(), get_weekly_calorie_log(0).
Send a weekly summary covering: weight change, goal ETA, day-by-day calorie adherence, whether target was adjusted.

**followup_breakfast / followup_lunch / followup_dinner** (one-time):
Re-send the 3-option check-in for the relevant meal. Save with appropriate context_type.

## Rules
- Be brief and direct. No filler.
- Always confirm logged values with exact numbers.
- If calorie estimate is uncertain, give a range and state your assumption.
- Do not send a proactive message if the relevant data is already logged.
- Current time: {current_time}"""


def _execute_tool(name: str, inputs: dict) -> str:
    fn = TOOL_MAP.get(name)
    if not fn:
        return f"Unknown tool: {name}"
    try:
        return str(fn(**inputs))
    except Exception as e:
        return f"Tool error: {e}"


def run_agent(
    trigger: str,
    message: str = None,
    image_url: str = None,
    chat_history: list = None,
) -> str:
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    content = []

    if image_url:
        response = httpx.get(image_url, auth=(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN))
        image_bytes = response.content
        media_type = response.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if media_type not in ("image/jpeg", "image/png", "image/gif", "image/webp"):
            media_type = "image/jpeg"
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.standard_b64encode(image_bytes).decode(),
                },
            }
        )
        if not message:
            content.append(
                {"type": "text", "text": "Analyze this image and take the appropriate action (log meal or weight)."}
            )

    if message:
        content.append({"type": "text", "text": message})

    if not content:
        content.append(
            {
                "type": "text",
                "text": f"Trigger: {trigger}. Current time: {datetime.now().strftime('%A %I:%M %p')}. Follow the scheduled trigger instructions for this trigger.",
            }
        )

    messages = []
    if chat_history:
        for entry in chat_history:
            role = "user" if entry["direction"] == "inbound" else "assistant"
            messages.append({"role": role, "content": entry["content"]})

    messages.append({"role": "user", "content": content})

    while True:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT.format(
                current_time=datetime.now().strftime("%A %B %d %Y %I:%M %p")
            ),
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "end_turn":
            return " ".join(
                block.text for block in response.content if hasattr(block, "text")
            )

        if response.stop_reason == "tool_use":
            tool_results = [
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": _execute_tool(block.name, block.input),
                }
                for block in response.content
                if block.type == "tool_use"
            ]
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
