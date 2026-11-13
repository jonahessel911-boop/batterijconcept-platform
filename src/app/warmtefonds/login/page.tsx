import { Suspense } from "react";
import { WarmtefondsLoginForm } from "@/components/warmtefonds/WarmtefondsLoginForm";

export const metadata = {
  title: "Inloggen | Warmtefonds-portaal | Batterijconcept",
};

export default function WarmtefondsLoginPage() {
  return (
    <Suspense
      fallback={
        <p className="py-16 text-center text-sm text-muted">Laden…</p>
      }
    >
      <WarmtefondsLoginForm />
    </Suspense>
  );
}
