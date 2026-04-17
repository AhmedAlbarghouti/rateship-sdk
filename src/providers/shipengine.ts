import { RateShipError } from "../errors";
import { createProviderFetcher } from "../internal/http";
import { floatToCents } from "../internal/money";
import type {
  Address,
  Label,
  NormalizedRate,
  Parcel,
  ProviderAdapter,
  RateRequest,
} from "../types";

const DEFAULT_BASE_URL = "https://api.shipengine.com/v1";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ShipEngineOptions {
  apiKey: string;
  /** Override the ShipEngine API base URL. Defaults to `https://api.shipengine.com/v1`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

// -- ShipEngine API response types (minimal) ---------------------------------

interface ShipEngineCarrier {
  carrier_id: string;
}

interface ShipEngineCarriersResponse {
  carriers?: ShipEngineCarrier[];
}

interface ShipEngineRate {
  rate_id: string;
  carrier_code: string;
  service_type: string;
  shipping_amount: { currency: string; amount: number };
  delivery_days?: number | null;
  estimated_delivery_date?: string | null;
}

interface ShipEngineRatesResponse {
  rate_response?: { rates?: ShipEngineRate[] };
}

interface ShipEngineLabelResponse {
  label_id: string;
  status: string;
  tracking_number: string | null;
  label_download: { pdf?: string | null; png?: string | null } | null;
  shipment_cost?: { currency: string; amount: number };
}

// -- Helpers -----------------------------------------------------------------

function mapAddress(a: Address) {
  return {
    name: a.name,
    phone: a.phone,
    email: a.email,
    address_line1: a.street1,
    address_line2: a.street2,
    city_locality: a.city,
    state_province: a.state,
    postal_code: a.zip,
    country_code: a.country,
  };
}

function mapPackage(p: Parcel) {
  return {
    weight: {
      value: p.weight,
      unit: p.weight_unit === "lb" ? "pound" : "ounce",
    },
    dimensions: {
      length: p.length,
      width: p.width,
      height: p.height,
      unit: "inch",
    },
  };
}

const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  ups: "UPS",
  usps: "USPS",
  fedex: "FedEx",
  dhl_express: "DHL Express",
  stamps_com: "USPS",
};

function carrierDisplayName(code: string): string {
  return CARRIER_DISPLAY_NAMES[code] ?? code.toUpperCase();
}

function normalizeRate(rate: ShipEngineRate): NormalizedRate {
  return {
    provider: "shipengine",
    carrier: carrierDisplayName(rate.carrier_code),
    service: rate.service_type,
    price_cents: floatToCents(rate.shipping_amount.amount),
    currency: "USD",
    estimated_days: rate.delivery_days ?? null,
    estimated_delivery: rate.estimated_delivery_date ?? null,
    rate_id: rate.rate_id,
    raw: rate,
  };
}

// -- Adapter factory ---------------------------------------------------------

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

  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const request = createProviderFetcher({
    provider: "shipengine",
    defaultTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const authHeaders = { "API-Key": apiKey };

  return {
    name: "shipengine",

    async getRates(req: RateRequest): Promise<NormalizedRate[]> {
      // ShipEngine requires explicit carrier_ids on /rates.
      const carriersData = (await request({
        url: `${baseUrl}/carriers`,
        method: "GET",
        headers: authHeaders,
      })) as ShipEngineCarriersResponse;

      const carrierIds = (carriersData.carriers ?? []).map((c) => c.carrier_id);

      if (carrierIds.length === 0) {
        throw new RateShipError(
          "No carriers connected in ShipEngine. Add a carrier in your ShipEngine dashboard first.",
          "PROVIDER_ERROR",
          { provider: "shipengine" },
        );
      }

      const data = (await request({
        url: `${baseUrl}/rates`,
        method: "POST",
        headers: authHeaders,
        body: {
          rate_options: { carrier_ids: carrierIds },
          shipment: {
            ship_from: mapAddress(req.from),
            ship_to: mapAddress(req.to),
            packages: [mapPackage(req.parcel)],
          },
        },
      })) as ShipEngineRatesResponse;

      return (data.rate_response?.rates ?? [])
        .filter((r) => r.shipping_amount.currency.toLowerCase() === "usd")
        .map(normalizeRate);
    },

    async createLabel(rate: NormalizedRate): Promise<Label> {
      if (!rate.rate_id) {
        throw new RateShipError(
          "ShipEngine createLabel: rate.rate_id is missing.",
          "VALIDATION_ERROR",
          { provider: "shipengine" },
        );
      }

      const data = (await request({
        url: `${baseUrl}/labels/rates/${encodeURIComponent(rate.rate_id)}`,
        method: "POST",
        headers: authHeaders,
        body: {
          validate_address: "no_validation",
          label_format: "pdf",
          label_download_type: "url",
        },
      })) as ShipEngineLabelResponse;

      if (data.status !== "completed") {
        throw new RateShipError(
          `ShipEngine label status: ${data.status}`,
          "PROVIDER_ERROR",
          { provider: "shipengine" },
        );
      }

      const labelUrl = data.label_download?.pdf ?? null;
      if (!labelUrl || !data.tracking_number) {
        throw new RateShipError(
          "ShipEngine returned a completed label without tracking_number or label_download.pdf.",
          "PROVIDER_ERROR",
          { provider: "shipengine" },
        );
      }

      return {
        provider: "shipengine",
        carrier: rate.carrier,
        service: rate.service,
        price_cents: rate.price_cents,
        currency: "USD",
        tracking_number: data.tracking_number,
        label_url: labelUrl,
        label_id: data.label_id,
        rate_id: rate.rate_id,
        created_at: new Date().toISOString(),
        raw: data,
      };
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
