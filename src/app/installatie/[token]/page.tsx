import { Suspense } from "react";
import { InstallatieOrdersPage } from "@/components/installatie/InstallatieOrdersPage";

export const metadata = {
  title: "Installatieportaal | Batterijconcept",
};

/** Portaallink met token — geen wachtwoord-login verplicht. */
export default async function InstallatieTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <InstallatieOrdersPage apiToken={token} />
    </Suspense>
  );
}
