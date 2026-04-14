/**
 * Baro Studio — Order Tracking Sheet Setup
 *
 * HOW TO USE:
 * 1. Go to https://sheets.new to create a new Google Sheet
 * 2. Click Extensions > Apps Script
 * 3. Paste this entire file into the editor
 * 4. Click Run > setupBaroStudioSheet
 * 5. Grant permissions when prompted
 * 6. Your sheet will be fully set up with all columns, dropdowns, and formatting
 */

function setupBaroStudioSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── 1. ORDERS SHEET ──────────────────────────────────────────────────────────
  let ordersSheet = ss.getSheetByName("Orders");
  if (!ordersSheet) ordersSheet = ss.insertSheet("Orders");
  ordersSheet.clearContents();
  ordersSheet.clearFormats();

  const headers = [
    "Order ID",           // A - auto-generated e.g. BS-2026-001
    "Date",               // B
    "Source",             // C - WhatsApp / Instagram
    "Customer Name",      // D
    "WhatsApp Number",    // E
    "Instagram Handle",   // F
    "City",               // G
    "Full Address",       // H
    "Item Name",          // I
    "Size",               // J
    "Colour / Variant",   // K
    "Qty",                // L
    "Unit Price (PKR)",   // M
    "Total Amount (PKR)", // N - formula: L * M
    "Payment Method",     // O
    "Payment Status",     // P
    "Payment Reference",  // Q - screenshot note / JazzCash TxID
    "Order Status",       // R
    "Courier",            // S
    "Tracking Number",    // T
    "Invoice No (Splendid)", // U
    "Invoice Sent?",      // V
    "Notes"               // W
  ];

  // Write headers
  ordersSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // Style header row
  const headerRange = ordersSheet.getRange(1, 1, 1, headers.length);
  headerRange
    .setBackground("#1a1a1a")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10);

  // Freeze header row
  ordersSheet.setFrozenRows(1);
  ordersSheet.setFrozenColumns(1);

  // Column widths
  const colWidths = [110, 90, 100, 150, 130, 130, 100, 200, 160, 70, 120, 50, 110, 120, 120, 110, 140, 120, 100, 130, 130, 90, 180];
  colWidths.forEach((w, i) => ordersSheet.setColumnWidth(i + 1, w));

  // ── Dropdowns ──
  const dataRange = ordersSheet.getRange(2, 1, 500, headers.length);

  // Source (C)
  setDropdown(ordersSheet, 2, 3, 500, ["WhatsApp", "Instagram", "Walk-in", "Cult Store", "Other"]);

  // Size (J)
  setDropdown(ordersSheet, 2, 10, 500, ["XS", "S", "M", "L", "XL", "XXL", "Free Size", "Custom"]);

  // Payment Method (O)
  setDropdown(ordersSheet, 2, 15, 500, ["JazzCash", "Easypaisa", "Bank Transfer", "Cash on Delivery", "Card"]);

  // Payment Status (P)
  setDropdown(ordersSheet, 2, 16, 500, ["Pending", "Received", "Partial", "Refunded"]);

  // Order Status (R)
  setDropdown(ordersSheet, 2, 18, 500, ["Received", "Confirmed", "In Production", "Ready", "Dispatched", "Delivered", "Cancelled", "Returned"]);

  // Courier (S)
  setDropdown(ordersSheet, 2, 19, 500, ["TCS", "Leopards", "BlueEx", "PostEx", "M&P", "Bykea", "Self Drop-off", "Other"]);

  // Invoice Sent (V)
  setDropdown(ordersSheet, 2, 22, 500, ["No", "Yes"]);

  // ── Auto Total formula (N = L * M) ──
  for (let row = 2; row <= 501; row++) {
    ordersSheet.getRange(row, 14).setFormula(`=IF(L${row}="","",L${row}*M${row})`);
  }

  // ── Auto Order ID formula (A) ──
  for (let row = 2; row <= 501; row++) {
    ordersSheet.getRange(row, 1).setFormula(
      `=IF(D${row}="","","BS-"&TEXT(YEAR(TODAY()),"0000")&"-"&TEXT(ROW()-1,"000"))`
    );
  }

  // ── Conditional formatting for Order Status ──
  const statusRange = ordersSheet.getRange("R2:R501");
  const rules = [
    { value: "Delivered",    bg: "#d4edda", fg: "#155724" },
    { value: "Dispatched",   bg: "#cce5ff", fg: "#004085" },
    { value: "In Production",bg: "#fff3cd", fg: "#856404" },
    { value: "Confirmed",    bg: "#e2d9f3", fg: "#4a235a" },
    { value: "Received",     bg: "#f8f9fa", fg: "#343a40" },
    { value: "Cancelled",    bg: "#f8d7da", fg: "#721c24" },
    { value: "Returned",     bg: "#ffeeba", fg: "#856404" },
  ];
  const cfRules = rules.map(r =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(r.value)
      .setBackground(r.bg)
      .setFontColor(r.fg)
      .setRanges([statusRange])
      .build()
  );
  ordersSheet.setConditionalFormatRules(cfRules);

  // ── Conditional formatting for Payment Status ──
  const payRange = ordersSheet.getRange("P2:P501");
  const payRules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Received").setBackground("#d4edda").setFontColor("#155724").setRanges([payRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Pending").setBackground("#fff3cd").setFontColor("#856404").setRanges([payRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Partial").setBackground("#cce5ff").setFontColor("#004085").setRanges([payRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Refunded").setBackground("#f8d7da").setFontColor("#721c24").setRanges([payRange]).build(),
  ];
  ordersSheet.setConditionalFormatRules([...cfRules, ...payRules]);

  // ── 2. INVENTORY SHEET ───────────────────────────────────────────────────────
  let invSheet = ss.getSheetByName("Inventory");
  if (!invSheet) invSheet = ss.insertSheet("Inventory");
  invSheet.clearContents();
  invSheet.clearFormats();

  const invHeaders = [
    "SKU",            // A
    "Item Name",      // B
    "Size",           // C
    "Colour",         // D
    "Fabric",         // E
    "Stock In",       // F - total pieces made
    "Stock Sold",     // G - formula from Orders sheet
    "Stock Reserved", // H - confirmed but unpaid
    "Stock Available",// I - formula: F - G - H
    "Reorder Alert",  // J - Yes/No formula
    "Cost Price (PKR)",// K
    "Sell Price (PKR)",// L
    "Margin %",       // M - formula
    "Notes"           // N
  ];

  invSheet.getRange(1, 1, 1, invHeaders.length).setValues([invHeaders]);
  invSheet.getRange(1, 1, 1, invHeaders.length)
    .setBackground("#1a1a1a")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  invSheet.setFrozenRows(1);

  // Margin formula
  for (let row = 2; row <= 101; row++) {
    invSheet.getRange(row, 9).setFormula(`=IF(F${row}="","",F${row}-G${row}-H${row})`);
    invSheet.getRange(row, 10).setFormula(`=IF(I${row}="","",IF(I${row}<=2,"YES - LOW STOCK",""))`);
    invSheet.getRange(row, 13).setFormula(`=IF(K${row}="","",ROUND((L${row}-K${row})/L${row}*100,1)&"%")`);
  }

  // Low stock alert formatting
  const alertRange = invSheet.getRange("J2:J101");
  invSheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains("YES")
      .setBackground("#f8d7da")
      .setFontColor("#721c24")
      .setFontWeight("bold")
      .setRanges([alertRange])
      .build()
  ]);

  // ── 3. CUSTOMERS SHEET ──────────────────────────────────────────────────────
  let custSheet = ss.getSheetByName("Customers");
  if (!custSheet) custSheet = ss.insertSheet("Customers");
  custSheet.clearContents();
  custSheet.clearFormats();

  const custHeaders = [
    "Customer ID",     // A
    "Name",            // B
    "WhatsApp",        // C
    "Instagram",       // D
    "City",            // E
    "Total Orders",    // F - formula
    "Total Spent (PKR)",// G - formula
    "Last Order Date", // H
    "Tag",             // I - VIP / Regular / New
    "Notes"            // J
  ];

  custSheet.getRange(1, 1, 1, custHeaders.length).setValues([custHeaders]);
  custSheet.getRange(1, 1, 1, custHeaders.length)
    .setBackground("#1a1a1a")
    .setFontColor("#ffffff")
    .setFontWeight("bold");
  custSheet.setFrozenRows(1);

  setDropdown(custSheet, 2, 9, 200, ["New", "Regular", "VIP", "Wholesale"]);

  // VIP tag formatting
  const tagRange = custSheet.getRange("I2:I201");
  custSheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("VIP").setBackground("#fff3cd").setFontColor("#856404").setFontWeight("bold").setRanges([tagRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Regular").setBackground("#d4edda").setFontColor("#155724").setRanges([tagRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Wholesale").setBackground("#cce5ff").setFontColor("#004085").setRanges([tagRange]).build(),
  ]);

  // ── 4. PURCHASES SHEET ──────────────────────────────────────────────────────
  let purchasesSheet = ss.getSheetByName("Purchases");
  if (!purchasesSheet) purchasesSheet = ss.insertSheet("Purchases");
  purchasesSheet.clearContents();
  purchasesSheet.clearFormats();

  const purchaseHeaders = [
    "Expense ID",         // A — e.g. EXP-2026-001
    "Date",               // B
    "Description",        // C — what was bought
    "Vendor / Supplier",  // D
    "Amount (PKR)",       // E
    "Category",           // F
    "Payment Method",     // G
    "Notes"               // H
  ];

  purchasesSheet.getRange(1, 1, 1, purchaseHeaders.length).setValues([purchaseHeaders]);
  purchasesSheet.getRange(1, 1, 1, purchaseHeaders.length)
    .setBackground("#1a1a1a")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setFontSize(10);
  purchasesSheet.setFrozenRows(1);

  const purchaseColWidths = [110, 90, 220, 160, 120, 120, 130, 200];
  purchaseColWidths.forEach((w, i) => purchasesSheet.setColumnWidth(i + 1, w));

  setDropdown(purchasesSheet, 2, 6, 500, ["Fabric", "Tailoring", "Packaging", "Marketing", "Other"]);
  setDropdown(purchasesSheet, 2, 7, 500, ["JazzCash", "Easypaisa", "Bank Transfer", "Cash"]);

  // Highlight large expenses (≥ PKR 10,000)
  const amtRange = purchasesSheet.getRange("E2:E501");
  purchasesSheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThanOrEqualTo(10000)
      .setBackground("#fff3cd")
      .setFontColor("#856404")
      .setRanges([amtRange])
      .build()
  ]);

  // ── 5. DASHBOARD SHEET ──────────────────────────────────────────────────────
  let dashSheet = ss.getSheetByName("Dashboard");
  if (!dashSheet) dashSheet = ss.insertSheet("Dashboard", 0); // Put first
  dashSheet.clearContents();
  dashSheet.clearFormats();

  const dashData = [
    ["BARO STUDIO — ORDER DASHBOARD", "", ""],
    ["", "", ""],
    ["TOTAL ORDERS", `=COUNTA(Orders!D2:D5000)`, ""],
    ["TOTAL REVENUE (PKR)", `=SUM(Orders!N2:N5000)`, ""],
    ["UNPAID ORDERS", `=COUNTIF(Orders!P2:P5000,"Pending")`, ""],
    ["ORDERS IN PRODUCTION", `=COUNTIF(Orders!R2:R5000,"In Production")`, ""],
    ["ORDERS DISPATCHED", `=COUNTIF(Orders!R2:R5000,"Dispatched")`, ""],
    ["ORDERS DELIVERED", `=COUNTIF(Orders!R2:R5000,"Delivered")`, ""],
    ["", "", ""],
    ["THIS MONTH REVENUE (PKR)",
      `=SUMPRODUCT((MONTH(Orders!B2:B5000)=MONTH(TODAY()))*(YEAR(Orders!B2:B5000)=YEAR(TODAY()))*Orders!N2:N5000)`,
      ""],
    ["THIS MONTH ORDERS",
      `=SUMPRODUCT((MONTH(Orders!B2:B5000)=MONTH(TODAY()))*(YEAR(Orders!B2:B5000)=YEAR(TODAY()))*(Orders!D2:D5000<>""))`,
      ""],
    ["", "", ""],
    ["TOTAL EXPENSES (PKR)",    `=SUM(Purchases!E2:E5000)`, ""],
    ["THIS MONTH EXPENSES (PKR)",
      `=SUMPRODUCT((MONTH(Purchases!B2:B5000)=MONTH(TODAY()))*(YEAR(Purchases!B2:B5000)=YEAR(TODAY()))*Purchases!E2:E5000)`,
      ""],
  ];

  dashSheet.getRange(1, 1, dashData.length, 3).setValues(dashData);

  // Style title
  dashSheet.getRange("A1").setFontSize(16).setFontWeight("bold").setFontColor("#1a1a1a");

  // Style metric labels
  dashSheet.getRange("A3:A11").setFontWeight("bold").setFontColor("#555555");

  // Style values
  dashSheet.getRange("B3:B11").setFontSize(14).setFontWeight("bold").setFontColor("#1a1a1a");

  // Column widths
  dashSheet.setColumnWidth(1, 250);
  dashSheet.setColumnWidth(2, 180);

  // ── Done ────────────────────────────────────────────────────────────────────
  SpreadsheetApp.getUi().alert(
    "✅ Baro Studio sheet is ready!\n\n" +
    "Sheets created:\n" +
    "• Dashboard — live summary stats\n" +
    "• Orders — full order tracking\n" +
    "• Purchases — fabric, tailoring & other expenses\n" +
    "• Inventory — stock levels & alerts\n" +
    "• Customers — customer database\n\n" +
    "Start adding orders to the Orders sheet."
  );
}

// ── Helper: set a dropdown on a column range ──────────────────────────────────
function setDropdown(sheet, startRow, col, numRows, values) {
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(startRow, col, numRows, 1).setDataValidation(rule);
}

// ── Send payment reminder via email (optional) ────────────────────────────────
// Can be triggered manually or on a time-based trigger
function sendPaymentReminders() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Orders");
  const data = sheet.getDataRange().getValues();

  let reminders = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const customerName   = row[3];  // D
    const whatsapp       = row[4];  // E
    const totalAmount    = row[13]; // N
    const paymentStatus  = row[15]; // P
    const orderStatus    = row[17]; // R
    const date           = row[1];  // B

    if (!customerName) continue;
    if (paymentStatus !== "Pending") continue;
    if (orderStatus === "Cancelled") continue;

    const daysSinceOrder = date ? Math.floor((new Date() - new Date(date)) / 86400000) : 0;
    if (daysSinceOrder >= 1) {
      reminders.push({ name: customerName, whatsapp, amount: totalAmount, days: daysSinceOrder, row: i + 1 });
    }
  }

  if (reminders.length === 0) {
    SpreadsheetApp.getUi().alert("No pending payments found.");
    return;
  }

  // Log reminders to a new sheet tab for easy copy-paste into WhatsApp
  let reminderSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Payment Reminders");
  if (!reminderSheet) reminderSheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Payment Reminders");
  reminderSheet.clearContents();
  reminderSheet.getRange(1, 1, 1, 4).setValues([["Customer", "WhatsApp", "Amount (PKR)", "Days Pending"]]);
  const rows = reminders.map(r => [r.name, r.whatsapp, r.amount, r.days]);
  if (rows.length) reminderSheet.getRange(2, 1, rows.length, 4).setValues(rows);

  SpreadsheetApp.getUi().alert(`Found ${reminders.length} unpaid order(s). Check the "Payment Reminders" tab.`);
}
