"use client";

/**
 * Recurring-window field (PRD §4.4). The outer date range (redeem_from..until) is
 * the drop's final close and catch expiry; this optional daily window narrows each
 * day to specific weekdays and a daily time range, read in the location's city
 * timezone. No days selected = one continuous window (the fields sit empty and the
 * drop redeems any time inside the outer range).
 *
 * Days are JS day-of-week (0=Sun … 6=Sat) to match the stored `redeem_days`.
 */

const DAYS: { dow: number; label: string }[] = [
  { dow: 0, label: "Su" }, { dow: 1, label: "Mo" }, { dow: 2, label: "Tu" }, { dow: 3, label: "We" },
  { dow: 4, label: "Th" }, { dow: 5, label: "Fr" }, { dow: 6, label: "Sa" },
];

export interface RedeemWindowValue {
  days: number[];
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export function RedeemWindowField({
  value, onChange, disabled = false,
}: {
  value: RedeemWindowValue;
  onChange: (v: RedeemWindowValue) => void;
  disabled?: boolean;
}) {
  const toggle = (dow: number) => {
    const on = value.days.includes(dow);
    onChange({ ...value, days: on ? value.days.filter((d) => d !== dow) : [...value.days, dow].sort((a, b) => a - b) });
  };
  const active = value.days.length > 0;

  return (
    <fieldset className="rw" disabled={disabled}>
      <legend className="rw-legend">Daily window</legend>
      <p className="muted rw-hint">Leave the days empty for a single continuous window. Pick days to repeat a daily time range.</p>
      <div className="rw-days" role="group" aria-label="Days">
        {DAYS.map((d) => (
          <button
            key={d.dow}
            type="button"
            className="rw-day"
            data-on={value.days.includes(d.dow) ? "" : undefined}
            aria-pressed={value.days.includes(d.dow)}
            onClick={() => toggle(d.dow)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="op-form-grid rw-times">
        <div>
          <label htmlFor="rw-start">Opens</label>
          <input id="rw-start" type="time" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} disabled={disabled || !active} />
        </div>
        <div>
          <label htmlFor="rw-end">Closes</label>
          <input id="rw-end" type="time" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} disabled={disabled || !active} />
        </div>
      </div>
    </fieldset>
  );
}

/** Validate + fold the field into request body keys. Returns an error string when
 *  the daily window is partly filled (days without a full time range, or vice
 *  versa) — mirrors the DB `redeem_daily_complete` constraint. `null` days clears
 *  a recurring window (a continuous window). */
export function redeemWindowBody(v: RedeemWindowValue, clearWhenEmpty: boolean):
  { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  const hasDays = v.days.length > 0;
  const hasTimes = Boolean(v.start && v.end);
  if (hasDays !== hasTimes) {
    return { ok: false, error: "A daily window needs both the days and a start and end time." };
  }
  if (hasDays && hasTimes && v.end <= v.start) {
    return { ok: false, error: "The daily window's closing time must be after its opening time." };
  }
  if (hasDays && hasTimes) {
    return { ok: true, body: { redeem_days: v.days, redeem_time_start: v.start, redeem_time_end: v.end } };
  }
  // No daily window: on edit, explicitly clear any prior recurring window.
  return { ok: true, body: clearWhenEmpty ? { redeem_days: null, redeem_time_start: null, redeem_time_end: null } : {} };
}
