/**
 * Baro Studio — Splendid Accounts Invoice Bot (API version)
 *
 * Reads confirmed orders from Google Sheets that don't have a Splendid
 * invoice yet, creates them via the Splendid REST API, and writes the
 * invoice number back to the sheet.
 *
 * SETUP:
 *   npm install googleapis dotenv
 *   cp .env.example .env   # fill in your credentials
 *   node splendid-bot.js
 *
 * Run once a day or as needed. Safe to run multiple times — only processes
 * orders where column U (Invoice No) is empty.
 */

require("dotenv").config();
const { google }       = require("googleapis");
const SplendidClient   = require("./splendid-client");

const SHEET_ID    = process.env.GOOGLE_SHEET_ID;
const ORDERS_TAB  = "Orders";

// 0-based column indices — must match setup-sheet.gs
const COL = {
  orderId: 0, date: 1, customerName: 3, whatsapp: 4, city: 6,
  address: 7, itemName: 8, size: 9, colour: 10, qty: 11,
  unitPrice: 12, totalAmount: 13, paymentMethod: 14,
  paymentStatus: 15, orderStatus: 17, invoiceNo: 20, invoiceSent: 21,
};

const READY_STATUSES = ["Confirmed", "In Production", "Ready", "Dispatched"];

// ── Google Sheets ────────────────────────────────────────────────────────────

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function fetchPendingOrders(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${ORDERS_TAB}!A2:W`,
  });

  return (res.data.values || [])
    .map((row, i) => ({ row, sheetRow: i + 2 }))
    .filter(({ row }) =>
      row[COL.customerName]?.trim() &&
      READY_STATUSES.includes(row[COL.orderStatus]) &&
      !row[COL.invoiceNo]?.trim()
    )
    .map(({ row, sheetRow }) => ({
      sheetRow,
      orderId:      row[COL.orderId]      || "",
      date:         row[COL.date]         || "",
      customerName: row[COL.customerName] || "",
      whatsapp:     row[COL.whatsapp]     || "",
      city:         row[COL.city]         || "",
      address:      row[COL.address]      || "",
      itemName:     row[COL.itemName]     || "",
      size:         row[COL.size]         || "",
      colour:       row[COL.colour]       || "",
      qty:          row[COL.qty]          || 1,
      unitPrice:    row[COL.unitPrice]    || 0,
      totalAmount:  row[COL.totalAmount]  || 0,
      paymentMethod: row[COL.paymentMethod] || "",
      paymentStatus: row[COL.paymentStatus] || "",
    }));
}

async function markInvoiceCreated(sheets, sheetRow, invoiceNo) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        { range: `${ORDERS_TAB}!U${sheetRow}`, values: [[invoiceNo]] },
        { range: `${ORDERS_TAB}!V${sheetRow}`, values: [["Yes"]] },
      ],
    },
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Baro Studio — Splendid Invoice Bot (API)");
  console.log("==========================================");

  const required = [
    "SPLENDID_API_KEY", "SPLENDID_API_SECRET", "SPLENDID_APP_ID",
    "SPLENDID_TENANT", "SPLENDID_BRANCH_ID", "SPLENDID_WAREHOUSE_ID",
    "SPLENDID_DEFAULT_PRODUCT_ID", "GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY",
  ];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing env variable: ${key}`);
      process.exit(1);
    }
  }

  const splendid = new SplendidClient();
  const sheets   = await getSheetsClient();
  const orders   = await fetchPendingOrders(sheets);

  if (orders.length === 0) {
    console.log("No orders need invoicing. Done.");
    return;
  }

  console.log(`Processing ${orders.length} order(s)...\n`);

  for (const order of orders) {
    console.log(`→ ${order.orderId} — ${order.customerName}`);
    try {
      // 1. Find or create customer in Splendid
      const customerId = await splendid.findOrCreateCustomer(order);
      console.log(`  Customer ID: ${customerId}`);

      // 2. Create the invoice
      const invoice = await splendid.createInvoice(order, customerId);
      const invoiceNo = invoice.number || invoice.id?.toString() || order.orderId;
      console.log(`  Invoice: ${invoiceNo}`);

      // 3. If already paid, record the payment too
      if (order.paymentStatus === "Received" && process.env.SPLENDID_BANK_ACCOUNT_ID) {
        await splendid.recordPayment({
          customerId,
          amount:    parseFloat(order.totalAmount),
          reference: order.orderId,
          accountId: parseInt(process.env.SPLENDID_BANK_ACCOUNT_ID),
          paymentMode: 40, // Direct Deposit
        });
        console.log(`  Payment recorded.`);
      }

      // 4. Write invoice number back to sheet
      await markInvoiceCreated(sheets, order.sheetRow, invoiceNo);
      console.log(`  ✅ Done\n`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}\n`);
    }
  }

  console.log("Finished.");
}

main().catch(console.error);
