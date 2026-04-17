import { RateShipError } from "../errors";
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

// -- Shippo API response types (minimal — we only type the fields we use) ----

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

/**
 * Convert a decimal string like "8.40" or "12.345" to integer cents.
 * Uses string slicing (not float math) to avoid binary-FP rounding errors
 * that make `Math.round(12.345 * 100)` return 1234 instead of 1235.
 */
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

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

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

/** Low-level Shippo POST wrapper with timeout + unified error mapping. */
async function shippoPost(
  apiKey: string,
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new RateShipError(
        "Shippo authentication failed. Check your API key.",
        "AUTH_FAILED",
        { provider: "shippo" },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RateShipError(
        `Shippo returned ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
        "PROVIDER_ERROR",
        { provider: "shippo" },
      );
    }

    return await res.json();
  } catch (err) {
    if (err instanceof RateShipError) throw err;
    if (isAbortError(err)) {
      throw new RateShipError(
        "Shippo request timed out.",
        "TIMEOUT",
        { provider: "shippo", cause: err },
      );
    }
    throw new RateShipError(
      "Shippo network error.",
      "NETWORK_ERROR",
      { provider: "shippo", cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "shippo",

    async getRates(request: RateRequest): Promise<NormalizedRate[]> {
      const payload = {
        address_from: mapAddress(request.from),
        address_to: mapAddress(request.to),
        parcels: [mapParcel(request.parcel)],
        async: false,
      };

      const data = (await shippoPost(
        apiKey,
        baseUrl,
        "/shipments/",
        payload,
        timeoutMs,
      )) as ShippoShipmentResponse;

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

      const data = (await shippoPost(
        apiKey,
        baseUrl,
        "/transactions/",
        { rate: rateObjectId, label_file_type: "PDF", async: false },
        timeoutMs,
      )) as ShippoTransactionResponse;

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
