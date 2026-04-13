/**
 * Baro Studio — WhatsApp Bot
 *
 * Entry point. Connects to WhatsApp via Baileys (QR code scan on first run),
 * routes messages to the correct handler, and starts the status poller.
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
} = require("@whiskeysockets/baileys");
const qrcode  = require("qrcode-terminal");
const pino    = require("pino");
const path    = require("path");

const { routeMessage } = require("./router");
const { startPoller }  = require("./poller");

const AUTH_DIR = path.join(__dirname, "auth_info");

// Validate required env vars before starting
const REQUIRED_ENV = ["OWNER_PHONE", "ANTHROPIC_API_KEY", "GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing env variable: ${key}. Check your .env file.`);
    process.exit(1);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    // Suppress Baileys' verbose logging — only show warnings and above
    logger: pino({ level: "warn" }),
    printQRInTerminal: false, // we handle QR ourselves
  });

  // ── QR code ──
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan this QR code with Baro Studio WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`Connection closed (${statusCode}). ${shouldReconnect ? "Reconnecting..." : "Logged out."}`);

      if (shouldReconnect) {
        setTimeout(startBot, 3000);
      } else {
        console.log("Session ended. Delete auth_info/ and restart to re-scan QR.");
        process.exit(0);
      }
    }

    if (connection === "open") {
      console.log("\n✅ WhatsApp connected — Baro Studio bot is live.\n");
      // Start the poller once connected
      await startPoller(sendMessage.bind(null, sock));
    }
  });

  // ── Save session creds ──
  sock.ev.on("creds.update", saveCreds);

  // ── Incoming messages ──
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      // Ignore messages sent by us
      if (msg.key.fromMe) continue;

      const from = msg.key.remoteJid;

      // Ignore group messages
      if (from.endsWith("@g.us")) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "";

      if (!text.trim()) continue;

      console.log(`[${new Date().toLocaleTimeString()}] From ${from}: ${text.slice(0, 80)}`);

      try {
        const reply = await routeMessage({ from, text });
        if (reply) {
          await sendMessage(sock, from, reply);
        }
      } catch (err) {
        console.error(`Error handling message from ${from}:`, err.message);
      }
    }
  });
}

async function sendMessage(sock, jid, text) {
  await sock.sendMessage(jid, { text });
}

startBot().catch(console.error);
