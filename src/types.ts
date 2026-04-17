/**
 * The set of providers this SDK supports. Each `Provider` corresponds to a
 * factory function exported from `rateship` (e.g. `easypost()`, `shippo()`,
 * `shipengine()`).
 */
export type Provider = "easypost" | "shippo" | "shipengine";

/**
 * Error codes used across both thrown errors (`RateShipError.code`) and
 * per-provider failure data (`ProviderError.code`).
 */
export type ErrorCode =
	| "AUTH_FAILED"
	| "TIMEOUT"
	| "PROVIDER_ERROR"
	| "NETWORK_ERROR"
	| "VALIDATION_ERROR"
	| "CONFIGURATION_ERROR"
	| "WEBHOOK_VERIFICATION_FAILED"
	| "UNKNOWN";

/**
 * Shipping address. Required fields cover the common-denominator across
 * providers.
 *
 * **v2.0.0 is US-domestic only.** `country` is locked to `"US"` at the type
 * level — international shipping (US → non-US, or non-US origin) is v2.1+.
 * Widening `country` to `string` in a future version is additive and
 * non-breaking for existing consumers.
 */
export interface Address {
	name: string;
	street1: string;
	/** Optional suite / apartment / floor. */
	street2?: string;
	city: string;
	state: string;
	zip: string;
	/** v2.0.0: locked to `"US"`. Widens to ISO 3166-1 alpha-2 in v2.1+. */
	country: "US";
	/** Optional. Some providers require it for certain carriers; the adapter will throw `VALIDATION_ERROR` if missing when needed. */
	phone?: string;
	email?: string;
}

/** A single package being shipped. Multi-parcel shipments are a v2.1 feature. */
export interface Parcel {
	weight: number;
	weight_unit: "lb" | "oz";
	length: number;
	width: number;
	height: number;
	distance_unit: "in";
}

export interface RateRequest {
	from: Address;
	to: Address;
	parcel: Parcel;
}

export interface NormalizedRate {
	provider: Provider;
	/** Carrier name (e.g. "UPS", "USPS", "FedEx"). Normalized to uppercase where possible. */
	carrier: string;
	/** Service level name (e.g. "Ground", "Priority Mail", "2-Day"). Provider-specific casing preserved. */
	service: string;
	price_cents: number;
	currency: "USD";
	/** Estimated days in transit. `null` if the provider didn't supply it. */
	estimated_days: number | null;
	/** ISO date string. `null` if the provider didn't supply it. */
	estimated_delivery: string | null;
	/** Provider-native rate identifier. Pass the full `NormalizedRate` to `createLabel()` — don't pass this field alone. */
	rate_id: string;
	/** Unmodified provider response for this rate. Access provider-specific fields here. */
	raw: object;
}

/** Per-provider failure inside `RatesResponse.errors[]`. Not a thrown error. */
export interface ProviderError {
	provider: Provider;
	code: ErrorCode;
	message: string;
}

export interface RatesResponse {
	/** Rates sorted by `price_cents` ascending. Empty if every provider failed. */
	rates: NormalizedRate[];
	/** One entry per provider that failed. Empty if every provider succeeded. */
	errors: ProviderError[];
}

export interface Label {
	provider: Provider;
	carrier: string;
	service: string;
	price_cents: number;
	currency: "USD";
	tracking_number: string;
	label_url: string;
	/** Provider-native label identifier — useful for support lookups. */
	label_id: string;
	/** The rate_id the label was purchased from. */
	rate_id: string;
	/** ISO timestamp of when the label was created. */
	created_at: string;
	/** Unmodified provider response. */
	raw: object;
}

/** Normalized tracking status bucket. */
export type TrackingStatus =
	| "pre_transit"
	| "in_transit"
	| "out_for_delivery"
	| "failure"
	| "unknown";

/** Subset of location fields some providers include on tracking events. */
export interface EventLocation {
	city?: string;
	state?: string;
	zip?: string;
	country?: string;
}

export interface TrackingUpdatedEvent {
	type: "tracking.updated";
	provider: Provider;
	tracking_number: string;
	carrier: string;
	status: TrackingStatus;
	/** Raw provider status string (e.g. "Accepted at origin facility"). Pattern-match on this for fine-grained cases. */
	status_detail?: string;
	location?: EventLocation;
	/** Updated ETA if the provider gave one. ISO date string. */
	estimated_delivery?: string;
	/** ISO timestamp of the carrier event itself. */
	occurred_at: string;
	/** Unmodified provider webhook payload. */
	raw: object;
}

export interface TrackingDeliveredEvent {
	type: "tracking.delivered";
	provider: Provider;
	tracking_number: string;
	carrier: string;
	delivered_at: string;
	location?: EventLocation;
	signed_by?: string;
	raw: object;
}

export type NormalizedEvent = TrackingUpdatedEvent | TrackingDeliveredEvent;

/**
 * The contract every provider adapter must implement. Users never interact
 * with this directly — they call provider factory functions (e.g. `easypost()`)
 * which return conforming adapters to the `RateShip` client.
 */
export interface ProviderAdapter {
	readonly name: Provider;
	getRates(request: RateRequest): Promise<NormalizedRate[]>;
	createLabel(rate: NormalizedRate): Promise<Label>;
	verifyWebhook(
		rawBody: string | Buffer,
		signature: string,
		secret: string,
	): NormalizedEvent;
}

export interface RateShipOptions {
	providers: ProviderAdapter[];
}

export interface WebhookVerifyInput {
	provider: Provider;
	rawBody: string | Buffer;
	signature: string;
	secret: string;
}
