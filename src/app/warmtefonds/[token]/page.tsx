import { Suspense } from "react";
import { WarmtefondsPortalPage } from "@/components/warmtefonds/WarmtefondsPortalPage";

export const metadata = {
  title: "Warmtefonds-portaal | Batterijconcept",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <WarmtefondsPortalPage />
    </Suspense>
  );
}
