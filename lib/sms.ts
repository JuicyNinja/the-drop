import { getEnv } from "@/lib/env";
import { recordDevSms } from "@/lib/redis";

/**
 * SMS delivery behind a provider interface. WP-3 ships a dev sender that logs
 * the message instead of sending it, so the full verification flow is testable
 * without Twilio. Supplying TWILIO_* credentials swaps in the real sender with
 * no other change (CLAUDE.md: the API is the product; providers are details).
 */
export interface SmsSender {
  readonly kind: "dev" | "twilio";
  send(to: string, body: string): Promise<{ id: string }>;
}

/** Dev sender: records the message in memory and logs it. Never sends. */
export class DevSmsSender implements SmsSender {
  readonly kind = "dev" as const;
  static readonly sent: { to: string; body: string; at: string }[] = [];

  async send(to: string, body: string): Promise<{ id: string }> {
    DevSmsSender.sent.push({ to, body, at: new Date().toISOString() });
    console.log(`[dev-sms] to=${to} body=${JSON.stringify(body)}`);
    // Cross-process observability for gates (dev only; never in production).
    await recordDevSms(to, body);
    return { id: `dev-${DevSmsSender.sent.length}` };
  }
}

/**
 * Twilio sender. Uses the REST API directly (no SDK) so nothing new is bundled
 * server-side. Reached only when all three TWILIO_* vars are present.
 */
export class TwilioSmsSender implements SmsSender {
  readonly kind = "twilio" as const;
  constructor(
    private readonly sid: string,
    private readonly token: string,
    private readonly from: string,
  ) {}

  async send(to: string, body: string): Promise<{ id: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`;
    const auth = Buffer.from(`${this.sid}:${this.token}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: this.from, Body: body }),
    });
    if (!res.ok) {
      throw new Error(`Twilio send failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as { sid: string };
    return { id: json.sid };
  }
}

let sender: SmsSender | undefined;

export function getSmsSender(): SmsSender {
  if (!sender) {
    const env = getEnv();
    if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER) {
      sender = new TwilioSmsSender(
        env.TWILIO_ACCOUNT_SID,
        env.TWILIO_AUTH_TOKEN,
        env.TWILIO_FROM_NUMBER,
      );
    } else {
      // Boot validation forbids missing Twilio in production; this is the second,
      // local guard so the dev sender can never silently swallow SMS in production.
      if (env.APP_ENV === "production") {
        throw new Error("Refusing the dev SMS sender in production: set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER.");
      }
      sender = new DevSmsSender();
    }
  }
  return sender;
}

/** Test hook only. */
export function resetSmsSender(): void {
  sender = undefined;
}
