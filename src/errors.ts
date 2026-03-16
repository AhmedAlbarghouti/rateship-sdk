export class RateShipError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "RateShipError";
    this.code = code;
    this.status = status;
  }
}
