/**
 * Routes incoming WhatsApp messages to the correct handler
 * based on whether the sender is the owner or a customer.
 */

const { handleOwnerMessage } = require("./handlers/owner");
const { handleCustomerMessage } = require("./handlers/customer");
const { normalisePhone } = require("./sheets");

const OWNER_PHONE = normalisePhone(process.env.OWNER_PHONE || "");

function isOwner(jid) {
  // Baileys JIDs look like: 923001234567@s.whatsapp.net
  const phone = jid.split("@")[0];
  return phone === OWNER_PHONE;
}

async function routeMessage(message) {
  const from = message.from;
  const text = message.text;

  if (!text || !text.trim()) return null; // ignore empty/media-only messages

  if (isOwner(from)) {
    return await handleOwnerMessage(message);
  } else {
    return await handleCustomerMessage(message);
  }
}

module.exports = { routeMessage };
