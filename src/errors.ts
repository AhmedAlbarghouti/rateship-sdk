import type { ErrorCode, Provider } from "./types";

export interface RateShipErrorOptions {
	provider?: Provider;
	cause?: unknown;
}

/**
 * Base error class thrown by the SDK. Every error the SDK throws is either
 * this class or a subclass of it.
 *
 * Inspect `.code` to branch on the failure kind, `.provider` to see which
 * adapter raised it (if applicable), and `.cause` for the underlying error
 * (often a `fetch` error or a provider response body).
 */
export class RateShipError extends Error {
	public readonly code: ErrorCode;
	public readonly provider?: Provider;
	public override readonly cause?: unknown;

	constructor(
		message: string,
		code: ErrorCode,
		options?: RateShipErrorOptions,
	) {
		super(message);
		this.name = "RateShipError";
		this.code = code;
		this.provider = options?.provider;
		this.cause = options?.cause;
	}
}

export interface WebhookVerificationErrorOptions {
	provider?: Provider;
	cause?: unknown;
}

/**
 * Thrown by `client.webhooks.verify(...)` when the HMAC signature does not
 * match the request body. Never return null on signature failure — surface
 * errors loudly so auth bypass bugs are impossible.
 */
export class WebhookVerificationError extends RateShipError {
	constructor(message: string, options?: WebhookVerificationErrorOptions) {
		super(message, "WEBHOOK_VERIFICATION_FAILED", options);
		this.name = "WebhookVerificationError";
	}
}
