/**
 * Baro Studio — Splendid Accounts Automation
 *
 * Reads new orders from Google Sheets and auto-creates invoices in
 * Splendid Accounts (splendidaccounts.pk) using browser automation.
 *
 * SETUP:
 *   npm install playwright @playwright/test googleapis dotenv
 *   npx playwright install chromium
 *   cp .env.example .env   # fill in your credentials
 *   node splendid-bot.js
 */

require("dotenv").config();
const { chromium } = require("playwright");
const { google } = require("googleapis");

// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
  splendid: {
    url: "https://app.splendidaccounts.pk",
    email: process.env.SPLENDID_EMAIL,
    password: process.env.SPLENDID_PASSWORD,
  },
  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    ordersTab: "Orders",
    // Column indices (0-based) matching setup-sheet.gs
    cols: {
      orderId: 0,
      date: 1,
      customerName: 3,
      whatsapp: 4,
      city: 6,
      address: 7,
      itemName: 8,
      size: 9,
      colour: 10,
      qty: 11,
      unitPrice: 12,
      totalAmount: 13,
      paymentMethod: 14,
      orderStatus: 17,
      invoiceNo: 20,     // U — written back after creation
      invoiceSent: 21,   // V — written back after sending
    },
  },
};

// ── Google Sheets auth ────────────────────────────────────────────────────────
async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// ── Fetch orders that need invoicing ─────────────────────────────────────────
async function fetchPendingOrders(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheets.spreadsheetId,
    range: `${CONFIG.sheets.ordersTab}!A2:W`,
  });

  const rows = res.data.values || [];
  const { cols } = CONFIG.sheets;

  return rows
    .map((row, index) => ({ row, sheetRow: index + 2 })) // +2 because 1-indexed + header
    .filter(({ row }) => {
      const hasCustomer  = row[cols.customerName]?.trim();
      const confirmed    = ["Confirmed", "In Production", "Ready", "Dispatched"]
        .includes(row[cols.orderStatus]);
      const noInvoiceYet = !row[cols.invoiceNo]?.trim();
      return hasCustomer && confirmed && noInvoiceYet;
    })
    .map(({ row, sheetRow }) => ({
      sheetRow,
      orderId:       row[cols.orderId]      || "",
      date:          row[cols.date]         || new Date().toLocaleDateString("en-PK"),
      customerName:  row[cols.customerName] || "",
      whatsapp:      row[cols.whatsapp]     || "",
      city:          row[cols.city]         || "",
      address:       row[cols.address]      || "",
      itemName:      row[cols.itemName]     || "",
      size:          row[cols.size]         || "",
      colour:        row[cols.colour]       || "",
      qty:           parseInt(row[cols.qty]) || 1,
      unitPrice:     parseFloat(row[cols.unitPrice]) || 0,
      totalAmount:   parseFloat(row[cols.totalAmount]) || 0,
      paymentMethod: row[cols.paymentMethod] || "",
    }));
}

// ── Write invoice number back to sheet ───────────────────────────────────────
async function markInvoiceCreated(sheets, sheetRow, invoiceNo) {
  const { cols } = CONFIG.sheets;
  // Write invoice number to column U and "Yes" to column V
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CONFIG.sheets.spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: `${CONFIG.sheets.ordersTab}!U${sheetRow}`,
          values: [[invoiceNo]],
        },
        {
          range: `${CONFIG.sheets.ordersTab}!V${sheetRow}`,
          values: [["Yes"]],
        },
      ],
    },
  });
}

// ── Create invoice in Splendid ────────────────────────────────────────────────
async function createInvoiceInSplendid(page, order) {
  console.log(`  Creating invoice for: ${order.customerName} (${order.orderId})`);

  // Navigate to new invoice page
  await page.goto(`${CONFIG.splendid.url}/sales/invoices/new`, { waitUntil: "networkidle" });

  // ── Customer field ──
  // Splendid uses a searchable customer dropdown
  const customerField = page.locator('input[placeholder*="Customer"], input[placeholder*="customer"], [data-field="customer"] input').first();
  await customerField.click();
  await customerField.fill(order.customerName);
  await page.waitForTimeout(600);

  // Check if customer exists in dropdown; if not, create new
  const dropdown = page.locator('.dropdown-item, .select-option, [role="option"]').filter({ hasText: order.customerName });
  const count = await dropdown.count();

  if (count > 0) {
    await dropdown.first().click();
  } else {
    // Try "Add new customer" option in dropdown
    const addNew = page.locator('.dropdown-item, [role="option"]').filter({ hasText: /add|new|create/i });
    if (await addNew.count() > 0) {
      await addNew.first().click();
      await page.waitForTimeout(500);
      // Fill in new customer details in the modal
      await fillNewCustomerModal(page, order);
    } else {
      // Just type the name and press Enter — Splendid may accept free text
      await customerField.press("Enter");
    }
  }

  // ── Invoice date ──
  const dateField = page.locator('input[type="date"], input[placeholder*="date" i]').first();
  if (await dateField.count() > 0) {
    const d = new Date(order.date);
    const formatted = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    await dateField.fill(formatted);
  }

  // ── Line item ──
  // Add the item description, quantity, and price
  const itemDescField = page.locator('input[placeholder*="item" i], input[placeholder*="description" i], input[placeholder*="product" i]').first();
  if (await itemDescField.count() > 0) {
    await itemDescField.fill(`${order.itemName}${order.size ? " – " + order.size : ""}${order.colour ? " / " + order.colour : ""}`);
    await page.waitForTimeout(400);
    // Dismiss any autocomplete if it appears
    await page.keyboard.press("Escape");
  }

  const qtyField = page.locator('input[placeholder*="qty" i], input[placeholder*="quantity" i]').first();
  if (await qtyField.count() > 0) {
    await qtyField.fill(String(order.qty));
  }

  const priceField = page.locator('input[placeholder*="price" i], input[placeholder*="rate" i], input[placeholder*="amount" i]').first();
  if (await priceField.count() > 0) {
    await priceField.fill(String(order.unitPrice));
  }

  // ── Notes / reference ──
  const notesField = page.locator('textarea[placeholder*="note" i], input[placeholder*="note" i], textarea[placeholder*="remark" i]').first();
  if (await notesField.count() > 0) {
    await notesField.fill(
      `Order ID: ${order.orderId}\nWhatsApp: ${order.whatsapp}\nAddress: ${order.address}, ${order.city}\nPayment: ${order.paymentMethod}`
    );
  }

  // ── Save the invoice ──
  const saveBtn = page.locator('button:has-text("Save"), button:has-text("Submit"), button[type="submit"]').first();
  await saveBtn.click();
  await page.waitForTimeout(1500);

  // ── Extract invoice number from the page ──
  let invoiceNo = order.orderId; // fallback to our own order ID
  const invoiceNoEl = page.locator('[data-field="invoice_number"], .invoice-number, h4, h3').first();
  if (await invoiceNoEl.count() > 0) {
    const text = await invoiceNoEl.textContent();
    const match = text.match(/INV[-#]?\d+/i);
    if (match) invoiceNo = match[0];
  }

  console.log(`  Invoice created: ${invoiceNo}`);
  return invoiceNo;
}

// ── Fill new customer modal ───────────────────────────────────────────────────
async function fillNewCustomerModal(page, order) {
  await page.locator('input[name*="name" i], input[placeholder*="name" i]').first().fill(order.customerName);
  const phoneField = page.locator('input[name*="phone" i], input[name*="mobile" i]').first();
  if (await phoneField.count() > 0) await phoneField.fill(order.whatsapp);
  const cityField = page.locator('input[name*="city" i]').first();
  if (await cityField.count() > 0) await cityField.fill(order.city);
  const saveModal = page.locator('button:has-text("Save"), button:has-text("Add"), button[type="submit"]').first();
  await saveModal.click();
  await page.waitForTimeout(800);
}

// ── Log into Splendid ─────────────────────────────────────────────────────────
async function loginToSplendid(page) {
  console.log("Logging into Splendid Accounts...");
  await page.goto(CONFIG.splendid.url, { waitUntil: "networkidle" });

  // Fill credentials
  await page.locator('input[type="email"], input[name="email"]').fill(CONFIG.splendid.email);
  await page.locator('input[type="password"], input[name="password"]').fill(CONFIG.splendid.password);
  await page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').click();
  await page.waitForNavigation({ waitUntil: "networkidle" });
  console.log("Logged in.");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("Baro Studio — Splendid Accounts Bot");
  console.log("=====================================");

  // Validate env
  const required = ["SPLENDID_EMAIL", "SPLENDID_PASSWORD", "GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_KEY"];
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing env variable: ${key}. Check your .env file.`);
      process.exit(1);
    }
  }

  const sheets = await getSheetsClient();
  const orders = await fetchPendingOrders(sheets);

  if (orders.length === 0) {
    console.log("No new orders need invoicing. Done.");
    return;
  }

  console.log(`Found ${orders.length} order(s) to invoice.`);

  const browser = await chromium.launch({ headless: false }); // set true for silent mode
  const context = await browser.newContext();
  const page    = await context.newPage();

  try {
    await loginToSplendid(page);

    for (const order of orders) {
      try {
        const invoiceNo = await createInvoiceInSplendid(page, order);
        await markInvoiceCreated(sheets, order.sheetRow, invoiceNo);
        console.log(`  Order ${order.orderId} — invoice ${invoiceNo} saved to sheet.`);
      } catch (err) {
        console.error(`  Failed for order ${order.orderId}:`, err.message);
        // Continue with next order — don't stop the whole run
      }
    }

    console.log("\nAll done. Check your Splendid invoices list.");
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
