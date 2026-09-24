import { ApiError } from "@/lib/api/errors";
import {
  claimIdempotencyKey,
  getIdempotencyResult,
  storeIdempotencyResult,
} from "@/lib/redis";
import { getServiceClient } from "@/lib/supabase/server";
import { annualIntroPricing, isSelfServeTier } from "@/lib/billing/tiers";
import { getSubscriptionGateway } from "@/lib/billing/subscription";
import type { OrgRecord } from "@/lib/orgs";

/**
 * Switch an org to an annual contract with the introductory offer (PRD §12.4):
 * $9/month for three months, then the annual monthly rate for nine — one
 * twelve-month term. Behind the same SubscriptionGateway as upgrades; the dev
 * gateway charges the first intro month, the real Stripe gateway (WP-16) sets up
 * the intro-then-annual schedule. Idempotent via the same key pattern, so a
 * double-click neither charges twice nor starts two terms. The tier is
 * unchanged — annual is an interval choice; tier changes stay on /upgrade.
 */

export interface AnnualResponse {
  subscription_id: string;
  charged_cents: number; // the first intro month ($9)
  billing_interval: "annual";
  tier: string;
  annual_price_cents: number;
  annual_monthly_cents: number;
  intro_monthly_cents: number;
  intro_months: number;
  year_total_cents: number;
  annual_started_at: string;
}

export async function switchToAnnual(org: OrgRecord, idempotencyKey: string): Promise<AnnualResponse> {
  const key = `annual:${org.id}:${idempotencyKey}`;

  const won = await claimIdempotencyKey(key);
  if (!won) {
    const prior = await getIdempotencyResult<AnnualResponse>(key);
    if (prior && prior !== "pending") return prior;
    throw new ApiError("RATE_LIMITED", "An annual switch for this request is already in progress. Retry shortly.");
  }

  // Enterprise is billed by contract, not self-serve annual.
  if (!isSelfServeTier(org.tier)) {
    throw new ApiError("VALIDATION_ERROR", "Enterprise is billed by contract — contact us for annual terms.", {
      body: [{ path: "tier", message: "not self-serve" }],
    });
  }
  const pricing = annualIntroPricing(org.tier);
  if (!pricing) throw new ApiError("VALIDATION_ERROR", "No annual price for this tier.");

  const svc = getServiceClient();
  // Guard against re-switching an org that is already annual.
  const { data: current, error: readErr } = await svc
    .from("organizations")
    .select("billing_interval")
    .eq("id", org.id)
    .maybeSingle();
  if (readErr) throw new Error(`read billing interval failed: ${readErr.message}`);
  if (current?.billing_interval === "annual") {
    throw new ApiError("VALIDATION_ERROR", "This org is already on an annual contract.");
  }

  const gatewayResult = await getSubscriptionGateway().subscribeAnnual({
    orgId: org.id,
    tier: org.tier,
    annualPriceCents: pricing.annual_price_cents,
    annualMonthlyCents: pricing.annual_monthly_cents,
    introMonthlyCents: pricing.intro_monthly_cents,
    introMonths: pricing.intro_months,
  });

  const startedAt = new Date().toISOString();
  const { error } = await svc
    .from("organizations")
    .update({
      billing_interval: "annual",
      annual_started_at: startedAt,
      stripe_subscription_id: gatewayResult.subscription_id,
      updated_at: startedAt,
    })
    .eq("id", org.id);
  if (error) throw new Error(`apply annual switch failed: ${error.message}`);

  const response: AnnualResponse = {
    subscription_id: gatewayResult.subscription_id,
    charged_cents: gatewayResult.charged_cents,
    billing_interval: "annual",
    tier: org.tier,
    annual_price_cents: pricing.annual_price_cents,
    annual_monthly_cents: pricing.annual_monthly_cents,
    intro_monthly_cents: pricing.intro_monthly_cents,
    intro_months: pricing.intro_months,
    year_total_cents: pricing.year_total_cents,
    annual_started_at: startedAt,
  };
  await storeIdempotencyResult(key, response);
  return response;
}
