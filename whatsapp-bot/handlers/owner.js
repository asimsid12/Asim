/**
 * Handles WhatsApp messages from the owner's number.
 * Uses Claude API to parse natural language commands into structured actions,
 * then executes those actions against Google Sheets.
 */

const Anthropic = require("@anthropic-ai/sdk");
const {
  appendOrder,
  updateOrder,
  getOrderById,
  getPendingPaymentOrders,
  getDailySummary,
} = require("../sheets");

const claude = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a command parser for Baro Studio, a Pakistani clothing brand.
The owner sends you WhatsApp messages in English, Urdu, or mixed (Roman Urdu).
Parse the message and return ONLY valid JSON with no extra text.

Possible actions and their JSON shapes:

1. new_order — owner is logging a new customer order
{"action":"new_order","data":{"customerName":"","whatsapp":"","city":"","address":"","itemName":"","size":"","colour":"","qty":1,"unitPrice":0,"paymentMethod":"","notes":""}}

2. update_status — change an order's status
{"action":"update_status","orderId":"BS-YYYY-NNN","status":"Confirmed|In Production|Ready|Dispatched|Delivered|Cancelled","courier":"","trackingNo":""}

3. payment_received — mark payment as received for an order
{"action":"payment_received","orderId":"BS-YYYY-NNN","reference":""}

4. summary — daily summary of orders
{"action":"summary"}

5. unpaid — list of unpaid orders
{"action":"unpaid"}

6. check_order — look up a specific order
{"action":"check_order","orderId":"BS-YYYY-NNN"}

7. unknown — message doesn't match any known command
{"action":"unknown"}

Rules:
- Pakistani phone numbers: normalise to 03XX-XXXXXXX format if given, otherwise leave empty.
- Prices are in PKR. If not given, use 0.
- If order ID is mentioned but incomplete (e.g. "001"), expand to "BS-CURRENT_YEAR-001".
- For courier, map: tcs→TCS, leo/leopards→Leopards, blue/blueex→BlueEx, postex→PostEx, mp/m&p→M&P.
- Return ONLY the JSON object. No explanation, no markdown.`;

async function parseCommand(text) {
  const currentYear = new Date().getFullYear();
  const msg = `Current year: ${currentYear}\nOwner message: ${text}`;

  const res = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: msg }],
  });

  const raw = res.content[0].text.trim();
  try {
    return JSON.parse(raw);
  } catch {
    return { action: "unknown" };
  }
}

async function handleOwnerMessage(message) {
  const text = (message.text || "").trim();
  if (!text) return null;

  let parsed;
  try {
    parsed = await parseCommand(text);
  } catch (err) {
    console.error("Claude API error:", err.message);
    return "Sorry, couldn't process that right now. Try again in a moment.";
  }

  switch (parsed.action) {
    case "new_order":
      return await handleNewOrder(parsed.data);

    case "update_status":
      return await handleUpdateStatus(parsed);

    case "payment_received":
      return await handlePaymentReceived(parsed);

    case "summary":
      return await handleSummary();

    case "unpaid":
      return await handleUnpaid();

    case "check_order":
      return await handleCheckOrder(parsed.orderId);

    case "unknown":
    default:
      return (
        "Didn't understand that. Try:\n\n" +
        "• *New order:* \"New order: Sara, 0301-1234567, size M, white kurta, PKR 4500, DHA Karachi\"\n" +
        "• *Update status:* \"BS-2026-001 dispatched TCS TCS123456\"\n" +
        "• *Payment received:* \"Payment received BS-2026-001\"\n" +
        "• *Summary:* \"Today's summary\"\n" +
        "• *Unpaid:* \"Show unpaid orders\"\n" +
        "• *Check order:* \"Status of BS-2026-001\""
      );
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleNewOrder(data) {
  if (!data.customerName) return "Couldn't parse the order — please include customer name, item, and price.";

  const { orderId, total } = await appendOrder(data);
  const lines = [
    `✅ Order logged!`,
    ``,
    `*Order ID:* ${orderId}`,
    `*Customer:* ${data.customerName}`,
    data.whatsapp ? `*WhatsApp:* ${data.whatsapp}` : null,
    `*Item:* ${data.itemName}${data.size ? " — " + data.size : ""}${data.colour ? " / " + data.colour : ""}`,
    `*Qty:* ${data.qty || 1}`,
    `*Amount:* PKR ${total || data.unitPrice}`,
    data.city ? `*City:* ${data.city}` : null,
    ``,
    `Status set to *Received*. Send payment details to customer when ready.`,
  ];
  return lines.filter(l => l !== null).join("\n");
}

async function handleUpdateStatus(parsed) {
  const result = await getOrderById(parsed.orderId);
  if (!result) return `Order *${parsed.orderId}* not found.`;

  const fields = { orderStatus: parsed.status };
  if (parsed.courier)   fields.courier   = parsed.courier;
  if (parsed.trackingNo) fields.trackingNo = parsed.trackingNo;

  await updateOrder(result.sheetRow, fields);

  const o = result.order;
  let reply = `✅ *${parsed.orderId}* updated to *${parsed.status}*`;
  if (parsed.trackingNo) reply += `\n🚚 Tracking: ${parsed.courier || ""} ${parsed.trackingNo}`.trim();
  if (o.whatsapp && parsed.status === "Dispatched" && parsed.trackingNo) {
    reply += `\n\n_Tracking message will be sent to ${o.customerName} automatically._`;
  }
  return reply;
}

async function handlePaymentReceived(parsed) {
  const result = await getOrderById(parsed.orderId);
  if (!result) return `Order *${parsed.orderId}* not found.`;

  const fields = {
    paymentStatus: "Received",
    orderStatus: result.order.orderStatus === "Received" ? "Confirmed" : result.order.orderStatus,
  };
  if (parsed.reference) fields.paymentRef = parsed.reference;

  await updateOrder(result.sheetRow, fields);

  const o = result.order;
  let reply = `✅ Payment marked as received for *${parsed.orderId}*`;
  if (o.whatsapp) reply += `\n\n_Confirmation message will be sent to ${o.customerName} automatically._`;
  return reply;
}

async function handleSummary() {
  const { count, revenue, unpaid } = await getDailySummary();
  if (count === 0) return "No orders logged today yet.";
  return (
    `📊 *Today's Summary*\n\n` +
    `Orders: *${count}*\n` +
    `Revenue: *PKR ${revenue.toLocaleString()}*\n` +
    `Unpaid: *${unpaid}*`
  );
}

async function handleUnpaid() {
  const pending = await getPendingPaymentOrders();
  if (!pending.length) return "No unpaid orders. 🎉";

  const lines = [`💰 *Unpaid Orders (${pending.length})*\n`];
  for (const { order: o } of pending) {
    lines.push(`• *${o.orderId}* — ${o.customerName} — PKR ${o.totalAmount} — ${o.orderStatus}`);
  }
  return lines.join("\n");
}

async function handleCheckOrder(orderId) {
  const result = await getOrderById(orderId);
  if (!result) return `Order *${orderId}* not found.`;

  const o = result.order;
  const lines = [
    `📋 *${o.orderId}*`,
    `Customer: ${o.customerName}${o.whatsapp ? " (" + o.whatsapp + ")" : ""}`,
    `Item: ${o.itemName}${o.size ? " — " + o.size : ""}`,
    `Amount: PKR ${o.totalAmount} | Payment: ${o.paymentStatus}`,
    `Status: ${o.orderStatus}`,
  ];
  if (o.courier && o.trackingNo) lines.push(`Tracking: ${o.courier} ${o.trackingNo}`);
  if (o.city) lines.push(`City: ${o.city}`);
  return lines.join("\n");
}

module.exports = { handleOwnerMessage };
