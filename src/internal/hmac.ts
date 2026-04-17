import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Compute a hex-encoded HMAC-SHA256 of the given payload with the given
 * secret. Pure function, no network I/O.
 */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Constant-time comparison of two hex strings. Returns false if the strings
 * are different lengths. Uses Node's `timingSafeEqual` under the hood so
 * attackers can't use response-time side channels to probe the signature
 * one byte at a time.
 */
export function timingSafeHexEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/** Convert a `string | Buffer` to a string for hashing. */
export function rawBodyToString(body: string | Buffer): string {
  return typeof body === "string" ? body : body.toString("utf8");
}
