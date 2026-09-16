import { getServiceClient } from "@/lib/supabase/server";

/**
 * The admin audit trail (CLAUDE.md invariant #14, API-CONTRACT §11). Every admin
 * mutation writes actor, action, target, before, after, and IP here — no
 * exceptions. The table is append-only: DB triggers forbid UPDATE and DELETE and
 * the RLS migration revokes both from every role including service_role, so this
 * record cannot be rewritten after the fact.
 *
 * `before` and `after` are the entity state on either side of the change, so an
 * auditor can see exactly what a mutation did. A create has a null `before`; a
 * pure state flip records both.
 */

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const { error } = await getServiceClient().from("admin_audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip_address: entry.ip ?? null,
  });
  // An admin mutation that cannot be recorded must not be reported as done: the
  // audit trail is the invariant, not a side effect.
  if (error) throw new Error(`audit write failed: ${error.message}`);
}

/**
 * The caller's IP for the audit trail. Behind Vercel/Ubuntu the real client is
 * the first entry of X-Forwarded-For; X-Real-IP is the fallback. Postgres `inet`
 * rejects junk, so an unparseable value is stored as null rather than failing
 * the mutation.
 */
export function ipFromRequest(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  return real ? real.trim() : null;
}
