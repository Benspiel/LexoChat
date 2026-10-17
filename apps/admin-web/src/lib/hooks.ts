import { useEffect, useRef } from "react";

/** Calls onIdle after `minutes` without keyboard/mouse activity. */
export function useIdleTimeout(minutes: number, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    let timer = window.setTimeout(() => cb.current(), minutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), minutes * 60_000);
    };
    const events = ["mousedown", "keydown", "touchstart", "wheel"] as const;
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, reset));
    };
  }, [minutes]);
}

/** Calls fn every `minutes` while mounted. */
export function useInterval(minutes: number, fn: () => void) {
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => cb.current(), minutes * 60_000);
    return () => window.clearInterval(id);
  }, [minutes]);
}
