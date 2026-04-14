/**
 * Voice note transcription using OpenAI Whisper.
 * Accepts an audio Buffer from a WhatsApp audioMessage and returns text.
 */

const { OpenAI } = require("openai");
const fs   = require("fs");
const os   = require("os");
const path = require("path");

let openai = null;

function getClient() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set.");
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

/**
 * Transcribe an audio buffer.
 *
 * @param {Buffer} buffer      - raw audio bytes (OGG/Opus from WhatsApp)
 * @param {string} [mimeType]  - e.g. "audio/ogg; codecs=opus"
 * @returns {Promise<string>}  - transcribed text
 */
async function transcribeAudio(buffer, mimeType) {
  // Choose file extension from mime type; default to ogg (WhatsApp voice notes)
  let ext = "ogg";
  if (mimeType) {
    if (mimeType.includes("mp4") || mimeType.includes("m4a")) ext = "m4a";
    else if (mimeType.includes("webm"))                        ext = "webm";
    else if (mimeType.includes("wav"))                         ext = "wav";
    else if (mimeType.includes("mp3") || mimeType.includes("mpeg")) ext = "mp3";
  }

  const tmpFile = path.join(os.tmpdir(), `baro-voice-${Date.now()}.${ext}`);
  fs.writeFileSync(tmpFile, buffer);

  try {
    const transcript = await getClient().audio.transcriptions.create({
      file:  fs.createReadStream(tmpFile),
      model: "whisper-1",
      // No language specified — Whisper auto-detects English / Urdu / Roman Urdu
    });
    return transcript.text.trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore cleanup errors */ }
  }
}

module.exports = { transcribeAudio };
