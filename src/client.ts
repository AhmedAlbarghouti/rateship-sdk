import type {
  RateShipOptions,
  RateRequest,
  RatesResponse,
  LabelPurchaseRequest,
  LabelPurchaseResult,
  LabelListParams,
  LabelHistoryResponse,
  WebhookCreateRequest,
  WebhookEndpoint,
  ApiResponse,
} from "./types";
import { RateShipError } from "./errors";

const DEFAULT_BASE_URL = "https://rateship.io";

export class RateShip {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  public readonly rates: RatesClient;
  public readonly labels: LabelsClient;
  public readonly webhooks: WebhooksClient;

  constructor(options: RateShipOptions) {
    if (!options.apiKey) {
      throw new Error("RateShip: apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

    this.rates = new RatesClient(this);
    this.labels = new LabelsClient(this);
    this.webhooks = new WebhooksClient(this);
  }

  /** @internal */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await response.json()) as ApiResponse<T>;

    if (!json.success) {
      throw new RateShipError(
        json.error.message,
        json.error.code,
        response.status,
      );
    }

    return json.data;
  }
}

class RatesClient {
  constructor(private readonly client: RateShip) {}

  /**
   * Get shipping rates from all connected providers.
   */
  async get(params: RateRequest): Promise<RatesResponse> {
    return this.client.request<RatesResponse>("POST", "/api/v1/rates", params);
  }
}

class LabelsClient {
  constructor(private readonly client: RateShip) {}

  /**
   * Purchase a shipping label.
   */
  async purchase(params: LabelPurchaseRequest): Promise<LabelPurchaseResult> {
    return this.client.request<LabelPurchaseResult>(
      "POST",
      "/api/v1/labels",
      params,
    );
  }

  /**
   * List purchased labels with optional filtering.
   */
  async list(params?: LabelListParams): Promise<LabelHistoryResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set("page", String(params.page));
    if (params?.page_size)
      searchParams.set("page_size", String(params.page_size));
    if (params?.provider) searchParams.set("provider", params.provider);
    if (params?.date_from) searchParams.set("date_from", params.date_from);
    if (params?.date_to) searchParams.set("date_to", params.date_to);

    const query = searchParams.toString();
    const path = `/api/v1/labels${query ? `?${query}` : ""}`;
    return this.client.request<LabelHistoryResponse>("GET", path);
  }
}

class WebhooksClient {
  constructor(private readonly client: RateShip) {}

  /**
   * Register a webhook endpoint.
   */
  async create(
    params: WebhookCreateRequest,
  ): Promise<WebhookEndpoint & { secret: string }> {
    return this.client.request<WebhookEndpoint & { secret: string }>(
      "POST",
      "/api/v1/webhooks",
      params,
    );
  }

  /**
   * List webhook endpoints.
   */
  async list(): Promise<{ endpoints: WebhookEndpoint[] }> {
    return this.client.request<{ endpoints: WebhookEndpoint[] }>(
      "GET",
      "/api/v1/webhooks",
    );
  }

  /**
   * Delete a webhook endpoint.
   */
  async delete(id: string): Promise<{ deleted: boolean }> {
    return this.client.request<{ deleted: boolean }>(
      "DELETE",
      `/api/v1/webhooks/${id}`,
    );
  }

  /**
   * Toggle a webhook endpoint active/inactive.
   */
  async update(
    id: string,
    params: { is_active: boolean },
  ): Promise<{ id: string; is_active: boolean }> {
    return this.client.request<{ id: string; is_active: boolean }>(
      "PATCH",
      `/api/v1/webhooks/${id}`,
      params,
    );
  }
}
