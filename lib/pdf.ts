import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getServiceClient } from "@/lib/supabase/server";
import { phonetic } from "@/lib/codes";
import { formatRedeemWindow, type RedeemWindow } from "@/lib/window";

/**
 * The printable code sheet (PRD §7.3): one page per live drop at a location,
 * showing the code, phonetic spelling, offer, date, and redemption-window
 * expiration. Taped to the register; staff reads the code aloud.
 */
export async function renderCodeSheet(locationId: string): Promise<Uint8Array> {
  const svc = getServiceClient();
  const { data: locRow, error: locErr } = await svc
    .from("locations")
    .select("name, cities(timezone)")
    .eq("id", locationId)
    .maybeSingle();
  if (locErr) throw new Error(`code sheet location load failed: ${locErr.message}`);
  const tz = ((locRow?.cities as unknown as { timezone: string | null } | null)?.timezone) ?? "America/Denver";
  const { data: drops, error } = await svc
    .from("drops")
    .select("id, code, title, terms, redeem_from, redeem_until, redeem_days, redeem_time_start, redeem_time_end")
    .eq("location_id", locationId)
    .eq("status", "live");
  if (error) throw new Error(`code sheet query failed: ${error.message}`);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  const live = (drops ?? []).filter((d) => d.code);

  const addPage = () => doc.addPage([612, 792]);

  if (live.length === 0) {
    const page = addPage();
    page.drawText("No live drops at this location.", { x: 60, y: 700, size: 18, font, color: muted });
  }

  for (const d of live) {
    const page = addPage();
    const loc = (locRow?.name as string | undefined) ?? "Location";
    page.drawText(loc, { x: 60, y: 730, size: 12, font, color: muted });
    page.drawText(String(d.title ?? ""), { x: 60, y: 700, size: 22, font: bold, color: ink });
    page.drawText("REDEMPTION CODE", { x: 60, y: 620, size: 12, font, color: muted });
    page.drawText(String(d.code), { x: 60, y: 560, size: 72, font: bold, color: ink });
    page.drawText(phonetic(String(d.code)), { x: 60, y: 525, size: 16, font, color: muted });

    // City-local date so the printed range matches the store's wall clock.
    const fmt = (v: unknown) =>
      v ? new Date(v as string).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }) : "—";
    const win: RedeemWindow = {
      redeem_from: (d.redeem_from as string | null) ?? null, redeem_until: (d.redeem_until as string | null) ?? null,
      redeem_days: (d.redeem_days as number[] | null) ?? null,
      redeem_time_start: (d.redeem_time_start as string | null) ?? null, redeem_time_end: (d.redeem_time_end as string | null) ?? null,
    };
    const windowText = formatRedeemWindow(win, tz);
    if (windowText) page.drawText(`Redeem: ${windowText}`, { x: 60, y: 460, size: 14, font: bold, color: ink });
    page.drawText(`Opens ${fmt(d.redeem_from)} · closes ${fmt(d.redeem_until)}`, { x: 60, y: 438, size: 11, font, color: muted });
    if (d.terms) page.drawText(`Terms: ${String(d.terms).slice(0, 90)}`, { x: 60, y: 410, size: 10, font, color: muted });
    page.drawText("The buyer types this code into their own device. Staff never enters anything.", {
      x: 60, y: 80, size: 10, font, color: muted,
    });
  }

  return doc.save();
}
