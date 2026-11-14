"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function WerkenbijSolliciteerForm({
  vacatureId,
  vacatureTitel,
}: {
  vacatureId: string;
  vacatureTitel: string;
}) {
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [motivatie, setMotivatie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/werkenbij/solliciteer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vacature_id: vacatureId,
          naam: naam.trim(),
          email: email.trim() || null,
          telefoon: telefoon.trim() || null,
          motivatie: motivatie.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-xl bg-green-soft px-4 py-6 ring-1 ring-green/20">
        <p className="font-display text-lg text-green-deeper">Bedankt!</p>
        <p className="mt-1 text-sm text-muted">
          We hebben je sollicitatie voor <strong>{vacatureTitel}</strong>{" "}
          ontvangen. We nemen zo snel mogelijk contact op.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <p className="font-display text-lg text-ink">Solliciteer</p>
        <p className="text-xs text-muted">
          Vul je gegevens in. We reageren zo snel mogelijk.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wb-naam" className="text-base">
          Naam *
        </Label>
        <Input
          id="wb-naam"
          value={naam}
          onChange={(e) => setNaam(e.target.value)}
          required
          autoComplete="name"
          className="h-14 rounded-xl px-4 text-base md:text-base"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wb-email" className="text-base">
            E-mail
          </Label>
          <Input
            id="wb-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="h-14 rounded-xl px-4 text-base md:text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wb-tel" className="text-base">
            Telefoon
          </Label>
          <Input
            id="wb-tel"
            type="tel"
            value={telefoon}
            onChange={(e) => setTelefoon(e.target.value)}
            autoComplete="tel"
            className="h-14 rounded-xl px-4 text-base md:text-base"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="wb-motivatie" className="text-base">
          Korte motivatie
        </Label>
        <Textarea
          id="wb-motivatie"
          rows={5}
          value={motivatie}
          onChange={(e) => setMotivatie(e.target.value)}
          placeholder="Waarom past deze rol bij jou?"
          className="min-h-32 rounded-xl px-4 py-3 text-base md:text-base"
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={busy || !naam.trim()}>
        {busy ? "Versturen…" : "Sollicitatie versturen"}
      </Button>
    </form>
  );
}
