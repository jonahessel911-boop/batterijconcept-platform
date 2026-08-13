import { Suspense } from "react";
import { CrmShell } from "@/components/crm/CrmShell";

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="crm-bg flex min-h-screen items-center justify-center text-sm text-muted">
          Laden…
        </div>
      }
    >
      <CrmShell />
    </Suspense>
  );
}
