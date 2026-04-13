/**
 * Splendid Accounts API Client
 * Docs: https://app.splendidaccounts.com/api (v3.4.6)
 * Auth: X-Api-Key, X-Api-Secret, X-App-Id headers
 */

const BASE_URL = "https://app.splendidaccounts.com/api";

class SplendidClient {
  constructor() {
    this.apiKey    = process.env.SPLENDID_API_KEY;
    this.apiSecret = process.env.SPLENDID_API_SECRET;
    this.appId     = process.env.SPLENDID_APP_ID;
    this.tenant    = process.env.SPLENDID_TENANT;       // company slug
    this.branchId  = process.env.SPLENDID_BRANCH_ID;
    this.warehouseId     = parseInt(process.env.SPLENDID_WAREHOUSE_ID);
    this.currencyId      = parseInt(process.env.SPLENDID_CURRENCY_ID || "1"); // 1 = PKR
    this.defaultProductId = parseInt(process.env.SPLENDID_DEFAULT_PRODUCT_ID);

    if (!this.apiKey || !this.apiSecret || !this.appId || !this.tenant || !this.branchId) {
      throw new Error("Missing Splendid API credentials. Check SPLENDID_* env vars.");
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  headers() {
    return {
      "X-Api-Key":    this.apiKey,
      "X-Api-Secret": this.apiSecret,
      "X-App-Id":     this.appId,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    };
  }

  async get(path) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Splendid GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async post(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Splendid POST ${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  // ── Company & setup ──────────────────────────────────────────────────────

  async getCompany() {
    return this.get("/Companies");
  }

  async getWarehouses() {
    return this.get(`/${this.tenant}/warehouses`);
  }

  // ── Customers ────────────────────────────────────────────────────────────

  /**
   * Search for an existing customer by phone number.
   * Returns the first match or null.
   */
  async findCustomerByPhone(phone) {
    const normalised = phone.replace(/\D/g, "");
    try {
      const results = await this.post(
        `/${this.tenant}/${this.branchId}/Customers/Search`,
        {
          phone: { phone: normalised, exactMatch: false },
        }
      );
      return Array.isArray(results) && results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a new customer. Returns the created customer object (with id).
   */
  async createCustomer({ name, phone, city, address }) {
    return this.post(`/${this.tenant}/${this.branchId}/Customers`, {
      name,
      displayName: name,
      phone: { phone: phone || "" },
      city:     city    || "",
      address1: address || "",
      currencyId: this.currencyId,
      isActive: true,
    });
  }

  /**
   * Find customer by phone, or create them if not found.
   * Returns customerId.
   */
  async findOrCreateCustomer(order) {
    if (order.whatsapp) {
      const existing = await this.findCustomerByPhone(order.whatsapp);
      if (existing) return existing.id;
    }
    const created = await this.createCustomer({
      name:    order.customerName,
      phone:   order.whatsapp,
      city:    order.city,
      address: order.address,
    });
    return created.id;
  }

  // ── Products ─────────────────────────────────────────────────────────────

  /**
   * Look up a product by name. Returns first match or null.
   */
  async findProductByName(name) {
    try {
      const res = await this.get(
        `/${this.tenant}/${this.branchId}/Products/BySKUOrName?name=${encodeURIComponent(name)}`
      );
      const list = Array.isArray(res) ? res : res.results || [];
      return list.length > 0 ? list[0] : null;
    } catch {
      return null;
    }
  }

  // ── Invoices ─────────────────────────────────────────────────────────────

  /**
   * Create and approve a sale invoice for one order.
   * Uses the default product ID if the item name isn't found in Splendid's catalog.
   *
   * @param {object} order - order object from sheets.js rowToOrder()
   * @param {number} customerId
   * @returns {object} created invoice
   */
  async createInvoice(order, customerId) {
    const qty       = parseFloat(order.qty)        || 1;
    const unitPrice = parseFloat(order.unitPrice)   || 0;
    const gross     = qty * unitPrice;

    // Try to find the product in Splendid's catalog; fall back to default
    let productId = this.defaultProductId;
    if (order.itemName) {
      const product = await this.findProductByName(order.itemName);
      if (product) productId = product.id;
    }

    const today   = new Date().toISOString();
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // +7 days

    const description = [
      order.itemName,
      order.size   ? `Size: ${order.size}`   : null,
      order.colour ? `Colour: ${order.colour}` : null,
      order.orderId ? `Ref: ${order.orderId}`  : null,
    ].filter(Boolean).join(" | ");

    return this.post(`/${this.tenant}/${this.branchId}/SaleInvoices/SaveAndApprove`, {
      customerId,
      date:        order.date ? new Date(order.date).toISOString() : today,
      dueDate,
      currencyId:  this.currencyId,
      exchangeRate: 1,
      grossAmount: gross,
      netAmount:   gross,
      isPosInvoice: false,
      reference:   order.orderId || "",
      saleInvoiceDetails: [
        {
          productId,
          quantity:    qty,
          price:       unitPrice,
          grossAmount: gross,
          netAmount:   gross,
          warehouseId: this.warehouseId,
          packingDetail: description,
        },
      ],
    });
  }

  // ── Payments ─────────────────────────────────────────────────────────────

  /**
   * Record a payment received from a customer.
   * paymentMode: 10 = Cash, 40 = Direct Deposit (bank/JazzCash/Easypaisa)
   *
   * @param {number} customerId
   * @param {number} amount
   * @param {string} reference  - e.g. order ID or JazzCash transaction ID
   * @param {number} accountId  - Splendid GL account ID for the payment method
   * @param {number} paymentMode - 10 (Cash) | 40 (Direct Deposit)
   */
  async recordPayment({ customerId, amount, reference, accountId, paymentMode = 40 }) {
    return this.post(`/${this.tenant}/${this.branchId}/CustomerPayments/SaveAndApprove`, {
      customerId,
      date:         new Date().toISOString(),
      currencyId:   this.currencyId,
      exchangeRate: 1,
      totalAmount:  amount,
      autoSettle:   true,
      reference,
      customerPaymentDetails: [
        {
          paymentMode,
          amount,
          accountId,
          instrumentStatus: 20, // Approved
        },
      ],
    });
  }
}

module.exports = SplendidClient;
