"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Rendert children pas na mount. Voorkomt hydration-mismatches door
 * browser-extensies die attributen injecteren (o.a. bis_skin_checked).
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}
