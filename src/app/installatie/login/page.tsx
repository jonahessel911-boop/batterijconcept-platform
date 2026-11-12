import { Suspense } from "react";
import { InstallatieLoginForm } from "@/components/installatie/InstallatieLoginForm";

export const metadata = {
  title: "Inloggen | Installatieportaal | Batterijconcept",
};

export default function InstallatieLoginPage() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <InstallatieLoginForm />
    </Suspense>
  );
}
