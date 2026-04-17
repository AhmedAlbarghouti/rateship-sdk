import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { easypost } from "./easypost";
import { RateShipError, WebhookVerificationError } from "../errors";
import type { NormalizedRate, RateRequest } from "../types";

const sampleRequest: RateRequest = {
  from: {
    name: "Alice",
    street1: "1 Infinite Loop",
    city: "Cupertino",
    state: "CA",
    zip: "95014",
    country: "US",
  },
  to: {
    name: "Bob",
    street1: "1600 Amphitheatre Parkway",
    city: "Mountain View",
    state: "CA",
    zip: "94043",
    country: "US",
  },
  parcel: {
    weight: 2,
    weight_unit: "lb",
    length: 10,
    width: 8,
    height: 6,
    distance_unit: "in",
  },
};

const sampleRate: NormalizedRate = {
  provider: "easypost",
  carrier: "UPS",
  service: "Ground",
  price_cents: 840,
  currency: "USD",
  estimated_days: 3,
  estimated_delivery: null,
  rate_id: "rate_abc123",
  raw: {
    id: "rate_abc123",
    shipment_id: "shp_xyz789",
    rate: "8.40",
    carrier: "UPS",
    service: "Ground",
  },
};

function mockFetchJson(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchText(body: string, status: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("easypost() factory", () => {
  it("returns an adapter with name 'easypost'", () => {
    const adapter = easypost({ apiKey: "EZAK_test" });
    expect(adapter.name).toBe("easypost");
  });

  it("throws CONFIGURATION_ERROR when apiKey is missing", () => {
    let thrown: unknown;
    try {
      easypost({ apiKey: "" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
  });
});

describe("easypost.getRates", () => {
  it("POSTs to /v2/shipments with HTTP Basic auth (apiKey:)", async () => {
    const fetchFn = mockFetchJson({ id: "shp_x", rates: [] });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    await adapter.getRates(sampleRequest);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.easypost.com/v2/shipments");
    expect(init.method).toBe("POST");
    const expectedBasic = `Basic ${Buffer.from("EZAK_test_xyz:").toString("base64")}`;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      expectedBasic,
    );
  });

  it("sends EasyPost's nested 'shipment' payload with parcel in ounces", async () => {
    const fetchFn = mockFetchJson({ id: "shp_x", rates: [] });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    await adapter.getRates(sampleRequest);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.shipment).toBeDefined();
    expect(body.shipment.from_address.city).toBe("Cupertino");
    expect(body.shipment.to_address.city).toBe("Mountain View");
    // parcel is a single object, not array; weight in oz (2 lb = 32 oz)
    expect(body.shipment.parcel).toMatchObject({
      length: 10,
      width: 8,
      height: 6,
      weight: 32,
    });
  });

  it("passes ounce weight through without conversion when weight_unit is 'oz'", async () => {
    const fetchFn = mockFetchJson({ id: "shp_x", rates: [] });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    await adapter.getRates({
      ...sampleRequest,
      parcel: { ...sampleRequest.parcel, weight: 12, weight_unit: "oz" },
    });

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.shipment.parcel.weight).toBe(12);
  });

  it("normalizes EasyPost rates into NormalizedRate shape", async () => {
    mockFetchJson({
      id: "shp_x",
      rates: [
        {
          id: "rate_xyz",
          rate: "8.40",
          currency: "USD",
          carrier: "UPS",
          service: "Ground",
          delivery_days: 3,
          delivery_date: "2026-05-01",
        },
      ],
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      provider: "easypost",
      carrier: "UPS",
      service: "Ground",
      price_cents: 840,
      currency: "USD",
      estimated_days: 3,
      estimated_delivery: "2026-05-01",
      rate_id: "rate_xyz",
    });
  });

  it("includes the parent shipment_id on each rate's raw (for createLabel)", async () => {
    mockFetchJson({
      id: "shp_parent_id",
      rates: [
        {
          id: "rate_xyz",
          rate: "8.40",
          currency: "USD",
          carrier: "UPS",
          service: "Ground",
          delivery_days: 3,
          delivery_date: null,
        },
      ],
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect((rates[0].raw as Record<string, unknown>).shipment_id).toBe(
      "shp_parent_id",
    );
    expect((rates[0].raw as Record<string, unknown>).id).toBe("rate_xyz");
  });

  it("falls back to est_delivery_days when delivery_days is null", async () => {
    mockFetchJson({
      id: "shp_x",
      rates: [
        {
          id: "rate_xyz",
          rate: "8.40",
          currency: "USD",
          carrier: "USPS",
          service: "Priority",
          delivery_days: null,
          est_delivery_days: 2,
          delivery_date: null,
        },
      ],
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates[0].estimated_days).toBe(2);
  });

  it("filters out non-USD rates", async () => {
    mockFetchJson({
      id: "shp_x",
      rates: [
        { id: "rate_usd", rate: "8.40", currency: "USD", carrier: "UPS", service: "Ground" },
        { id: "rate_cad", rate: "10.40", currency: "CAD", carrier: "UPS", service: "Ground" },
      ],
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(1);
    expect(rates[0].rate_id).toBe("rate_usd");
  });

  it("throws AUTH_FAILED on 401", async () => {
    mockFetchText("unauthorized", 401);
    const adapter = easypost({ apiKey: "EZAK_bad" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
    expect((thrown as RateShipError).provider).toBe("easypost");
  });

  it("throws PROVIDER_ERROR on 500", async () => {
    mockFetchText("boom", 500);
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
  });

  it("throws TIMEOUT on AbortError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("aborted", "AbortError");
      }),
    );
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("TIMEOUT");
  });

  it("throws NETWORK_ERROR on generic fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("NETWORK_ERROR");
  });
});

describe("easypost.createLabel", () => {
  it("POSTs to /v2/shipments/:shipment_id/buy with { rate: { id } }", async () => {
    const fetchFn = mockFetchJson({
      id: "shp_xyz789",
      tracking_code: "1Z999AA10123456784",
      postage_label: {
        label_url: "https://easypost-files.s3.amazonaws.com/label.pdf",
      },
      status: "unknown",
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    await adapter.createLabel(sampleRate);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.easypost.com/v2/shipments/shp_xyz789/buy");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ rate: { id: "rate_abc123" } });
  });

  it("returns a Label with tracking_number, label_url, label_id", async () => {
    mockFetchJson({
      id: "shp_xyz789",
      tracking_code: "1Z999AA10123456784",
      postage_label: {
        label_url: "https://easypost-files.s3.amazonaws.com/label.pdf",
      },
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const label = await adapter.createLabel(sampleRate);

    expect(label).toMatchObject({
      provider: "easypost",
      carrier: "UPS",
      service: "Ground",
      price_cents: 840,
      currency: "USD",
      tracking_number: "1Z999AA10123456784",
      label_url: "https://easypost-files.s3.amazonaws.com/label.pdf",
      label_id: "shp_xyz789",
      rate_id: "rate_abc123",
    });
    expect(label.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("throws VALIDATION_ERROR when rate.raw.shipment_id is missing", async () => {
    const badRate: NormalizedRate = {
      ...sampleRate,
      raw: { id: "rate_abc123" }, // no shipment_id
    };
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.createLabel(badRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("VALIDATION_ERROR");
  });

  it("throws VALIDATION_ERROR when rate.raw.id is missing", async () => {
    const badRate: NormalizedRate = {
      ...sampleRate,
      raw: { shipment_id: "shp_xyz789" }, // no id
    };
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.createLabel(badRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("VALIDATION_ERROR");
  });

  it("throws AUTH_FAILED on 401 during label purchase", async () => {
    mockFetchText("unauthorized", 401);
    const adapter = easypost({ apiKey: "EZAK_bad" });
    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
  });

  it("throws PROVIDER_ERROR if response has no label_url", async () => {
    mockFetchJson({
      id: "shp_xyz789",
      tracking_code: "1Z999AA10123456784",
      postage_label: null,
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
  });
});

describe("easypost.verifyWebhook", () => {
  const SECRET = "EZ_wh_secret_123";

  function signEasyPostHeader(body: string, secret: string = SECRET): string {
    const normalized = secret.normalize("NFKD");
    const sig = createHmac("sha256", normalized).update(body).digest("hex");
    return `hmac-sha256-hex=${sig}`;
  }

  const transitBody = JSON.stringify({
    description: "tracker.updated",
    result: {
      tracking_code: "1Z999AA10123456784",
      carrier: "UPS",
      status: "in_transit",
      tracking_details: [
        { status: "in_transit", message: "On vehicle for delivery" },
      ],
      est_delivery_date: "2026-04-18",
    },
  });

  const deliveredBody = JSON.stringify({
    description: "tracker.updated",
    result: {
      tracking_code: "1Z999AA10123456784",
      carrier: "UPS",
      status: "delivered",
      tracking_details: [
        {
          status: "delivered",
          message: "Delivered",
          datetime: "2026-04-17T15:30:00Z",
          tracking_location: {
            city: "Mountain View",
            state: "CA",
            zip: "94043",
            country: "US",
          },
        },
      ],
    },
  });

  it("returns a normalized tracking.updated event on 'in_transit' status", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const event = adapter.verifyWebhook(
      transitBody,
      signEasyPostHeader(transitBody),
      SECRET,
    );

    expect(event.type).toBe("tracking.updated");
    if (event.type === "tracking.updated") {
      expect(event.provider).toBe("easypost");
      expect(event.tracking_number).toBe("1Z999AA10123456784");
      expect(event.carrier).toBe("UPS");
      expect(event.status).toBe("in_transit");
      expect(event.estimated_delivery).toBe("2026-04-18");
    }
  });

  it("returns a normalized tracking.delivered event on 'delivered' status", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });

    const event = adapter.verifyWebhook(
      deliveredBody,
      signEasyPostHeader(deliveredBody),
      SECRET,
    );

    expect(event.type).toBe("tracking.delivered");
    if (event.type === "tracking.delivered") {
      expect(event.tracking_number).toBe("1Z999AA10123456784");
      expect(event.delivered_at).toBe("2026-04-17T15:30:00Z");
      expect(event.location).toMatchObject({ city: "Mountain View" });
    }
  });

  it("accepts header value without the 'hmac-sha256-hex=' prefix (bare hex)", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    const prefixed = signEasyPostHeader(transitBody);
    const bare = prefixed.replace(/^hmac-sha256-hex=/, "");

    const event = adapter.verifyWebhook(transitBody, bare, SECRET);
    expect(event.type).toBe("tracking.updated");
  });

  it("accepts Buffer rawBody", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    const event = adapter.verifyWebhook(
      Buffer.from(transitBody, "utf8"),
      signEasyPostHeader(transitBody),
      SECRET,
    );
    expect(event.type).toBe("tracking.updated");
  });

  it("applies NFKD normalization to the secret (matches EasyPost client libs)", () => {
    // A secret with a composed unicode char; NFKD-normalized equivalent is
    // used to sign. Verify MUST match when user passes the composed form.
    const composedSecret = "caf\u00e9"; // "café" with composed é
    const decomposedSecret = composedSecret.normalize("NFKD"); // "cafe\u0301"

    const sig = createHmac("sha256", decomposedSecret)
      .update(transitBody)
      .digest("hex");
    const header = `hmac-sha256-hex=${sig}`;

    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    const event = adapter.verifyWebhook(transitBody, header, composedSecret);
    expect(event.type).toBe("tracking.updated");
  });

  it("throws WebhookVerificationError on tampered body", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      adapter.verifyWebhook(
        transitBody + "tampered",
        signEasyPostHeader(transitBody),
        SECRET,
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WebhookVerificationError);
    expect((thrown as WebhookVerificationError).code).toBe(
      "WEBHOOK_VERIFICATION_FAILED",
    );
  });

  it("throws WebhookVerificationError on wrong secret", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      adapter.verifyWebhook(
        transitBody,
        signEasyPostHeader(transitBody),
        "wrong_secret",
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WebhookVerificationError);
  });

  it("throws WebhookVerificationError on empty signature", () => {
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    let thrown: unknown;
    try {
      adapter.verifyWebhook(transitBody, "", SECRET);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(WebhookVerificationError);
  });

  it("maps 'return_to_sender' to status=failure on tracking.updated", () => {
    const body = JSON.stringify({
      description: "tracker.updated",
      result: {
        tracking_code: "1Z",
        carrier: "UPS",
        status: "return_to_sender",
        tracking_details: [{ status: "return_to_sender", message: "Returning" }],
      },
    });
    const adapter = easypost({ apiKey: "EZAK_test_xyz" });
    const event = adapter.verifyWebhook(
      body,
      signEasyPostHeader(body),
      SECRET,
    );
    expect(event.type).toBe("tracking.updated");
    if (event.type === "tracking.updated") {
      expect(event.status).toBe("failure");
    }
  });
});
