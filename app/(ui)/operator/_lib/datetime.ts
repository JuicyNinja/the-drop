/** datetime-local <-> ISO helpers for the drop forms. The input is the
 *  operator's wall clock; the API takes ISO. Empty means "leave unset". */

export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string | undefined {
  if (!local) return undefined;
  const t = new Date(local).getTime();
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}
