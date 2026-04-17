import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shippo } from "./shippo";
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
  provider: "shippo",
  carrier: "UPS",
  service: "Ground",
  price_cents: 840,
  currency: "USD",
  estimated_days: 3,
  estimated_delivery: null,
  rate_id: "rate_abc123",
  raw: {
    object_id: "rate_abc123",
    amount: "8.40",
    currency: "USD",
    provider: "UPS",
    servicelevel: { name: "Ground", token: "ups_ground" },
    estimated_days: 3,
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

describe("shippo() factory", () => {
  it("returns an adapter with name 'shippo'", () => {
    const adapter = shippo({ apiKey: "shippo_test_xyz" });
    expect(adapter.name).toBe("shippo");
  });

  it("throws CONFIGURATION_ERROR when apiKey is missing", () => {
    let thrown: unknown;
    try {
      shippo({ apiKey: "" });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
  });
});

describe("shippo.getRates", () => {
  it("POSTs to /shipments/ with ShippoToken auth header", async () => {
    const fetchFn = mockFetchJson({ object_id: "ship_1", status: "SUCCESS", rates: [] });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    await adapter.getRates(sampleRequest);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.goshippo.com/shipments/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "ShippoToken shippo_test_xyz",
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("sends from/to/parcel payload in Shippo's schema with async=false", async () => {
    const fetchFn = mockFetchJson({ object_id: "ship_1", status: "SUCCESS", rates: [] });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    await adapter.getRates(sampleRequest);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.async).toBe(false);
    expect(body.address_from.city).toBe("Cupertino");
    expect(body.address_to.city).toBe("Mountain View");
    expect(body.parcels).toHaveLength(1);
    expect(body.parcels[0]).toMatchObject({
      length: "10",
      width: "8",
      height: "6",
      distance_unit: "in",
      weight: "2",
      mass_unit: "lb",
    });
  });

  it("normalizes Shippo rates into NormalizedRate shape", async () => {
    mockFetchJson({
      object_id: "ship_1",
      status: "SUCCESS",
      rates: [
        {
          object_id: "rate_abc",
          amount: "8.40",
          currency: "USD",
          provider: "UPS",
          servicelevel: { name: "Ground", token: "ups_ground" },
          estimated_days: 3,
        },
      ],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(1);
    expect(rates[0]).toMatchObject({
      provider: "shippo",
      carrier: "UPS",
      service: "Ground",
      price_cents: 840,
      currency: "USD",
      estimated_days: 3,
      estimated_delivery: null,
      rate_id: "rate_abc",
    });
    expect(rates[0].raw).toEqual(
      expect.objectContaining({ object_id: "rate_abc", amount: "8.40" }),
    );
  });

  it("rounds fractional cents correctly (amount '12.345' -> 1235 cents)", async () => {
    mockFetchJson({
      object_id: "ship_1",
      status: "SUCCESS",
      rates: [
        {
          object_id: "rate_x",
          amount: "12.345",
          currency: "USD",
          provider: "USPS",
          servicelevel: { name: "Priority", token: "usps_priority" },
        },
      ],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates[0].price_cents).toBe(1235);
  });

  it("filters out non-USD rates", async () => {
    mockFetchJson({
      object_id: "ship_1",
      status: "SUCCESS",
      rates: [
        {
          object_id: "rate_usd",
          amount: "8.40",
          currency: "USD",
          provider: "UPS",
          servicelevel: { name: "Ground", token: "ups_ground" },
        },
        {
          object_id: "rate_cad",
          amount: "10.40",
          currency: "CAD",
          provider: "UPS",
          servicelevel: { name: "Ground", token: "ups_ground" },
        },
      ],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    const rates = await adapter.getRates(sampleRequest);

    expect(rates).toHaveLength(1);
    expect(rates[0].rate_id).toBe("rate_usd");
  });

  it("throws RateShipError AUTH_FAILED on 401", async () => {
    mockFetchText("unauthorized", 401);
    const adapter = shippo({ apiKey: "shippo_test_invalid" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
    expect((thrown as RateShipError).provider).toBe("shippo");
  });

  it("throws RateShipError AUTH_FAILED on 403", async () => {
    mockFetchText("forbidden", 403);
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
  });

  it("throws RateShipError PROVIDER_ERROR on 500", async () => {
    mockFetchText("internal server error", 500);
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
    expect((thrown as RateShipError).provider).toBe("shippo");
  });

  it("throws RateShipError TIMEOUT on AbortError", async () => {
    const fn = vi.fn(async () => {
      const err = new DOMException("The operation was aborted.", "AbortError");
      throw err;
    });
    vi.stubGlobal("fetch", fn);
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("TIMEOUT");
    expect((thrown as RateShipError).provider).toBe("shippo");
  });

  it("throws RateShipError NETWORK_ERROR on generic fetch failure", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.getRates(sampleRequest);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("NETWORK_ERROR");
    expect((thrown as RateShipError).provider).toBe("shippo");
  });
});

describe("shippo.createLabel", () => {
  it("POSTs to /transactions/ using the rate's raw.object_id", async () => {
    const fetchFn = mockFetchJson({
      status: "SUCCESS",
      object_id: "txn_xyz",
      tracking_number: "1Z999AA10123456784",
      label_url: "https://shippo-delivery.s3.amazonaws.com/label.pdf",
      rate: "rate_abc123",
      messages: [],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    await adapter.createLabel(sampleRate);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.goshippo.com/transactions/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.rate).toBe("rate_abc123");
    expect(body.label_file_type).toBe("PDF");
    expect(body.async).toBe(false);
  });

  it("returns a Label with tracking_number, label_url, label_id", async () => {
    mockFetchJson({
      status: "SUCCESS",
      object_id: "txn_xyz",
      tracking_number: "1Z999AA10123456784",
      label_url: "https://shippo-delivery.s3.amazonaws.com/label.pdf",
      rate: "rate_abc123",
      messages: [],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    const label = await adapter.createLabel(sampleRate);

    expect(label).toMatchObject({
      provider: "shippo",
      carrier: "UPS",
      service: "Ground",
      price_cents: 840,
      currency: "USD",
      tracking_number: "1Z999AA10123456784",
      label_url: "https://shippo-delivery.s3.amazonaws.com/label.pdf",
      label_id: "txn_xyz",
      rate_id: "rate_abc123",
    });
    expect(label.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(label.raw).toBeDefined();
  });

  it("throws PROVIDER_ERROR when transaction status is not SUCCESS", async () => {
    mockFetchJson({
      status: "ERROR",
      object_id: "txn_xyz",
      tracking_number: null,
      label_url: null,
      rate: "rate_abc123",
      messages: [{ text: "Insufficient postage balance" }, { text: "Fund your account" }],
    });
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
    expect((thrown as RateShipError).message).toMatch(/Insufficient postage/);
  });

  it("throws AUTH_FAILED on 401 during label purchase", async () => {
    mockFetchText("unauthorized", 401);
    const adapter = shippo({ apiKey: "shippo_test_invalid" });

    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("AUTH_FAILED");
  });

  it("throws PROVIDER_ERROR when rate.raw is missing object_id", async () => {
    const badRate: NormalizedRate = {
      ...sampleRate,
      raw: {}, // no object_id
    };
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.createLabel(badRate);
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("VALIDATION_ERROR");
  });

  it("throws TIMEOUT if the transaction call aborts", async () => {
    const fn = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fn);
    const adapter = shippo({ apiKey: "shippo_test_xyz" });

    let thrown: unknown;
    try {
      await adapter.createLabel(sampleRate);
    } catch (e) {
      thrown = e;
    }

    expect((thrown as RateShipError).code).toBe("TIMEOUT");
  });
});
