// Shopify Admin API client — thin wrapper around fetch

const STORE = process.env.SHOPIFY_STORE;
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = process.env.SHOPIFY_API_VERSION || '2025-07';

const BASE = `https://${STORE}/admin/api/${VERSION}`;

async function request(path, options = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }

  return res.json();
}

export async function getProduct(productId) {
  const { product } = await request(`/products/${productId}.json`);
  return product;
}

export async function getProductVariants(productId) {
  const product = await getProduct(productId);
  return product.variants;
}

export async function getOrder(orderId) {
  const { order } = await request(`/orders/${orderId}.json`);
  return order;
}

export async function addOrderTag(orderId, tag) {
  const order = await getOrder(orderId);
  const existingTags = order.tags ? order.tags.split(',').map(t => t.trim()) : [];
  if (existingTags.includes(tag)) return order;

  const newTags = [...existingTags, tag].join(', ');
  return request(`/orders/${orderId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ order: { id: orderId, tags: newTags } }),
  });
}

export async function addOrderNote(orderId, note) {
  return request(`/orders/${orderId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ order: { id: orderId, note } }),
  });
}
