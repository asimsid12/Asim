/**
 * Handles messages from customers (anyone who is not the owner).
 *
 * Three things this handler does:
 *   1. Payment screenshot  → notify the owner to confirm, store pending state
 *   2. Order ID in message → reply with order status
 *   3. Anything else       → brief holding reply
 */

const { getOrderById, getUnpaidOrderByPhone, normalisePhone } = require("../sheets");
const { setPendingPayment } = require("../state");
const { OWNER_JID }         = require("../router");

// Matches patterns like BS-2026-001 or bs2026001 (forgiving)
const ORDER_ID_RE = /\b(BS[-\s]?\d{4}[-\s]?\d{3})\b/i;

async function handleCustomerMessage(message, send) {
  const { from, type, text } = message;

  // ── 1. Payment screenshot ─────────────────────────────────────────────────
  // Customer sends an image with no (or minimal) caption
  if (type === "image" && !text) {
    const phone  = from.split("@")[0];
    const result = await getUnpaidOrderByPhone(phone).catch(() => null);

    if (result) {
      const { order } = result;
      // Store pending confirmation for owner to resolve
      setPendingPayment({
        orderId:      order.orderId,
        customerJid:  from,
        customerName: order.customerName,
        amount:       order.totalAmount,
        sheetRow:     result.sheetRow,
      });
      // Notify the owner
      await send(
        OWNER_JID,
        `📸 *Payment screenshot* from *${order.customerName}*\n` +
        `Order: *${order.orderId}*  |  Amount: PKR ${order.totalAmount}\n\n` +
        `Reply *yes* to mark as paid.`
      );
    }
    // No reply to customer — they'll get a confirmation once owner says yes
    return;
  }

  // ── 2. Order status lookup ────────────────────────────────────────────────
  if (text) {
    const idMatch = text.match(ORDER_ID_RE);
    if (idMatch) {
      const orderId = idMatch[1].replace(/\s/g, "-").toUpperCase();
      try {
        const result = await getOrderById(orderId);
        if (result) {
          const o = result.order;
          const lines = [
            `Order *${o.orderId}* status:`,
            `📦 ${o.itemName}${o.size ? " (" + o.size + ")" : ""}`,
            `💰 PKR ${o.totalAmount}  |  💳 ${o.paymentStatus}`,
            `🚦 ${o.orderStatus}`,
          ];
          if (o.courier && o.trackingNo) {
            lines.push(`🚚 ${o.courier} — ${o.trackingNo}`);
          }
          lines.push("\nFor help, reply to this chat. 🤍");
          await send(from, lines.join("\n"));
        } else {
          await send(from, `We couldn't find order *${orderId}*. Please double-check the ID, or message us and we'll look it up. 🤍`);
        }
      } catch {
        await send(from, "We're having trouble looking up your order right now. Please try again shortly. 🤍");
      }
      return;
    }
  }

  // Customer replies disabled — ignore all other messages for now
}

module.exports = { handleCustomerMessage };
