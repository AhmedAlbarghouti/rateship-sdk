import { RateShipError } from "../errors";
import { createProviderFetcher } from "../internal/http";
import { amountToCents } from "../internal/money";
import type {
  Address,
  Label,
  NormalizedRate,
  Parcel,
  ProviderAdapter,
  RateRequest,
} from "../types";

const DEFAULT_BASE_URL = "https://api.goshippo.com";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ShippoOptions {
  apiKey: string;
  /** Override the Shippo API base URL. Defaults to `https://api.goshippo.com`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

// -- Shippo API response types (minimal — only fields we consume) ------------

interface ShippoRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string; token: string };
  estimated_days?: number;
}

interface ShippoShipmentResponse {
  object_id: string;
  status?: string;
  rates?: ShippoRate[];
}

interface ShippoTransactionResponse {
  status: string;
  object_id: string;
  tracking_number: string | null;
  label_url: string | null;
  rate: string;
  messages?: Array<{ text?: string }>;
}

// -- Helpers -----------------------------------------------------------------

function mapAddress(a: Address) {
  return {
    name: a.name,
    street1: a.street1,
    street2: a.street2,
    city: a.city,
    state: a.state,
    zip: a.zip,
    country: a.country,
    phone: a.phone,
    email: a.email,
  };
}

function mapParcel(p: Parcel) {
  return {
    length: String(p.length),
    width: String(p.width),
    height: String(p.height),
    distance_unit: p.distance_unit,
    weight: String(p.weight),
    mass_unit: p.weight_unit,
  };
}

function normalizeRate(rate: ShippoRate): NormalizedRate {
  return {
    provider: "shippo",
    carrier: rate.provider,
    service: rate.servicelevel.name,
    price_cents: amountToCents(rate.amount),
    currency: "USD",
    estimated_days: rate.estimated_days ?? null,
    estimated_delivery: null,
    rate_id: rate.object_id,
    raw: rate,
  };
}

// -- Adapter factory ---------------------------------------------------------

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

  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const request = createProviderFetcher({
    provider: "shippo",
    defaultTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const authHeaders = { Authorization: `ShippoToken ${apiKey}` };

  return {
    name: "shippo",

    async getRates(req: RateRequest): Promise<NormalizedRate[]> {
      const data = (await request({
        url: `${baseUrl}/shipments/`,
        method: "POST",
        headers: authHeaders,
        body: {
          address_from: mapAddress(req.from),
          address_to: mapAddress(req.to),
          parcels: [mapParcel(req.parcel)],
          async: false,
        },
      })) as ShippoShipmentResponse;

      return (data.rates ?? [])
        .filter((r) => r.currency === "USD")
        .map(normalizeRate);
    },

    async createLabel(rate: NormalizedRate): Promise<Label> {
      const raw = rate.raw as { object_id?: unknown };
      const rateObjectId = raw?.object_id;
      if (typeof rateObjectId !== "string" || !rateObjectId) {
        throw new RateShipError(
          "Shippo createLabel: rate.raw.object_id is missing. Pass the NormalizedRate returned by getRates() directly — don't reconstruct it.",
          "VALIDATION_ERROR",
          { provider: "shippo" },
        );
      }

      const data = (await request({
        url: `${baseUrl}/transactions/`,
        method: "POST",
        headers: authHeaders,
        body: { rate: rateObjectId, label_file_type: "PDF", async: false },
      })) as ShippoTransactionResponse;

      if (data.status !== "SUCCESS") {
        const messages =
          data.messages
            ?.map((m) => m.text)
            .filter((t): t is string => Boolean(t))
            .join("; ") || "Shippo label purchase failed.";
        throw new RateShipError(messages, "PROVIDER_ERROR", {
          provider: "shippo",
        });
      }

      if (!data.tracking_number || !data.label_url) {
        throw new RateShipError(
          "Shippo returned a successful transaction without tracking_number or label_url.",
          "PROVIDER_ERROR",
          { provider: "shippo" },
        );
      }

      return {
        provider: "shippo",
        carrier: rate.carrier,
        service: rate.service,
        price_cents: rate.price_cents,
        currency: "USD",
        tracking_number: data.tracking_number,
        label_url: data.label_url,
        label_id: data.object_id,
        rate_id: rate.rate_id,
        created_at: new Date().toISOString(),
        raw: data,
      };
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
