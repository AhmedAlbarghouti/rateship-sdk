# Changelog

All notable changes to the `rateship` package are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - Unreleased

### Changed — breaking

The SDK has been rewritten from an HTTP client for a hosted RateShip service into a provider-agnostic shipping library. Every public API has changed. See the [migration notes in the README](./README.md#migrating-from-v1) for a full diff.

- **New construction shape.** `new RateShip({ apiKey, baseUrl })` is replaced by `new RateShip({ providers: [easypost(...), shippo(...), ...] })`. Each provider is a factory function that returns an adapter; pass them into the client.
- **Flat method surface.** `rateship.rates.get(...)` → `client.getRates(...)`. `rateship.labels.purchase(...)` → `client.createLabel(rate)` — pass the full `NormalizedRate` back, no re-specifying address / weight / dimensions.
- **Stateful label purchase.** The adapter reads provider-native identifiers from `rate.raw` and buys the label in one HTTP call instead of re-creating the shipment.
- **Webhook helper.** New `client.webhooks.verify({ provider, rawBody, signature, secret })` — HMAC verification + typed event normalization.
- **Request type changes:** `from_address`/`to_address` → `from`/`to`; weight and dimensions extracted into a `parcel` object; `package_count` removed (single parcel at MVP); `weight_unit: 'lbs'` → `'lb'` to match provider APIs; **`Address.country` locked to the `"US"` literal type** (v1 accepted any string). Widening to `string` in v2.1+ is additive and won't break v2.0 code.
- **Error model.** `RateShipError.status` removed. Errors now carry `.code` (`AUTH_FAILED` | `TIMEOUT` | `PROVIDER_ERROR` | `NETWORK_ERROR` | `VALIDATION_ERROR` | `CONFIGURATION_ERROR` | `WEBHOOK_VERIFICATION_FAILED` | `UNKNOWN`) and optionally `.provider` / `.cause`. New `WebhookVerificationError` subclass for signature mismatches.
- **Hosted-only features removed.** No more `labels.list()`, no webhook registration/list/delete endpoints, no API-key or subscription concepts — all were pieces of the hosted v1 service that no longer exists.

### Added

- **Three provider adapters** with full rate + label support: `easypost`, `shippo`, `shipengine`.
- **Parallel fan-out** for `getRates()` — `Promise.allSettled` across all configured providers; partial failures land in an `errors[]` array. Rates are sorted ascending by `price_cents`.
- **Webhook verification** for Shippo (HMAC-SHA256 over `<timestamp>.<body>`, 5-min replay tolerance) and EasyPost (HMAC-SHA256 hex with NFKD-normalized secret, accepting both the `hmac-sha256-hex=` prefixed form and bare hex).
- **Subpath exports** for per-provider tree-shaking: `rateship/providers/easypost`, `rateship/providers/shippo`, `rateship/providers/shipengine`.
- **Zero runtime dependencies.** Uses Node's built-in `fetch` and `crypto`.
- **Node 20+** via `engines` field in `package.json`.
- **Dual CJS + ESM** build with full `.d.ts` types.

### Not supported yet (planned for v2.1+)

- ShipEngine webhook verification (uses RSA-SHA256 + JWKS, which requires async key fetching). Calling `shipengine.verifyWebhook` in v2.0 throws a `RateShipError` with code `CONFIGURATION_ERROR` and a docs link.
- International shipping — `Address.country` is locked to `"US"` at the type level. Non-US origin or destination will type-error at compile time; widening the type in v2.1+ is additive, so v2.0 code won't break.
- Tracking polling (`client.tracking.get()`). Handle tracking via webhooks for now.
- International units (kg, grams, cm).
- Label options (format, insurance, return labels, customs).
- Multiple adapters of the same provider type (multi-tenant key rotation).
- Programmatic webhook registration with providers.
