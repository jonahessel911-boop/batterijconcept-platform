import { Suspense } from "react";
import { WarmtefondsOrderDetailPage } from "@/components/warmtefonds/WarmtefondsOrderDetailPage";

export const metadata = {
  title: "Warmtefonds-aanvraag | Batterijconcept",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <WarmtefondsOrderDetailPage />
    </Suspense>
  );
}
