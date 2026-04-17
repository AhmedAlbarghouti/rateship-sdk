import { describe, expect, it } from "vitest";
import { easypost } from "./easypost";
import { RateShipError } from "../errors";

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
