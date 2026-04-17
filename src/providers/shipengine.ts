import { RateShipError } from "../errors";
import type { ProviderAdapter } from "../types";

export interface ShipEngineOptions {
  apiKey: string;
  /** Override the ShipEngine API base URL. Defaults to `https://api.shipengine.com`. */
  baseUrl?: string;
}

/**
 * Create a ShipEngine provider adapter.
 *
 * Auth header: `API-Key: <apiKey>`.
 * Pass the returned adapter to `new RateShip({ providers: [shipengine(...)] })`.
 */
export function shipengine(options: ShipEngineOptions): ProviderAdapter {
  if (!options.apiKey) {
    throw new RateShipError(
      "shipengine() requires an apiKey.",
      "CONFIGURATION_ERROR",
    );
  }

  return {
    name: "shipengine",
    async getRates() {
      throw new RateShipError(
        "shipengine.getRates() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shipengine" },
      );
    },
    async createLabel() {
      throw new RateShipError(
        "shipengine.createLabel() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shipengine" },
      );
    },
    verifyWebhook() {
      throw new RateShipError(
        "shipengine.verifyWebhook() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "shipengine" },
      );
    },
  };
}
