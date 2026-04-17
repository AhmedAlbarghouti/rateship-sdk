import { describe, expect, it } from "vitest";
import { shippo } from "./shippo";
import { RateShipError } from "../errors";

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
