"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REMEMBER_KEY = "bc_installatie_login_email";

const PANEL_SLIDES = [
  {
    title: "Alles voor je installaties",
    text: "Agenda, orders, team en facturen op één plek — voor jou en je monteurs.",
    image: "/products/battery.png",
    alt: "Thuisbatterij",
  },
  {
    title: "Op pad, altijd up-to-date",
    text: "Bekijk planning, status en klantgegevens live vanaf de bouwplaats.",
    image: "/products/install.png",
    alt: "Installatiemateriaal",
  },
  {
    title: "Samen scherp plannen",
    text: "Koppels, schouw en oplevering in één portaal — zonder heen-en-weer mailen.",
    image: "/products/inverter.png",
    alt: "Omvormer",
  },
] as const;

export function InstallatieLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const claimToken = searchParams.get("token")?.trim() || "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [remember, setRemember] = useState(true);
  const [mode, setMode] = useState<"login" | "claim">(
    claimToken ? "claim" : "login"
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [claimEmail, setClaimEmail] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);

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

  useEffect(() => {
    const id = window.setInterval(() => {
      setSlide((s) => (s + 1) % PANEL_SLIDES.length);
    }, 5200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!claimToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/installatie/${encodeURIComponent(claimToken)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(
            (data as { error?: string }).error ||
              "Deze link is ongeldig of verlopen."
          );
          setMode("login");
          return;
        }
        const mail =
          data.teamgenoot?.email || data.partner?.email || null;
        setClaimEmail(typeof mail === "string" ? mail : null);
        setMode("claim");
      } catch {
        if (!cancelled) {
          setError("Kon de link niet controleren.");
          setMode("login");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimToken]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/installatie/auth/login", {
        method: "POST",
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
      router.replace("/installatie");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function onClaim(e: FormEvent) {
    e.preventDefault();
    if (password !== password2) {
      setError("Wachtwoorden komen niet overeen");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/installatie/auth/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: claimToken, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      router.replace("/installatie");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const active = PANEL_SLIDES[slide];

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Form */}
      <div className="relative flex items-center justify-center bg-white px-6 py-12 sm:px-10">
        <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-2 duration-500">
          <div className="mb-8 flex flex-col items-center text-center">
            <Image
              src="/brands/batterijconcept-mark.png"
              alt="Batterijconcept"
              width={56}
              height={56}
              className="mb-5 h-14 w-14 object-contain"
              priority
            />
            <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-ink">
              {mode === "claim" ? "Account activeren" : "Welkom terug!"}
            </h1>
            <p className="mt-1.5 text-sm text-muted">
              {mode === "claim"
                ? "Kies een wachtwoord voor je installatieportaal"
                : "Vul je gegevens in om door te gaan"}
            </p>
          </div>

          {mode === "claim" ? (
            <form onSubmit={(e) => void onClaim(e)} className="space-y-4">
              {claimEmail ? (
                <p className="rounded-lg bg-green-soft px-3 py-2 text-sm text-green-deeper">
                  Account: <span className="font-medium">{claimEmail}</span>
                </p>
              ) : (
                <p className="text-sm text-muted">
                  Eerste keer inloggen via je link…
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="claim-pw" className="text-ink">
                  Nieuw wachtwoord
                </Label>
                <Input
                  id="claim-pw"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg border-line bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-pw2" className="text-ink">
                  Herhaal wachtwoord
                </Label>
                <Input
                  id="claim-pw2"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="h-11 rounded-lg border-line bg-white"
                />
              </div>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                disabled={saving}
                className="h-11 w-full rounded-lg bg-green-deeper text-[15px] font-medium hover:bg-green-dark"
              >
                {saving ? "Bezig…" : "Wachtwoord opslaan & inloggen →"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted transition-colors hover:text-ink"
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Ik heb al een wachtwoord — naar login
              </button>
            </form>
          ) : (
            <form onSubmit={(e) => void onLogin(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="login-email" className="text-ink">
                  E-mailadres
                </Label>
                <Input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-lg border-line bg-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-pw" className="text-ink">
                  Wachtwoord
                </Label>
                <Input
                  id="login-pw"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-lg border-line bg-white"
                />
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-muted select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="size-4 rounded border-line accent-green-deeper"
                  />
                  Onthoud mij
                </label>
                <a
                  href="mailto:info@batterijconcept.nl?subject=Wachtwoord%20installatieportaal"
                  className="font-medium text-green-deeper transition-colors hover:text-green"
                >
                  Wachtwoord vergeten?
                </a>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button
                type="submit"
                disabled={saving}
                className="h-11 w-full rounded-lg bg-green-deeper text-[15px] font-medium hover:bg-green-dark"
              >
                {saving ? "Bezig…" : "Inloggen →"}
              </Button>

              <p className="pt-2 text-center text-xs leading-relaxed text-muted">
                Door in te loggen ga je akkoord met het gebruik van dit portaal
                voor installatiepartners van Batterijconcept.
              </p>
            </form>
          )}
        </div>
      </div>

      {/* Visual panel */}
      <div className="relative hidden overflow-hidden bg-green-deeper lg:flex lg:items-center lg:justify-center lg:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(26,138,62,0.55), transparent 45%), radial-gradient(circle at 80% 80%, rgba(243,112,33,0.22), transparent 40%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.9) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <div className="w-full overflow-hidden rounded-3xl border border-white/20 bg-white/10 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm animate-in fade-in zoom-in-95 duration-700">
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-white">
              {PANEL_SLIDES.map((item, i) => (
                <div
                  key={item.title}
                  className={`absolute inset-0 transition-opacity duration-700 ${
                    i === slide ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <Image
                    src={item.image}
                    alt={item.alt}
                    fill
                    className="object-contain p-6"
                    sizes="(max-width: 1024px) 0px, 420px"
                    priority={i === 0}
                  />
                </div>
              ))}
            </div>
          </div>

          <div
            key={active.title}
            className="mt-8 max-w-sm text-center animate-in fade-in slide-in-from-bottom-1 duration-500"
          >
            <h2 className="font-display text-2xl font-semibold tracking-tight text-white">
              {active.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/70">
              {active.text}
            </p>
          </div>

          <div className="mt-6 flex items-center gap-2">
            {PANEL_SLIDES.map((item, i) => (
              <button
                key={item.title}
                type="button"
                aria-label={`Slide ${i + 1}`}
                onClick={() => setSlide(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === slide
                    ? "w-7 bg-orange"
                    : "w-1.5 bg-white/35 hover:bg-white/55"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
