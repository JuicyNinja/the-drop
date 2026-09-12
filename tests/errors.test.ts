import { describe, expect, it } from "vitest";
import {
  ApiError,
  ERROR_CODES,
  errorEnvelopeSchema,
  isApiError,
} from "@/lib/api/errors";

/** API-CONTRACT §1.4, verbatim. */
const CONTRACT_TABLE: Record<string, number> = {
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
};

describe("canonical error codes (API-CONTRACT §1.4)", () => {
  it("matches the contract table exactly, code for code", () => {
    expect(ERROR_CODES).toEqual(CONTRACT_TABLE);
  });

  it("ApiError derives its HTTP status from the code", () => {
    for (const [code, status] of Object.entries(CONTRACT_TABLE)) {
      const error = new ApiError(code as keyof typeof ERROR_CODES, "x");
      expect(error.status).toBe(status);
    }
  });

  it("produces the §1.3 envelope with details defaulting to {}", () => {
    const envelope = new ApiError("DROP_GONE", "This drop is Gone.").toEnvelope();
    expect(envelope).toEqual({
      error: { code: "DROP_GONE", message: "This drop is Gone.", details: {} },
    });
    expect(errorEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("rejects an envelope carrying a code outside the contract", () => {
    const result = errorEnvelopeSchema.safeParse({
      error: { code: "SOLD_OUT", message: "", details: {} },
    });
    expect(result.success).toBe(false);
  });

  it("isApiError narrows", () => {
    expect(isApiError(new ApiError("NOT_FOUND", ""))).toBe(true);
    expect(isApiError(new Error("nope"))).toBe(false);
  });
});
