"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emptyMonteurProfielDraft,
  MonteurProfielFields,
  type MonteurProfielDraft,
} from "@/components/installatie/MonteurProfielFields";

type Props = {
  portalToken: string;
  onBack: () => void;
  onCreated?: (info: {
    naam: string;
    email: string | null;
    inviteSent: boolean;
    inviteError?: string | null;
  }) => void;
};

export function NieuweMonteurPage({
  portalToken,
  onBack,
  onCreated,
}: Props) {
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [draft, setDraft] = useState<MonteurProfielDraft>(
    emptyMonteurProfielDraft()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim() || !email.trim()) return;
    if (!draft.kan_schouw && !draft.kan_installatie) {
      setError("Vink minstens Schouw of Installatie aan.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam: naam.trim(),
            email: email.trim(),
            telefoon: telefoon.trim() || null,
            rol: draft.rol,
            kan_schouw: draft.kan_schouw,
            kan_installatie: draft.kan_installatie,
            regios: draft.regios,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      const tg = data.teamgenoot as
        | { naam?: string; email?: string | null }
        | undefined;
      onCreated?.({
        naam: tg?.naam || naam.trim(),
        email: tg?.email || email.trim(),
        inviteSent: Boolean(data.invite_sent),
        inviteError:
          typeof data.invite_error === "string" ? data.invite_error : null,
      });
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#F7F9F7]">
      <header className="shrink-0 border-b border-line bg-white">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onBack}
            className="gap-1.5"
          >
            <ArrowLeft className="size-4" />
            Terug
          </Button>
          <div className="min-w-0">
            <h1 className="font-display text-lg font-semibold text-ink">
              Nieuwe monteur
            </h1>
            <p className="truncate text-xs text-muted">
              Naam + e-mail · krijgt inlogmail · vult zelf leeftijd, merken en
              foto in
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <form
          onSubmit={(e) => void submit(e)}
          className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 sm:px-6"
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 rounded-xl border border-line bg-white p-4 shadow-xs sm:grid-cols-2 sm:p-6">
            <div className="space-y-1.5">
              <Label htmlFor="nieuw-monteur-naam">Naam *</Label>
              <Input
                id="nieuw-monteur-naam"
                required
                autoFocus
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                placeholder="Bijv. Mohammed Ahmed"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nieuw-monteur-email">E-mail *</Label>
              <Input
                id="nieuw-monteur-email"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voor inlogmail"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nieuw-monteur-telefoon">Telefoon</Label>
              <Input
                id="nieuw-monteur-telefoon"
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                placeholder="Optioneel"
              />
            </div>
            <div className="sm:col-span-2">
              <MonteurProfielFields
                value={draft}
                onChange={setDraft}
                disabled={saving}
                mode="partner"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pb-8">
            <Button
              type="submit"
              size="lg"
              disabled={saving || !naam.trim() || !email.trim()}
              className="h-11 px-5"
            >
              {saving ? "Bezig…" : "Toevoegen + stuur inlogmail"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={saving}
              onClick={onBack}
              className="h-11 px-5"
            >
              Annuleren
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
