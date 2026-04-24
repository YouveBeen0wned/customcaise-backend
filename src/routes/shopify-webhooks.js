// src/routes/shopify-webhooks.js
//
// Receives Shopify order/create webhooks.
// For each line item from the Custom Caise master product:
//   1. Extract the design_url from line_item.properties
//   2. Look up the printify_variant_id from variant-map.json
//   3. Upload the design image to Printify
//   4. Create a Printify order for Casestry fulfillment
//   5. Tag the Shopify order so we can see it was processed
//
// Idempotency: Shopify retries webhooks on non-2xx responses, so we
// tag the order after successful processing and skip already-tagged orders.

import express from 'express';
import { readFile } from 'node:fs/promises';
import { verifyShopifyWebhook } from '../lib/verify-shopify-webhook.js';
import { uploadImageByUrl, createOrder, sendOrderToProduction } from '../services/printify.js';
import { addOrderTag, addOrderNote } from '../services/shopify.js';

const router = express.Router();

// Load variant map once at startup. Fail fast if missing.
let variantMap = null;
async function loadVariantMap() {
  if (variantMap) return variantMap;
  const raw = await readFile(new URL('../../variant-map.json', import.meta.url), 'utf8');
  variantMap = JSON.parse(raw);
  return variantMap;
}

const PROCESSED_TAG = 'printify-submitted';

/**
 * POST /webhooks/shopify/orders-create
 *
 * Note: express.raw() is mounted BEFORE verifyShopifyWebhook so the
 * middleware sees the unparsed body for HMAC calculation.
 */
router.post(
  '/orders-create',
  express.raw({ type: 'application/json' }),
  verifyShopifyWebhook,
  async (req, res) => {
    // Respond 200 quickly — Shopify has a 5s timeout. Do the real work async.
    // If processing fails after we've 200'd, we log it and handle it manually;
    // that's the correct tradeoff vs. making Shopify retry (which causes
    // duplicate Printify orders if the failure was late in the flow).
    res.status(200).send('ok');

    try {
      await processOrder(req.body);
    } catch (err) {
      console.error('❌ Order processing failed:', err);
      // Tag the order so we can find it manually
      if (req.body?.id) {
        try {
          await addOrderTag(req.body.id, 'printify-error');
          await addOrderNote(req.body.id, `Printify fulfillment error: ${err.message}`);
        } catch (tagErr) {
          console.error('Failed to tag errored order:', tagErr);
        }
      }
    }
  }
);

async function processOrder(order) {
  const orderId = order.id;
  const orderName = order.name; // e.g., "#1001"
  console.log(`📦 Processing Shopify order ${orderName} (${orderId})`);

  // Idempotency check
  const existingTags = (order.tags || '').split(',').map(t => t.trim());
  if (existingTags.includes(PROCESSED_TAG)) {
    console.log(`   ↩️  Already processed (has ${PROCESSED_TAG} tag), skipping`);
    return;
  }

  const map = await loadVariantMap();

  // Collect all Custom Caise line items with their design URLs
  const printifyLineItems = [];

  for (const item of order.line_items || []) {
    const shopifyVariantId = item.variant_id;
    const mapping = map.variants[shopifyVariantId];

    if (!mapping) {
      console.log(`   ⏭️  Line item "${item.name}" is not a Custom Caise variant, skipping`);
      continue;
    }

    // Extract design_url from line item properties
    const properties = item.properties || [];
    const designUrlProp = properties.find(p => p.name === 'design_url');
    const phoneModelProp = properties.find(p => p.name === 'phone_model');

    if (!designUrlProp?.value) {
      throw new Error(
        `Line item "${item.name}" has no design_url property. Order cannot fulfill.`
      );
    }

    const designUrl = designUrlProp.value;
    const phoneModel = phoneModelProp?.value || mapping.printify_title;

    console.log(`   🎨 Uploading design for ${phoneModel}...`);
    const upload = await uploadImageByUrl(
      designUrl,
      `order-${orderName}-${shopifyVariantId}.png`
    );
    console.log(`      ✓ Printify upload ID: ${upload.id}`);

    printifyLineItems.push({
      print_provider_id: map.print_provider_id,
      blueprint_id: map.blueprint_id,
      variant_id: mapping.printify_variant_id,
      print_areas: {
        front: [
          {
            src: upload.id,
            scale: 1,
            x: 0.5,
            y: 0.5,
            angle: 0,
          },
        ],
      },
      quantity: item.quantity,
    });
  }

  if (printifyLineItems.length === 0) {
    console.log(`   ℹ️  No Custom Caise line items in this order, nothing to fulfill`);
    return;
  }

  // Build Printify order payload
  const shipping = order.shipping_address || order.billing_address;
  if (!shipping) {
    throw new Error('Order has no shipping or billing address');
  }

  const printifyOrderPayload = {
    external_id: String(orderId),
    label: orderName,
    line_items: printifyLineItems,
    shipping_method: 1, // standard shipping
    send_shipping_notification: true,
    address_to: {
      first_name: shipping.first_name || '',
      last_name: shipping.last_name || '',
      email: order.email || order.contact_email || '',
      phone: shipping.phone || '',
      country: shipping.country_code || '',
      region: shipping.province_code || '',
      address1: shipping.address1 || '',
      address2: shipping.address2 || '',
      city: shipping.city || '',
      zip: shipping.zip || '',
    },
  };

  console.log(`   🚚 Creating Printify order with ${printifyLineItems.length} item(s)...`);
  const printifyOrder = await createOrder(printifyOrderPayload);
  console.log(`      ✓ Printify order ID: ${printifyOrder.id}`);

  // Automatically send to production (skip the manual review step)
  console.log(`   🏭 Sending order to production...`);
  await sendOrderToProduction(printifyOrder.id);
  console.log(`      ✓ In production`);

  // Tag and note on Shopify side
  await addOrderTag(orderId, PROCESSED_TAG);
  await addOrderNote(orderId, `Printify order created: ${printifyOrder.id}`);

  console.log(`✅ Order ${orderName} fully processed`);
}

export default router;
