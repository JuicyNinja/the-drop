"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The redemption keypad (DESIGN-SYSTEM §7.2). Four Departure Mono tiles on the
 * board. Uppercase-only; characters outside the 24-symbol alphabet are rejected
 * at the keystroke and never appear. Auto-advance, auto-submit on the fourth
 * character. Each filled tile does a single flap-flip as it takes the character.
 * The operator never enters anything — the buyer types on their own device.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY345679";
const LEN = 4;

export function Keypad({ onComplete, disabled }: { onComplete: (code: string) => void; disabled?: boolean }) {
  const [chars, setChars] = useState<string[]>(Array(LEN).fill(""));
  const [flip, setFlip] = useState<number | null>(null);
  const hidden = useRef<HTMLInputElement>(null);

  useEffect(() => { hidden.current?.focus(); }, []);

  function setValue(raw: string) {
    const filtered = raw.toUpperCase().split("").filter((c) => ALPHABET.includes(c)).slice(0, LEN);
    const next = Array(LEN).fill("").map((_, i) => filtered[i] ?? "");
    const lastFilled = filtered.length - 1;
    if (lastFilled >= 0 && chars[lastFilled] !== next[lastFilled]) {
      setFlip(lastFilled);
      setTimeout(() => setFlip(null), 180);
    }
    setChars(next);
    if (filtered.length === LEN) onComplete(filtered.join(""));
  }

  return (
    <div className="keypad" onClick={() => hidden.current?.focus()}>
      <input
        ref={hidden}
        className="keypad-input"
        inputMode="text"
        autoComplete="off"
        autoCapitalize="characters"
        aria-label="Enter the code"
        maxLength={LEN}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        value={chars.join("")}
      />
      <div className="keypad-tiles" aria-hidden>
        {chars.map((c, i) => (
          <span key={i} className={`keypad-tile data${flip === i ? " sf-flip" : ""}`}>{c || " "}</span>
        ))}
      </div>
    </div>
  );
}
