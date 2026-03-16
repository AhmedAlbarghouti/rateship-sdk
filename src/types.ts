// Provider types
export type Provider = "shippo" | "easypost" | "shipengine";

// Rate types
export interface RateRequest {
  origin_zip: string;
  destination_zip: string;
  weight: number;
  weight_unit: "lbs" | "oz";
  length: number;
  width: number;
  height: number;
  package_count: number;
}

export interface NormalizedRate {
  provider: Provider;
  carrier: string;
  service: string;
  price_cents: number;
  currency: "USD";
  estimated_days: number | null;
  estimated_delivery: string | null;
  rate_id: string;
  raw: object;
}

export interface ProviderError {
  provider: Provider;
  error: string;
  code: "AUTH_FAILED" | "TIMEOUT" | "PROVIDER_ERROR" | "UNKNOWN";
}

export interface RatesResponse {
  rates: NormalizedRate[];
  errors: ProviderError[];
}

// Label types
export interface Address {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface LabelPurchaseRequest {
  provider: Provider;
  rate_id: string;
  carrier: string;
  service: string;
  price_cents: number;
  from_address: Address;
  to_address: Address;
  weight: number;
  weight_unit: "lbs" | "oz";
  length: number;
  width: number;
  height: number;
  package_count: number;
}

export interface LabelPurchaseResult {
  provider: Provider;
  carrier: string;
  service: string;
  price_cents: number;
  tracking_number: string | null;
  label_url: string | null;
  rate_id: string;
}

export interface LabelHistoryItem {
  id: string;
  created_at: string;
  provider: Provider;
  carrier: string;
  service: string;
  price_cents: number;
  tracking_number: string | null;
  label_url: string | null;
  rate_id: string;
}

export interface LabelHistoryResponse {
  items: LabelHistoryItem[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface LabelListParams {
  page?: number;
  page_size?: number;
  provider?: Provider;
  date_from?: string;
  date_to?: string;
}

// Webhook types
export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  secret?: string;
}

export interface WebhookCreateRequest {
  url: string;
  events: ("label.purchased" | "tracking.updated" | "tracking.delivered")[];
}

// API response types
export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    code: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// Client options
export interface RateShipOptions {
  apiKey: string;
  baseUrl?: string;
}
