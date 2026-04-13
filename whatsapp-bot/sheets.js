/**
 * Google Sheets integration for Baro Studio WhatsApp bot.
 * Mirrors the column structure defined in order-sheet/setup-sheet.gs
 */

const { google } = require("googleapis");

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const ORDERS_TAB = "Orders";

// 0-based column indices — must match setup-sheet.gs exactly
const COL = {
  orderId:       0,   // A
  date:          1,   // B
  source:        2,   // C
  customerName:  3,   // D
  whatsapp:      4,   // E
  instagram:     5,   // F
  city:          6,   // G
  address:       7,   // H
  itemName:      8,   // I
  size:          9,   // J
  colour:        10,  // K
  qty:           11,  // L
  unitPrice:     12,  // M
  totalAmount:   13,  // N
  paymentMethod: 14,  // O
  paymentStatus: 15,  // P
  paymentRef:    16,  // Q
  orderStatus:   17,  // R
  courier:       18,  // S
  trackingNo:    19,  // T
  invoiceNo:     20,  // U
  invoiceSent:   21,  // V
  notes:         22,  // W
};

const CONFIRMED_STATUSES = ["Confirmed", "In Production", "Ready", "Dispatched", "Delivered"];

async function getClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getAllRows() {
  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${ORDERS_TAB}!A2:X`,
  });
  return res.data.values || [];
}

// Returns the order object and its 1-based sheet row number
async function getOrderById(orderId) {
  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][COL.orderId] || "").toUpperCase() === orderId.toUpperCase()) {
      return { order: rowToOrder(rows[i]), sheetRow: i + 2 };
    }
  }
  return null;
}

async function getOrderByPhone(phone) {
  const normalised = normalisePhone(phone);
  const rows = await getAllRows();
  // Return the most recent order for this phone number
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (normalisePhone(row[COL.whatsapp] || "") === normalised && row[COL.customerName]) {
      return { order: rowToOrder(row), sheetRow: i + 2 };
    }
  }
  return null;
}

async function getPendingPaymentOrders() {
  const rows = await getAllRows();
  return rows
    .map((row, i) => ({ order: rowToOrder(row), sheetRow: i + 2 }))
    .filter(({ order }) =>
      order.customerName &&
      order.paymentStatus === "Pending" &&
      order.orderStatus !== "Cancelled"
    );
}

async function getDailySummary() {
  const rows = await getAllRows();
  const today = new Date().toLocaleDateString("en-PK");
  let count = 0;
  let revenue = 0;
  let unpaid = 0;

  for (const row of rows) {
    if (!row[COL.customerName]) continue;
    const rowDate = new Date(row[COL.date]).toLocaleDateString("en-PK");
    if (rowDate === today) {
      count++;
      revenue += parseFloat(row[COL.totalAmount]) || 0;
      if (row[COL.paymentStatus] === "Pending") unpaid++;
    }
  }
  return { count, revenue, unpaid };
}

// Appends a new order row; returns the auto-generated order ID
async function appendOrder(data) {
  const sheets = await getClient();

  // Count existing rows to generate order ID
  const rows = await getAllRows();
  const nextNum = rows.filter(r => r[COL.customerName]).length + 1;
  const orderId = `BS-${new Date().getFullYear()}-${String(nextNum).padStart(3, "0")}`;

  const today = new Date().toLocaleDateString("en-GB"); // DD/MM/YYYY
  const total = (data.qty || 1) * (data.unitPrice || 0);

  // Build row in column order — leave formula columns (A, N) blank so the sheet formula runs
  const row = Array(23).fill("");
  row[COL.orderId]       = orderId;
  row[COL.date]          = today;
  row[COL.source]        = data.source || "WhatsApp";
  row[COL.customerName]  = data.customerName || "";
  row[COL.whatsapp]      = data.whatsapp || "";
  row[COL.city]          = data.city || "";
  row[COL.address]       = data.address || "";
  row[COL.itemName]      = data.itemName || "";
  row[COL.size]          = data.size || "";
  row[COL.colour]        = data.colour || "";
  row[COL.qty]           = data.qty || 1;
  row[COL.unitPrice]     = data.unitPrice || 0;
  row[COL.totalAmount]   = total;
  row[COL.paymentMethod] = data.paymentMethod || "";
  row[COL.paymentStatus] = "Pending";
  row[COL.orderStatus]   = "Received";
  row[COL.notes]         = data.notes || "";

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${ORDERS_TAB}!A2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });

  return { orderId, total };
}

// Updates specific fields on an existing order row
async function updateOrder(sheetRow, fields) {
  const sheets = await getClient();
  const data = [];

  for (const [field, value] of Object.entries(fields)) {
    if (COL[field] === undefined) continue;
    const col = colLetter(COL[field] + 1);
    data.push({ range: `${ORDERS_TAB}!${col}${sheetRow}`, values: [[value]] });
  }

  if (!data.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

// Fetch rows where a notification needs to be sent (for poller.js)
async function getDispatchedUnnotified() {
  const rows = await getAllRows();
  return rows
    .map((row, i) => ({ order: rowToOrder(row), sheetRow: i + 2 }))
    .filter(({ order }) =>
      order.orderStatus === "Dispatched" &&
      order.trackingNo &&
      order.whatsapp &&
      !order.notes.includes("[tracking-sent]")
    );
}

async function getConfirmedUnnotified() {
  const rows = await getAllRows();
  return rows
    .map((row, i) => ({ order: rowToOrder(row), sheetRow: i + 2 }))
    .filter(({ order }) =>
      order.paymentStatus === "Received" &&
      CONFIRMED_STATUSES.includes(order.orderStatus) &&
      order.whatsapp &&
      !order.notes.includes("[confirm-sent]")
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToOrder(row) {
  return {
    orderId:       row[COL.orderId]       || "",
    date:          row[COL.date]          || "",
    source:        row[COL.source]        || "",
    customerName:  row[COL.customerName]  || "",
    whatsapp:      row[COL.whatsapp]      || "",
    city:          row[COL.city]          || "",
    address:       row[COL.address]       || "",
    itemName:      row[COL.itemName]      || "",
    size:          row[COL.size]          || "",
    colour:        row[COL.colour]        || "",
    qty:           row[COL.qty]           || "",
    unitPrice:     row[COL.unitPrice]     || "",
    totalAmount:   row[COL.totalAmount]   || "",
    paymentMethod: row[COL.paymentMethod] || "",
    paymentStatus: row[COL.paymentStatus] || "",
    orderStatus:   row[COL.orderStatus]   || "",
    courier:       row[COL.courier]       || "",
    trackingNo:    row[COL.trackingNo]    || "",
    invoiceNo:     row[COL.invoiceNo]     || "",
    notes:         row[COL.notes]         || "",
  };
}

function colLetter(n) {
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(((n - 1) % 26) + 65) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function normalisePhone(phone) {
  return phone.replace(/\D/g, "").replace(/^0/, "92");
}

module.exports = {
  getOrderById,
  getOrderByPhone,
  getPendingPaymentOrders,
  getDailySummary,
  appendOrder,
  updateOrder,
  getDispatchedUnnotified,
  getConfirmedUnnotified,
  normalisePhone,
};
