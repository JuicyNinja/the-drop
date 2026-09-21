import { ApiError } from "@/lib/api/errors";
import { getServiceClient } from "@/lib/supabase/server";
import { getSmsSender } from "@/lib/sms";
import { getUserByHandle } from "@/lib/users";

/**
 * TRANSFERS (PRD §6, API-CONTRACT §7). A caught drop may be handed to one other
 * buyer, once. The rules that make this a generous act rather than a resale
 * market — and the invariants a subtle change here would break:
 *
 *  - ONE hop (invariant #12). transfer_count increments on ACCEPT (the hop that
 *    completes), never on send, so a declined/expired transfer leaves the
 *    sender free to try again. A second accepted hop is TRANSFER_LIMIT_REACHED.
 *  - 5-minute accept window; 30-minute pre-close send cutoff. Both enforced at
 *    write time here AND by the server sweeper — NEVER by a client timer.
 *  - Position number TRAVELS (a property of the catch, guarded permanent by the
 *    DB trigger). Clout does NOT travel — it is written only on redemption, to
 *    whoever actually shows up.
 *  - Decline / expire returns the catch to the ORIGINAL holder, never to the
 *    inventory pool (counters never go up, invariant #2).
 *  - A window that closes while a transfer is pending VOIDS the transfer and the
 *    catch dies with the window — no orphaned "held" catch past its window.
 *
 * Every state transition is a conditional UPDATE ... WHERE <expected status>
 * RETURNING, so it is safe under concurrent execution: for a given row exactly
 * one caller (an accept, a decline, or one of two racing sweepers) wins the
 * transition and the losers see zero rows and do nothing. The transfer row's
 * `status` is the single source of truth for who resolved it.
 */

const ACCEPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const SEND_CUTOFF_MS = 30 * 60 * 1000; // must send ≥30 min before window close

export interface TransferSummary {
  transfer_id: string;
  to_handle: string;
  status: string;
  accept_by: string;
}

export interface IncomingTransfer {
  id: string;
  from_handle: string;
  position_number: number;
  drop_title: string;
  accept_by: string;
  sent_at: string;
}

export interface AcceptResult {
  transfer_id: string;
  status: "accepted";
  catch_id: string;
  position_number: number;
}

interface CatchContext {
  drop_title: string;
  position_number: number;
}

/** Drop title + position for an SMS body. Best-effort; never blocks a send. */
async function catchContext(catchId: string): Promise<CatchContext> {
  const { data, error } = await getServiceClient()
    .from("catches")
    .select("position_number, drops!inner(title)")
    .eq("id", catchId)
    .maybeSingle();
  // Best-effort SMS-body context (called post-commit): a real error is LOGGED,
  // not swallowed as "no data" and not thrown — the transfer must not fail here.
  if (error) {
    console.error("[transfer] catch context lookup failed (non-fatal)", error.message);
    return { drop_title: "a drop", position_number: 0 };
  }
  const drop = data?.drops as unknown as { title: string } | undefined;
  return {
    drop_title: drop?.title ?? "a drop",
    position_number: (data?.position_number as number) ?? 0,
  };
}

async function phoneOf(userId: string): Promise<string | null> {
  const { data, error } = await getServiceClient().from("users").select("phone").eq("id", userId).maybeSingle();
  if (error) { console.error("[transfer] phone lookup failed (non-fatal)", error.message); return null; }
  return (data?.phone as string | null) ?? null;
}

async function handleOf(userId: string): Promise<string> {
  const { data, error } = await getServiceClient().from("users").select("handle").eq("id", userId).maybeSingle();
  if (error) { console.error("[transfer] handle lookup failed (non-fatal)", error.message); return "someone"; }
  return (data?.handle as string | null) ?? "someone";
}

/**
 * Notify a phone directly, bypassing every notification preference and follow
 * tier (PRD §6: a transfer SMS goes out regardless). Best-effort — a send
 * failure is logged, never surfaced, because the state transition already
 * committed and must not be rolled back on an SMS hiccup.
 */
async function notify(userId: string, body: string): Promise<void> {
  try {
    const phone = await phoneOf(userId);
    if (!phone) return;
    await getSmsSender().send(phone, body);
  } catch (e) {
    console.error("[transfer] SMS send failed (non-fatal)", e instanceof Error ? e.message : e);
  }
}

/**
 * Send a catch to another buyer. Checks (in order): the caller holds a `held`
 * catch, it has not already completed a hop, the send is ≥30 min before the
 * redemption window closes, and the recipient exists and is not the sender.
 * The catch is moved to `transfer_pending` by a conditional flip that also
 * serves as the mutual-exclusion lock against a concurrent redemption.
 */
export async function createTransfer(
  fromUserId: string,
  catchId: string,
  toHandle: string,
  now: Date = new Date(),
): Promise<TransferSummary> {
  const svc = getServiceClient();

  const { data: catchRow, error: cErr } = await svc
    .from("catches")
    .select("id, user_id, status, transfer_count, expires_at, position_number, drop_id")
    .eq("id", catchId)
    .maybeSingle();
  if (cErr) throw new Error(`load catch failed: ${cErr.message}`);
  // Do not reveal whether the catch exists or belongs to someone else.
  if (!catchRow || catchRow.user_id !== fromUserId) throw new ApiError("NOT_FOUND", "No such catch.");

  // One hop: a catch that has already been accepted once cannot be sent again.
  if ((catchRow.transfer_count as number) >= 1) {
    throw new ApiError("TRANSFER_LIMIT_REACHED", "This catch has already been transferred once.");
  }

  // Send cutoff: ≥30 minutes before the redemption window closes.
  const expiresAt = new Date(catchRow.expires_at as string);
  if (now.getTime() > expiresAt.getTime() - SEND_CUTOFF_MS) {
    throw new ApiError("TRANSFER_CUTOFF_PASSED", "Transfers close 30 minutes before the redemption window.");
  }

  // Recipient, resolved on the confusable-normalized handle. NOT_FOUND when no
  // account matches — the same response an attacker gets for any miss.
  const recipient = await getUserByHandle(toHandle);
  if (!recipient) throw new ApiError("NOT_FOUND", "No such recipient.");
  if (recipient.id === fromUserId) {
    throw new ApiError("VALIDATION_ERROR", "You cannot transfer a catch to yourself.", {
      body: [{ path: "to_handle", message: "self" }],
    });
  }

  // Acquire the catch: held → transfer_pending, conditional. This is the lock.
  // A concurrent redemption (also conditional on status='held') and a second
  // concurrent send both race here; exactly one flips the row and the rest see
  // zero rows.
  const { data: locked, error: lErr } = await svc
    .from("catches")
    .update({ status: "transfer_pending" })
    .eq("id", catchId)
    .eq("status", "held")
    .select("id");
  if (lErr) throw new Error(`acquire catch failed: ${lErr.message}`);
  if (!locked || locked.length === 0) {
    // Not held: already redeemed, already pending a transfer, or expired.
    throw new ApiError("VALIDATION_ERROR", "This catch can no longer be transferred.", {
      body: [{ path: "catch_id", message: "not_held" }],
    });
  }

  const acceptBy = new Date(now.getTime() + ACCEPT_WINDOW_MS).toISOString();
  const { data: transfer, error: tErr } = await svc
    .from("transfers")
    .insert({
      catch_id: catchId,
      from_user_id: fromUserId,
      to_user_id: recipient.id,
      status: "pending",
      sent_at: now.toISOString(),
      accept_by: acceptBy,
    })
    .select("id")
    .single();
  if (tErr) {
    // Roll the catch back to held: we acquired it but failed to record the
    // transfer, so it must not be stranded in transfer_pending.
    const { error: rbErr } = await svc.from("catches").update({ status: "held" }).eq("id", catchId).eq("status", "transfer_pending");
    if (rbErr) throw new Error(`create transfer failed: ${tErr.message}; rollback also failed (catch stranded transfer_pending): ${rbErr.message}`);
    throw new Error(`create transfer failed: ${tErr.message}`);
  }

  // SMS the recipient regardless of their follow tier or SMS preference.
  const fromHandle = await handleOf(fromUserId);
  await notify(
    recipient.id,
    `${fromHandle} sent you position ${catchRow.position_number} of ${(await catchContext(catchId)).drop_title}. It returns to them if you do not accept within 5 minutes.`,
  );

  return { transfer_id: transfer.id as string, to_handle: recipient.handle, status: "pending", accept_by: acceptBy };
}

/**
 * Accept an incoming transfer. Moves catches.user_id to the recipient, sets
 * transfer_count = 1 (blocking any second hop), and returns the catch to `held`
 * so the new holder can redeem. Position travels; NO clout is written (clout is
 * a redemption-only event, keyed to who actually redeems).
 */
export async function acceptTransfer(
  userId: string,
  transferId: string,
  now: Date = new Date(),
): Promise<AcceptResult> {
  const svc = getServiceClient();

  const { data: t, error } = await svc
    .from("transfers")
    .select("id, catch_id, from_user_id, to_user_id, status, accept_by")
    .eq("id", transferId)
    .maybeSingle();
  if (error) throw new Error(`load transfer failed: ${error.message}`);
  if (!t || t.to_user_id !== userId) throw new ApiError("NOT_FOUND", "No such transfer.");

  // Resolve the transfer: pending → accepted, only while inside the window.
  const { data: won, error: uErr } = await svc
    .from("transfers")
    .update({ status: "accepted", resolved_at: now.toISOString() })
    .eq("id", transferId)
    .eq("status", "pending")
    .gt("accept_by", now.toISOString())
    .select("catch_id, from_user_id");
  if (uErr) throw new Error(`accept transfer failed: ${uErr.message}`);

  if (!won || won.length === 0) {
    // Lost the transition: past the accept window, or already resolved. If it is
    // still pending but late, expire it now (return the catch to the sender) so
    // the state is correct even before the next sweeper tick.
    await expireOnePending(transferId, now);
    throw new ApiError("TRANSFER_EXPIRED", "This transfer has expired.");
  }

  const catchId = won[0].catch_id as string;

  // Move the catch to the recipient. transfer_count → 1 (one hop used); status
  // → held. position_number is left untouched (it travels; the permanence
  // trigger would reject any change anyway). Guarded on transfer_pending so a
  // racing void/expire cannot both fire.
  const { data: moved, error: mErr } = await svc
    .from("catches")
    .update({ user_id: userId, transfer_count: 1, status: "held" })
    .eq("id", catchId)
    .eq("status", "transfer_pending")
    .select("position_number");
  if (mErr) throw new Error(`move catch failed: ${mErr.message}`);
  if (!moved || moved.length === 0) {
    // The transfer flipped to accepted but the catch was no longer pending
    // (window closed between the two writes). Treat as expired; do not strand.
    throw new ApiError("TRANSFER_EXPIRED", "This transfer has expired.");
  }

  const ctx = await catchContext(catchId);
  await notify(
    won[0].from_user_id as string,
    `${await handleOf(userId)} accepted position ${ctx.position_number} of ${ctx.drop_title}.`,
  );

  return { transfer_id: transferId, status: "accepted", catch_id: catchId, position_number: moved[0].position_number as number };
}

/**
 * Decline an incoming transfer. Returns the catch to the original holder
 * immediately (status → held, user_id unchanged — it was never moved on send),
 * never to the inventory pool. transfer_count is untouched (0), so the original
 * holder may send it again.
 */
export async function declineTransfer(
  userId: string,
  transferId: string,
  now: Date = new Date(),
): Promise<{ transfer_id: string; status: "declined" }> {
  const svc = getServiceClient();

  const { data: t, error } = await svc
    .from("transfers")
    .select("id, catch_id, from_user_id, to_user_id, status")
    .eq("id", transferId)
    .maybeSingle();
  if (error) throw new Error(`load transfer failed: ${error.message}`);
  if (!t || t.to_user_id !== userId) throw new ApiError("NOT_FOUND", "No such transfer.");

  const { data: won, error: uErr } = await svc
    .from("transfers")
    .update({ status: "declined", resolved_at: now.toISOString() })
    .eq("id", transferId)
    .eq("status", "pending")
    .select("catch_id, from_user_id");
  if (uErr) throw new Error(`decline transfer failed: ${uErr.message}`);
  if (!won || won.length === 0) throw new ApiError("TRANSFER_EXPIRED", "This transfer has expired.");

  const catchId = won[0].catch_id as string;
  // Return to the original holder (user_id was never changed on send).
  const { error: relErr } = await svc.from("catches").update({ status: "held" }).eq("id", catchId).eq("status", "transfer_pending");
  if (relErr) throw new Error(`return declined catch to holder failed (catch stranded transfer_pending): ${relErr.message}`);

  const ctx = await catchContext(catchId);
  await notify(
    won[0].from_user_id as string,
    `${await handleOf(userId)} declined position ${ctx.position_number} of ${ctx.drop_title}. It is back in your wallet.`,
  );

  return { transfer_id: transferId, status: "declined" };
}

/** Pending transfers addressed to a user that are still inside the accept window. */
export async function listIncoming(userId: string, now: Date = new Date()): Promise<IncomingTransfer[]> {
  const { data, error } = await getServiceClient()
    .from("transfers")
    .select("id, sent_at, accept_by, from_user:users!transfers_from_user_id_fkey(handle), catches!inner(position_number, drops!inner(title))")
    .eq("to_user_id", userId)
    .eq("status", "pending")
    .gt("accept_by", now.toISOString())
    .order("sent_at", { ascending: false });
  if (error) throw new Error(`list incoming failed: ${error.message}`);

  return (data ?? []).map((r) => {
    const from = r.from_user as unknown as { handle: string } | null;
    const c = r.catches as unknown as { position_number: number; drops: { title: string } };
    return {
      id: r.id as string,
      from_handle: from?.handle ?? "someone",
      position_number: c.position_number,
      drop_title: c.drops?.title ?? "a drop",
      accept_by: r.accept_by as string,
      sent_at: r.sent_at as string,
    };
  });
}

/**
 * Expire one specific pending transfer if it is past its accept window and the
 * catch's window is still open (return it to the sender as held). Used by the
 * accept path when it loses the race to a lapsed window. Concurrency-safe: the
 * conditional transition means the sweeper and this cannot both act.
 */
async function expireOnePending(transferId: string, now: Date): Promise<void> {
  const svc = getServiceClient();
  const { data: won, error: wErr } = await svc
    .from("transfers")
    .update({ status: "expired", resolved_at: now.toISOString() })
    .eq("id", transferId)
    .eq("status", "pending")
    .lte("accept_by", now.toISOString())
    .select("catch_id");
  if (wErr) throw new Error(`expire-one transfer claim failed: ${wErr.message}`);
  if (won && won.length > 0) {
    // Only return the catch to the sender if its redemption window is still
    // open; if closed, leave it for the void pass (it will be expired, not
    // handed back as a live held catch).
    const { error: cErr } = await svc
      .from("catches")
      .update({ status: "held" })
      .eq("id", won[0].catch_id as string)
      .eq("status", "transfer_pending")
      .gt("expires_at", now.toISOString());
    if (cErr) throw new Error(`return expired catch to sender failed: ${cErr.message}`);
  }
}

export interface SweepResult {
  voided: string[]; // window closed while pending → catch dies with the window
  expired: string[]; // accept window lapsed → catch returned to sender
}

/**
 * The server sweeper (API-CONTRACT §7), run every ~30s by an external ticker in
 * production and by the admin sweep route / the gate here. It replaces every
 * client-side timer: an offline client changes nothing about when a transfer
 * resolves.
 *
 * Two passes, each a conditional transition safe under concurrent sweepers:
 *
 *  1. VOID — pending transfers whose catch redemption window has already closed
 *     (`catches.expires_at <= now`). The catch dies with the window: transfer →
 *     voided, catch → expired. No orphaned held catch. Done FIRST so a transfer
 *     past the window is never handed back to the sender as a live catch.
 *  2. EXPIRE — pending transfers past their 5-minute accept window whose catch
 *     window is still open. transfer → expired, catch → held (back to sender).
 */
export async function runTransferSweep(now: Date = new Date()): Promise<SweepResult> {
  const svc = getServiceClient();
  const nowIso = now.toISOString();
  const voided: string[] = [];
  const expired: string[] = [];

  // --- Pass 1: VOID (window closed while pending). ---
  const { data: voidCandidates, error: vErr } = await svc
    .from("transfers")
    .select("id, catch_id, catches!inner(expires_at)")
    .eq("status", "pending")
    .lte("catches.expires_at", nowIso);
  if (vErr) throw new Error(`sweep void query failed: ${vErr.message}`);
  for (const t of voidCandidates ?? []) {
    const { data: won, error: wErr } = await svc
      .from("transfers")
      .update({ status: "voided", resolved_at: nowIso })
      .eq("id", t.id as string)
      .eq("status", "pending")
      .select("catch_id");
    if (wErr) throw new Error(`sweep void claim failed: ${wErr.message}`);
    if (won && won.length > 0) {
      // Catch dies with the window. transfer_pending → expired (no return path).
      const { error: cErr } = await svc.from("catches").update({ status: "expired" }).eq("id", won[0].catch_id as string).eq("status", "transfer_pending");
      if (cErr) throw new Error(`sweep void catch update failed: ${cErr.message}`);
      voided.push(t.id as string);
    }
  }

  // --- Pass 2: EXPIRE (accept window lapsed, catch window still open). ---
  const { data: expireCandidates, error: eErr } = await svc
    .from("transfers")
    .select("id, catch_id, from_user_id")
    .eq("status", "pending")
    .lte("accept_by", nowIso);
  if (eErr) throw new Error(`sweep expire query failed: ${eErr.message}`);
  for (const t of expireCandidates ?? []) {
    const { data: won, error: wErr } = await svc
      .from("transfers")
      .update({ status: "expired", resolved_at: nowIso })
      .eq("id", t.id as string)
      .eq("status", "pending")
      .select("catch_id, from_user_id");
    if (wErr) throw new Error(`sweep expire claim failed: ${wErr.message}`);
    if (won && won.length > 0) {
      // Return to the original holder (user_id unchanged), never to inventory.
      // No SMS here: the contract lists SMS on send/accept/decline only (a
      // deliberate scope decision, recorded in the report).
      const { error: cErr } = await svc.from("catches").update({ status: "held" }).eq("id", won[0].catch_id as string).eq("status", "transfer_pending");
      if (cErr) throw new Error(`sweep return expired catch to sender failed: ${cErr.message}`);
      expired.push(t.id as string);
    }
  }

  return { voided, expired };
}
