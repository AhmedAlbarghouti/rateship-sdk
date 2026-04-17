import { describe, expect, it, vi } from "vitest";
import { RateShip } from "./client";
import { RateShipError } from "./errors";
import type {
  Label,
  NormalizedEvent,
  NormalizedRate,
  Provider,
  ProviderAdapter,
  RateRequest,
} from "./types";

function makeAdapter(
  name: Provider,
  overrides: Partial<ProviderAdapter> = {},
): ProviderAdapter {
  return {
    name,
    getRates: vi.fn(async (_req: RateRequest): Promise<NormalizedRate[]> => []),
    createLabel: vi.fn(
      async (_rate: NormalizedRate): Promise<Label> =>
        ({}) as unknown as Label,
    ),
    verifyWebhook: vi.fn(
      (): NormalizedEvent =>
        ({}) as unknown as NormalizedEvent,
    ),
    ...overrides,
  };
}

describe("RateShip construction", () => {
  it("accepts a single provider adapter", () => {
    const client = new RateShip({ providers: [makeAdapter("easypost")] });
    expect(client).toBeInstanceOf(RateShip);
  });

  it("accepts multiple adapters of different provider types", () => {
    const client = new RateShip({
      providers: [makeAdapter("easypost"), makeAdapter("shippo")],
    });
    expect(client).toBeInstanceOf(RateShip);
  });

  it("throws CONFIGURATION_ERROR when providers array is empty", () => {
    let thrown: unknown;
    try {
      new RateShip({ providers: [] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
  });

  it("throws CONFIGURATION_ERROR when two adapters share the same provider name", () => {
    let thrown: unknown;
    try {
      new RateShip({
        providers: [makeAdapter("easypost"), makeAdapter("easypost")],
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
    expect((thrown as RateShipError).message).toMatch(/easypost/);
  });

  it("does not call any adapter method during construction (lazy validation)", () => {
    const adapter = makeAdapter("shippo");
    new RateShip({ providers: [adapter] });
    expect(adapter.getRates).not.toHaveBeenCalled();
    expect(adapter.createLabel).not.toHaveBeenCalled();
    expect(adapter.verifyWebhook).not.toHaveBeenCalled();
  });

  it("exposes a webhooks namespace with verify()", () => {
    const client = new RateShip({ providers: [makeAdapter("easypost")] });
    expect(typeof client.webhooks.verify).toBe("function");
  });
});

const sampleRequest: RateRequest = {
  from: {
    name: "A",
    street1: "1",
    city: "X",
    state: "CA",
    zip: "00000",
    country: "US",
  },
  to: {
    name: "B",
    street1: "2",
    city: "Y",
    state: "CA",
    zip: "00001",
    country: "US",
  },
  parcel: {
    weight: 1,
    weight_unit: "lb",
    length: 1,
    width: 1,
    height: 1,
    distance_unit: "in",
  },
};

function makeRate(
  provider: Provider,
  rate_id: string,
  price_cents: number,
): NormalizedRate {
  return {
    provider,
    carrier: "TEST",
    service: "Test",
    price_cents,
    currency: "USD",
    estimated_days: 3,
    estimated_delivery: null,
    rate_id,
    raw: { id: rate_id },
  };
}

describe("RateShip.getRates — fan-out", () => {
  it("calls getRates on every configured provider", async () => {
    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => [makeRate("easypost", "ep_1", 500)]),
    });
    const sh = makeAdapter("shippo", {
      getRates: vi.fn(async () => [makeRate("shippo", "sh_1", 700)]),
    });
    const client = new RateShip({ providers: [ep, sh] });

    await client.getRates(sampleRequest);

    expect(ep.getRates).toHaveBeenCalledOnce();
    expect(sh.getRates).toHaveBeenCalledOnce();
    expect((ep.getRates as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      sampleRequest,
    );
  });

  it("returns { rates, errors } with rates sorted by price_cents ascending", async () => {
    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => [
        makeRate("easypost", "ep_1", 900),
        makeRate("easypost", "ep_2", 500),
      ]),
    });
    const sh = makeAdapter("shippo", {
      getRates: vi.fn(async () => [makeRate("shippo", "sh_1", 700)]),
    });
    const client = new RateShip({ providers: [ep, sh] });

    const response = await client.getRates(sampleRequest);

    expect(response.rates).toHaveLength(3);
    expect(response.rates.map((r) => r.price_cents)).toEqual([500, 700, 900]);
    expect(response.errors).toEqual([]);
  });

  it("returns partial success: one provider succeeds, one throws RateShipError", async () => {
    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => [makeRate("easypost", "ep_1", 500)]),
    });
    const sh = makeAdapter("shippo", {
      getRates: vi.fn(async () => {
        throw new RateShipError("Shippo auth failed", "AUTH_FAILED", {
          provider: "shippo",
        });
      }),
    });
    const client = new RateShip({ providers: [ep, sh] });

    const response = await client.getRates(sampleRequest);

    expect(response.rates).toHaveLength(1);
    expect(response.rates[0].provider).toBe("easypost");
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0]).toEqual({
      provider: "shippo",
      code: "AUTH_FAILED",
      message: "Shippo auth failed",
    });
  });

  it("returns rates=[] and all errors when every provider fails", async () => {
    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => {
        throw new RateShipError("ep down", "NETWORK_ERROR", {
          provider: "easypost",
        });
      }),
    });
    const sh = makeAdapter("shippo", {
      getRates: vi.fn(async () => {
        throw new RateShipError("sh down", "TIMEOUT", { provider: "shippo" });
      }),
    });
    const client = new RateShip({ providers: [ep, sh] });

    const response = await client.getRates(sampleRequest);

    expect(response.rates).toEqual([]);
    expect(response.errors).toHaveLength(2);
    const byProvider = Object.fromEntries(
      response.errors.map((e) => [e.provider, e.code]),
    );
    expect(byProvider).toEqual({ easypost: "NETWORK_ERROR", shippo: "TIMEOUT" });
  });

  it("wraps non-RateShipError thrown by an adapter as UNKNOWN", async () => {
    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => {
        throw new Error("something else broke");
      }),
    });
    const client = new RateShip({ providers: [ep] });

    const response = await client.getRates(sampleRequest);

    expect(response.rates).toEqual([]);
    expect(response.errors).toHaveLength(1);
    expect(response.errors[0]).toMatchObject({
      provider: "easypost",
      code: "UNKNOWN",
    });
  });

  it("runs providers in parallel (both fetches initiated before either resolves)", async () => {
    let epStarted = false;
    let shStarted = false;
    let release: () => void = () => {};
    const waiter = new Promise<void>((r) => {
      release = r;
    });

    const ep = makeAdapter("easypost", {
      getRates: vi.fn(async () => {
        epStarted = true;
        await waiter;
        return [];
      }),
    });
    const sh = makeAdapter("shippo", {
      getRates: vi.fn(async () => {
        shStarted = true;
        await waiter;
        return [];
      }),
    });
    const client = new RateShip({ providers: [ep, sh] });

    const promise = client.getRates(sampleRequest);
    // Yield the microtask queue so both adapters enter their awaits.
    await Promise.resolve();
    await Promise.resolve();
    expect(epStarted).toBe(true);
    expect(shStarted).toBe(true);

    release();
    await promise;
  });
});

describe("RateShip.createLabel", () => {
  it("routes to the adapter matching rate.provider", async () => {
    const fakeLabel: Label = {
      provider: "shippo",
      carrier: "UPS",
      service: "Ground",
      price_cents: 700,
      currency: "USD",
      tracking_number: "1Z",
      label_url: "https://x/y.pdf",
      label_id: "lbl_1",
      rate_id: "sh_1",
      created_at: "2026-04-17T00:00:00.000Z",
      raw: {},
    };
    const ep = makeAdapter("easypost", {
      createLabel: vi.fn(async () => {
        throw new Error("should not be called");
      }),
    });
    const sh = makeAdapter("shippo", {
      createLabel: vi.fn(async () => fakeLabel),
    });
    const client = new RateShip({ providers: [ep, sh] });

    const rate = makeRate("shippo", "sh_1", 700);
    const label = await client.createLabel(rate);

    expect(sh.createLabel).toHaveBeenCalledOnce();
    expect(ep.createLabel).not.toHaveBeenCalled();
    expect(label).toBe(fakeLabel);
  });

  it("re-throws adapter errors (no errors array on createLabel)", async () => {
    const sh = makeAdapter("shippo", {
      createLabel: vi.fn(async () => {
        throw new RateShipError("no funds", "PROVIDER_ERROR", {
          provider: "shippo",
        });
      }),
    });
    const client = new RateShip({ providers: [sh] });

    let thrown: unknown;
    try {
      await client.createLabel(makeRate("shippo", "sh_1", 700));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("PROVIDER_ERROR");
  });

  it("throws CONFIGURATION_ERROR when the rate's provider isn't configured", async () => {
    const client = new RateShip({ providers: [makeAdapter("shippo")] });

    let thrown: unknown;
    try {
      await client.createLabel(makeRate("easypost", "ep_1", 500));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RateShipError);
    expect((thrown as RateShipError).code).toBe("CONFIGURATION_ERROR");
    expect((thrown as RateShipError).message).toMatch(/easypost/);
  });
});
