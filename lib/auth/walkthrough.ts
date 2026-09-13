import { getServiceClient } from "@/lib/supabase/server";

/** Set walkthrough_completed_at once. Both complete and skip call this. */
export async function setWalkthroughDone(userId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getServiceClient()
    .from("users")
    .update({ walkthrough_completed_at: now, updated_at: now })
    .eq("id", userId)
    .is("walkthrough_completed_at", null);
  if (error) throw new Error(`walkthrough update failed: ${error.message}`);
}
