import { RateShipError } from "./errors";
import type {
  NormalizedEvent,
  Provider,
  ProviderAdapter,
  RateShipOptions,
  WebhookVerifyInput,
} from "./types";

/**
 * Main SDK entry point. Configure with one or more provider adapters; call
 * `getRates()` to fan out rate requests, `createLabel(rate)` to buy a label,
 * and `webhooks.verify(...)` to validate inbound provider webhooks.
 */
export class RateShip {
  private readonly adapters: Map<Provider, ProviderAdapter>;

  public readonly webhooks: WebhooksNamespace;

  constructor(options: RateShipOptions) {
    const providers = options.providers;

    if (!providers || providers.length === 0) {
      throw new RateShipError(
        "RateShip requires at least one provider. Pass one or more provider factories (e.g. `easypost(...)`) to `providers`.",
        "CONFIGURATION_ERROR",
      );
    }

    const byName = new Map<Provider, ProviderAdapter>();
    for (const adapter of providers) {
      if (byName.has(adapter.name)) {
        throw new RateShipError(
          `Duplicate provider: "${adapter.name}". Only one adapter per provider type is supported at MVP.`,
          "CONFIGURATION_ERROR",
        );
      }
      byName.set(adapter.name, adapter);
    }

    this.adapters = byName;
    this.webhooks = new WebhooksNamespace(this.adapters);
  }
}

/**
 * The `client.webhooks.*` surface. Kept as its own namespace because it will
 * grow (register, list event types, etc.) while rates and labels are flat.
 */
class WebhooksNamespace {
  constructor(private readonly adapters: Map<Provider, ProviderAdapter>) {}

  /**
   * Verify the HMAC signature on an inbound webhook from a provider and
   * return a normalized event. Throws `WebhookVerificationError` on mismatch.
   *
   * `rawBody` MUST be the exact bytes the provider sent. Do not parse-then-
   * re-serialize the body — HMAC is computed over the raw payload.
   */
  verify(input: WebhookVerifyInput): NormalizedEvent {
    const adapter = this.adapters.get(input.provider);
    if (!adapter) {
      throw new RateShipError(
        `No adapter configured for provider "${input.provider}". Add it to the \`providers\` array when constructing \`RateShip\`.`,
        "CONFIGURATION_ERROR",
      );
    }
    return adapter.verifyWebhook(input.rawBody, input.signature, input.secret);
  }
}
