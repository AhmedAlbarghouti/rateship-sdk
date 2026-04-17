import { Buffer } from "node:buffer";
import { RateShipError } from "../errors";
import type {
  Address,
  Label,
  NormalizedRate,
  Parcel,
  ProviderAdapter,
  RateRequest,
} from "../types";

const DEFAULT_BASE_URL = "https://api.easypost.com/v2";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface EasyPostOptions {
  apiKey: string;
  /** Override the EasyPost API base URL. Defaults to `https://api.easypost.com/v2`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
}

// -- EasyPost API response types (minimal) -----------------------------------

interface EasyPostRate {
  id: string;
  rate: string;
  currency: string;
  carrier: string;
  service: string;
  delivery_days?: number | null;
  est_delivery_days?: number | null;
  delivery_date?: string | null;
}

interface EasyPostShipmentResponse {
  id: string;
  rates?: EasyPostRate[];
}

interface EasyPostBuyResponse {
  id: string;
  tracking_code?: string | null;
  postage_label?: { label_url?: string | null } | null;
  status?: string;
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

/** EasyPost expects parcel weight in ounces. Convert from the input unit. */
function parcelToEasyPost(p: Parcel) {
  const weightOz = p.weight_unit === "lb" ? p.weight * 16 : p.weight;
  return {
    length: p.length,
    width: p.width,
    height: p.height,
    weight: weightOz,
  };
}

function normalizeRate(rate: EasyPostRate, shipmentId: string): NormalizedRate {
  return {
    provider: "easypost",
    carrier: rate.carrier,
    service: rate.service,
    price_cents: amountToCents(rate.rate),
    currency: "USD",
    estimated_days: rate.delivery_days ?? rate.est_delivery_days ?? null,
    estimated_delivery: rate.delivery_date ?? null,
    rate_id: rate.id,
    // Inject shipment_id alongside the raw rate so createLabel can rebuild
    // the /shipments/:id/buy URL without re-fetching.
    raw: { ...rate, shipment_id: shipmentId },
  };
}

/** Low-level EasyPost POST with Basic auth, timeout, and unified error mapping. */
async function easypostPost(
  apiKey: string,
  baseUrl: string,
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const basic = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: basic,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new RateShipError(
        "EasyPost authentication failed. Check your API key.",
        "AUTH_FAILED",
        { provider: "easypost" },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RateShipError(
        `EasyPost returned ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
        "PROVIDER_ERROR",
        { provider: "easypost" },
      );
    }

    return await res.json();
  } catch (err) {
    if (err instanceof RateShipError) throw err;
    if (isAbortError(err)) {
      throw new RateShipError("EasyPost request timed out.", "TIMEOUT", {
        provider: "easypost",
        cause: err,
      });
    }
    throw new RateShipError("EasyPost network error.", "NETWORK_ERROR", {
      provider: "easypost",
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

// -- Adapter factory ---------------------------------------------------------

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

  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    name: "easypost",

    async getRates(request: RateRequest): Promise<NormalizedRate[]> {
      const payload = {
        shipment: {
          from_address: mapAddress(request.from),
          to_address: mapAddress(request.to),
          parcel: parcelToEasyPost(request.parcel),
        },
      };

      const data = (await easypostPost(
        apiKey,
        baseUrl,
        "/shipments",
        payload,
        timeoutMs,
      )) as EasyPostShipmentResponse;

      return (data.rates ?? [])
        .filter((r) => r.currency === "USD")
        .map((r) => normalizeRate(r, data.id));
    },

    async createLabel(rate: NormalizedRate): Promise<Label> {
      const raw = rate.raw as { id?: unknown; shipment_id?: unknown };
      const rateId = raw?.id;
      const shipmentId = raw?.shipment_id;

      if (typeof shipmentId !== "string" || !shipmentId) {
        throw new RateShipError(
          "EasyPost createLabel: rate.raw.shipment_id is missing. Pass the NormalizedRate returned by getRates() directly.",
          "VALIDATION_ERROR",
          { provider: "easypost" },
        );
      }
      if (typeof rateId !== "string" || !rateId) {
        throw new RateShipError(
          "EasyPost createLabel: rate.raw.id is missing. Pass the NormalizedRate returned by getRates() directly.",
          "VALIDATION_ERROR",
          { provider: "easypost" },
        );
      }

      const data = (await easypostPost(
        apiKey,
        baseUrl,
        `/shipments/${encodeURIComponent(shipmentId)}/buy`,
        { rate: { id: rateId } },
        timeoutMs,
      )) as EasyPostBuyResponse;

      const trackingNumber = data.tracking_code ?? null;
      const labelUrl = data.postage_label?.label_url ?? null;

      if (!trackingNumber || !labelUrl) {
        throw new RateShipError(
          "EasyPost label purchase succeeded but response is missing tracking_code or postage_label.label_url.",
          "PROVIDER_ERROR",
          { provider: "easypost" },
        );
      }

      return {
        provider: "easypost",
        carrier: rate.carrier,
        service: rate.service,
        price_cents: rate.price_cents,
        currency: "USD",
        tracking_number: trackingNumber,
        label_url: labelUrl,
        label_id: data.id,
        rate_id: rate.rate_id,
        created_at: new Date().toISOString(),
        raw: data,
      };
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
