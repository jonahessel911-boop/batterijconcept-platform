"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InstallatiePartnerTeamgenoot } from "@/types/database";
import { INSTALLATIE_MERKEN } from "@/lib/installatie-merken";
import { normalizeMerkenErvaring } from "@/lib/installatie-merken";
import { formatDateShort } from "@/lib/format";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  portalToken: string;
};

type MijnBeoordeling = {
  id: string;
  project_nummer: string | null;
  status: string | null;
  installatie_at: string | null;
  monteur_beoordeling_sterren: number | null;
  monteur_beoordeling_notitie: string | null;
  monteur_beoordeling_door: string | null;
  monteur_beoordeling_op: string | null;
  klantvriendelijkheid_sterren: number | null;
  klantvriendelijkheid_notitie: string | null;
  klantvriendelijkheid_door: string | null;
  leads?: { naam?: string | null; plaats?: string | null } | null;
};

function Stars({ value }: { value: number | null | undefined }) {
  if (value == null) {
    return <span className="text-xs text-muted">Nog geen score</span>;
  }
  return (
    <span className="tabular-nums text-sm font-semibold text-ink" aria-label={`${value} van 5`}>
      {"★".repeat(value)}
      <span className="text-muted">{"★".repeat(Math.max(0, 5 - value))}</span>
      <span className="ml-1.5 text-xs font-medium text-muted">{value}/5</span>
    </span>
  );
}

export function MonteurEigenProfielPanel({ portalToken }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [leeftijd, setLeeftijd] = useState("");
  const [merken, setMerken] = useState<string[]>([]);
  const [hasFoto, setHasFoto] = useState(false);
  const [rolLabel, setRolLabel] = useState("Monteur");
  const [beoordelingen, setBeoordelingen] = useState<MijnBeoordeling[]>([]);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profielRes, scoresRes] = await Promise.all([
        fetch(`/api/installatie/${encodeURIComponent(portalToken)}/profiel`),
        fetch(
          `/api/installatie/${encodeURIComponent(portalToken)}/mijn-beoordelingen`
        ),
      ]);
      const data = await profielRes.json();
      if (!profielRes.ok) throw new Error(data.error || "Laden mislukt");
      const t = data.teamgenoot as InstallatiePartnerTeamgenoot;
      setNaam(t.naam || "");
      setEmail(t.email || "");
      setTelefoon(t.telefoon || "");
      setLeeftijd(t.leeftijd != null ? String(t.leeftijd) : "");
      setMerken(normalizeMerkenErvaring(t.merken_ervaring));
      setHasFoto(Boolean(t.foto_storage_path));
      setRolLabel(t.rol === "beheerder" ? "Beheerder" : "Monteur");

      if (scoresRes.ok) {
        const scores = await scoresRes.json();
        setBeoordelingen((scores.installaties || []) as MijnBeoordeling[]);
      } else {
        setBeoordelingen([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleMerk(merk: string) {
    setMerken((prev) =>
      prev.includes(merk) ? prev.filter((m) => m !== merk) : [...prev, merk]
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/profiel`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telefoon: telefoon.trim() || null,
            leeftijd: leeftijd.trim() || null,
            merken_ervaring: merken,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setOkMsg("Profiel opgeslagen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFoto(file: File) {
    setFotoBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/profiel`,
        { method: "PATCH", body: fd }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Foto upload mislukt");
      setHasFoto(true);
      setOkMsg("Profielfoto opgeslagen");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Foto upload mislukt");
    } finally {
      setFotoBusy(false);
    }
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Laden…</p>;
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {okMsg ? (
        <Alert className="border-green/25 bg-green-soft text-green-dark">
          <AlertDescription className="text-green-dark">
            {okMsg}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-semibold text-ink">
            Mijn profiel
          </CardTitle>
          <CardDescription>
            Vul je leeftijd, merkenervaring en foto zelf in. Naam en rol worden
            door je installatiepartner beheerd.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm">
            <div className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">Naam</dt>
              <dd className="font-medium text-ink">{naam}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">E-mail</dt>
              <dd className="font-medium text-ink">{email || "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">Rol</dt>
              <dd>
                <Badge variant="secondary">{rolLabel}</Badge>
              </dd>
            </div>
          </dl>

          <form onSubmit={(e) => void save(e)} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profiel-telefoon">Telefoon</Label>
              <Input
                id="profiel-telefoon"
                value={telefoon}
                onChange={(e) => setTelefoon(e.target.value)}
                placeholder="Optioneel"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profiel-leeftijd">Leeftijd</Label>
              <Input
                id="profiel-leeftijd"
                type="number"
                min={16}
                max={99}
                value={leeftijd}
                onChange={(e) => setLeeftijd(e.target.value)}
                placeholder="Bijv. 32"
              />
            </div>

            <div className="space-y-2">
              <Label>Ervaring per merk</Label>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                {INSTALLATIE_MERKEN.map((merk) => (
                  <label
                    key={merk}
                    className="inline-flex items-center gap-2 text-sm text-ink"
                  >
                    <Checkbox
                      checked={merken.includes(merk)}
                      onCheckedChange={() => toggleMerk(merk)}
                    />
                    {merk}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Profielfoto</Label>
              <p className="text-xs text-muted">
                {hasFoto
                  ? "Foto aanwezig — upload om te vervangen."
                  : "Nog geen foto."}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={fotoBusy}
                onClick={() => fotoInputRef.current?.click()}
              >
                {fotoBusy ? "Uploaden…" : "Upload foto"}
              </Button>
              <input
                ref={fotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                disabled={fotoBusy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadFoto(file);
                  e.target.value = "";
                }}
              />
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Opslaan…" : "Profiel opslaan"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display text-lg font-semibold text-ink">
            Mijn beoordelingen
          </CardTitle>
          <CardDescription>
            Read-only. Scores van je partner (installatie) en van Batterijconcept
            (klantvriendelijkheid).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {beoordelingen.length === 0 ? (
            <p className="text-sm text-muted">
              Nog geen afgeronde installaties gekoppeld aan jou.
            </p>
          ) : (
            beoordelingen.map((row) => {
              const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
              return (
                <div
                  key={row.id}
                  className="rounded-lg border border-line bg-wash/40 px-3 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">
                      {row.project_nummer || row.id.slice(0, 8)}
                      {lead?.naam ? (
                        <span className="font-normal text-muted">
                          {" "}
                          · {lead.naam}
                        </span>
                      ) : null}
                    </p>
                    {row.installatie_at ? (
                      <span className="text-xs text-muted">
                        {formatDateShort(row.installatie_at)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted">
                        Partner (installatie)
                      </span>
                      <Stars value={row.monteur_beoordeling_sterren} />
                    </div>
                    {row.monteur_beoordeling_notitie?.trim() ? (
                      <p className="text-sm text-ink">
                        {row.monteur_beoordeling_notitie.trim()}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-1.5">
                      <span className="text-xs font-medium text-muted">
                        Klantvriendelijkheid (BC)
                      </span>
                      <Stars value={row.klantvriendelijkheid_sterren} />
                    </div>
                    {row.klantvriendelijkheid_notitie?.trim() ? (
                      <p className="text-sm text-ink">
                        {row.klantvriendelijkheid_notitie.trim()}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
