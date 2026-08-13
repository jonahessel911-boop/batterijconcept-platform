import { Suspense } from "react";
import { LoginForm } from "@/components/crm/LoginForm";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="crm-bg flex min-h-screen items-center justify-center text-sm text-muted">
          Laden…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
