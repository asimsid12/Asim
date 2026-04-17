/**
 * Shared in-memory state for the bot.
 *
 * Currently used to track a pending payment confirmation:
 * when a customer sends a payment screenshot the bot stores the
 * order details here and asks the owner to confirm.
 * The owner's next "yes" reply resolves it.
 */

let pendingPaymentConfirmation = null;
let pendingInvoiceSend = null;

function setPendingPayment(data)  { pendingPaymentConfirmation = data; }
function getPendingPayment()      { return pendingPaymentConfirmation; }
function clearPendingPayment()    { pendingPaymentConfirmation = null; }

function setPendingInvoice(data)  { pendingInvoiceSend = data; }
function getPendingInvoice()      { return pendingInvoiceSend; }
function clearPendingInvoice()    { pendingInvoiceSend = null; }

module.exports = {
  setPendingPayment, getPendingPayment, clearPendingPayment,
  setPendingInvoice, getPendingInvoice, clearPendingInvoice,
};
