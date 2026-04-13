/**
 * Polls Google Sheets every 5 minutes for orders that need
 * an automatic WhatsApp notification sent to the customer.
 *
 * Tracked via flags written into the Notes column:
 *   [confirm-sent]  — payment confirmation sent
 *   [tracking-sent] — dispatch + tracking sent
 */

const { getDispatchedUnnotified, getConfirmedUnnotified, updateOrder } = require("./sheets");

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function buildTrackingMessage(order) {
  const courierLinks = {
    TCS:      "https://www.tcs.com.pk/track-shipment",
    Leopards: "https://www.leopardscourier.com/leopards_tracking.php",
    BlueEx:   "https://www.blueex.com.pk",
    PostEx:   "https://postex.pk/tracking",
    "M&P":    "https://www.mp.com.pk",
  };

  const trackingLink = courierLinks[order.courier] || "";
  const lines = [
    `Hi ${order.customerName} 🤍`,
    ``,
    `Your order *${order.orderId}* has been dispatched!`,
    ``,
    `🚚 Courier: ${order.courier}`,
    `📋 Tracking No: *${order.trackingNo}*`,
    trackingLink ? `🔗 Track here: ${trackingLink}` : null,
    ``,
    `Estimated delivery: 1–2 days (Karachi) / 3–5 days (other cities).`,
    ``,
    `Please inspect before signing. Reach out if anything is wrong!`,
    ``,
    `— Baro Studio`,
  ];
  return lines.filter(l => l !== null).join("\n");
}

function buildConfirmationMessage(order) {
  return (
    `Hi ${order.customerName} 🤍\n\n` +
    `We've received your payment — thank you!\n\n` +
    `Your order *${order.orderId}* is now confirmed and will go into production shortly.\n\n` +
    `We'll message you as soon as it's ready to dispatch.\n\n` +
    `— Baro Studio`
  );
}

// sendFn is passed in from bot.js to keep poller decoupled from Baileys
async function startPoller(sendFn) {
  console.log("Poller started — checking every 5 minutes for pending notifications.");

  async function poll() {
    try {
      await checkDispatched(sendFn);
      await checkConfirmed(sendFn);
    } catch (err) {
      console.error("Poller error:", err.message);
    }
  }

  // Run immediately on start, then on interval
  await poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

async function checkDispatched(sendFn) {
  const orders = await getDispatchedUnnotified();
  for (const { order, sheetRow } of orders) {
    const phone = order.whatsapp.replace(/\D/g, "").replace(/^0/, "92");
    const jid = `${phone}@s.whatsapp.net`;
    const msg = buildTrackingMessage(order);

    try {
      await sendFn(jid, msg);
      // Append flag to notes so we don't send again
      const updatedNotes = (order.notes + " [tracking-sent]").trim();
      await updateOrder(sheetRow, { notes: updatedNotes });
      console.log(`  Tracking sent for ${order.orderId} → ${order.customerName}`);
    } catch (err) {
      console.error(`  Failed to send tracking for ${order.orderId}:`, err.message);
    }
  }
}

async function checkConfirmed(sendFn) {
  const orders = await getConfirmedUnnotified();
  for (const { order, sheetRow } of orders) {
    const phone = order.whatsapp.replace(/\D/g, "").replace(/^0/, "92");
    const jid = `${phone}@s.whatsapp.net`;
    const msg = buildConfirmationMessage(order);

    try {
      await sendFn(jid, msg);
      const updatedNotes = (order.notes + " [confirm-sent]").trim();
      await updateOrder(sheetRow, { notes: updatedNotes });
      console.log(`  Confirmation sent for ${order.orderId} → ${order.customerName}`);
    } catch (err) {
      console.error(`  Failed to send confirmation for ${order.orderId}:`, err.message);
    }
  }
}

module.exports = { startPoller };
