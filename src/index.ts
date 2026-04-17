export { RateShip } from "./client";
export { RateShipError, WebhookVerificationError } from "./errors";

// Provider factories (also available via subpath imports for tree-shaking)
export { easypost } from "./providers/easypost";
export { shippo } from "./providers/shippo";
export { shipengine } from "./providers/shipengine";

// Types — full public surface
export type {
	Address,
	ErrorCode,
	EventLocation,
	Label,
	NormalizedEvent,
	NormalizedRate,
	Parcel,
	Provider,
	ProviderAdapter,
	ProviderError,
	RateRequest,
	RatesResponse,
	RateShipOptions,
	TrackingDeliveredEvent,
	TrackingStatus,
	TrackingUpdatedEvent,
	WebhookVerifyInput,
} from "./types";

export type { EasyPostOptions } from "./providers/easypost";
export type { ShippoOptions } from "./providers/shippo";
export type { ShipEngineOptions } from "./providers/shipengine";
export type { RateShipErrorOptions } from "./errors";
