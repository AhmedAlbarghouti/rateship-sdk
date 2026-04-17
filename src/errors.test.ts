import { describe, expect, it } from "vitest";
import { RateShipError, WebhookVerificationError } from "./errors";

describe("RateShipError", () => {
  it("is an instance of Error", () => {
    const err = new RateShipError("boom", "UNKNOWN");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RateShipError);
  });

  it("carries message and code", () => {
    const err = new RateShipError("auth failed", "AUTH_FAILED");
    expect(err.message).toBe("auth failed");
    expect(err.code).toBe("AUTH_FAILED");
  });

  it("sets name to RateShipError so toString() is useful", () => {
    const err = new RateShipError("boom", "UNKNOWN");
    expect(err.name).toBe("RateShipError");
  });

  it("optionally carries a provider for provider-origin errors", () => {
    const err = new RateShipError("boom", "PROVIDER_ERROR", {
      provider: "shippo",
    });
    expect(err.provider).toBe("shippo");
  });

  it("optionally carries the underlying cause for debugging", () => {
    const cause = new Error("fetch failed");
    const err = new RateShipError("network down", "NETWORK_ERROR", { cause });
    expect(err.cause).toBe(cause);
  });

  it("leaves provider and cause undefined when not supplied", () => {
    const err = new RateShipError("boom", "UNKNOWN");
    expect(err.provider).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe("WebhookVerificationError", () => {
  it("is an instance of RateShipError and Error", () => {
    const err = new WebhookVerificationError("bad signature");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RateShipError);
    expect(err).toBeInstanceOf(WebhookVerificationError);
  });

  it("has code WEBHOOK_VERIFICATION_FAILED automatically", () => {
    const err = new WebhookVerificationError("bad signature");
    expect(err.code).toBe("WEBHOOK_VERIFICATION_FAILED");
  });

  it("sets name to WebhookVerificationError", () => {
    const err = new WebhookVerificationError("bad signature");
    expect(err.name).toBe("WebhookVerificationError");
  });

  it("optionally carries provider", () => {
    const err = new WebhookVerificationError("bad signature", {
      provider: "easypost",
    });
    expect(err.provider).toBe("easypost");
  });
});
