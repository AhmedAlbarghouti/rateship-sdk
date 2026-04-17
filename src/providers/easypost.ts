import { RateShipError } from "../errors";
import type { ProviderAdapter } from "../types";

export interface EasyPostOptions {
  apiKey: string;
  /** Override the EasyPost API base URL. Defaults to `https://api.easypost.com`. */
  baseUrl?: string;
}

/**
 * Create an EasyPost provider adapter.
 *
 * Auth: HTTP Basic — the API key is sent as the username, password empty.
 * Pass the returned adapter to `new RateShip({ providers: [easypost(...)] })`.
 */
export function easypost(options: EasyPostOptions): ProviderAdapter {
  if (!options.apiKey) {
    throw new RateShipError(
      "easypost() requires an apiKey.",
      "CONFIGURATION_ERROR",
    );
  }

  return {
    name: "easypost",
    async getRates() {
      throw new RateShipError(
        "easypost.getRates() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "easypost" },
      );
    },
    async createLabel() {
      throw new RateShipError(
        "easypost.createLabel() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "easypost" },
      );
    },
    verifyWebhook() {
      throw new RateShipError(
        "easypost.verifyWebhook() is not yet implemented.",
        "PROVIDER_ERROR",
        { provider: "easypost" },
      );
    },
  };
}
