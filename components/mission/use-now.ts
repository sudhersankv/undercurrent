"use client";

import { useEffect, useState } from "react";

/** Re-render every `ms` (0 = never) for relative times. */
export function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ms) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
