import { Suspense } from "react";
import { ProjectPage } from "@/components/crm/ProjectPage";

export default function ProjectDetailRoute() {
  return (
    <Suspense
      fallback={
        <p className="py-20 text-center text-sm text-muted">Project laden…</p>
      }
    >
      <ProjectPage />
    </Suspense>
  );
}
