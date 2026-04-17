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
