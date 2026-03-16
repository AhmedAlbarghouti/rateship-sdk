import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateShip } from "./client";
import { RateShipError } from "./errors";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockResponse(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    status,
    json: async () => body,
  });
}

describe("RateShip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws if apiKey is missing", () => {
    expect(() => new RateShip({ apiKey: "" })).toThrow("apiKey is required");
  });

  it("uses default base URL", () => {
    const client = new RateShip({ apiKey: "rs_dev_test" });
    expect(client).toBeDefined();
  });

  it("accepts custom base URL", () => {
    const client = new RateShip({
      apiKey: "rs_dev_test",
      baseUrl: "http://localhost:3000",
    });
    expect(client).toBeDefined();
  });
});

describe("rates.get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const client = new RateShip({
    apiKey: "rs_dev_test",
    baseUrl: "http://localhost:3000",
  });

  it("sends correct request", async () => {
    mockResponse({
      success: true,
      data: { rates: [], errors: [] },
    });

    await client.rates.get({
      from_address: {
        name: "John Smith",
        street1: "123 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
        phone: "2125551234",
      },
      to_address: {
        name: "Jane Doe",
        street1: "456 Oak Ave",
        city: "Los Angeles",
        state: "CA",
        zip: "90001",
        phone: "3105551234",
      },
      weight: 2.5,
      weight_unit: "lbs",
      length: 10,
      width: 8,
      height: 4,
      package_count: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/rates",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer rs_dev_test",
        }),
      }),
    );
  });

  it("returns rates data", async () => {
    const mockRates = {
      rates: [
        {
          provider: "shippo",
          carrier: "USPS",
          service: "Ground",
          price_cents: 800,
          currency: "USD",
          estimated_days: 5,
          estimated_delivery: null,
          rate_id: "rate_123",
          raw: {},
        },
      ],
      errors: [],
    };

    mockResponse({ success: true, data: mockRates });

    const result = await client.rates.get({
      from_address: {
        name: "John Smith",
        street1: "123 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
        phone: "2125551234",
      },
      to_address: {
        name: "Jane Doe",
        street1: "456 Oak Ave",
        city: "Los Angeles",
        state: "CA",
        zip: "90001",
        phone: "3105551234",
      },
      weight: 1,
      weight_unit: "lbs",
      length: 5,
      width: 5,
      height: 5,
      package_count: 1,
    });

    expect(result.rates).toHaveLength(1);
    expect(result.rates[0].carrier).toBe("USPS");
    expect(result.errors).toHaveLength(0);
  });

  it("throws RateShipError on API error", async () => {
    mockResponse(
      {
        success: false,
        error: { message: "Invalid API key", code: "AUTH_FAILED" },
      },
      401,
    );

    await expect(
      client.rates.get({
        from_address: {
          name: "John Smith",
          street1: "123 Main St",
          city: "New York",
          state: "NY",
          zip: "10001",
          phone: "2125551234",
        },
        to_address: {
          name: "Jane Doe",
          street1: "456 Oak Ave",
          city: "Los Angeles",
          state: "CA",
          zip: "90001",
          phone: "3105551234",
        },
        weight: 1,
        weight_unit: "lbs",
        length: 5,
        width: 5,
        height: 5,
        package_count: 1,
      }),
    ).rejects.toThrow(RateShipError);
  });

  it("RateShipError has code and status", async () => {
    mockResponse(
      {
        success: false,
        error: { message: "Unauthorized", code: "AUTH_FAILED" },
      },
      401,
    );

    try {
      await client.rates.get({
        from_address: {
          name: "John Smith",
          street1: "123 Main St",
          city: "New York",
          state: "NY",
          zip: "10001",
          phone: "2125551234",
        },
        to_address: {
          name: "Jane Doe",
          street1: "456 Oak Ave",
          city: "Los Angeles",
          state: "CA",
          zip: "90001",
          phone: "3105551234",
        },
        weight: 1,
        weight_unit: "lbs",
        length: 5,
        width: 5,
        height: 5,
        package_count: 1,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(RateShipError);
      const err = e as RateShipError;
      expect(err.code).toBe("AUTH_FAILED");
      expect(err.status).toBe(401);
      expect(err.message).toBe("Unauthorized");
    }
  });
});

describe("labels.purchase", () => {
  const client = new RateShip({
    apiKey: "rs_dev_test",
    baseUrl: "http://localhost:3000",
  });

  it("sends purchase request", async () => {
    mockResponse({
      success: true,
      data: {
        provider: "shippo",
        carrier: "USPS",
        service: "Ground",
        price_cents: 800,
        tracking_number: "1234",
        label_url: "https://example.com/label.pdf",
        rate_id: "rate_123",
      },
    });

    const result = await client.labels.purchase({
      provider: "shippo",
      rate_id: "rate_123",
      carrier: "USPS",
      service: "Ground",
      price_cents: 800,
      from_address: {
        name: "Test",
        street1: "123 Main",
        city: "SF",
        state: "CA",
        zip: "94107",
        phone: "4155551234",
      },
      to_address: {
        name: "Test",
        street1: "456 Oak",
        city: "LA",
        state: "CA",
        zip: "90001",
        phone: "3105551234",
      },
      weight: 1,
      weight_unit: "lbs",
      length: 5,
      width: 5,
      height: 5,
      package_count: 1,
    });

    expect(result.tracking_number).toBe("1234");
    expect(result.label_url).toBe("https://example.com/label.pdf");
  });
});

describe("labels.list", () => {
  const client = new RateShip({
    apiKey: "rs_dev_test",
    baseUrl: "http://localhost:3000",
  });

  it("sends list request with no params", async () => {
    mockResponse({
      success: true,
      data: { items: [], page: 1, page_size: 10, total: 0, total_pages: 1 },
    });

    await client.labels.list();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/labels",
      expect.anything(),
    );
  });

  it("sends list request with params", async () => {
    mockResponse({
      success: true,
      data: { items: [], page: 2, page_size: 5, total: 0, total_pages: 1 },
    });

    await client.labels.list({ page: 2, page_size: 5, provider: "shippo" });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("page=2"),
      expect.anything(),
    );
  });
});

describe("webhooks", () => {
  const client = new RateShip({
    apiKey: "rs_dev_test",
    baseUrl: "http://localhost:3000",
  });

  it("creates a webhook", async () => {
    mockResponse({
      success: true,
      data: {
        id: "wh_123",
        url: "https://example.com/hook",
        events: ["label.purchased"],
        is_active: true,
        created_at: "2026-03-15",
        secret: "secret_abc",
      },
    });

    const result = await client.webhooks.create({
      url: "https://example.com/hook",
      events: ["label.purchased"],
    });

    expect(result.secret).toBe("secret_abc");
  });

  it("lists webhooks", async () => {
    mockResponse({
      success: true,
      data: { endpoints: [] },
    });

    const result = await client.webhooks.list();
    expect(result.endpoints).toHaveLength(0);
  });

  it("deletes a webhook", async () => {
    mockResponse({
      success: true,
      data: { deleted: true },
    });

    const result = await client.webhooks.delete("wh_123");
    expect(result.deleted).toBe(true);
  });
});
