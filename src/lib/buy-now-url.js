// src/lib/buy-now-url.js
//
// Helper for constructing the Shopify "Buy Now" cart URL that the Android app opens.
//
// The URL pattern is:
//   https://customcaise.myshopify.com/cart/{variant_id}:{qty}?properties[design_url]=...&properties[phone_model]=...
//
// When Shopify receives this URL, it creates a cart with the given variant and
// attaches the custom properties. The properties flow through checkout and into
// the order.line_items[].properties array, which the webhook reads to fulfill.

const STORE = process.env.SHOPIFY_STORE || 'customcaise.myshopify.com';

/**
 * @param {object} params
 * @param {string|number} params.shopifyVariantId  Shopify variant ID for the selected phone model
 * @param {string} params.designUrl                Public URL to the user's design PNG/JPG
 * @param {string} params.phoneModel               Human-readable phone model name (for order display)
 * @param {string} [params.discountCode]           Optional discount code to auto-apply
 * @param {number} [params.quantity=1]
 * @returns {string} fully-encoded checkout URL
 */
export function buildBuyNowUrl({
  shopifyVariantId,
  designUrl,
  phoneModel,
  discountCode,
  quantity = 1,
}) {
  if (!shopifyVariantId) throw new Error('shopifyVariantId required');
  if (!designUrl) throw new Error('designUrl required');
  if (!phoneModel) throw new Error('phoneModel required');

  const params = new URLSearchParams();
  params.set('properties[design_url]', designUrl);
  params.set('properties[phone_model]', phoneModel);
  if (discountCode) params.set('discount', discountCode);

  return `https://${STORE}/cart/${shopifyVariantId}:${quantity}?${params.toString()}`;
}
