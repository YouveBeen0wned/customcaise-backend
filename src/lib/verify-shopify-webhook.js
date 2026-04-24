// src/lib/verify-shopify-webhook.js
//
// Shopify signs every webhook with an HMAC of the raw request body,
// using your app's API secret as the key. Verifying this prevents
// attackers from POSTing fake orders to our webhook endpoint.
//
// CRITICAL: the HMAC must be calculated over the RAW request body,
// before any JSON parsing. Express's express.raw() middleware keeps
// the body as a Buffer so we can do this.

import crypto from 'node:crypto';

const SECRET = process.env.SHOPIFY_API_SECRET;

/**
 * Express middleware. Requires the route to use express.raw({ type: 'application/json' }).
 * On success, parses the body into req.body as JSON.
 * On failure, responds 401 and does not call next().
 */
export function verifyShopifyWebhook(req, res, next) {
  if (!SECRET) {
    console.error('SHOPIFY_API_SECRET missing — cannot verify webhooks');
    return res.status(500).send('Server misconfigured');
  }

  const header = req.get('X-Shopify-Hmac-Sha256');
  if (!header) {
    return res.status(401).send('Missing HMAC header');
  }

  const rawBody = req.body; // Buffer from express.raw()
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(500).send('Body not raw — middleware order wrong');
  }

  const computed = crypto
    .createHmac('sha256', SECRET)
    .update(rawBody)
    .digest('base64');

  // Timing-safe compare to prevent timing attacks
  const a = Buffer.from(computed);
  const b = Buffer.from(header);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('HMAC mismatch');
  }

  // Parse JSON now that we've verified
  try {
    req.body = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).send('Invalid JSON');
  }

  next();
}
