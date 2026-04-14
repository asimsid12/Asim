/**
 * Shared in-memory state for the bot.
 *
 * Currently used to track a pending payment confirmation:
 * when a customer sends a payment screenshot the bot stores the
 * order details here and asks the owner to confirm.
 * The owner's next "yes" reply resolves it.
 */

let pendingPaymentConfirmation = null;

/**
 * @typedef {object} PendingPayment
 * @property {string} orderId
 * @property {string} customerJid   - e.g. "923001234567@s.whatsapp.net"
 * @property {string} customerName
 * @property {number|string} amount
 * @property {number} sheetRow
 * @property {string} [invoiceId]   - Splendid invoice ID if known
 */

/** @param {PendingPayment} data */
function setPendingPayment(data) {
  pendingPaymentConfirmation = data;
}

/** @returns {PendingPayment|null} */
function getPendingPayment() {
  return pendingPaymentConfirmation;
}

function clearPendingPayment() {
  pendingPaymentConfirmation = null;
}

module.exports = { setPendingPayment, getPendingPayment, clearPendingPayment };
