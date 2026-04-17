/**
 * Routes incoming WhatsApp messages to the correct handler
 * based on whether the sender is the owner or a customer.
 *
 * Both handlers receive:
 *   message - normalised message object from bot.js
 *   send    - async (jid, payload) => void
 */

const { handleOwnerMessage }    = require("./handlers/owner");
const { handleCustomerMessage } = require("./handlers/customer");
const { normalisePhone }        = require("./sheets");

const OWNER_PHONE = normalisePhone(process.env.OWNER_PHONE || "");
const OWNER_JID   = `${OWNER_PHONE}@s.whatsapp.net`;

function isOwner(jid) {
  return jid === OWNER_JID ||
         jid === `${OWNER_PHONE}@lid` ||
         jid.startsWith(`${OWNER_PHONE}:`);
}

async function routeMessage(message, send) {
  if (isOwner(message.from)) {
    await handleOwnerMessage(message, send);
  } else {
    await handleCustomerMessage(message, send);
  }
}

module.exports = { routeMessage, OWNER_JID };
