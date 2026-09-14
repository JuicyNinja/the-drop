import { getEnv } from "@/lib/env";

/**
 * Subscription upgrades behind a provider interface (same pattern as the
 * geocoder and SMS). The dev gateway performs the upgrade's *effect* — it is
 * not a stub — without a network call; real Stripe swaps in by credential.
 *
 * WP-16 note: when the real Stripe gateway replaces this, proration MUST use
 * `proration_behavior=always_invoice`, and the Stripe *webhook* is what
 * confirms the charge — never the API response. The dev gateway returns the
 * amount our own proration computed so scheduling unblocks in the same request.
 */

export interface UpgradeRequest {
  orgId: string;
  fromTier: string;
  toTier: string;
  proratedCents: number;
}

export interface UpgradeResult {
  subscription_id: string;
  charged_cents: number;
}

export interface SubscriptionGateway {
  readonly kind: "dev" | "stripe";
  upgrade(req: UpgradeRequest): Promise<UpgradeResult>;
}

/** Dev gateway: grants the upgrade with no network call. */
export class DevSubscriptionGateway implements SubscriptionGateway {
  readonly kind = "dev" as const;
  async upgrade(req: UpgradeRequest): Promise<UpgradeResult> {
    return {
      subscription_id: `dev_sub_${req.orgId.slice(0, 8)}_${req.toTier}`,
      charged_cents: req.proratedCents,
    };
  }
}

/** Stripe gateway. Built in a later package (see WP-16 note above). */
export class StripeSubscriptionGateway implements SubscriptionGateway {
  readonly kind = "stripe" as const;
  constructor(private readonly secretKey: string) {}
  async upgrade(req: UpgradeRequest): Promise<UpgradeResult> {
    void this.secretKey;
    void req;
    // WP-16: create/swap the Stripe subscription item with
    // proration_behavior=always_invoice; the webhook confirms the charge.
    throw new Error("StripeSubscriptionGateway.upgrade is not implemented yet (WP-16).");
  }
}

let gateway: SubscriptionGateway | undefined;

export function getSubscriptionGateway(): SubscriptionGateway {
  if (!gateway) {
    const env = getEnv();
    if (env.STRIPE_SECRET_KEY) {
      gateway = new StripeSubscriptionGateway(env.STRIPE_SECRET_KEY);
    } else {
      // Boot validation forbids this in production; second, local guard so the
      // dev gateway can never silently grant upgrades in production.
      if (env.APP_ENV === "production") {
        throw new Error("Refusing the dev subscription gateway in production: set STRIPE_SECRET_KEY.");
      }
      gateway = new DevSubscriptionGateway();
    }
  }
  return gateway;
}

/** Test hook only. */
export function resetSubscriptionGateway(): void {
  gateway = undefined;
}
