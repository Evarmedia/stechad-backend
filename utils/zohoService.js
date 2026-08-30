const axios = require("axios");

let cachedAccessToken = null;
let accessTokenExpiresAt = 0;

const getConfiguration = () => ({
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  organizationId: process.env.ZOHO_ORGANIZATION_ID,
  defaultItemId: process.env.ZOHO_DEFAULT_ITEM_ID,
  accountsUrl: process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com",
  apiBaseUrl: process.env.ZOHO_API_BASE_URL || "https://www.zohoapis.com/books/v3",
});

const isConfigured = () => {
  const config = getConfiguration();
  return Boolean(config.clientId && config.clientSecret && config.refreshToken && config.organizationId && config.defaultItemId);
};

const getAccessToken = async () => {
  if (cachedAccessToken && Date.now() < accessTokenExpiresAt) return cachedAccessToken;
  const config = getConfiguration();
  if (!isConfigured()) {
    const error = new Error("Zoho Books requires client ID, client secret, refresh token, organization ID, and a default item ID");
    error.code = "ZOHO_NOT_CONFIGURED";
    throw error;
  }
  const params = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  const response = await axios.post(`${config.accountsUrl}/oauth/v2/token`, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });
  if (!response.data?.access_token) throw new Error(response.data?.error || "Zoho did not return an access token");
  cachedAccessToken = response.data.access_token;
  accessTokenExpiresAt = Date.now() + Math.max(60, Number(response.data.expires_in || 3600) - 120) * 1000;
  return cachedAccessToken;
};

const zohoRequest = async ({ method = "GET", path, params = {}, data }) => {
  const config = getConfiguration();
  const token = await getAccessToken();
  const response = await axios({
    method,
    url: `${config.apiBaseUrl}${path}`,
    params: { organization_id: config.organizationId, ...params },
    data,
    headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" },
    timeout: 20000,
  });
  if (response.data?.code && response.data.code !== 0) throw new Error(response.data.message || "Zoho Books request failed");
  return response.data;
};

const resolveCustomer = async (contactName) => {
  const result = await zohoRequest({ path: "/contacts", params: { contact_name: contactName, contact_type: "customer", per_page: 10 } });
  const contacts = result.contacts || [];
  const exact = contacts.find((contact) => contact.contact_name?.toLowerCase() === contactName.toLowerCase());
  const contact = exact || contacts[0];
  if (!contact) throw new Error(`No Zoho Books customer matches "${contactName}"`);
  return contact;
};

const syncProjectInvoice = async (invoice) => {
  if (invoice.zoho_invoice_id) return { invoice_id: invoice.zoho_invoice_id, alreadySynced: true };
  if (invoice.invoice_type !== "project") throw new Error("Only client project invoices can be raised as Zoho Books sales invoices");
  const config = getConfiguration();
  const customer = await resolveCustomer(invoice.client_name);
  const suppliedItems = Array.isArray(invoice.line_items) ? invoice.line_items : [];
  const lineItems = suppliedItems.length
    ? suppliedItems.map((item) => ({
        item_id: item.item_id || config.defaultItemId,
        description: item.description || invoice.notes || `STECHAD project services for ${invoice.period}`,
        quantity: Number(item.quantity || 1),
        rate: Number(item.rate || item.amount || invoice.amount),
      }))
    : [{ item_id: config.defaultItemId, description: invoice.notes || `STECHAD project services for ${invoice.period}`, quantity: 1, rate: Number(invoice.amount) }];
  const result = await zohoRequest({
    method: "POST",
    path: "/invoices",
    data: {
      customer_id: customer.contact_id,
      reference_number: invoice.invoice_number,
      date: new Date().toISOString().slice(0, 10),
      notes: invoice.notes || undefined,
      line_items: lineItems,
    },
  });
  if (!result.invoice?.invoice_id) throw new Error("Zoho Books did not return the created invoice ID");
  return result.invoice;
};

const getOrganizationMetrics = async () => {
  if (!isConfigured()) return { configured: false, organization: null };
  const config = getConfiguration();
  const [organizationResult, invoiceResult] = await Promise.all([
    zohoRequest({ path: `/organizations/${config.organizationId}` }),
    zohoRequest({ path: "/invoices", params: { per_page: 200 } }),
  ]);
  const invoices = invoiceResult.invoices || [];
  return {
    configured: true,
    organization: organizationResult.organization || null,
    invoiceCount: invoices.length,
    outstandingReceivables: invoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0),
    invoicedTotal: invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
  };
};

module.exports = { isConfigured, syncProjectInvoice, getOrganizationMetrics };
