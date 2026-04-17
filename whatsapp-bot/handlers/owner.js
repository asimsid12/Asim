/**
 * Handles all messages from the owner's number.
 *
 * Workflow:
 *   1. Voice note  → Whisper transcription → treated as text
 *   2. Text/voice  → Claude parses into a structured action
 *   3. new_order   → Sheet → Splendid customer + invoice → PDF → customer WhatsApp
 *   4. new_expense → Purchases sheet + Splendid journal entry
 *   5. payment_received (manual text) → mark paid in Splendid + sheet
 *   6. Pending payment confirmation (customer screenshot) → owner says "yes" → mark paid
 *   7. Other commands: update_status, check_order, unpaid, summary
 */

const Anthropic = require("@anthropic-ai/sdk");

const {
  appendOrder,
  updateOrder,
  getOrderById,
  getPendingPaymentOrders,
  getDailySummary,
  appendExpense,
  normalisePhone,
} = require("../sheets");

const { transcribeAudio }    = require("../lib/whisper");
const { generateInvoicePdf } = require("../lib/pdf-invoice");
const {
  getPendingPayment, clearPendingPayment,
  setPendingInvoice, getPendingInvoice, clearPendingInvoice,
} = require("../state");

// Splendid client — optional; order logging still works without it
let splendid = null;
try {
  const SplendidClient = require("../../splendid-automation/splendid-client");
  splendid = new SplendidClient();
} catch {
  // Splendid credentials not configured yet
}

const claude = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Claude system prompt ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a command parser for Baro Studio, a Pakistani clothing brand.
The owner sends you WhatsApp messages in English, Urdu, or mixed Roman Urdu.
Parse the message and return ONLY valid JSON — no extra text, no markdown.

Possible actions:

1. new_order — owner is logging a new customer order
{"action":"new_order","data":{"customerName":"","whatsapp":"","city":"","address":"","itemName":"","size":"","colour":"","qty":1,"unitPrice":0,"paymentMethod":"","notes":""}}

2. new_expense — owner is recording a purchase/expense (fabric, tailor, accessories, embroidery, etc.)
{"action":"new_expense","data":{"description":"","vendor":"","amount":0,"category":"Fabric|Tailoring|Accessories|Embroidery|Other","paymentMethod":"","notes":""}}

3. update_status — change an order's status
{"action":"update_status","orderId":"BS-YYYY-NNN","status":"Confirmed|In Production|Ready|Dispatched|Delivered|Cancelled","courier":"","trackingNo":""}

4. payment_received — mark payment as received (manual, no screenshot)
{"action":"payment_received","orderId":"BS-YYYY-NNN","reference":""}

5. summary — daily summary
{"action":"summary"}

6. unpaid — list unpaid orders
{"action":"unpaid"}

7. check_order — look up one order
{"action":"check_order","orderId":"BS-YYYY-NNN"}

8. unknown
{"action":"unknown"}

Rules:
- Pakistani phone numbers: normalise to 03XX-XXXXXXX format if given, otherwise leave empty.
- Prices are in PKR. If not stated, use 0.
- If order ID looks partial (e.g. "001"), expand to "BS-CURRENT_YEAR-001".
- Courier mapping: tcs→TCS, leo/leopards→Leopards, blue/blueex→BlueEx, postex→PostEx, mp/m&p→M&P.
- For expenses: category = one of Fabric, Tailoring, Accessories, Embroidery, Other.
- Tailoring vendor: use the actual name (Sunny, Ibrahim, etc.) so the right account is used.
- Return ONLY the JSON object.`;

async function parseCommand(text) {
  const year = new Date().getFullYear();
  const res  = await claude.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: "user", content: `Current year: ${year}\nOwner message: ${text}` }],
  });
  try {
    const raw = res.content[0].text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(raw);
  } catch {
    return { action: "unknown" };
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

async function handleOwnerMessage(message, send) {
  const reply = (text) => send(message.from, text);

  // ── 1a. Pending invoice send? ─────────────────────────────────────────────
  const pendingInvoice = getPendingInvoice();
  if (pendingInvoice && isConfirmation(message.text)) {
    await sendInvoiceToCustomer(pendingInvoice, send, message.from);
    clearPendingInvoice();
    return;
  }

  // ── 1b. Pending payment confirmation? ────────────────────────────────────
  const pending = getPendingPayment();
  if (pending && isConfirmation(message.text)) {
    await confirmPayment(pending, send, message.from);
    clearPendingPayment();
    return;
  }

  // ── 2. Resolve text from message type ─────────────────────────────────────
  let text = message.text || "";

  if (message.type === "audio" && message.audioBuffer) {
    await reply("_Transcribing voice note…_");
    try {
      text = await transcribeAudio(message.audioBuffer, message.mimeType);
    } catch (err) {
      await reply(`Couldn't transcribe voice note: ${err.message}`);
      return;
    }
    if (!text) {
      await reply("Voice note was empty or unclear. Please try again.");
      return;
    }
    // Echo back so owner can verify transcription
    await reply(`_Heard: "${text}"_`);
  }

  if (!text.trim()) return;

  // ── 3. Parse intent with Claude ───────────────────────────────────────────
  let parsed;
  try {
    parsed = await parseCommand(text);
  } catch (err) {
    console.error("Claude API error:", err.message);
    await reply("Sorry, couldn't process that right now. Try again in a moment.");
    return;
  }

  // ── 4. Dispatch to action handlers ───────────────────────────────────────
  switch (parsed.action) {
    case "new_order":
      await handleNewOrder(parsed.data, send, message.from);
      break;

    case "new_expense":
      await handleNewExpense(parsed.data, reply);
      break;

    case "update_status":
      await reply(await handleUpdateStatus(parsed));
      break;

    case "payment_received":
      await reply(await handlePaymentReceived(parsed, send));
      break;

    case "summary":
      await reply(await handleSummary());
      break;

    case "unpaid":
      await reply(await handleUnpaid());
      break;

    case "check_order":
      await reply(await handleCheckOrder(parsed.orderId));
      break;

    default:
      await reply(helpText());
  }
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function handleNewOrder(data, send, ownerJid) {
  const reply = (text) => send(ownerJid, text);

  if (!data.customerName) {
    await reply("Couldn't parse the order — please include customer name, item, and price.");
    return;
  }

  // 1. Append to Google Sheet
  let orderId, total;
  try {
    ({ orderId, total } = await appendOrder(data));
  } catch (err) {
    await reply(`Failed to save order to sheet: ${err.message}`);
    return;
  }

  const orderWithId = { ...data, orderId, totalAmount: total };

  // 2. Create Splendid invoice (if configured)
  let invoiceNo = null;
  if (splendid) {
    try {
      const customerId = await splendid.findOrCreateCustomer(orderWithId);
      const invoice    = await splendid.createInvoice(orderWithId, customerId);
      invoiceNo        = invoice.number || invoice.id?.toString() || null;
      if (invoiceNo) {
        // Persist invoice number back to sheet
        const { sheetRow } = await getOrderById(orderId) || {};
        if (sheetRow) await updateOrder(sheetRow, { invoiceNo, invoiceSent: "No" });
      }
    } catch (err) {
      console.error("Splendid invoice error:", err.message);
      // Non-fatal — still send the order confirmation
    }
  }

  // 3. Generate PDF invoice
  let pdfBuffer = null;
  try {
    pdfBuffer = await generateInvoicePdf(orderWithId, invoiceNo);
  } catch (err) {
    console.error("PDF generation error:", err.message);
  }

  // 4. Send PDF to owner for review, store pending send
  const lines = [
    `✅ *Order logged!*`,
    ``,
    `*Order ID:* ${orderId}`,
    `*Customer:* ${data.customerName}${data.whatsapp ? " — " + data.whatsapp : ""}`,
    `*Item:* ${data.itemName}${data.size ? " (" + data.size + ")" : ""}${data.colour ? " / " + data.colour : ""}`,
    `*Amount:* PKR ${(total || 0).toLocaleString()}`,
    data.city ? `*City:* ${data.city}` : null,
    invoiceNo ? `*Splendid Invoice:* ${invoiceNo}` : null,
  ];
  await reply(lines.filter((l) => l !== null).join("\n"));

  if (pdfBuffer) {
    await send(ownerJid, {
      document: pdfBuffer,
      mimetype: "application/pdf",
      fileName: `Baro-Studio-${orderId}.pdf`,
      caption: data.whatsapp
        ? `👆 Review the invoice above.\n\nReply *yes* to send it to ${data.customerName}.`
        : `👆 Invoice preview. No customer WhatsApp number — share manually.`,
    });
    if (data.whatsapp) {
      setPendingInvoice({
        orderId,
        customerJid: `${normalisePhone(data.whatsapp)}@s.whatsapp.net`,
        customerName: data.customerName,
        pdfBuffer,
        sheetRow: (await getOrderById(orderId))?.sheetRow,
      });
    }
  }
}

async function handleNewExpense(data, reply) {
  if (!data.description || !data.amount) {
    await reply("Couldn't parse the expense — please include what was bought and the amount.");
    return;
  }

  // 1. Append to Purchases sheet
  let expenseId;
  try {
    ({ expenseId } = await appendExpense(data));
  } catch (err) {
    await reply(`Failed to save expense to sheet: ${err.message}`);
    return;
  }

  // 2. Create purchase invoice in Splendid (if configured)
  let invoiceRef = null;
  if (splendid) {
    try {
      const invoice = await splendid.createPurchaseInvoice(data);
      invoiceRef    = invoice?.number || invoice?.id?.toString() || null;
    } catch (err) {
      console.error("Splendid purchase invoice error:", err.message);
    }
  }

  const lines = [
    `✅ *Expense recorded!*`,
    ``,
    `*Ref:* ${expenseId}`,
    `*Description:* ${data.description}`,
    data.vendor ? `*Vendor:* ${data.vendor}` : null,
    `*Amount:* PKR ${parseFloat(data.amount).toLocaleString()}`,
    `*Category:* ${data.category || "Other"}`,
    invoiceRef ? `*Splendid Invoice:* ${invoiceRef}` : null,
  ];
  await reply(lines.filter((l) => l !== null).join("\n"));
}

async function sendInvoiceToCustomer(pending, send, ownerJid) {
  const reply = (text) => send(ownerJid, text);
  try {
    await send(pending.customerJid, {
      document: pending.pdfBuffer,
      mimetype: "application/pdf",
      fileName: `Baro-Studio-${pending.orderId}.pdf`,
      caption:
        `Hi ${pending.customerName}! 🤍 Thank you for your order with Baro Studio.\n\n` +
        `Please find your invoice attached. To confirm your order, kindly complete payment and send us the screenshot.\n\n` +
        `Order ID: *${pending.orderId}*`,
    });
    if (pending.sheetRow) await updateOrder(pending.sheetRow, { invoiceSent: "Yes" });
    await reply(`📄 Invoice sent to ${pending.customerName}.`);
  } catch (err) {
    await reply(`Failed to send invoice: ${err.message}`);
  }
}

async function handleUpdateStatus(parsed) {
  const result = await getOrderById(parsed.orderId);
  if (!result) return `Order *${parsed.orderId}* not found.`;

  const fields = { orderStatus: parsed.status };
  if (parsed.courier)    fields.courier    = parsed.courier;
  if (parsed.trackingNo) fields.trackingNo = parsed.trackingNo;
  await updateOrder(result.sheetRow, fields);

  let reply = `✅ *${parsed.orderId}* → *${parsed.status}*`;
  if (parsed.trackingNo) reply += `\n🚚 ${parsed.courier || ""} ${parsed.trackingNo}`.trimEnd();
  return reply;
}

async function handlePaymentReceived(parsed, send) {
  const result = await getOrderById(parsed.orderId);
  if (!result) return `Order *${parsed.orderId}* not found.`;

  const { order, sheetRow } = result;

  // Mark paid in sheet
  const newStatus = order.orderStatus === "Received" ? "Confirmed" : order.orderStatus;
  await updateOrder(sheetRow, {
    paymentStatus: "Received",
    orderStatus:   newStatus,
    ...(parsed.reference ? { paymentRef: parsed.reference } : {}),
  });

  // Record in Splendid
  if (splendid && order.whatsapp) {
    try {
      const customerId = await splendid.findOrCreateCustomer(order);
      await splendid.recordPayment({
        customerId,
        amount:    parseFloat(order.totalAmount) || 0,
        reference: parsed.orderId,
        accountId: parseInt(process.env.SPLENDID_BANK_ACCOUNT_ID),
      });
    } catch (err) {
      console.error("Splendid payment record error:", err.message);
    }
  }

  // Send confirmation to customer
  if (order.whatsapp) {
    const customerJid = `${normalisePhone(order.whatsapp)}@s.whatsapp.net`;
    try {
      await send(customerJid,
        `Hi ${order.customerName}! 🤍 We've received your payment for order *${order.orderId}*.\n\n` +
        `Your order is now *${newStatus}*. We'll update you when it's dispatched.`
      );
    } catch (err) {
      console.error("Failed to send payment confirmation to customer:", err.message);
    }
  }

  return (
    `✅ Payment marked for *${parsed.orderId}*\n` +
    `Status: *${newStatus}*` +
    (order.whatsapp ? `\n_Confirmation sent to ${order.customerName}._` : "")
  );
}

async function confirmPayment(pending, send, ownerJid) {
  const reply = (text) => send(ownerJid, text);

  const result = await getOrderById(pending.orderId);
  if (!result) {
    await reply(`Couldn't find order *${pending.orderId}* to mark as paid.`);
    return;
  }

  const { order, sheetRow } = result;

  const newStatus = order.orderStatus === "Received" ? "Confirmed" : order.orderStatus;
  await updateOrder(sheetRow, { paymentStatus: "Received", orderStatus: newStatus });

  if (splendid && order.whatsapp) {
    try {
      const customerId = await splendid.findOrCreateCustomer(order);
      await splendid.recordPayment({
        customerId,
        amount:    parseFloat(order.totalAmount) || 0,
        reference: pending.orderId,
        accountId: parseInt(process.env.SPLENDID_BANK_ACCOUNT_ID),
      });
    } catch (err) {
      console.error("Splendid payment error:", err.message);
    }
  }

  // Confirm to customer
  try {
    await send(
      pending.customerJid,
      `Hi ${pending.customerName}! 🤍 We've received your payment for order *${pending.orderId}*.\n\n` +
      `Your order is now *${newStatus}*. We'll update you when it's dispatched.`
    );
  } catch (err) {
    console.error("Failed to send payment confirmation to customer:", err.message);
  }

  await reply(
    `✅ *${pending.orderId}* marked as paid. Status → *${newStatus}*.\n` +
    `_Confirmation sent to ${pending.customerName}._`
  );
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
    `Amount: PKR ${o.totalAmount}  |  Payment: ${o.paymentStatus}`,
    `Status: ${o.orderStatus}`,
  ];
  if (o.courier && o.trackingNo) lines.push(`Tracking: ${o.courier} ${o.trackingNo}`);
  if (o.city) lines.push(`City: ${o.city}`);
  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isConfirmation(text) {
  if (!text) return false;
  return /^\s*(yes|haan|ha|confirm|ok|okay|done|paid|✅)\s*$/i.test(text.trim());
}

function helpText() {
  return (
    "Didn't understand that. Try:\n\n" +
    "🎙 *Voice note examples:*\n" +
    "• \"New order: Sara, 0301-1234567, size M, navy kurta, PKR 4500, DHA Karachi\"\n" +
    "• \"Fabric purchase from Gul Ahmed, 5 metres lawn, PKR 12000\"\n" +
    "• \"Tailor payment to Umar, PKR 8000\"\n\n" +
    "📝 *Text commands:*\n" +
    "• *Status:* \"BS-2026-001 dispatched TCS TCS123456\"\n" +
    "• *Payment:* \"Payment received BS-2026-001\"\n" +
    "• *Check:* \"Status of BS-2026-001\"\n" +
    "• *Summary:* \"Today's summary\"\n" +
    "• *Unpaid:* \"Show unpaid orders\""
  );
}

module.exports = { handleOwnerMessage };
