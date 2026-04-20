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
    "get_weight_trend": tool_fns.get_weight_trend,
    "send_whatsapp": whatsapp.send_message,
}

SYSTEM_PROMPT = """You are a proactive personal health tracking agent for Asim.

User profile: Age 36, height 183cm, ~82kg, male.
Resting TDEE (no activity): 1,850 kcal/day. On days with no Apple Watch data, use this value.

Responsibilities:
- Food photo received: analyze it, estimate calories, log the meal, confirm to user.
- Weight photo received: read the number off the scale, log it, confirm to user.
- Apple Watch data received: log the activity calories.
- Scheduled morning check (8am): if no weight logged today, send a reminder.
- Scheduled midday check (1pm): if no lunch logged yet, check in with the user.
- Scheduled evening check (8pm): calculate and send the daily summary.
- Scheduled weekly check (Sunday 7pm): send a weekly summary with weight trend.

Rules:
- Be brief and direct. No fluff or filler phrases.
- Always confirm what you logged with the exact values.
- If calorie estimate is uncertain, give a range and state your assumption.
- Do not send a proactive message if the relevant data has already been logged.
- Current time: {current_time}"""


def _execute_tool(name: str, inputs: dict) -> str:
    fn = TOOL_MAP.get(name)
    if not fn:
        return f"Unknown tool: {name}"
    try:
        return str(fn(**inputs))
    except Exception as e:
        return f"Tool error: {e}"


def run_agent(trigger: str, message: str = None, image_url: str = None) -> str:
    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)

    content = []

    if image_url:
        image_bytes = httpx.get(image_url).content
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": base64.standard_b64encode(image_bytes).decode(),
                },
            }
        )
        if not message:
            content.append(
                {
                    "type": "text",
                    "text": "Analyze this image and take the appropriate action (log meal or weight).",
                }
            )

    if message:
        content.append({"type": "text", "text": message})

    if not content:
        content.append(
            {
                "type": "text",
                "text": f"Scheduled check-in at {datetime.now().strftime('%A %I:%M %p')}. Review today's logs and take any needed proactive action.",
            }
        )

    messages = [{"role": "user", "content": content}]

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
