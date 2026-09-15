import { getEnv } from "@/lib/env";
import { recordDevNotification } from "@/lib/redis";

/**
 * Web Push behind a provider interface (WP-12), the same pattern as SMS/email.
 * The dev sender logs and mirrors to Redis so gates can observe it; supplying
 * VAPID_* swaps in the real web-push sender with no other change. The dev sender
 * is refused in production (defense in depth) so a missing VAPID config can
 * never silently drop pushes.
 */

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface PushSender {
  readonly kind: "dev" | "web-push";
  send(subscription: WebPushSubscription, payload: PushPayload): Promise<void>;
}

export class DevPushSender implements PushSender {
  readonly kind = "dev" as const;
  static readonly sent: { endpoint: string; payload: PushPayload; at: string }[] = [];

  async send(subscription: WebPushSubscription, payload: PushPayload): Promise<void> {
    DevPushSender.sent.push({ endpoint: subscription.endpoint, payload, at: new Date().toISOString() });
    console.log(`[dev-push] endpoint=${subscription.endpoint.slice(0, 40)} title=${JSON.stringify(payload.title)}`);
    await recordDevNotification("push", subscription.endpoint, payload.title);
  }
}

/**
 * Production sender. Uses the `web-push` library (VAPID JWT + payload encryption
 * are not worth hand-rolling). Imported lazily so it never loads on the dev path.
 */
export class WebPushSender implements PushSender {
  readonly kind = "web-push" as const;
  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  async send(subscription: WebPushSubscription, payload: PushPayload): Promise<void> {
    const webpush = (await import("web-push")).default;
    webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  }
}

let sender: PushSender | undefined;

export function getPushSender(): PushSender {
  if (!sender) {
    const env = getEnv();
    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT) {
      sender = new WebPushSender(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
    } else {
      if (env.APP_ENV === "production") {
        throw new Error("Refusing the dev push sender in production: set VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT.");
      }
      sender = new DevPushSender();
    }
  }
  return sender;
}

/** Test hook only. */
export function resetPushSender(): void {
  sender = undefined;
}
