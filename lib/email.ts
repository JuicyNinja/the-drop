import { getEnv } from "@/lib/env";

/**
 * Transactional email behind a provider interface. WP-3 uses it for the
 * post-registration prompt to complete the full profile. Dev sender logs;
 * supplying RESEND_* swaps in Resend with no other change.
 */
export interface EmailSender {
  readonly kind: "dev" | "resend";
  send(msg: {
    to: string;
    subject: string;
    text: string;
  }): Promise<{ id: string }>;
}

export class DevEmailSender implements EmailSender {
  readonly kind = "dev" as const;
  static readonly sent: { to: string; subject: string; text: string; at: string }[] = [];

  async send(msg: { to: string; subject: string; text: string }): Promise<{ id: string }> {
    DevEmailSender.sent.push({ ...msg, at: new Date().toISOString() });
    console.log(`[dev-email] to=${msg.to} subject=${JSON.stringify(msg.subject)}`);
    return { id: `dev-${DevEmailSender.sent.length}` };
  }
}

export class ResendEmailSender implements EmailSender {
  readonly kind = "resend" as const;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(msg: { to: string; subject: string; text: string }): Promise<{ id: string }> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      }),
    });
    if (!res.ok) throw new Error(`Resend send failed: HTTP ${res.status}`);
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  }
}

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (!sender) {
    const env = getEnv();
    sender =
      env.RESEND_API_KEY && env.RESEND_FROM
        ? new ResendEmailSender(env.RESEND_API_KEY, env.RESEND_FROM)
        : new DevEmailSender();
  }
  return sender;
}

/** Test hook only. */
export function resetEmailSender(): void {
  sender = undefined;
}
