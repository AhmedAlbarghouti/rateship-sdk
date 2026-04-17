import { Buffer } from "node:buffer";
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
    // Inject shipment_id so createLabel can reconstruct /shipments/:id/buy
    // without a second rate fetch. User must pass the full rate back in.
    raw: { ...rate, shipment_id: shipmentId },
  };
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
  const request = createProviderFetcher({
    provider: "easypost",
    defaultTimeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  });
  const basic = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const authHeaders = { Authorization: basic };

  return {
    name: "easypost",

    async getRates(req: RateRequest): Promise<NormalizedRate[]> {
      const data = (await request({
        url: `${baseUrl}/shipments`,
        method: "POST",
        headers: authHeaders,
        body: {
          shipment: {
            from_address: mapAddress(req.from),
            to_address: mapAddress(req.to),
            parcel: parcelToEasyPost(req.parcel),
          },
        },
      })) as EasyPostShipmentResponse;

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

      const data = (await request({
        url: `${baseUrl}/shipments/${encodeURIComponent(shipmentId)}/buy`,
        method: "POST",
        headers: authHeaders,
        body: { rate: { id: rateId } },
      })) as EasyPostBuyResponse;

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

    verifyWebhook(
      rawBody: string | Buffer,
      signature: string,
      secret: string,
    ): NormalizedEvent {
      return verifyEasyPostWebhook(rawBody, signature, secret);
    },
  };
}

// -- Webhook verification ----------------------------------------------------

const EASYPOST_SIGNATURE_PREFIX = "hmac-sha256-hex=";

function mapEasyPostStatus(raw: string): TrackingStatus {
  switch (raw) {
    case "pre_transit":
      return "pre_transit";
    case "in_transit":
      return "in_transit";
    case "out_for_delivery":
      return "out_for_delivery";
    case "delivered":
      // Caller switches to tracking.delivered event for this status.
      return "in_transit";
    case "return_to_sender":
    case "failure":
    case "error":
      return "failure";
    default:
      return "unknown";
  }
}

interface EasyPostTrackingDetail {
  status?: string;
  message?: string;
  datetime?: string;
  tracking_location?: EventLocation;
}

interface EasyPostTrackerPayload {
  description?: string;
  result?: {
    tracking_code?: string;
    carrier?: string;
    status?: string;
    tracking_details?: EasyPostTrackingDetail[];
    est_delivery_date?: string | null;
  };
}

function verifyEasyPostWebhook(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
): NormalizedEvent {
  if (!secret) {
    throw new WebhookVerificationError(
      "EasyPost verifyWebhook: secret is required.",
      { provider: "easypost" },
    );
  }
  if (!signatureHeader) {
    throw new WebhookVerificationError(
      "EasyPost signature header is empty.",
      { provider: "easypost" },
    );
  }

  // EasyPost's docs + official client libs use the prefixed form
  // `hmac-sha256-hex=<hex>` but also accept the bare hex in the wild.
  const trimmedSig = signatureHeader.startsWith(EASYPOST_SIGNATURE_PREFIX)
    ? signatureHeader.slice(EASYPOST_SIGNATURE_PREFIX.length)
    : signatureHeader;

  const bodyStr = rawBodyToString(rawBody);
  // EasyPost client libs normalize the secret with NFKD. Match them so
  // secrets containing composed unicode (e.g. "café") verify the same
  // way they do in Python / Go / Ruby.
  const normalizedSecret = secret.normalize("NFKD");
  const expected = hmacSha256Hex(normalizedSecret, bodyStr);

  if (!timingSafeHexEqual(trimmedSig, expected)) {
    throw new WebhookVerificationError(
      "EasyPost webhook signature did not match.",
      { provider: "easypost" },
    );
  }

  let parsed: EasyPostTrackerPayload;
  try {
    parsed = JSON.parse(bodyStr) as EasyPostTrackerPayload;
  } catch (err) {
    throw new WebhookVerificationError(
      "EasyPost webhook body is not valid JSON.",
      { provider: "easypost", cause: err },
    );
  }

  const result = parsed.result ?? {};
  const rawStatus = result.status ?? "";
  const trackingNumber = result.tracking_code ?? "";
  const carrier = (result.carrier ?? "").toUpperCase();
  const details = result.tracking_details ?? [];
  const last = details[details.length - 1];
  const occurredAt = last?.datetime ?? new Date().toISOString();
  const statusDetail = last?.message;
  const location = last?.tracking_location;

  if (!trackingNumber) {
    throw new WebhookVerificationError(
      "EasyPost webhook body is missing result.tracking_code.",
      { provider: "easypost" },
    );
  }

  if (rawStatus === "delivered") {
    return {
      type: "tracking.delivered",
      provider: "easypost",
      tracking_number: trackingNumber,
      carrier,
      delivered_at: occurredAt,
      location,
      raw: parsed,
    };
  }

  return {
    type: "tracking.updated",
    provider: "easypost",
    tracking_number: trackingNumber,
    carrier,
    status: mapEasyPostStatus(rawStatus),
    status_detail: statusDetail,
    location,
    estimated_delivery: result.est_delivery_date ?? undefined,
    occurred_at: occurredAt,
    raw: parsed,
  };
}
