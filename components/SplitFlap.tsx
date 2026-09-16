"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The split-flap (DESIGN-SYSTEM §6). Real motion in exactly one component, used
 * in exactly three moments (board arrival, catch confirmation, Gone) — never on
 * load, scroll, or hover. One character per tile: 180ms flip, 40ms stagger left
 * to right, 3–5 random intermediate characters from the code alphabet before
 * settling. `prefers-reduced-motion` sets instantly with no intermediates, and
 * the state still registers.
 *
 * The horizontal split line at rest is what identifies a tile as a flap before
 * it ever moves.
 */

const CODE_ALPHABET = "ACDEFGHJKMNPQRTUVWXY345679";
const DIGITS = "0123456789";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Tile({ target, charset, delay, run }: { target: string; charset: string; delay: number; run: number }) {
  // `anim` holds the transient intermediate character while a flip is in flight;
  // null means at rest, and rest renders `target` directly. Keeping the resting
  // value out of state means the effect never sets state synchronously — it only
  // schedules timers — while a reduced-motion or run===0 tile still shows the
  // correct character instantly.
  const [anim, setAnim] = useState<string | null>(null);
  const [flipping, setFlipping] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (run === 0 || prefersReducedMotion()) {
      return; // rest: render shows `target`; the state change registers immediately
    }
    const frames = 3 + Math.floor(Math.random() * 3); // 3–5 intermediates
    const start = () => {
      let i = 0;
      const tick = () => {
        setFlipping(true);
        if (i < frames) {
          setAnim(charset[Math.floor(Math.random() * charset.length)]);
          i += 1;
          timers.current.push(setTimeout(tick, 180 / frames));
        } else {
          setAnim(null);
          timers.current.push(setTimeout(() => setFlipping(false), 90));
        }
      };
      tick();
    };
    timers.current.push(setTimeout(start, delay));
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, run]);

  return (
    <span className={`sf-tile${flipping ? " sf-flip" : ""}`} aria-hidden>
      {anim ?? target}
    </span>
  );
}

export function SplitFlap({
  value,
  charset = "code",
  run = 0,
  className = "",
  ariaLabel,
}: {
  value: string;
  /** which alphabet the intermediate frames draw from */
  charset?: "code" | "digits";
  /** bump this to trigger a flip; 0 renders at rest (no animation) */
  run?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const alphabet = charset === "digits" ? DIGITS : CODE_ALPHABET;
  const chars = value.split("");
  return (
    <span className={`sf ${className}`} role="text" aria-label={ariaLabel ?? value}>
      {chars.map((c, i) => (
        <Tile key={i} target={c} charset={alphabet} delay={i * 40} run={run} />
      ))}
    </span>
  );
}
