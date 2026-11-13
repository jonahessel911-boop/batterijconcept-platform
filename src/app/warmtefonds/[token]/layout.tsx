import type { ReactNode } from "react";

/**
 * Voorkomt horizontale “half-swipe” op telefoon (iOS overscroll / body-pan).
 */
export default function WarmtefondsTokenLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="wf-portal-shell relative max-w-[100vw] overflow-x-hidden overscroll-x-none touch-pan-y">
      {children}
    </div>
  );
}
