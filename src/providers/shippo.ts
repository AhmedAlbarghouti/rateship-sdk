import { RateShipError, WebhookVerificationError } from "../errors";
import { createProviderFetcher } from "../internal/http";
import {
  hmacSha256Hex,
  rawBodyToString,
  timingSafeHexEqual,
} from "../internal/hmac";
import { amountToCents } from "../internal/money";
import type {
  Address,
  EventLocation,
  Label,
  NormalizedEvent,
  NormalizedRate,
  Parcel,
  ProviderAdapter,
  RateRequest,
  TrackingStatus,
} from "../types";

const DEFAULT_BASE_URL = "https://api.goshippo.com";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Shippo doesn't document a tolerance; 5 minutes matches Stripe/GitHub norms. */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

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

    verifyWebhook(
      rawBody: string | Buffer,
      signature: string,
      secret: string,
    ): NormalizedEvent {
      return verifyShippoWebhook(rawBody, signature, secret);
    },
  };
}

// -- Webhook verification ----------------------------------------------------

/**
 * Parse Shippo's `t=<unix>,v1=<hex>` signature header value.
 * Returns null if either piece is missing (triggers verification failure).
 */
function parseShippoSignatureHeader(
  header: string,
): { timestamp: number; signature: string } | null {
  const parts = header.split(",").map((p) => p.trim());
  let ts: number | null = null;
  let sig: string | null = null;
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1);
    if (key === "t") {
      const n = Number(value);
      if (Number.isInteger(n) && n > 0) ts = n;
    } else if (key === "v1") {
      sig = value;
    }
  }
  if (ts === null || sig === null) return null;
  return { timestamp: ts, signature: sig };
}

function mapShippoStatus(raw: string): TrackingStatus {
  switch (raw) {
    case "PRE_TRANSIT":
      return "pre_transit";
    case "TRANSIT":
      return "in_transit";
    case "DELIVERED":
      // Caller decides whether to emit tracking.delivered instead.
      return "in_transit";
    case "RETURNED":
    case "FAILURE":
      return "failure";
    default:
      return "unknown";
  }
}

interface ShippoTrackingStatus {
  status?: string;
  status_detail?: string;
  status_date?: string;
  location?: EventLocation;
}

interface ShippoTrackingPayload {
  data?: {
    tracking_number?: string;
    carrier?: string;
    tracking_status?: ShippoTrackingStatus;
  };
}

function verifyShippoWebhook(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
): NormalizedEvent {
  if (!secret) {
    throw new WebhookVerificationError(
      "Shippo verifyWebhook: secret is required.",
      { provider: "shippo" },
    );
  }

  const parsed = parseShippoSignatureHeader(signatureHeader);
  if (!parsed) {
    throw new WebhookVerificationError(
      "Shippo signature header is malformed. Expected `t=<unix>,v1=<hex>`.",
      { provider: "shippo" },
    );
  }

  const { timestamp, signature } = parsed;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
    throw new WebhookVerificationError(
      "Shippo webhook timestamp is stale. Replay-protection rejected the request.",
      { provider: "shippo" },
    );
  }

  const bodyStr = rawBodyToString(rawBody);
  const expected = hmacSha256Hex(secret, `${timestamp}.${bodyStr}`);

  if (!timingSafeHexEqual(signature, expected)) {
    throw new WebhookVerificationError(
      "Shippo webhook signature did not match.",
      { provider: "shippo" },
    );
  }

  // Signature is valid. Parse and normalize.
  let parsedBody: ShippoTrackingPayload;
  try {
    parsedBody = JSON.parse(bodyStr) as ShippoTrackingPayload;
  } catch (err) {
    throw new WebhookVerificationError(
      "Shippo webhook body is not valid JSON.",
      { provider: "shippo", cause: err },
    );
  }

  const data = parsedBody.data ?? {};
  const ts = data.tracking_status ?? {};
  const rawStatus = ts.status ?? "";
  const trackingNumber = data.tracking_number ?? "";
  const carrier = (data.carrier ?? "").toUpperCase();
  const location = ts.location;
  const occurredAt = ts.status_date ?? new Date().toISOString();

  if (!trackingNumber) {
    throw new WebhookVerificationError(
      "Shippo webhook body is missing data.tracking_number.",
      { provider: "shippo" },
    );
  }

  if (rawStatus === "DELIVERED") {
    return {
      type: "tracking.delivered",
      provider: "shippo",
      tracking_number: trackingNumber,
      carrier,
      delivered_at: occurredAt,
      location,
      raw: parsedBody,
    };
  }

  return {
    type: "tracking.updated",
    provider: "shippo",
    tracking_number: trackingNumber,
    carrier,
    status: mapShippoStatus(rawStatus),
    status_detail: ts.status_detail,
    location,
    occurred_at: occurredAt,
    raw: parsedBody,
  };
}
