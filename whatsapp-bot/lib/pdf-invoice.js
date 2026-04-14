/**
 * Generates a PDF invoice for a Baro Studio order.
 * Returns a Buffer so the caller can send it via WhatsApp.
 *
 * Uses PDFKit — no browser or headless Chrome required.
 */

const PDFDocument = require("pdfkit");

/**
 * @param {object} order      - order object from sheets.js rowToOrder()
 * @param {string} [invoiceNo]- Splendid invoice number (optional)
 * @returns {Promise<Buffer>}
 */
function generateInvoicePdf(order, invoiceNo) {
  return new Promise((resolve, reject) => {
    const doc  = new PDFDocument({ size: "A4", margin: 50 });
    const bufs = [];

    doc.on("data",  (c) => bufs.push(c));
    doc.on("end",   ()  => resolve(Buffer.concat(bufs)));
    doc.on("error", reject);

    const L   = 50;    // left margin
    const R   = 545;   // right edge
    const MID = 300;   // mid-page

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(22).font("Helvetica-Bold").text("BARO STUDIO", { align: "center" });
    doc.fontSize(9).font("Helvetica").fillColor("#666666")
       .text("Limited Edition Clothing  |  Karachi", { align: "center" });
    doc.text("@barostudio___  |  instagram.com/barostudio___", { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(0.8);

    // ── Rule ────────────────────────────────────────────────────────────────
    rule(doc, L, R);
    doc.moveDown(0.6);

    // ── Invoice title + reference numbers ───────────────────────────────────
    doc.fontSize(13).font("Helvetica-Bold").text("INVOICE", { align: "center" });
    doc.moveDown(0.5);

    const today = order.date
      ? new Date(order.date).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" })
      : new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });

    const labelW = 110;
    const valX   = L + labelW;

    doc.fontSize(9).font("Helvetica");
    labelVal(doc, L, valX, "Date:",        today);
    labelVal(doc, L, valX, "Order ID:",    order.orderId  || "—");
    if (invoiceNo) {
      labelVal(doc, L, valX, "Invoice No:", invoiceNo);
    }
    doc.moveDown(0.8);

    // ── Bill To ─────────────────────────────────────────────────────────────
    doc.fontSize(9).font("Helvetica-Bold").text("BILL TO", L);
    doc.font("Helvetica").fontSize(9);
    doc.text(order.customerName || "—", L);
    if (order.whatsapp) doc.text(`WhatsApp: ${order.whatsapp}`, L);
    if (order.city)     doc.text(order.city, L);
    if (order.address)  doc.text(order.address, L);
    doc.moveDown(0.8);

    // ── Item table ───────────────────────────────────────────────────────────
    rule(doc, L, R);
    doc.moveDown(0.4);

    // Table header
    const colItem  = L;
    const colSize  = 240;
    const colQty   = 360;
    const colAmt   = 430;
    const rowH     = 16;

    let y = doc.y;
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Item",          colItem, y, { width: 185 });
    doc.text("Size / Colour", colSize, y, { width: 110 });
    doc.text("Qty",           colQty,  y, { width: 60 });
    doc.text("Amount (PKR)",  colAmt,  y, { width: 115, align: "right" });
    y += rowH;

    rule(doc, L, R, y);
    y += 6;

    // Item row
    doc.font("Helvetica").fontSize(9);
    const sizeCol = [order.size, order.colour].filter(Boolean).join(" / ") || "—";
    const amount  = parseFloat(order.totalAmount || 0);
    doc.text(order.itemName || "—",    colItem, y, { width: 185 });
    doc.text(sizeCol,                  colSize, y, { width: 110 });
    doc.text(String(order.qty || 1),   colQty,  y, { width: 60 });
    doc.text(fmt(amount),              colAmt,  y, { width: 115, align: "right" });
    y += rowH;

    rule(doc, L, R, y);
    y += 8;

    // Total row
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("TOTAL",   colQty, y, { width: 60 });
    doc.text(fmt(amount), colAmt, y, { width: 115, align: "right" });
    y += rowH + 4;

    // Payment status badge
    const paid = (order.paymentStatus || "").toLowerCase() === "received";
    doc.fontSize(9).font("Helvetica")
       .fillColor(paid ? "#155724" : "#856404")
       .text(paid ? "PAID" : "PAYMENT PENDING", colAmt, y, { width: 115, align: "right" });
    doc.fillColor("#000000");
    y += rowH + 8;

    // ── Payment methods ──────────────────────────────────────────────────────
    doc.y = y;
    rule(doc, L, R);
    doc.moveDown(0.6);
    doc.fontSize(9).font("Helvetica-Bold").text("Payment Methods", L);
    doc.font("Helvetica").text("JazzCash  |  Easypaisa  |  Bank Transfer", L);
    doc.text("Payment details will be shared on request.", L);
    doc.moveDown(1.2);

    // ── Footer ───────────────────────────────────────────────────────────────
    rule(doc, L, R);
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#444444").font("Helvetica-BoldOblique")
       .text("Thank you for shopping with Baro Studio! 🤍", { align: "center" });
    doc.font("Helvetica").fontSize(8).fillColor("#888888")
       .text("For queries, reply to this WhatsApp chat.", { align: "center" });

    doc.end();
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rule(doc, x1, x2, atY) {
  const y = atY !== undefined ? atY : doc.y;
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor("#cccccc").lineWidth(0.5).stroke();
  doc.strokeColor("#000000").lineWidth(1);
}

function labelVal(doc, lx, vx, label, value) {
  const y = doc.y;
  doc.font("Helvetica-Bold").text(label, lx, y, { width: vx - lx - 4, continued: false });
  doc.font("Helvetica").text(value, vx, y - doc.currentLineHeight());
}

function fmt(n) {
  return "PKR " + (parseFloat(n) || 0).toLocaleString("en-PK");
}

module.exports = { generateInvoicePdf };
