# Custom Caise Backend

Backend service that wires Shopify orders to Printify (Casestry) fulfillment for the Custom Caise app — a custom-designed phone case product where every order ships with a one-of-a-kind user-generated design.

**Status:** ✅ Deployed and operational
**Hosting:** Railway (`pleasant-presence` project)
**Public URL:** https://customcaise-backend-production-a57e.up.railway.app

## What it does

Handles the entire flow from "customer pays on Shopify" to "Casestry prints and ships":

1. **Variant mapping** — one-time setup script that matches every Shopify variant of the master `Custom Caise` product to its Printify counterpart and saves a lookup table (`variant-map.json`).
2. **Buy Now URL builder** — constructs the Shopify cart URL the Android app opens, embedding the user's design URL and phone model as line item properties.
3. **Order webhook handler** — receives Shopify `orders/create` webhooks, extracts the `design_url` property from each line item, and creates a Printify order with the custom design for Casestry to fulfill.

## Architecture

```
Customer designs case in Android app
    ↓
App uploads design image → public URL (design_url)
    ↓
App opens: customcaise.myshopify.com/cart/add?id={variant}&quantity=1
              &properties[design_url]=...&properties[phone_model]=...
              &return_to=/checkout
    ↓
Customer completes Shopify checkout (10% off, free US shipping)
    ↓
Shopify fires orders/create webhook (signed with HMAC)
    ↓
Backend (this service) on Railway:
  • Verifies HMAC signature
  • Looks up Printify variant from Shopify variant ID
  • Creates Printify order with design_url referenced directly
  • (Optional) Auto-sends to production
  • Tags Shopify order "printify-submitted"
    ↓
Casestry receives order from Printify → prints → ships to customer
```

## Tech stack

- **Node.js 20+** with native `fetch`
- **Express** (web server)
- **dotenv** (config)
- No database — variant map lives as a JSON file in the repo, refreshed via script

## Project structure

```
customcaise-backend/
├── src/
│   ├── server.js                       # Express entry point
│   ├── routes/
│   │   └── shopify-webhooks.js         # /webhooks/shopify/orders-create handler
│   ├── services/
│   │   ├── shopify.js                  # Shopify Admin API client
│   │   └── printify.js                 # Printify API client
│   └── lib/
│       ├── verify-shopify-webhook.js   # HMAC signature verification
│       └── buy-now-url.js              # Buy Now URL builder for Android app
├── scripts/
│   └── build-variant-map.js            # One-time variant mapping
├── variant-map.json                    # Generated; commit to repo
├── package.json
├── render.yaml                         # Unused; keeping for reference
└── .env.example                        # Credential template
```

## Environment variables

Set in Railway → service → **Variables** tab.

| Variable | Source | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `SHOPIFY_STORE` | `customcaise.myshopify.com` | The .myshopify.com domain |
| `SHOPIFY_ADMIN_TOKEN` | Shopify admin → Settings → Apps and sales channels → Develop apps → caises → API credentials | Format: `shpat_...`. **One-time reveal**; uninstall and reinstall the app to get a new one if lost. |
| `SHOPIFY_API_SECRET` | Shopify admin → Settings → Notifications → bottom of page, "Webhooks will be signed with" | 64-char hex. **Not** the custom app's API secret — it's the per-store webhook signing secret. |
| `SHOPIFY_API_VERSION` | `2025-07` | Stable version |
| `SHOPIFY_MASTER_PRODUCT_ID` | URL of Custom Caise in Shopify admin (long number at end) | |
| `PRINTIFY_API_TOKEN` | Printify → My Account → Connections → API → Generate token | |
| `PRINTIFY_SHOP_ID` | Printify dashboard URL: `printify.com/app/store/{ID}/dashboard` | **Must be the "Your Imagination Realized" shop**, not the "Caises" custom store. |
| `PRINTIFY_BLUEPRINT_ID` | `841` | Casestry Impact-Resistant Case |
| `PRINTIFY_PRINT_PROVIDER_ID` | `88` | Casestry |
| `AUTO_SEND_TO_PRODUCTION` | `false` (or unset) during testing, `true` for live | Safety flag — when not `true`, Printify orders stay in "On hold" for manual review |

## Setup (from scratch on a new machine)

### 1. Clone and install

```bash
git clone https://github.com/YouveBeen0wned/customcaise-backend.git
cd customcaise-backend
npm install
```

### 2. Configure local environment

```bash
cp .env.example .env
```

Edit `.env` with all values from the table above.

### 3. Build the variant map

Once a Custom Caise product is published in Shopify and `SHOPIFY_MASTER_PRODUCT_ID` is set:

```bash
npm run map-variants
```

Writes `variant-map.json` in the project root. Re-run whenever variants are added or removed in Printify.

Output should look like:
```
✅ Wrote variant-map.json with 76 matched variants
```

### 4. Run locally

```bash
npm run dev
```

Server listens on `http://localhost:3000`. Check liveness:
```bash
curl http://localhost:3000/health
# {"ok":true,"timestamp":"..."}
```

## Deployment (Railway)

The current deployment is on Railway in the `pleasant-presence` project. New deploys happen automatically on every push to `main`.

### To deploy a new copy from scratch:

1. Push code to a GitHub repo
2. railway.com → New Project → Deploy from GitHub repo → select repo
3. Railway auto-detects Node and runs `npm install` + `npm start`
4. Add environment variables (see table above) in the service's Variables tab
5. Settings → Networking → Generate Domain → copy public URL
6. Verify health: `curl https://{your-url}/health`

### Plan

Hobby plan ($5/month) recommended. The free trial credit runs out in 30 days. Webhook services need always-on availability — Render's free tier (with cold starts) is unsafe for this because Shopify's 5-second webhook timeout doesn't tolerate cold-start latency.

## Shopify webhook registration

Shopify admin → **Settings** → **Notifications** → scroll to **Webhooks** → **Create webhook**:

- **Event:** `Order creation`
- **Format:** `JSON`
- **URL:** `https://customcaise-backend-production-a57e.up.railway.app/webhooks/shopify/orders-create`
- **Webhook API version:** `2025-07`

The webhook is signed with HMAC. Our handler verifies the signature against `SHOPIFY_API_SECRET` (the per-store webhook signing secret, found at the bottom of the Notifications page).

## Buy Now URL format (for the Android app)

The Android app uses the `/cart/add` endpoint (not the legacy `/cart/{variant}:{qty}` permalink — that one strips line item properties).

```kotlin
val variantId = lookupShopifyVariantId(phoneModel)  // from variant-map.json
val designUrl = uploadDesignAndGetPublicUrl(...)    // see "Design upload" below

val checkoutUrl = "https://customcaise.myshopify.com/cart/add" +
    "?id=$variantId" +
    "&quantity=1" +
    "&properties[design_url]=${Uri.encode(designUrl)}" +
    "&properties[phone_model]=${Uri.encode(phoneModel)}" +
    "&return_to=/checkout"

val intent = Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl))
startActivity(intent)
```

`return_to=/checkout` skips the cart page and goes directly to checkout.

The `buildBuyNowUrl()` helper in `src/lib/buy-now-url.js` constructs this server-side if needed.

## Design upload pipeline (TODO)

The app needs to upload the user's design somewhere with a stable, public URL before constructing the Buy Now URL. The design URL is fetched directly by Printify when creating the fulfillment order — **it must be a direct image URL with no redirects** (picsum.photos won't work; placehold.co does).

Recommended hosting:
- **Cloudflare R2** — best choice, S3-compatible, zero egress fees, generous free tier
- **AWS S3** — well-known, slight cost
- **Cloudinary** — free tier with image transformations
- **Firebase Storage** — easy if already in Google ecosystem

Not yet implemented — flagged as next milestone.

## Order processing flow (what the webhook does)

For each `orders/create` webhook:

1. **Respond 200 immediately** to Shopify (5-second timeout). Process async.
2. **Verify HMAC** signature against `SHOPIFY_API_SECRET`. Reject with 401 if invalid.
3. **Idempotency check** — skip if order already has `printify-submitted` tag.
4. **For each line item:**
   - Look up `shopifyVariantId` in `variant-map.json`. Skip if not a Custom Caise variant.
   - Extract `design_url` and `phone_model` from `line_item.properties`. Error if `design_url` missing.
   - Add to printifyLineItems with `print_areas.front[].src = designUrl`.
5. **Create Printify order** via `POST /v1/shops/{shop_id}/orders.json` with full address + line items.
6. **If `AUTO_SEND_TO_PRODUCTION=true`:** call `POST /orders/{id}/send_to_production.json`. Otherwise leave on hold.
7. **Tag Shopify order** with `printify-submitted` and add note `Printify order created: {id}`.

### Error handling

If anything fails after step 1, the Shopify order is tagged `printify-error` with the error message in the order notes. Manual investigation required for those.

## Pricing structure

| | Value |
|---|---|
| Retail (base) | $40 |
| Auto-discount | 10% (`-$4.00 NEW LAUNCH`) |
| Customer pays | $36 |
| Shipping (US) | Free (absorbed) |
| Casestry print cost | ~$15-18 per case |
| Casestry shipping (you pay) | ~$5.19 per US order |
| Stripe fees | 2.9% + $0.30 ≈ $1.34 |
| **Profit per US order** | **~$11-15** |

## Operational notes

### Multi-store warning

The Printify account has 5 stores. The "Caises" store is a Custom API integration that doesn't auto-publish to Shopify. **All work must happen in the "Your Imagination Realized" Shopify-connected store.** This caused a stuck publish during initial setup.

### Shadow products in Printify

Every API order auto-creates an "API #{order_id} - {customer_name}" product in Printify. These are unpublished and customers don't see them — they're internal records. Filter by Status=Published in the Printify product list to hide them. Don't auto-delete; useful for customer support if reprints are needed.

### Test mode toggles

For testing without real charges:
- **Shopify Payments test mode:** Settings → Payments → Shopify Payments → Manage → Test mode ON
- **Backend safety mode:** `AUTO_SEND_TO_PRODUCTION` env var unset or `false`

For going live:
- Disable Shopify test mode
- Set `AUTO_SEND_TO_PRODUCTION=true` in Railway

### Test card numbers

When Shopify Payments test mode is active:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Any future expiration date, any 3-digit CVV

## Troubleshooting

**Webhook delivers 401 (HMAC mismatch):**
The `SHOPIFY_API_SECRET` env var doesn't match the store's webhook signing secret. Find the right secret at Settings → Notifications → bottom of page, "Webhooks will be signed with". This is **different** from the custom app's API secret.

**Printify order creation fails with "src field should be URL":**
The design URL passed in `properties[design_url]` is not a direct image URL. Common causes: redirect URLs (picsum.photos), expired signed URLs, private storage. Use a direct image URL or a public CDN.

**Order completes on Shopify but webhook never fires:**
Either (1) webhook not registered, (2) Railway service down (check `/health`), or (3) the order went through Shop Pay express checkout which sometimes drops line item properties. Confirm by inspecting the order in Shopify admin — line item properties section should show `design_url` and `phone_model`.

**Webhook fires but logs say "Line item is not a Custom Caise variant":**
The Shopify variant ID doesn't exist in `variant-map.json`. Re-run `npm run map-variants` and commit/push the updated file.

**Order tagged `printify-error`:**
Check the order note for the error message. Common causes: malformed shipping address, design_url unreachable, Printify API rate limit.

## Next steps

- [ ] Implement design upload pipeline in Android app (Cloudflare R2 recommended)
- [ ] End-to-end test with real $36 charge + refund (validates production payment flow)
- [ ] Toggle `AUTO_SEND_TO_PRODUCTION=true` for launch
- [ ] Disable Shopify test mode for launch
- [ ] Marketing posts (Reddit, Discord, IG, etc.)
- [ ] Optional: variant lookup endpoint (`GET /variants`) so app doesn't need to ship variant-map.json
- [ ] Optional: monitoring / alerting on `printify-error` tagged orders

## Credits

Built collaboratively over a long iteration session. Major debugging milestones survived:
- Multi-store confusion (Caises vs Your Imagination Realized)
- Stuck Printify publish (eventually unblocked by support)
- Wrong Shopify secret (custom app secret vs webhook signing secret)
- Cart URL format (legacy `/cart/{id}:{qty}` strips properties, modern `/cart/add` preserves them)
- Printify orders endpoint quirks (expects URL in `src`, not upload ID)
- Notepad save corrupting JS syntax
