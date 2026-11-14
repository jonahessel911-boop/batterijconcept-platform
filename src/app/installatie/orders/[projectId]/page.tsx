import { Suspense } from "react";
import { InstallatieOrderDetailPage } from "@/components/installatie/InstallatieOrderDetailPage";

export const metadata = {
  title: "Order | Installatieportaal",
};

export default function Page() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <InstallatieOrderDetailPage apiToken="session" />
    </Suspense>
  );
}
