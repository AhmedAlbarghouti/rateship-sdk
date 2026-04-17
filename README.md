# rateship

Provider-agnostic shipping SDK for Node. **One API across every major shipping provider — your backend, your keys, zero lock-in.**

[![npm](https://img.shields.io/npm/v/rateship.svg)](https://www.npmjs.com/package/rateship)
[![license](https://img.shields.io/npm/l/rateship.svg)](./LICENSE)

- **Multi-provider by default** — configure EasyPost, Shippo, and ShipEngine at once; one `getRates()` call fans out in parallel and returns normalized rates across all of them.
- **Stateful label purchase** — pass a rate back to `createLabel(rate)` and the SDK buys it through the right provider in a single API call.
- **Webhook verification built in** — `webhooks.verify()` validates HMAC signatures and returns typed, normalized events.
- **Zero runtime dependencies.** Node 20+, native `fetch`, native `crypto`.
- **Full TypeScript.** Every response, every event, every error is typed.
- **Tree-shakable.** Import a single provider and the rest never reaches your bundle.

> **v2.0.0 is US-domestic only.** `country` on addresses is locked to `"US"` at the type level; weight uses `lb`/`oz`, distance uses `in`, and rates are filtered to USD. International shipping lands in v2.1+ as an additive widening — v2.0 code won't break when it ships.

```ts
import { RateShip, easypost, shippo } from 'rateship';

const client = new RateShip({
  providers: [
    easypost({ apiKey: process.env.EASYPOST_KEY! }),
    shippo({ apiKey: process.env.SHIPPO_KEY! }),
  ],
});

const { rates, errors } = await client.getRates(request);
const label = await client.createLabel(rates[0]);
```

---

## Install

```bash
npm install rateship
# or
pnpm add rateship
# or
yarn add rateship
```

Requires **Node 20+**.

## Getting Provider Keys

You bring your own provider credentials. No RateShip account required.

| Provider | Dashboard | Key format |
|---|---|---|
| **EasyPost** | https://www.easypost.com/account/api-keys | `EZ_...` (test) / `EZAK_...` (prod) |
| **Shippo** | https://apps.goshippo.com/settings/api | `shippo_test_...` / `shippo_live_...` |
| **ShipEngine** | https://app.shipengine.com/#/settings/api-keys | `TEST_...` / `live_...` |

## Quickstart

```ts
import { RateShip, easypost, shippo, shipengine } from 'rateship';

const client = new RateShip({
  providers: [
    easypost({ apiKey: process.env.EASYPOST_KEY! }),
    shippo({ apiKey: process.env.SHIPPO_KEY! }),
    shipengine({ apiKey: process.env.SHIPENGINE_KEY! }),
  ],
});

// Fan out to every configured provider in parallel.
const { rates, errors } = await client.getRates({
  from: {
    name: 'Warehouse',
    street1: '500 Terry A Francois Blvd',
    city: 'San Francisco',
    state: 'CA',
    zip: '94158',
    country: 'US',
  },
  to: {
    name: 'Jane Doe',
    street1: '1600 Amphitheatre Pkwy',
    city: 'Mountain View',
    state: 'CA',
    zip: '94043',
    country: 'US',
  },
  parcel: {
    weight: 2,
    weight_unit: 'lb',
    length: 10,
    width: 8,
    height: 6,
    distance_unit: 'in',
  },
});

// rates are sorted ascending by price_cents
// errors[] holds per-provider failures (partial success)

const label = await client.createLabel(rates[0]);
console.log(label.tracking_number, label.label_url);
```

## API Reference

### `new RateShip({ providers })`

Configure one or more provider adapters:

```ts
const client = new RateShip({
  providers: [
    easypost({ apiKey: '...' }),
    shippo({ apiKey: '...' }),
    shipengine({ apiKey: '...' }),
  ],
});
```

**Rules:**
- At least one provider is required. Passing `[]` throws `CONFIGURATION_ERROR`.
- Only one adapter per provider type at this version. Passing two `easypost(...)` adapters throws `CONFIGURATION_ERROR`.
- No network calls happen at construction. Invalid API keys surface on the first `getRates()` / `createLabel()` call via the `errors[]` array or a thrown `RateShipError`.

### `client.getRates(request) → { rates, errors }`

Parallel fan-out across every configured provider. Returns both successful rates and per-provider failures — one provider being down never kills the whole call.

```ts
interface RatesResponse {
  rates: NormalizedRate[];   // sorted ascending by price_cents
  errors: ProviderError[];   // one entry per failed provider, empty if all OK
}

interface NormalizedRate {
  provider: 'easypost' | 'shippo' | 'shipengine';
  carrier: string;           // "UPS", "USPS", "FedEx"
  service: string;           // "Ground", "Priority Mail", etc.
  price_cents: number;       // always integer cents, always USD at v2.0
  currency: 'USD';
  estimated_days: number | null;
  estimated_delivery: string | null;  // ISO date
  rate_id: string;           // provider-native rate id
  raw: object;               // full provider response, untouched
}
```

### `client.createLabel(rate) → Label`

Buy the label for a rate you got from `getRates()`. Pass the whole `NormalizedRate` object back — the SDK uses the `raw` field to reconstruct the provider-native purchase call in one HTTP hop.

```ts
const label = await client.createLabel(rates[0]);

interface Label {
  provider: 'easypost' | 'shippo' | 'shipengine';
  carrier: string;
  service: string;
  price_cents: number;
  currency: 'USD';
  tracking_number: string;   // required — success guarantees this exists
  label_url: string;         // required
  label_id: string;          // provider-native label identifier
  rate_id: string;
  created_at: string;        // ISO timestamp
  raw: object;
}
```

Throws `RateShipError` on any failure (provider error, auth, timeout, network). Label purchase is single-provider, so there's no partial success shape — just one exception or one result.

### `client.webhooks.verify({ provider, rawBody, signature, secret }) → NormalizedEvent`

Verify the HMAC signature of an inbound provider webhook and return a normalized, typed event. Throws `WebhookVerificationError` on mismatch — never returns null, so auth-bypass bugs are impossible.

```ts
// Express
app.post('/webhooks/shippo', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = client.webhooks.verify({
      provider: 'shippo',
      rawBody: req.body,                                    // Buffer, not parsed JSON
      signature: req.header('Shippo-Auth-Signature')!,
      secret: process.env.SHIPPO_WEBHOOK_SECRET!,
    });

    if (event.type === 'tracking.delivered') {
      // event.delivered_at, event.location, event.signed_by
    } else {
      // event.status is one of: 'pre_transit' | 'in_transit' |
      //   'out_for_delivery' | 'failure' | 'unknown'
      // event.status_detail, event.occurred_at, event.estimated_delivery
    }

    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(401);
  }
});
```

**`rawBody` MUST be the exact bytes the provider sent.** HMAC is computed over the raw payload — parsing JSON then re-serializing it breaks signatures.

**Provider support matrix:**

| Provider | Header | Algorithm | Notes |
|---|---|---|---|
| Shippo | `Shippo-Auth-Signature` | HMAC-SHA256 over `<timestamp>.<body>` | 5-min replay tolerance. Contact Shippo to enable webhook signing on your account. |
| EasyPost | `X-Hmac-Signature` | HMAC-SHA256 hex with `hmac-sha256-hex=` prefix | Secret is NFKD-normalized to match EasyPost's official clients. |
| ShipEngine | RSA-SHA256 + JWKS | Not in v2.0.0 | Calling `verifyWebhook` for ShipEngine throws with a docs link. Shipping in v2.1. |

## Subpath Imports (Tree-Shaking)

If you only use one provider, import it directly for a smaller bundle:

```ts
import { RateShip } from 'rateship';
import { easypost } from 'rateship/providers/easypost';

const client = new RateShip({ providers: [easypost({ apiKey: '...' })] });
```

Subpath imports:
- `rateship/providers/easypost`
- `rateship/providers/shippo`
- `rateship/providers/shipengine`

## Error Handling

All errors thrown by the SDK are `RateShipError` (or a subclass). Inspect `.code` to branch.

```ts
import { RateShip, RateShipError, WebhookVerificationError } from 'rateship';

try {
  const label = await client.createLabel(rate);
} catch (err) {
  if (err instanceof RateShipError) {
    console.log(err.code);      // 'AUTH_FAILED', 'TIMEOUT', etc.
    console.log(err.provider);  // 'shippo' | 'easypost' | 'shipengine' | undefined
    console.log(err.cause);     // underlying error (network, parse, etc.)
  }
}
```

**Per-provider errors inside `getRates().errors[]`** are plain data (not thrown), with the same code set:

| Code | When |
|---|---|
| `AUTH_FAILED` | Provider returned 401 or 403 — bad / expired API key. |
| `TIMEOUT` | Request exceeded the configured timeout (default 15s). |
| `PROVIDER_ERROR` | Provider returned a 4xx/5xx (non-auth) or a semantic failure (e.g. "insufficient postage"). |
| `NETWORK_ERROR` | DNS failure, connection reset, TLS handshake failure, etc. |
| `VALIDATION_ERROR` | Input validation caught a bad request before calling any provider. |
| `CONFIGURATION_ERROR` | SDK misuse — missing API key, duplicate adapters, unsupported feature. |
| `WEBHOOK_VERIFICATION_FAILED` | HMAC signature mismatch or timestamp too stale. |
| `UNKNOWN` | Catch-all for errors that don't fit the above buckets. |

## TypeScript

Every public type is exported from the package root:

```ts
import type {
  // Config
  RateShipOptions,
  Provider,
  // Input
  Address,
  Parcel,
  RateRequest,
  // Output
  NormalizedRate,
  ProviderError,
  RatesResponse,
  Label,
  // Webhooks
  WebhookVerifyInput,
  NormalizedEvent,
  TrackingUpdatedEvent,
  TrackingDeliveredEvent,
  TrackingStatus,
  EventLocation,
  // Errors
  ErrorCode,
  RateShipErrorOptions,
  // Adapter interface (for custom providers)
  ProviderAdapter,
  // Per-provider factory options
  EasyPostOptions,
  ShippoOptions,
  ShipEngineOptions,
} from 'rateship';
```

## Migrating from v1

The v1 SDK was an HTTP client for a hosted RateShip API. v2 talks to providers directly from your backend — no hosted service required.

Biggest shape changes:
- `rateship.rates.get(request)` → `client.getRates(request)`
- `rateship.labels.purchase(request)` → `client.createLabel(rate)` (pass the `NormalizedRate` back, not a reconstructed request)
- `RateShipError.status` removed — use `.code` instead (`AUTH_FAILED`, etc.)
- `RateRequest` restructured: `from_address`/`to_address` → `from`/`to`; weight + dims extracted into a `parcel` object; `package_count` removed (single parcel at MVP).
- `weight_unit: 'lbs'` → `'lb'` (singular, matches provider APIs).
- `client.labels.list()` removed — no hosted history. Persist labels yourself.
- `client.webhooks.create/list/delete/update` removed — no hosted webhook registration. Use provider dashboards directly.

## Contributing

Issues and PRs welcome at https://github.com/AhmedAlbarghouti/rateship-sdk.

## License

MIT — see [LICENSE](./LICENSE).
