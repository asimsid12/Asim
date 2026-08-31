# Baro Studio — Business Automation Toolkit

Automation tools for Baro Studio, a Karachi-based limited-edition clothing brand.

## What's in Here

| Folder | What it does |
|--------|-------------|
| `order-sheet/` | Google Apps Script that sets up a fully structured order tracking sheet in Google Sheets |
| `splendid-automation/` | Node.js script that reads confirmed orders from the sheet and auto-creates invoices in Splendid Accounts |
| `whatsapp-templates/` | Copy-paste WhatsApp messages for every stage of the order journey |
| `health/` | Syncs Google Health data locally so Claude can review training and diet ([setup](health/README.md)) |

---

## Step 1 — Set Up the Google Sheet

1. Go to [sheets.new](https://sheets.new) and create a blank spreadsheet
2. Click **Extensions → Apps Script**
3. Delete the default code and paste the contents of `order-sheet/setup-sheet.gs`
4. Click **Run → setupBaroStudioSheet**
5. Grant permissions when prompted

This creates four tabs automatically:
- **Dashboard** — live summary (total orders, revenue, unpaid, in production)
- **Orders** — main order log with dropdowns and colour coding
- **Inventory** — stock levels with low-stock alerts
- **Customers** — customer database with VIP tagging

Copy the **Sheet ID** from the URL:
```
https://docs.google.com/spreadsheets/d/THIS_PART_IS_YOUR_SHEET_ID/edit
```

---

## Step 2 — Set Up the Splendid Automation

### Requirements
- Node.js 18+
- A Google **Service Account** with Sheets API access ([guide](https://developers.google.com/identity/protocols/oauth2/service-account))
- Your Splendid Accounts login credentials

### Install
```bash
cd splendid-automation
npm install
npm run install-browsers
```

### Configure
```bash
cp .env.example .env
```

Edit `.env`:
```
SPLENDID_EMAIL=your@email.com
SPLENDID_PASSWORD=yourpassword
GOOGLE_SHEET_ID=your-sheet-id
GOOGLE_SERVICE_ACCOUNT_KEY=./service-account-key.json
```

Place your downloaded service account JSON key in the `splendid-automation/` folder as `service-account-key.json`.

Share your Google Sheet with the service account's email address (give it **Editor** access).

### Run
```bash
npm start
```

The script will:
1. Read all orders from the sheet where status is Confirmed/In Production/Ready/Dispatched and no invoice exists yet
2. Open Splendid Accounts in a browser window
3. Create each invoice automatically
4. Write the Splendid invoice number back to the sheet

Run this once a day (or as needed). It only processes orders that don't have an invoice yet — safe to run multiple times.

---

## Step 3 — WhatsApp Templates

Open `whatsapp-templates/templates.md` and copy the relevant message for each stage:

| Template | When to send |
|----------|-------------|
| Order Received | As soon as an order comes in |
| Payment Received | Once payment screenshot confirmed |
| Payment Reminder | 24 hrs after order if unpaid |
| Ready to Dispatch | Day of dispatch |
| Dispatched + Tracking | After handing to courier |
| Delivery Follow-up | 1-2 days after expected arrival |
| New Drop | When a new collection launches |

---

## Order Workflow

```
Customer DMs on WhatsApp / Instagram
              ↓
Add to Orders sheet (Date, Customer, Item, Size, Price, Address)
              ↓
Send "Order Received" template → customer pays
              ↓
Mark Payment Status = "Received"
Change Order Status = "Confirmed"
              ↓
Run: npm start  (creates invoice in Splendid automatically)
              ↓
Splendid invoice sent to customer via WhatsApp (one click in Splendid)
              ↓
Change Order Status = "In Production" → "Ready" → "Dispatched"
Enter Tracking Number → send "Dispatched" template
              ↓
Mark "Delivered" when confirmed
```

---

## Inventory Management

Use the **Inventory** tab to track stock:
- Enter each piece with its `Stock In` count when you make it
- `Stock Sold` and `Stock Available` calculate automatically from the Orders sheet
- The `Reorder Alert` column turns red when fewer than 2 pieces remain

---

## Step 4 — WhatsApp Bot (Two-Way Automation)

The bot runs on Baro Studio's existing WhatsApp number and handles both directions:

**Owner → Bot** (you send commands, bot acts):

| Message you send | What happens |
|---|---|
| `New order: Sara, 0300-0000000, size M, navy kurta, PKR 4500, DHA Karachi` | Row added to Orders sheet, Order ID returned |
| `BS-2026-001 dispatched Leopards LEP78901` | Status updated, tracking saved, customer auto-notified |
| `Payment received BS-2026-001` | Payment marked, customer auto-notified |
| `Today's summary` | Order count + revenue for today |
| `Show unpaid orders` | Lists all pending payments |
| `Status of BS-2026-001` | Full order details |

**Bot → Customer** (automatic, no action needed):
- Payment confirmed → customer receives confirmation message
- Order dispatched with tracking → customer receives tracking message
- Customer sends order ID → receives live status
- Customer asks about sizes/fabric/delivery → receives FAQ reply

### Setup

```bash
cd whatsapp-bot
npm install
cp .env.example .env   # fill in your credentials
node bot.js            # QR code appears — scan with Baro Studio WhatsApp
```

On first run, a QR code appears in the terminal. Scan it once with the Baro Studio WhatsApp. The session is saved — no QR needed on future restarts.

**Required credentials** (all in `.env`):
- `OWNER_PHONE` — your WhatsApp number in international format (e.g. `923001234567`)
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `GOOGLE_SHEET_ID` — from your Google Sheet URL
- `GOOGLE_SERVICE_ACCOUNT_KEY` — path to your service account JSON file

### Deploying to a VPS

```bash
# Install Node.js on your VPS (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repo and install
git clone <your-repo-url>
cd Asim/whatsapp-bot
npm install
cp .env.example .env   # fill in credentials

# Run persistently (keeps running after you close SSH)
npm install -g pm2
pm2 start bot.js --name baro-studio-bot
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

---

## Future Additions (Planned)

- [ ] PDF invoice generator (no Splendid login needed)
- [ ] Monthly financial summary auto-sent to owner WhatsApp on the 1st
- [ ] Shopify storefront with Splendid sync (eliminates DM orders entirely)
- [ ] Instagram Shopping integration
