import { describe, expect, it } from "vitest";
import { shipengine } from "./shipengine";
import { RateShipError } from "../errors";

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
