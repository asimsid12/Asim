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

    if (!this.apiKey || !this.apiSecret || !this.tenant || !this.branchId) {
      throw new Error("Missing Splendid API credentials. Check SPLENDID_* env vars.");
    }
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  headers() {
    const h = {
      "X-Api-Key":    this.apiKey,
      "X-Api-Secret": this.apiSecret,
      "Content-Type": "application/json",
      "Accept":       "application/json",
    };
    if (this.appId) h["X-App-Id"] = this.appId;
    return h;
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
      phone: phone || "",
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

    const today   = new Date().toISOString().split("T")[0];
    const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

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

  // ── Suppliers ────────────────────────────────────────────────────────────

  async findSupplierByName(name) {
    try {
      const results = await this.post(
        `/${this.tenant}/${this.branchId}/Suppliers/Search`,
        { name: { name, exactMatch: false } }
      );
      return Array.isArray(results) && results.length > 0 ? results[0] : null;
    } catch {
      return null;
    }
  }

  async createSupplier({ name }) {
    return this.post(`/${this.tenant}/${this.branchId}/Suppliers`, {
      name,
      displayName:  name,
      currencyId:   this.currencyId,
      isActive:     true,
    });
  }

  async findOrCreateSupplier(vendorName) {
    const name = vendorName || "General Vendor";
    const existing = await this.findSupplierByName(name);
    if (existing) return existing.id;
    const created = await this.createSupplier({ name });
    return created.id;
  }

  // ── Purchase invoices (expenses) ─────────────────────────────────────────

  // Maps expense category + vendor name to the correct GL account ID.
  // Fabric → Inventory; Tailoring → vendor-specific account; etc.
  expenseAccountId(category, vendor = "") {
    const v = (vendor || "").toLowerCase();
    switch ((category || "").toLowerCase()) {
      case "fabric":       return 2701193;  // Inventory
      case "tailoring":    return v.includes("ibrahim") ? 2705041 : 2705040;  // Ibrahim or Sunny
      case "accessories":  return 2738462;  // Kaj, Zipper, Buttons Etc
      case "embroidery":   return 2810811;  // Embroidery - Shahzaib
      default:             return 2701198;  // Cost of Goods Sold
    }
  }

  /**
   * Record a purchase expense as a Splendid Purchase Invoice.
   * Fabric goes to Inventory; tailoring/embroidery/accessories to their
   * respective Direct Cost accounts.
   *
   * @param {object} data - expense data from owner.js handleNewExpense()
   */
  async createPurchaseInvoice(data) {
    const supplierId = await this.findOrCreateSupplier(data.vendor);
    const amount     = parseFloat(data.amount) || 0;
    const accountId  = this.expenseAccountId(data.category, data.vendor);
    const today      = new Date().toISOString().split("T")[0];
    const dueDate    = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    const description = [
      data.description,
      data.vendor ? `(${data.vendor})` : null,
    ].filter(Boolean).join(" ");

    return this.post(`/${this.tenant}/${this.branchId}/PurchaseInvoices/SaveAndApprove`, {
      supplierId,
      date:         today,
      dueDate,
      currencyId:   this.currencyId,
      exchangeRate: 1,
      grossAmount:  amount,
      netAmount:    amount,
      reference:    description.slice(0, 100),
      purchaseInvoiceDetails: [
        {
          accountId,
          quantity:    1,
          price:       amount,
          grossAmount: amount,
          netAmount:   amount,
          description,
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
