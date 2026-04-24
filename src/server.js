// src/server.js
//
// Custom Caise backend.
// Exposes:
//   GET  /health                              — liveness check
//   POST /webhooks/shopify/orders-create      — Shopify webhook (HMAC-verified)

import 'dotenv/config';
import express from 'express';
import shopifyWebhooks from './routes/shopify-webhooks.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Liveness probe
app.get('/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// Webhooks — this router uses express.raw() internally BEFORE HMAC verification,
// so we must NOT mount express.json() globally (it would consume the body first).
app.use('/webhooks/shopify', shopifyWebhooks);

// JSON parser for any future non-webhook routes (mount after webhooks)
app.use(express.json());

// Root
app.get('/', (req, res) => {
  res.send('Custom Caise backend running');
});

app.listen(PORT, () => {
  console.log(`🚀 Custom Caise backend listening on :${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Shopify store: ${process.env.SHOPIFY_STORE}`);
});
