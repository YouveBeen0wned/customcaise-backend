// Printify API client — thin wrapper around fetch

const TOKEN = process.env.PRINTIFY_API_TOKEN;
const SHOP_ID = process.env.PRINTIFY_SHOP_ID;
const BLUEPRINT_ID = process.env.PRINTIFY_BLUEPRINT_ID || '841';
const PROVIDER_ID = process.env.PRINTIFY_PRINT_PROVIDER_ID || '88';

const BASE = 'https://api.printify.com/v1';

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'CustomCaiseBackend/1.0',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Printify ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Get the list of all variants available for blueprint 841 / provider 88.
 * Returns variants with ids and titles (e.g., "iPhone 15 Pro / Glossy").
 */
export async function getBlueprintVariants() {
  const data = await request(
    `/catalog/blueprints/${BLUEPRINT_ID}/print_providers/${PROVIDER_ID}/variants.json`
  );
  return data.variants || [];
}

/**
 * List products in our Printify shop.
 * Paginated — returns { data, current_page, last_page, ... }.
 */
export async function listProducts(page = 1) {
  return request(`/shops/${SHOP_ID}/products.json?page=${page}&limit=50`);
}

/**
 * Get a single Printify product (includes the variants mapped to Shopify).
 */
export async function getProduct(productId) {
  return request(`/shops/${SHOP_ID}/products/${productId}.json`);
}

/**
 * Find our master Printify product by title.
 * Handles pagination.
 */
export async function findMasterProduct(title = 'Custom Caise') {
  let page = 1;
  while (true) {
    const result = await listProducts(page);
    const match = (result.data || []).find(p => p.title === title);
    if (match) return match;
    if (page >= (result.last_page || 1)) return null;
    page++;
  }
}

/**
 * Upload an image to Printify's media library by URL.
 * Returns the upload object (id, file_name, etc.).
 */
export async function uploadImageByUrl(url, fileName = 'custom-design.png') {
  return request('/uploads/images.json', {
    method: 'POST',
    body: JSON.stringify({
      file_name: fileName,
      url,
    }),
  });
}

/**
 * Create an order on Printify for fulfillment.
 * The structure matches Printify's /orders.json POST schema.
 */
export async function createOrder(payload) {
  return request(`/shops/${SHOP_ID}/orders.json`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Send an existing order to production immediately.
 * By default Printify holds orders for manual review.
 */
export async function sendOrderToProduction(printifyOrderId) {
  return request(`/shops/${SHOP_ID}/orders/${printifyOrderId}/send_to_production.json`, {
    method: 'POST',
  });
}
