/**
 * Baro Studio — WhatsApp Bot
 *
 * Entry point. Connects via Baileys (QR code scan on first run), classifies
 * each incoming message as text / audio (voice note) / image (payment
 * screenshot), and routes it to the correct handler.
 *
 * FIRST RUN:
 *   A QR code will appear in the terminal. Scan it with the Baro Studio
 *   WhatsApp Business app. The session is saved to ./auth_info/ so the
 *   QR code is only needed once.
 *
 * USAGE:
 *   node bot.js
 */

require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");
const qrcode = require("qrcode-terminal");
const pino   = require("pino");
const path   = require("path");

const { routeMessage } = require("./router");

const AUTH_DIR = path.join(__dirname, "auth_info");

const REQUIRED_ENV = [
  "OWNER_PHONE",
  "ANTHROPIC_API_KEY",
  "GOOGLE_SHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
  "OPENAI_API_KEY",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing env variable: ${key}. Check your .env file.`);
    process.exit(1);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();
  const logger               = pino({ level: "warn" });

  const sock = makeWASocket({
    version,
    auth:              state,
    logger,
    printQRInTerminal: false,
  });

  // ── send() helper passed to all route handlers ───────────────────────────
  // payload can be a plain string or a Baileys message content object.
  async function send(jid, payload) {
    if (typeof payload === "string") {
      await sock.sendMessage(jid, { text: payload });
    } else {
      await sock.sendMessage(jid, payload);
    }
  }

  // ── QR / connection ───────────────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code with Baro Studio WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`Connection closed (${code}). Reconnecting…`);
        setTimeout(startBot, 3000);
      } else {
        console.log("Logged out. Delete auth_info/ and restart to re-scan QR.");
        process.exit(0);
      }
    }

    if (connection === "open") {
      console.log("\n✅ WhatsApp connected — Baro Studio bot is live.\n");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ── Incoming messages ─────────────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    console.log(`[debug] upsert type=${type} count=${messages.length} fromMe=${messages.map(m=>m.key.fromMe)}`);
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      if (from.endsWith("@g.us")) continue; // ignore group messages

      const msgObj = await classifyMessage(sock, msg, logger);
      if (!msgObj) continue; // nothing actionable

      console.log(
        `[${new Date().toLocaleTimeString()}] ${msgObj.type} from ${from}` +
        (msgObj.text ? `: ${msgObj.text.slice(0, 80)}` : "")
      );

      try {
        await routeMessage(msgObj, send);
      } catch (err) {
        console.error(`Error handling message from ${from}:`, err.message);
      }
    }
  });
}

// ── Message classifier ────────────────────────────────────────────────────────
// Returns a normalised message object or null if nothing actionable.
//
// {
//   from:        "923001234567@s.whatsapp.net"
//   type:        "text" | "audio" | "image"
//   text:        string  (transcribed for audio, caption for image, "" if none)
//   audioBuffer: Buffer | null
//   mimeType:    string | null
// }

async function classifyMessage(sock, msg, logger) {
  const from = msg.key.remoteJid;
  const m    = msg.message || {};

  // Text
  const textBody =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    null;

  if (textBody) {
    return { from, type: "text", text: textBody.trim(), audioBuffer: null, mimeType: null };
  }

  // Audio / voice note
  if (m.audioMessage) {
    try {
      const buffer   = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      const mimeType = m.audioMessage.mimetype || "audio/ogg";
      return { from, type: "audio", text: "", audioBuffer: buffer, mimeType };
    } catch (err) {
      console.error("Failed to download audio:", err.message);
      return null;
    }
  }

  // Image (payment screenshot or other)
  if (m.imageMessage) {
    const caption = m.imageMessage.caption?.trim() || "";
    try {
      const buffer = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      return { from, type: "image", text: caption, audioBuffer: null, mimeType: m.imageMessage.mimetype || "image/jpeg", imageBuffer: buffer };
    } catch (err) {
      console.error("Failed to download image:", err.message);
      // Still handle it as an image with no buffer — handler will deal gracefully
      return { from, type: "image", text: caption, audioBuffer: null, mimeType: null, imageBuffer: null };
    }
  }

  return null; // sticker, video, document, etc. — ignore
}

startBot().catch(console.error);
