/** Who did an admin action, for the audit trail. Threaded into every admin
 *  mutation so the write and its audit record can never drift apart. */
export interface AdminActor {
  actorId: string;
  ip: string | null;
}
