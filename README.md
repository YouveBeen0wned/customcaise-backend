# Custom Caise Backend

Backend service that wires Shopify orders to Printify fulfillment for the Custom Caise app.

## What it does

1. **Variant mapping** (one-time script) — matches every Shopify variant of the master
   "Custom Caise" product to its Printify counterpart and saves a lookup table.
2. **Buy Now URL builder** — constructs the Shopify cart URL the Android app opens,
   embedding the user's design URL and phone model as cart properties.
3. **Fulfillment webhook** — receives Shopify `orders/create` webhooks, reads the
   `design_url` property from each line item, uploads the image to Printify, and
   creates a Printify order with Casestry for fulfillment.

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to `.env` and fill in credentials.

```bash
cp .env.example .env
```

Required values:

| Variable | Where to get it |
|---|---|
| `SHOPIFY_STORE` | Your `.myshopify.com` domain (e.g., `customcaise.myshopify.com`) |
| `SHOPIFY_ADMIN_TOKEN` | Shopify admin → Apps → caises → API credentials → Admin API access token (only revealable once) |
| `SHOPIFY_API_SECRET` | Same page → API secret key (click eye icon) |
| `SHOPIFY_MASTER_PRODUCT_ID` | Open Custom Caise in admin; the number at the end of the URL |
| `PRINTIFY_API_TOKEN` | printify.com → My Account → Connections → API → Generate new token |
| `PRINTIFY_SHOP_ID` | printify.com dashboard URL, number after `/store/` |

### 3. Build the variant map (one-time)

Once Custom Caise is published in Shopify and `SHOPIFY_MASTER_PRODUCT_ID` is set:

```bash
npm run map-variants
```

This writes `variant-map.json` in the project root. Re-run whenever variants are
added or removed in Printify.

### 4. Run locally

```bash
npm run dev
```

Server listens on `http://localhost:3000`.

Check liveness: `curl http://localhost:3000/health`

## Deployment (Render)

### First deploy

1. Push this repo to GitHub (private is fine).
2. In Render dashboard → **New** → **Blueprint** → connect the repo.
3. Render reads `render.yaml` and creates the web service.
4. In the service's **Environment** tab, paste the values marked `sync: false` in
   `render.yaml` (tokens, shop IDs, etc.).
5. After deploy, commit `variant-map.json` to the repo (it's in `.gitignore` by
   default — remove it from there if you want auto-deploy to include it, OR
   run `npm run map-variants` once via Render's shell).

### Public URL

Render gives you a URL like `https://customcaise-backend.onrender.com`.

Your Shopify webhook URL is:
```
https://customcaise-backend.onrender.com/webhooks/shopify/orders-create
```

## Register the Shopify webhook

Shopify admin → **Settings** → **Notifications** → scroll to **Webhooks** → **Create webhook**:

- **Event:** `Order creation`
- **Format:** `JSON`
- **URL:** `https://customcaise-backend.onrender.com/webhooks/shopify/orders-create`
- **Webhook API version:** `2025-07`
- **Save**

Shopify sends a test ping immediately. Check Render logs for `📦 Processing Shopify order`.

### HMAC verification

Every webhook includes an `X-Shopify-Hmac-Sha256` header that we verify against
the raw body using `SHOPIFY_API_SECRET`. Unsigned or tampered requests get `401`.

## Android app integration

The Android app calls a function like this to launch checkout:

```kotlin
val checkoutUrl = "https://customcaise.myshopify.com/cart/" +
    "$shopifyVariantId:1" +
    "?properties[design_url]=${Uri.encode(designImageUrl)}" +
    "&properties[phone_model]=${Uri.encode(phoneModelName)}"

val intent = Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl))
startActivity(intent)
```

Or use `CustomTabsIntent` for an in-app browser experience.

The `shopifyVariantId` comes from the variant map — the app needs a way to look
up "iPhone 15 Pro / Glossy" → Shopify variant ID. Either:

- **Option A:** ship `variant-map.json` with the app (simple; requires app update for new phone models)
- **Option B:** expose a `GET /variants` endpoint on this backend that the app queries (dynamic; always current)

Happy to add Option B if you want.

## Flow summary

```
User designs case in app
    ↓
App uploads design PNG → gets public URL (design_url)
    ↓
App opens: customcaise.myshopify.com/cart/{variant}:1?properties[design_url]=...
    ↓
Customer completes Shopify checkout
    ↓
Shopify fires orders/create webhook → this backend
    ↓
Backend: verify HMAC, upload design to Printify, create Printify order
    ↓
Printify sends to Casestry for printing + shipping
```

## Idempotency

Shopify retries webhooks on non-2xx responses. To avoid duplicate Printify orders,
we tag processed Shopify orders with `printify-submitted` and skip orders that
already have that tag.

Errored orders get tagged `printify-error` with the error message in the order
notes for manual review.
