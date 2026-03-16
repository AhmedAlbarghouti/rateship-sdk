# rateship

Official SDK for the [RateShip](https://rateship.io) shipping API. Get rates and purchase labels across Shippo, EasyPost, and ShipEngine through one unified API.

## Install

```bash
npm install rateship
```

## Quick Start

```typescript
import { RateShip } from "rateship";

const rateship = new RateShip({
  apiKey: "rs_dev_your_key_here",
});

// Get shipping rates
const { rates, errors } = await rateship.rates.get({
  origin_zip: "10001",
  destination_zip: "90210",
  weight: 2.5,
  weight_unit: "lbs",
  length: 10,
  width: 8,
  height: 4,
  package_count: 1,
});

console.log(rates); // Normalized rates from all connected providers
```

## API Reference

### Initialize

```typescript
const rateship = new RateShip({
  apiKey: "rs_dev_your_key_here", // Required
  baseUrl: "https://rateship.io", // Optional, defaults to production
});
```

### Get Rates

```typescript
const { rates, errors } = await rateship.rates.get({
  origin_zip: "10001",
  destination_zip: "90210",
  weight: 2.5,
  weight_unit: "lbs", // "lbs" | "oz"
  length: 10,
  width: 8,
  height: 4,
  package_count: 1,
});
```

Each rate in the `rates` array:

```typescript
{
  provider: "shippo" | "easypost" | "shipengine",
  carrier: "USPS",
  service: "Ground Advantage",
  price_cents: 965,
  currency: "USD",
  estimated_days: 5,
  estimated_delivery: null,
  rate_id: "5e228fbf...",
  raw: { /* original provider response */ }
}
```

### Purchase a Label

```typescript
const label = await rateship.labels.purchase({
  provider: "shippo",
  rate_id: "5e228fbf...",
  carrier: "USPS",
  service: "Ground Advantage",
  price_cents: 965,
  from_address: {
    name: "Jane Smith",
    street1: "123 Main St",
    city: "San Francisco",
    state: "CA",
    zip: "94107",
  },
  to_address: {
    name: "John Doe",
    street1: "456 Oak Ave",
    city: "Los Angeles",
    state: "CA",
    zip: "90001",
  },
  weight: 2.5,
  weight_unit: "lbs",
  length: 10,
  width: 8,
  height: 4,
  package_count: 1,
});

console.log(label.tracking_number); // "9400111899223..."
console.log(label.label_url);       // "https://..."
```

### List Labels

```typescript
const { items, page, total } = await rateship.labels.list({
  page: 1,
  page_size: 10,
  provider: "shippo",    // optional filter
  date_from: "2026-03-01", // optional
  date_to: "2026-03-31",   // optional
});
```

### Webhooks

```typescript
// Register an endpoint
const endpoint = await rateship.webhooks.create({
  url: "https://your-app.com/webhooks",
  events: ["label.purchased", "tracking.updated", "tracking.delivered"],
});
console.log(endpoint.secret); // Save this for signature verification

// List endpoints
const { endpoints } = await rateship.webhooks.list();

// Toggle active/inactive
await rateship.webhooks.update(endpoint.id, { is_active: false });

// Delete
await rateship.webhooks.delete(endpoint.id);
```

## Error Handling

```typescript
import { RateShip, RateShipError } from "rateship";

try {
  const { rates } = await rateship.rates.get({ /* ... */ });
} catch (error) {
  if (error instanceof RateShipError) {
    console.log(error.message); // "Invalid API key"
    console.log(error.code);    // "AUTH_FAILED"
    console.log(error.status);  // 401
  }
}
```

### Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `AUTH_FAILED` | 401 | Missing or invalid API key |
| `INVALID_API_KEY` | 401 | API key not found or revoked |
| `SUBSCRIPTION_REQUIRED` | 403 | Pro subscription required |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `USAGE_LIMIT_EXCEEDED` | 429 | Free tier limit reached |
| `RATE_LIMITED` | 429 | Too many requests |
| `PROVIDER_ERROR` | 502 | Shipping provider returned an error |

## TypeScript

All types are exported:

```typescript
import type {
  RateRequest,
  NormalizedRate,
  ProviderError,
  RatesResponse,
  LabelPurchaseRequest,
  LabelPurchaseResult,
  LabelHistoryResponse,
  Address,
  Provider,
} from "rateship";
```

## License

MIT
