"use client";
// One-time entrance motion (DESIGN.md §6): numbers count up, charts draw in. Rows fade up via the `stagger` /
// `enter-up` classes in tokens.css.
// Runs once per mount; later updates tween briefly (state change) or not at all. Reduced motion → final state only.
import { useEffect, useRef, useState } from "react";

const prefersReduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts from 0 to `value` on first render (~700ms), then tweens between values (~250ms). */
export function useCountUp(value: number, { duration = 700, update = 250 } = {}): number {
  const [shown, setShown] = useState(() => (prefersReduced() ? value : 0));
  const from = useRef(prefersReduced() ? value : 0);
  const first = useRef(true);

  useEffect(() => {
    if (prefersReduced()) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const ms = first.current ? duration : update;
    first.current = false;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const v = a + (value - a) * easeOut(p);
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, update]);

  return shown;
}

/** Recharts props: draw in once (lines stroke, bars grow from the baseline), never replay on data updates. */
export function useChartEntrance(duration = 600) {
  const [done, setDone] = useState(() => prefersReduced());
  return {
    isAnimationActive: !done,
    animationDuration: duration,
    animationEasing: "ease-out" as const,
    onAnimationEnd: () => setDone(true),
  };
}
