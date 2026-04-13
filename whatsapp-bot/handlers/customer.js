/**
 * Handles incoming messages from customers (non-owner numbers).
 * - Order status lookup by order ID
 * - FAQ keyword auto-replies
 * - Fallback holding message
 */

const { getOrderById } = require("../sheets");

// Matches patterns like BS-2026-001 or bs2026001 (forgiving)
const ORDER_ID_RE = /\b(BS[-\s]?\d{4}[-\s]?\d{3})\b/i;

const FAQ = [
  {
    keywords: ["size", "sizes", "sizing", "measurements", "fit"],
    reply:
      "We offer XS, S, M, L, XL, and XXL — plus Free Size and Custom where applicable.\n\nEach piece mentions available sizes. Feel free to ask about a specific item! 🤍",
  },
  {
    keywords: ["fabric", "material", "cloth", "cotton", "lawn", "silk", "linen"],
    reply:
      "All fabric details are in our Instagram captions (@barostudio___). Feel free to ask about a specific piece and we'll tell you exactly what it's made of! 🤍",
  },
  {
    keywords: ["price", "cost", "rate", "how much", "kitna"],
    reply:
      "Prices vary per piece and are listed in our Instagram posts. DM us the item you're interested in and we'll share the price. 🤍",
  },
  {
    keywords: ["delivery", "shipping", "ship", "courier", "kitne din", "how long", "days"],
    reply:
      "Delivery times:\n• Within Karachi: 1–2 working days\n• Other cities: 3–5 working days\n\nWe ship via TCS, Leopards, and BlueEx.",
  },
  {
    keywords: ["payment", "pay", "jazzcash", "easypaisa", "bank", "transfer"],
    reply:
      "We accept:\n💳 JazzCash\n💳 Easypaisa\n🏦 Bank Transfer\n\nPayment details will be shared once you confirm your order.",
  },
  {
    keywords: ["exchange", "return", "refund", "wrong size", "problem", "issue", "complaint"],
    reply:
      "We accept exchanges within 48 hours of delivery, provided the item is unworn and in its original condition.\n\nPlease share:\n1. Your Order ID\n2. A clear photo of the item\n3. The reason\n\nWe'll sort it out! 🤍",
  },
  {
    keywords: ["available", "stock", "in stock", "sold out", "milega", "hai"],
    reply:
      "Our pieces are limited edition. Check our Instagram (@barostudio___) for current availability, or tell us which item you're interested in and we'll confirm! 🤍",
  },
  {
    keywords: ["drop", "new", "collection", "launch", "next", "kab"],
    reply:
      "Stay tuned on Instagram @barostudio___ — we announce all new drops there first!\n\nWant early access? Let us know and we'll add you to our broadcast list 🤍",
  },
  {
    keywords: ["order", "place order", "buy", "purchase", "lena hai", "chahiye"],
    reply:
      "To place an order, please share:\n\n1. Item name / description\n2. Size\n3. Your full delivery address\n4. Contact number\n\nWe'll confirm availability and send payment details. 🤍",
  },
  {
    keywords: ["instagram", "insta", "social", "page", "handle"],
    reply: "Find us on Instagram: @barostudio___\n\nWe post new arrivals, restocks, and behind-the-scenes there first! 📸",
  },
];

async function handleCustomerMessage(message) {
  const text = (message.text || "").trim();
  const lower = text.toLowerCase();

  // ── 1. Order status lookup ────────────────────────────────────────────────
  const idMatch = text.match(ORDER_ID_RE);
  if (idMatch) {
    const orderId = idMatch[1].replace(/\s/g, "-").toUpperCase();
    try {
      const result = await getOrderById(orderId);
      if (result) {
        const o = result.order;
        const lines = [
          `Order *${o.orderId}* status:`,
          `📦 Item: ${o.itemName}${o.size ? " (" + o.size + ")" : ""}`,
          `💰 Amount: PKR ${o.totalAmount}`,
          `💳 Payment: ${o.paymentStatus}`,
          `🚦 Status: ${o.orderStatus}`,
        ];
        if (o.courier && o.trackingNo) {
          lines.push(`🚚 Tracking: ${o.courier} — ${o.trackingNo}`);
        }
        lines.push("\nFor help, reply to this chat. 🤍");
        return lines.join("\n");
      } else {
        return `We couldn't find order *${orderId}*. Please double-check the order ID, or message us and we'll look it up. 🤍`;
      }
    } catch {
      return "We're having trouble looking up your order right now. Please try again in a moment. 🤍";
    }
  }

  // ── 2. FAQ keyword matching ───────────────────────────────────────────────
  for (const faq of FAQ) {
    if (faq.keywords.some(kw => lower.includes(kw))) {
      return faq.reply;
    }
  }

  // ── 3. Greeting ───────────────────────────────────────────────────────────
  if (/^(hi|hello|hey|salam|assalam|aoa|helo|hii|hiii)\b/i.test(lower)) {
    return "Hi! 🤍 Welcome to Baro Studio.\n\nHow can we help you? You can ask about sizes, delivery, placing an order, or send your Order ID to check status.";
  }

  // ── 4. Fallback ───────────────────────────────────────────────────────────
  return "Thanks for your message! 🤍 We'll get back to you shortly.\n\nFor quick answers, you can ask about:\n• Sizes & fabric\n• Delivery & payment\n• Placing an order\n• Your order status (send your Order ID)";
}

module.exports = { handleCustomerMessage };
