import { Suspense } from "react";
import { InstallatieOrdersPage } from "@/components/installatie/InstallatieOrdersPage";

export const metadata = {
  title: "Installatieportaal | Batterijconcept",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <InstallatieOrdersPage />
    </Suspense>
  );
}
