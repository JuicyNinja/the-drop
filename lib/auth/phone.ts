import { ApiError } from "@/lib/api/errors";
import { incrementWithWindow, kvDel, kvGet, kvSet } from "@/lib/redis";
import { getSmsSender } from "@/lib/sms";

/**
 * SMS phone verification. The code lives in Redis with a TTL; the SMS itself
 * goes through the provider interface (dev sender logs it). Sending is rate
 * limited 5/hour per phone (API-CONTRACT §13); confirmation is limited to a
 * few attempts before the code is burned.
 */

const CODE_TTL_SECONDS = 10 * 60;
const SEND_LIMIT = 5;
const SEND_WINDOW_SECONDS = 60 * 60;
const MAX_CONFIRM_ATTEMPTS = 5;

interface VerifyRecord {
  code: string;
  phone: string;
  attempts: number;
}

const recordKey = (userId: string) => `phoneverify:${userId}`;
const sendRateKey = (phone: string) => `phoneverify:sendrate:${phone}`;

function sixDigitCode(): string {
  // Uniform 000000–999999.
  const n = Math.floor(Math.random() * 1_000_000);
  return String(n).padStart(6, "0");
}

/** Generate, store, and send a verification code. Enforces the send rate limit. */
export async function sendPhoneCode(userId: string, phone: string): Promise<void> {
  const attempts = await incrementWithWindow(sendRateKey(phone), SEND_WINDOW_SECONDS);
  if (attempts > SEND_LIMIT) {
    throw new ApiError("RATE_LIMITED", "Too many verification codes requested. Try again later.");
  }
  const code = sixDigitCode();
  await kvSet<VerifyRecord>(recordKey(userId), { code, phone, attempts: 0 }, CODE_TTL_SECONDS);
  await getSmsSender().send(phone, `Your The Drop verification code is ${code}`);
}

/**
 * Confirm a code. Returns true on success. A wrong code counts an attempt and,
 * past the cap, burns the record. Missing/expired records fail validation.
 */
export async function confirmPhoneCode(userId: string, code: string): Promise<boolean> {
  const key = recordKey(userId);
  const record = await kvGet<VerifyRecord>(key);
  if (!record) {
    throw new ApiError("VALIDATION_ERROR", "No verification in progress, or the code expired.", {
      code: [{ path: "code", message: "expired or not requested" }],
    });
  }
  if (record.code === code) {
    await kvDel(key);
    return true;
  }
  const attempts = record.attempts + 1;
  if (attempts >= MAX_CONFIRM_ATTEMPTS) {
    await kvDel(key);
    throw new ApiError("VALIDATION_ERROR", "Too many incorrect attempts. Request a new code.", {
      code: [{ path: "code", message: "attempts exceeded" }],
    });
  }
  await kvSet<VerifyRecord>(key, { ...record, attempts }, CODE_TTL_SECONDS);
  throw new ApiError("VALIDATION_ERROR", "Incorrect verification code.", {
    code: [{ path: "code", message: "incorrect" }],
  });
}
