import { getServiceClient } from "@/lib/supabase/server";

/**
 * Read the admin audit trail (API-CONTRACT §11). Read-only — the table is
 * append-only at the database layer, so there is no write path here at all.
 */

export interface AuditLogEntry {
  id: string;
  actor_id: string;
  actor_handle: string;
  action: string;
  target_type: string;
  target_id: string | null;
  before: unknown;
  after: unknown;
  ip_address: string | null;
  occurred_at: string;
}

export interface AuditLogQuery {
  actor_id?: string;
  target_type?: string;
  target_id?: string;
  limit?: number;
}

export async function listAuditLog(opts: AuditLogQuery = {}): Promise<AuditLogEntry[]> {
  let q = getServiceClient()
    .from("admin_audit_log")
    .select("id, actor_id, action, target_type, target_id, before, after, ip_address, occurred_at, users:actor_id(handle)")
    .order("occurred_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (opts.actor_id) q = q.eq("actor_id", opts.actor_id);
  if (opts.target_type) q = q.eq("target_type", opts.target_type);
  if (opts.target_id) q = q.eq("target_id", opts.target_id);
  const { data, error } = await q;
  if (error) throw new Error(`list audit log failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    actor_id: r.actor_id as string,
    actor_handle: (r.users as unknown as { handle: string } | null)?.handle ?? "",
    action: r.action as string,
    target_type: r.target_type as string,
    target_id: (r.target_id as string | null) ?? null,
    before: r.before ?? null,
    after: r.after ?? null,
    ip_address: (r.ip_address as string | null) ?? null,
    occurred_at: r.occurred_at as string,
  }));
}
