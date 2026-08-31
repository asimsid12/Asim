/**
 * Stateless MCP server over Streamable HTTP.
 *
 * The OAuth provider has already validated the bearer token by the time a
 * request reaches here, and exposes the authenticated user as `ctx.props`.
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { readDataType } from "./google.js";

const SUPPORTED_PROTOCOLS = ["2025-03-26", "2025-06-18", "2025-11-25"];
const SERVER_INFO = { name: "google-health", title: "Google Health", version: "1.0.0" };

// ── Dates ────────────────────────────────────────────────────────────────────

const isoDate = (d) => d.toISOString().slice(0, 10);

/** Defaults to the trailing fortnight — enough to see a trend, cheap to fetch. */
function range({ from, to } = {}) {
  const end   = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - 13 * 86_400_000);
  return { from: isoDate(start), to: isoDate(end) };
}

const DATE_RANGE_SCHEMA = {
  type: "object",
  properties: {
    from: { type: "string", description: "Start date, YYYY-MM-DD. Defaults to 14 days ago." },
    to:   { type: "string", description: "End date, YYYY-MM-DD. Defaults to today." },
  },
};

// ── Tools ────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_daily_summary",
    title: "Daily summary",
    description:
      "Per-day activity and recovery: steps, calories burned, active zone minutes, " +
      "distance, resting heart rate and sleep duration. Start here for questions " +
      "about how a week went, training load, or recovery trends.",
    inputSchema: DATE_RANGE_SCHEMA,
    handler: async (env, sub, args) => {
      const { from, to } = range(args);
      const types = ["steps", "totalCalories", "activeZoneMinutes", "distance", "dailyRestingHeartRate", "sleep"];

      const results = await Promise.allSettled(
        types.map((type) => readDataType(env, sub, type, from, to)),
      );

      const summary = { from, to, dataTypes: {}, unavailable: {} };
      types.forEach((type, i) => {
        const result = results[i];
        if (result.status === "fulfilled") summary.dataTypes[type] = result.value;
        else summary.unavailable[type] = result.reason.message;
      });

      // Nothing came back at all — that is a connection problem, not an empty
      // week, and saying so stops it being read as "you did no training".
      if (Object.keys(summary.dataTypes).length === 0) {
        throw new Error(`No data could be read. First failure: ${results[0].reason.message}`);
      }
      return summary;
    },
  },
  {
    name: "get_workouts",
    title: "Workouts",
    description:
      "Individual exercise sessions with type, duration, heart rate and calories. " +
      "Use for questions about what was trained, how hard, and how often.",
    inputSchema: DATE_RANGE_SCHEMA,
    handler: async (env, sub, args) => {
      const { from, to } = range(args);
      return { from, to, workouts: await readDataType(env, sub, "exercise", from, to) };
    },
  },
  {
    name: "get_sleep",
    title: "Sleep",
    description: "Sleep sessions with duration, stages and timing. Use for recovery questions.",
    inputSchema: DATE_RANGE_SCHEMA,
    handler: async (env, sub, args) => {
      const { from, to } = range(args);
      return { from, to, sleep: await readDataType(env, sub, "sleep", from, to) };
    },
  },
  {
    name: "get_body_metrics",
    title: "Body metrics",
    description: "Weight and body fat readings over time. Use for questions about body composition trends.",
    inputSchema: DATE_RANGE_SCHEMA,
    handler: async (env, sub, args) => {
      const { from, to } = range(args);
      const [weight, bodyFat] = await Promise.all([
        readDataType(env, sub, "weight", from, to),
        readDataType(env, sub, "bodyFat", from, to),
      ]);
      return { from, to, weight, bodyFat };
    },
  },
  {
    name: "log_meal",
    title: "Log a meal",
    description:
      "Record a meal with estimated macros. Call this after looking at a photo of food " +
      "and estimating what is in it. Commit to single numbers rather than ranges, and " +
      "put whatever drove the estimate in `assumptions`.",
    inputSchema: {
      type: "object",
      required: ["date", "meal", "items", "calories"],
      properties: {
        date:        { type: "string", description: "YYYY-MM-DD" },
        meal:        { type: "string", description: "breakfast, lunch, dinner or snack" },
        items:       { type: "array", items: { type: "string" }, description: "Dishes and portions, e.g. ['2 roti', 'chicken karahi ~200g']" },
        calories:    { type: "number" },
        protein_g:   { type: "number" },
        carbs_g:     { type: "number" },
        fat_g:       { type: "number" },
        assumptions: { type: "string", description: "What most affects the estimate — oil/ghee content, meat portion" },
      },
    },
    handler: async (env, sub, args) => {
      const key = `meals:${sub}:${args.date}`;
      const existing = JSON.parse((await env.HEALTH_KV.get(key)) || "[]");
      existing.push({ loggedAt: new Date().toISOString(), ...args });
      await env.HEALTH_KV.put(key, JSON.stringify(existing));
      return { logged: args.meal, date: args.date, mealsThatDay: existing.length };
    },
  },
  {
    name: "get_meals",
    title: "Logged meals",
    description: "Previously logged meals with their macros. Use to total up calories and protein, or to spot gaps in logging.",
    inputSchema: DATE_RANGE_SCHEMA,
    handler: async (env, sub, args) => {
      const { from, to } = range(args);
      const listed = await env.HEALTH_KV.list({ prefix: `meals:${sub}:` });

      const days = listed.keys
        .map((k) => k.name.slice(`meals:${sub}:`.length))
        .filter((date) => date >= from && date <= to)
        .sort();

      const meals = [];
      for (const date of days) {
        meals.push(...JSON.parse((await env.HEALTH_KV.get(`meals:${sub}:${date}`)) || "[]"));
      }
      return { from, to, meals };
    },
  },
];

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

const jsonRpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const jsonRpcError  = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleMessage(message, env, props) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      return jsonRpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : "2025-11-25",
        capabilities:    { tools: {} },
        serverInfo:      SERVER_INFO,
      });
    }

    case "ping":
      return jsonRpcResult(id, {});

    case "tools/list":
      return jsonRpcResult(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) =>
          ({ name, title, description, inputSchema })),
      });

    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${params?.name}`);

      try {
        const output = await tool.handler(env, props.userId, params.arguments || {});
        return jsonRpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        });
      } catch (err) {
        // Tool failures belong in the result so the model can see and adapt.
        return jsonRpcResult(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

export class HealthMcp extends WorkerEntrypoint {
  async fetch(request) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
    }

    const messages = Array.isArray(body) ? body : [body];
    const responses = [];

    for (const message of messages) {
      // Notifications carry no id and take no reply.
      if (message.id === undefined) continue;
      responses.push(await handleMessage(message, this.env, this.ctx.props));
    }

    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? responses : responses[0]);
  }
}
