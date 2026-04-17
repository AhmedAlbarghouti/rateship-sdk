import { RateShipError } from "../errors";
import type { Provider } from "../types";

export interface ProviderFetcherConfig {
  provider: Provider;
  /** Default timeout applied when a request doesn't override it. */
  defaultTimeoutMs?: number;
}

export interface FetcherRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  /** Will be JSON.stringify-ed when present. Omit for GET. */
  body?: unknown;
  /** Per-request override of the default timeout. */
  timeoutMs?: number;
}

export type ProviderFetcher = (req: FetcherRequest) => Promise<unknown>;

/**
 * Display name used in error messages. Keeps error copy readable while the
 * machine-readable `provider` + `code` fields are stable.
 */
const DISPLAY_NAMES: Record<Provider, string> = {
  easypost: "EasyPost",
  shippo: "Shippo",
  shipengine: "ShipEngine",
};

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Factory returning a `fetch`-backed function with unified timeout + error
 * mapping. Every adapter uses this so error codes, timeouts, and network
 * failures behave identically across providers.
 *
 * Success path: resolves to the parsed JSON body.
 * Failure path: throws `RateShipError` with one of
 *   AUTH_FAILED | PROVIDER_ERROR | TIMEOUT | NETWORK_ERROR,
 *   each tagged with the configured provider.
 */
export function createProviderFetcher(
  config: ProviderFetcherConfig,
): ProviderFetcher {
  const provider = config.provider;
  const display = DISPLAY_NAMES[provider];
  const defaultTimeout = config.defaultTimeoutMs ?? 15_000;

  return async function fetcher(req: FetcherRequest): Promise<unknown> {
    const timeoutMs = req.timeoutMs ?? defaultTimeout;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
          ...req.headers,
        },
        body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 401 || res.status === 403) {
        throw new RateShipError(
          `${display} authentication failed. Check your API key.`,
          "AUTH_FAILED",
          { provider },
        );
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new RateShipError(
          `${display} returned ${res.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
          "PROVIDER_ERROR",
          { provider },
        );
      }

      return await res.json();
    } catch (err) {
      if (err instanceof RateShipError) throw err;
      if (isAbortError(err)) {
        throw new RateShipError(
          `${display} request timed out.`,
          "TIMEOUT",
          { provider, cause: err },
        );
      }
      throw new RateShipError(
        `${display} network error.`,
        "NETWORK_ERROR",
        { provider, cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
