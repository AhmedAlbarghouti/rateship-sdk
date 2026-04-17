import { afterEach, describe, expect, it, vi } from "vitest";
import { shipengine } from "./shipengine";
import { RateShipError } from "../errors";
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
  provider: "shipengine",
  carrier: "UPS",
  service: "UPS Ground",
  price_cents: 840,
  currency: "USD",
  estimated_days: 3,
  estimated_delivery: null,
  rate_id: "se-rate_abc123",
  raw: {
    rate_id: "se-rate_abc123",
    carrier_code: "ups",
    service_type: "UPS Ground",
    shipping_amount: { currency: "usd", amount: 8.4 },
  },
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function textRes(body: string, status: number): Response {
  return new Response(body, { status });
}

/**
 * Mock a sequence of fetch responses. Each call pops the next mock.
 */
function mockFetchSequence(...responses: Response[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn();
  for (const res of responses) fn.mockResolvedValueOnce(res);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shipengine() factory", () => {
  it("returns an adapter with name 'shipengine'", () => {
    const adapter = shipengine({ apiKey: "TEST_xyz" });
    expect(adapter.name).toBe("shipengine");
  });

  it("throws CONFIGURATION_ERROR when apiKey is missing", () => {
    let thrown: unknown;
    try {
      shipengine({ apiKey: "" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
  });
});

describe("shipengine.getRates", () => {
  it("fetches /v1/carriers first, then POSTs to /v1/rates with API-Key header", async () => {
    const fetchFn = mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }, { carrier_id: "se-2" }] }),
      jsonRes({ rate_response: { rates: [] } }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    await adapter.getRates(sampleRequest);

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [carriersUrl, carriersInit] = fetchFn.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(carriersUrl).toBe("https://api.shipengine.com/v1/carriers");
    expect((carriersInit.headers as Record<string, string>)["API-Key"]).toBe(
      "TEST_xyz",
    );

    const [ratesUrl, ratesInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(ratesUrl).toBe("https://api.shipengine.com/v1/rates");
    expect(ratesInit.method).toBe("POST");
    expect((ratesInit.headers as Record<string, string>)["API-Key"]).toBe(
      "TEST_xyz",
    );
  });

  it("sends ShipEngine's schema: ship_from/ship_to + packages array + carrier_ids", async () => {
    const fetchFn = mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-ups" }, { carrier_id: "se-fx" }] }),
      jsonRes({ rate_response: { rates: [] } }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    await adapter.getRates(sampleRequest);

    const [, ratesInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(ratesInit.body as string);
    expect(body.rate_options.carrier_ids).toEqual(["se-ups", "se-fx"]);
    expect(body.shipment.ship_from.city_locality).toBe("Cupertino");
    expect(body.shipment.ship_from.address_line1).toBe("1 Infinite Loop");
    expect(body.shipment.ship_from.country_code).toBe("US");
    expect(body.shipment.ship_to.city_locality).toBe("Mountain View");
    expect(body.shipment.packages).toHaveLength(1);
    expect(body.shipment.packages[0]).toMatchObject({
      weight: { value: 2, unit: "pound" },
      dimensions: { length: 10, width: 8, height: 6, unit: "inch" },
    });
  });

  it("uses unit 'ounce' when parcel.weight_unit is 'oz'", async () => {
    const fetchFn = mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }] }),
      jsonRes({ rate_response: { rates: [] } }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    await adapter.getRates({
      ...sampleRequest,
      parcel: { ...sampleRequest.parcel, weight: 12, weight_unit: "oz" },
    });

    const [, ratesInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(ratesInit.body as string);
    expect(body.shipment.packages[0].weight).toEqual({
      value: 12,
      unit: "ounce",
    });
  });

  it("throws PROVIDER_ERROR when no carriers are connected", async () => {
    mockFetchSequence(jsonRes({ carriers: [] }));
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
    expect((thrown as RateShipError).message).toMatch(/carrier/i);
  });

  it("normalizes ShipEngine rates, mapping carrier_code to display name", async () => {
    mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }] }),
      jsonRes({
        rate_response: {
          rates: [
            {
              rate_id: "se-rate_a",
              carrier_code: "ups",
              service_type: "UPS Ground",
              shipping_amount: { currency: "usd", amount: 8.4 },
              delivery_days: 3,
              estimated_delivery_date: "2026-05-01",
            },
            {
              rate_id: "se-rate_b",
              carrier_code: "fedex",
              service_type: "FedEx Home Delivery",
              shipping_amount: { currency: "usd", amount: 10.25 },
              delivery_days: 4,
              estimated_delivery_date: null,
            },
          ],
        },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(2);
    expect(rates[0]).toMatchObject({
      provider: "shipengine",
      carrier: "UPS",
      service: "UPS Ground",
      price_cents: 840,
      currency: "USD",
      estimated_days: 3,
      estimated_delivery: "2026-05-01",
      rate_id: "se-rate_a",
    });
    expect(rates[1]).toMatchObject({
      carrier: "FedEx",
      service: "FedEx Home Delivery",
      price_cents: 1025,
    });
  });

  it("filters out non-USD rates by shipping_amount.currency", async () => {
    mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }] }),
      jsonRes({
        rate_response: {
          rates: [
            {
              rate_id: "se-usd",
              carrier_code: "ups",
              service_type: "Ground",
              shipping_amount: { currency: "usd", amount: 8.4 },
            },
            {
              rate_id: "se-cad",
              carrier_code: "ups",
              service_type: "Ground",
              shipping_amount: { currency: "cad", amount: 10.5 },
            },
          ],
        },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(1);
    expect(rates[0].rate_id).toBe("se-usd");
  });

  it("throws AUTH_FAILED on 401 from /rates", async () => {
    mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }] }),
      textRes("unauthorized", 401),
    );
    const adapter = shipengine({ apiKey: "TEST_bad" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
    expect((thrown as RateShipError).provider).toBe("shipengine");
  });

  it("throws AUTH_FAILED on 401 from /carriers (preflight)", async () => {
    mockFetchSequence(textRes("unauthorized", 401));
    const adapter = shipengine({ apiKey: "TEST_bad" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
  });

  it("throws PROVIDER_ERROR on 500 from /rates", async () => {
    mockFetchSequence(
      jsonRes({ carriers: [{ carrier_id: "se-1" }] }),
      textRes("boom", 500),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });
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
    const adapter = shipengine({ apiKey: "TEST_xyz" });
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
    const adapter = shipengine({ apiKey: "TEST_xyz" });
    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("NETWORK_ERROR");
  });
});

describe("shipengine.createLabel", () => {
  it("POSTs to /v1/labels/rates/:rate_id with API-Key + label_format pdf", async () => {
    const fetchFn = mockFetchSequence(
      jsonRes({
        label_id: "se-label_xyz",
        status: "completed",
        tracking_number: "1Z999AA10123456784",
        label_download: { pdf: "https://shipengine.com/labels/x.pdf" },
        shipment_cost: { currency: "usd", amount: 8.4 },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    await adapter.createLabel(sampleRate);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.shipengine.com/v1/labels/rates/se-rate_abc123",
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["API-Key"]).toBe(
      "TEST_xyz",
    );
    const body = JSON.parse(init.body as string);
    expect(body.label_format).toBe("pdf");
    expect(body.label_download_type).toBe("url");
  });

  it("returns a Label with tracking_number, label_url, label_id", async () => {
    mockFetchSequence(
      jsonRes({
        label_id: "se-label_xyz",
        status: "completed",
        tracking_number: "1Z999AA10123456784",
        label_download: { pdf: "https://shipengine.com/labels/x.pdf" },
        shipment_cost: { currency: "usd", amount: 8.4 },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    const label = await adapter.createLabel(sampleRate);

    expect(label).toMatchObject({
      provider: "shipengine",
      carrier: "UPS",
      service: "UPS Ground",
      price_cents: 840,
      currency: "USD",
      tracking_number: "1Z999AA10123456784",
      label_url: "https://shipengine.com/labels/x.pdf",
      label_id: "se-label_xyz",
      rate_id: "se-rate_abc123",
    });
  });

  it("throws PROVIDER_ERROR when status is not 'completed'", async () => {
    mockFetchSequence(
      jsonRes({
        label_id: "se-label_xyz",
        status: "processing",
        tracking_number: null,
        label_download: null,
        shipment_cost: { currency: "usd", amount: 8.4 },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });

    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
    expect((thrown as RateShipError).message).toMatch(/processing/);
  });

  it("throws AUTH_FAILED on 401 during label purchase", async () => {
    mockFetchSequence(textRes("unauthorized", 401));
    const adapter = shipengine({ apiKey: "TEST_bad" });
    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
  });

  it("throws PROVIDER_ERROR when label_download.pdf is missing", async () => {
    mockFetchSequence(
      jsonRes({
        label_id: "se-label_xyz",
        status: "completed",
        tracking_number: "1Z999AA10123456784",
        label_download: null,
        shipment_cost: { currency: "usd", amount: 8.4 },
      }),
    );
    const adapter = shipengine({ apiKey: "TEST_xyz" });
    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
  });
});

describe("shipengine.verifyWebhook", () => {
  it("throws CONFIGURATION_ERROR explaining RSA+JWKS is v2.1+", () => {
    const adapter = shipengine({ apiKey: "TEST_xyz" });
    let thrown: unknown;
    try {
      adapter.verifyWebhook("{}", "any-sig", "any-secret");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
    expect((thrown as RateShipError).provider).toBe("shipengine");
    // Error message should point the user at what to do next.
    const msg = (thrown as RateShipError).message;
    expect(msg).toMatch(/RSA|JWKS|not supported|v2\.1/i);
  });
});
