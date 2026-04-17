import { RateShipError } from "../errors";
import type { ProviderAdapter } from "../types";

export interface ShippoOptions {
  apiKey: string;
  /** Override the Shippo API base URL. Defaults to `https://api.goshippo.com`. */
  baseUrl?: string;
}

/**
 * Create a Shippo provider adapter.
 *
 * Auth header: `Authorization: ShippoToken <apiKey>`.
 * Pass the returned adapter to `new RateShip({ providers: [shippo(...)] })`.
 */
export function shippo(options: ShippoOptions): ProviderAdapter {
  if (!options.apiKey) {
    throw new RateShipError(
      "shippo() requires an apiKey.",
      "CONFIGURATION_ERROR",
    );
  }

  return {
    name: "shippo",
    async getRates() {
      throw new RateShipError(
        "shippo.getRates() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shippo" },
      );
    },
    async createLabel() {
      throw new RateShipError(
        "shippo.createLabel() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shippo" },
      );
    },
    verifyWebhook() {
      throw new RateShipError(
        "shippo.verifyWebhook() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shippo" },
      );
    },
  };
}
