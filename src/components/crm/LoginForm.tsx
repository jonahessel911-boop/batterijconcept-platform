"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inloggen mislukt");
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crm-bg flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md border border-line bg-white">
        <div className="border-b border-line bg-green-dark px-6 py-5">
          <p className="font-display text-lg font-semibold tracking-tight text-white">
            Batterij<span className="text-orange">concept</span>
            <span className="ml-2 text-[10px] font-medium uppercase tracking-[0.16em] text-white/50">
              CRM
            </span>
          </p>
          <p className="mt-1 text-sm text-white/70">Log in met je teamaccount</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 p-6">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            E-mail
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Wachtwoord
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green"
            />
          </label>

          {error && (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Inloggen"}
          </button>
        </form>
      </div>
    </div>
  );
}
