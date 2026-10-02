import { Suspense } from "react";
import { CrmShell } from "@/components/crm/CrmShell";
import { CrmPageSkeleton } from "@/components/crm/CrmPageSkeleton";

export default function HomePage() {
  return (
    <Suspense fallback={<CrmPageSkeleton activeTab="projecten" />}>
      <CrmShell />
    </Suspense>
  );
}
