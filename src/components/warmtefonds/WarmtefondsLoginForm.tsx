"use client";

import { FormEvent, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REMEMBER_KEY = "bc_warmtefonds_login_email";

function goToPortal(path: string) {
  window.location.assign(path);
}

export function WarmtefondsLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/warmtefonds/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inloggen mislukt");
      try {
        if (remember) localStorage.setItem(REMEMBER_KEY, email.trim());
        else localStorage.removeItem(REMEMBER_KEY);
      } catch {
        /* ignore */
      }
      const redirect =
        typeof data.redirect === "string"
          ? data.redirect
          : data.portal_token
            ? `/warmtefonds/${data.portal_token}`
            : "/warmtefonds/login";
      goToPortal(redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f7f6] lg:flex-row">
      <div className="relative hidden flex-1 overflow-hidden bg-green-dark lg:block">
        <div className="relative z-10 flex h-full flex-col justify-end p-10 text-white">
          <p className="text-xs text-white/50">Batterijconcept</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="font-display text-2xl font-semibold text-ink">
            Inloggen
          </h2>
          <p className="mt-1 text-sm text-muted">
            Gebruik de e-mail en het wachtwoord uit je uitnodiging.
          </p>

          <form onSubmit={onLogin} className="mt-6 space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="wf-email">E-mail</Label>
              <Input
                id="wf-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-password">Wachtwoord</Label>
              <Input
                id="wf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 accent-green"
              />
              E-mail onthouden
            </label>
            <Button
              type="submit"
              disabled={saving}
              className="w-full bg-green-dark hover:bg-green-deeper"
            >
              {saving ? "Bezig…" : "Inloggen"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
