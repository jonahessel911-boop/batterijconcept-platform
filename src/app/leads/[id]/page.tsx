import { Suspense } from "react";
import { LeadPage } from "@/components/crm/LeadPage";

export default function LeadDetailRoute() {
  return (
    <Suspense
      fallback={
        <p className="py-20 text-center text-sm text-muted">Lead laden…</p>
      }
    >
      <LeadPage />
    </Suspense>
  );
}
