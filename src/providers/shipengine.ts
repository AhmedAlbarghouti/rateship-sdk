import { RateShipError } from "../errors";
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

function amountToCents(amount: string): number {
  const normalized = amount.trim();
  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const padded = (fracPart + "000").slice(0, 3);
  const wholeCents =
    parseInt(intPart, 10) * 100 + parseInt(padded.slice(0, 2), 10);
  const halfDigit = parseInt(padded.slice(2, 3), 10);
  return sign * (halfDigit >= 5 ? wholeCents + 1 : wholeCents);
}

function floatToCents(amount: number): number {
  // Convert via fixed-precision string to avoid binary FP quirks.
  return amountToCents(amount.toFixed(3));
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

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

/** Low-level ShipEngine request with API-Key auth, timeout, unified errors. */
async function shipEngineRequest(
  apiKey: string,
  baseUrl: string,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        "API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new RateShipError(
        "ShipEngine authentication failed. Check your API key.",
        "AUTH_FAILED",
        { provider: "shipengine" },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RateShipError(
        `ShipEngine returned ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
        "PROVIDER_ERROR",
        { provider: "shipengine" },
      );
    }

    return await res.json();
  } catch (err) {
    if (err instanceof RateShipError) throw err;
    if (isAbortError(err)) {
      throw new RateShipError("ShipEngine request timed out.", "TIMEOUT", {
        provider: "shipengine",
        cause: err,
      });
    }
    throw new RateShipError("ShipEngine network error.", "NETWORK_ERROR", {
      provider: "shipengine",
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "shipengine",

    async getRates(request: RateRequest): Promise<NormalizedRate[]> {
      // ShipEngine requires explicit carrier_ids on /rates.
      const carriersData = (await shipEngineRequest(
        apiKey,
        baseUrl,
        "/carriers",
        { method: "GET" },
        timeoutMs,
      )) as ShipEngineCarriersResponse;

      const carrierIds = (carriersData.carriers ?? []).map(
        (c) => c.carrier_id,
      );

      if (carrierIds.length === 0) {
        throw new RateShipError(
          "No carriers connected in ShipEngine. Add a carrier in your ShipEngine dashboard first.",
          "PROVIDER_ERROR",
          { provider: "shipengine" },
        );
      }

      const payload = {
        rate_options: { carrier_ids: carrierIds },
        shipment: {
          ship_from: mapAddress(request.from),
          ship_to: mapAddress(request.to),
          packages: [mapPackage(request.parcel)],
        },
      };

      const data = (await shipEngineRequest(
        apiKey,
        baseUrl,
        "/rates",
        { method: "POST", body: payload },
        timeoutMs,
      )) as ShipEngineRatesResponse;

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

      const data = (await shipEngineRequest(
        apiKey,
        baseUrl,
        `/labels/rates/${encodeURIComponent(rate.rate_id)}`,
        {
          method: "POST",
          body: {
            validate_address: "no_validation",
            label_format: "pdf",
            label_download_type: "url",
          },
        },
        timeoutMs,
      )) as ShipEngineLabelResponse;

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
