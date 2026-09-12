import { z } from "@/lib/zod";

/**
 * Canonical error codes. API-CONTRACT §1.4.
 *
 * Codes are stable contract. Native clients branch on `code`, never on
 * `message`. Messages may be reworded; codes may not. Add a code only by
 * amending API-CONTRACT §1.4 first.
 */
export const ERROR_CODES = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  LOCATION_PERMISSION_REQUIRED: 403,
  ACCOUNT_SUSPENDED: 403,
  NOT_FOUND: 404,
  DROP_GONE: 409,
  DROP_NOT_LIVE: 409,
  ALREADY_CAUGHT: 409,
  ALREADY_REDEEMED: 409,
  OUTSIDE_GEOFENCE: 409,
  GPS_ACCURACY_INSUFFICIENT: 422,
  INVALID_CODE: 422,
  REDEMPTION_WINDOW_CLOSED: 409,
  TRANSFER_CUTOFF_PASSED: 409,
  TRANSFER_LIMIT_REACHED: 409,
  TRANSFER_EXPIRED: 409,
  FANATIC_LIMIT_REACHED: 409,
  ALLOWANCE_EXHAUSTED: 402,
  DROP_IMMUTABLE: 409,
  HANDLE_LOCKED: 409,
  HANDLE_TAKEN: 409,
  RATE_LIMITED: 429,
  VALIDATION_ERROR: 422,
  INTERNAL_ERROR: 500,
  NOT_READY: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [
  ErrorCode,
  ...ErrorCode[],
];

export const errorCodeSchema = z.enum(ERROR_CODE_LIST);

/** API-CONTRACT §1.3: the error envelope. */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Throw this from a handler to produce a contract error response. The HTTP
 * status is derived from the code. Handlers never pick a status by hand.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: { code: this.code, message: this.message, details: this.details },
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
