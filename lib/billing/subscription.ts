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

/** Switch to an annual contract (PRD §12.4). The intro charges $9/mo for three
 *  months, then the annual monthly rate for nine — one twelve-month term. */
export interface AnnualSubscribeRequest {
  orgId: string;
  tier: string;
  annualPriceCents: number;
  annualMonthlyCents: number;
  introMonthlyCents: number;
  introMonths: number;
}

export interface SubscriptionGateway {
  readonly kind: "dev" | "stripe";
  upgrade(req: UpgradeRequest): Promise<UpgradeResult>;
  subscribeAnnual(req: AnnualSubscribeRequest): Promise<UpgradeResult>;
}

/** Dev gateway: grants the upgrade/annual switch with no network call. */
export class DevSubscriptionGateway implements SubscriptionGateway {
  readonly kind = "dev" as const;
  async upgrade(req: UpgradeRequest): Promise<UpgradeResult> {
    return {
      subscription_id: `dev_sub_${req.orgId.slice(0, 8)}_${req.toTier}`,
      charged_cents: req.proratedCents,
    };
  }
  async subscribeAnnual(req: AnnualSubscribeRequest): Promise<UpgradeResult> {
    // Charges the first intro month ($9) now; the rest of the schedule (intro
    // then the annual monthly rate) is what the real provider sets up.
    return {
      subscription_id: `dev_sub_${req.orgId.slice(0, 8)}_${req.tier}_annual`,
      charged_cents: req.introMonthlyCents,
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
  async subscribeAnnual(req: AnnualSubscribeRequest): Promise<UpgradeResult> {
    void this.secretKey;
    void req;
    // WP-16: an annual Stripe subscription with a 3-month $9 intro phase then the
    // annual monthly rate; the webhook confirms each charge.
    throw new Error("StripeSubscriptionGateway.subscribeAnnual is not implemented yet (WP-16).");
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
