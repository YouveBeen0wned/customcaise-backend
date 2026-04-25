// src/routes/shopify-webhooks.js
//
// Receives Shopify order/create webhooks.
// For each line item from the Custom Caise master product:
//   1. Extract the design_url from line_item.properties
//   2. Look up the printify_variant_id from variant-map.json
//   3. Create a Printify order referencing the design URL directly
//   4. Tag the Shopify order so we can see it was processed

import express from 'express';
import { readFile } from 'node:fs/promises';
import { verifyShopifyWebhook } from '../lib/verify-shopify-webhook.js';
import { createOrder, sendOrderToProduction } from '../services/printify.js';
import { addOrderTag, addOrderNote } from '../services/shopify.js';

const router = express.Router();

let variantMap = null;
async function loadVariantMap() {
  if (variantMap) return variantMap;
  const raw = await readFile(new URL('../../variant-map.json', import.meta.url), 'utf8');
  variantMap = JSON.parse(raw);
  return variantMap;
}

const PROCESSED_TAG = 'printify-submitted';

router.post(
  '/orders-create',
  express.raw({ type: 'application/json' }),
  verifyShopifyWebhook,
  async (req, res) => {
    res.status(200).send('ok');

    try {
      await processOrder(req.body);
    } catch (err) {
      console.error('❌ Order processing failed:', err);
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
  const orderName = order.name;
  console.log(`📦 Processing Shopify order ${orderName} (${orderId})`);

  const existingTags = (order.tags || '').split(',').map(t => t.trim());
  if (existingTags.includes(PROCESSED_TAG)) {
    console.log(`   ↩️  Already processed (has ${PROCESSED_TAG} tag), skipping`);
    return;
  }

  const map = await loadVariantMap();
  const printifyLineItems = [];

  for (const item of order.line_items || []) {
    const shopifyVariantId = item.variant_id;
    const mapping = map.variants[shopifyVariantId];

    if (!mapping) {
      console.log(`   ⏭️  Line item "${item.name}" is not a Custom Caise variant, skipping`);
      continue;
    }

    // Look in line item properties first (legacy /cart/add URLs), then fall back
// to order-level note_attributes (current /cart/{id}:1?attributes[...] URLs).
const properties     = item.properties     || [];
const noteAttributes = order.note_attributes || [];
const findProp = (name) =>
  properties.find(p => p.name === name)?.value
  ?? noteAttributes.find(a => a.name === name)?.value;

const designUrl  = findProp('design_url');
const phoneModel = findProp('phone_model') || mapping.printify_title;

if (!designUrl) {
  throw new Error(
    `Line item "${item.name}" has no design_url (checked properties + note_attributes). Order cannot fulfill.`
  );
}

    console.log(`   🎨 Using design URL for ${phoneModel}: ${designUrl}`);

    printifyLineItems.push({
      print_provider_id: map.print_provider_id,
      blueprint_id: map.blueprint_id,
      variant_id: mapping.printify_variant_id,
      print_areas: {
        front: [
          {
            src: designUrl,
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

  const shipping = order.shipping_address || order.billing_address;
  if (!shipping) {
    throw new Error('Order has no shipping or billing address');
  }

  const printifyOrderPayload = {
    external_id: String(orderId),
    label: orderName,
    line_items: printifyLineItems,
    shipping_method: 1,
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

  if (process.env.AUTO_SEND_TO_PRODUCTION === 'true') {
    console.log(`   🏭 Sending order to production...`);
    await sendOrderToProduction(printifyOrder.id);
    console.log(`      ✓ In production`);
  } else {
    console.log(`   ⏸️  AUTO_SEND_TO_PRODUCTION not enabled — order on hold for manual review`);
  }

  await addOrderTag(orderId, PROCESSED_TAG);
  await addOrderNote(orderId, `Printify order created: ${printifyOrder.id}`);

  console.log(`✅ Order ${orderName} fully processed`);
}

export default router;
