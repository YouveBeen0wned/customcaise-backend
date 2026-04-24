#!/usr/bin/env node
// scripts/build-variant-map.js
//
// One-time (re-runnable) script: pulls all variants from the Shopify master
// product AND from the Printify master product, matches them by variant title,
// and writes variant-map.json to the backend root.
//
// The map lets the webhook take a Shopify variant ID from an incoming order
// and immediately know which Printify variant to use when creating the fulfillment order.
//
// Run with: npm run map-variants

import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { getProductVariants } from '../src/services/shopify.js';
import { findMasterProduct, getProduct as getPrintifyProduct } from '../src/services/printify.js';

const SHOPIFY_MASTER_PRODUCT_ID = process.env.SHOPIFY_MASTER_PRODUCT_ID;

if (!SHOPIFY_MASTER_PRODUCT_ID) {
  console.error('❌ SHOPIFY_MASTER_PRODUCT_ID not set in .env');
  console.error('   Grab it from the product URL in Shopify admin, e.g.:');
  console.error('   https://customcaise.myshopify.com/admin/products/1234567890123');
  process.exit(1);
}

console.log('📥 Fetching Shopify variants...');
const shopifyVariants = await getProductVariants(SHOPIFY_MASTER_PRODUCT_ID);
console.log(`   ✓ ${shopifyVariants.length} Shopify variants`);

console.log('📥 Finding Printify master product...');
const printifyMaster = await findMasterProduct('Custom Caise');
if (!printifyMaster) {
  console.error('❌ Could not find Printify product titled "Custom Caise"');
  process.exit(1);
}
console.log(`   ✓ Printify product: ${printifyMaster.id}`);

console.log('📥 Fetching Printify variant details...');
const printifyFull = await getPrintifyProduct(printifyMaster.id);
const printifyVariants = printifyFull.variants || [];
console.log(`   ✓ ${printifyVariants.length} Printify variants`);

// Match by title. Shopify variant title is like "iPhone 15 Pro / Glossy",
// Printify variant title is like "iPhone 15 Pro / Glossy" (via the same blueprint).
// Normalization handles minor formatting differences.
const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const printifyByTitle = new Map();
for (const pv of printifyVariants) {
  printifyByTitle.set(normalize(pv.title), pv);
}

const mapping = {};
const unmatched = [];

for (const sv of shopifyVariants) {
  const key = normalize(sv.title);
  const pv = printifyByTitle.get(key);
  if (pv) {
    mapping[sv.id] = {
      shopify_variant_id: sv.id,
      shopify_title: sv.title,
      shopify_sku: sv.sku,
      printify_variant_id: pv.id,
      printify_title: pv.title,
      price: sv.price,
    };
  } else {
    unmatched.push(sv);
  }
}

const output = {
  generated_at: new Date().toISOString(),
  shopify_product_id: SHOPIFY_MASTER_PRODUCT_ID,
  printify_product_id: printifyMaster.id,
  blueprint_id: parseInt(process.env.PRINTIFY_BLUEPRINT_ID || '841', 10),
  print_provider_id: parseInt(process.env.PRINTIFY_PRINT_PROVIDER_ID || '88', 10),
  variant_count: Object.keys(mapping).length,
  variants: mapping,
};

await writeFile(
  new URL('../variant-map.json', import.meta.url),
  JSON.stringify(output, null, 2)
);

console.log('');
console.log(`✅ Wrote variant-map.json with ${Object.keys(mapping).length} matched variants`);
if (unmatched.length) {
  console.log(`⚠️  ${unmatched.length} Shopify variants had no Printify match:`);
  unmatched.forEach(v => console.log(`   - ${v.title} (Shopify ID ${v.id})`));
  console.log('');
  console.log('   These variants will fail fulfillment if ordered. Usually caused by');
  console.log('   a Printify variant being disabled while the Shopify one stayed enabled.');
  console.log('   Fix by re-enabling the variant in Printify and re-publishing.');
}
