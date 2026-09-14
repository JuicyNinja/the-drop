import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getServiceClient } from "@/lib/supabase/server";
import { phonetic } from "@/lib/codes";

/**
 * The printable code sheet (PRD §7.3): one page per live drop at a location,
 * showing the code, phonetic spelling, offer, date, and redemption-window
 * expiration. Taped to the register; staff reads the code aloud.
 */
export async function renderCodeSheet(locationId: string): Promise<Uint8Array> {
  const svc = getServiceClient();
  const { data: locRow } = await svc.from("locations").select("name").eq("id", locationId).maybeSingle();
  const { data: drops, error } = await svc
    .from("drops")
    .select("id, code, title, terms, redeem_from, redeem_until")
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

    const fmt = (v: unknown) => (v ? new Date(v as string).toLocaleString("en-US") : "—");
    page.drawText(`Redemption opens: ${fmt(d.redeem_from)}`, { x: 60, y: 460, size: 12, font, color: ink });
    page.drawText(`Redemption closes: ${fmt(d.redeem_until)}`, { x: 60, y: 440, size: 12, font, color: ink });
    if (d.terms) page.drawText(`Terms: ${String(d.terms).slice(0, 90)}`, { x: 60, y: 410, size: 10, font, color: muted });
    page.drawText("The buyer types this code into their own device. Staff never enters anything.", {
      x: 60, y: 80, size: 10, font, color: muted,
    });
  }

  return doc.save();
}
