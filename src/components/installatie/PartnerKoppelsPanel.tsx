"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type {
  InstallatiePartnerKoppel,
  InstallatiePartnerTeamgenoot,
} from "@/types/database";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { koppelWeergaveNaam } from "@/lib/installatie-koppel";

function Notice({
  tone,
  compact = false,
  children,
}: {
  tone: "error" | "ok" | "warn";
  compact?: boolean;
  children: ReactNode;
}) {
  const toneClass =
    tone === "ok"
      ? "border-green/25 bg-green-soft text-green-dark"
      : tone === "warn"
        ? "border-[#E8D48B] bg-[#FFFBEB] text-[#92400E]"
        : "";
  return (
    <Alert
      variant={tone === "error" ? "destructive" : "default"}
      className={[toneClass, compact ? "py-1.5 text-xs" : ""].join(" ")}
    >
      <AlertDescription
        className={tone === "error" ? undefined : "text-inherit"}
      >
        {children}
      </AlertDescription>
    </Alert>
  );
}

type Props = {
  portalToken: string;
  teamgenoten: InstallatiePartnerTeamgenoot[];
  compact?: boolean;
};

export function PartnerKoppelsPanel({
  portalToken,
  teamgenoten,
  compact = false,
}: Props) {
  const [items, setItems] = useState<InstallatiePartnerKoppel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [naam, setNaam] = useState("");
  const [m1, setM1] = useState("");
  const [m2, setM2] = useState("");
  const [open, setOpen] = useState(true);
  const [nieuwOpen, setNieuwOpen] = useState(false);
  const [openKoppelId, setOpenKoppelId] = useState<string | null>(null);

  const actieveMonteurs = teamgenoten.filter(
    (t) => t.actief !== false && t.kan_installatie !== false
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/koppels`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.koppels || []) as InstallatiePartnerKoppel[]);
      if (data.migration_required && data.hint) setHint(data.hint);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [portalToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addKoppel(e: React.FormEvent) {
    e.preventDefault();
    if (!m1 || !m2) {
      setError("Kies twee monteurs");
      return;
    }
    if (m1 === m2) {
      setError("Kies twee verschillende monteurs");
      return;
    }
    const n1 = actieveMonteurs.find((t) => t.id === m1)?.naam || "";
    const n2 = actieveMonteurs.find((t) => t.id === m2)?.naam || "";
    const koppelNaam =
      naam.trim() || (n1 && n2 ? `${n1} · ${n2}` : n1 || n2 || "Koppel");
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/koppels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            naam: koppelNaam,
            monteur_1_id: m1 || null,
            monteur_2_id: m2 || null,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      setNaam("");
      setM1("");
      setM2("");
      setNieuwOpen(false);
      setOkMsg(`Koppel “${data.koppel.naam}” toegevoegd`);
      setOpen(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function patchKoppel(
    id: string,
    body: Record<string, unknown>,
    ok: string
  ) {
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/koppels`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...body }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setItems((list) =>
        list.map((k) =>
          k.id === id ? { ...k, ...(data.koppel as InstallatiePartnerKoppel) } : k
        )
      );
      setOkMsg(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Opslaan mislukt");
    }
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Koppel “${label}” verwijderen?`)) return;
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(portalToken)}/koppels?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
      setItems((list) => list.filter((k) => k.id !== id));
      setOkMsg("Koppel verwijderd");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verwijderen mislukt");
    }
  }

  const actiefCount = items.filter((k) => k.actief !== false).length;

  function koppelLabel(k: InstallatiePartnerKoppel) {
    const fromMons = koppelWeergaveNaam(k);
    if (fromMons && fromMons !== "Koppel") return fromMons;
    return (k.naam || "").trim() || "Koppel";
  }

  return (
    <>
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <div
          className={cn(
            "flex items-center gap-2",
            compact ? "px-3 py-2" : "px-4 py-2.5"
          )}
        >
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition hover:opacity-80">
            <span className="min-w-0">
              <span
                className={cn(
                  "block font-semibold text-ink",
                  compact
                    ? "text-[11px] uppercase tracking-wide text-muted"
                    : "font-display text-base"
                )}
              >
                Installatiekoppels
              </span>
              {!compact ? (
                <span className="mt-0.5 block text-sm text-muted">
                  Twee monteurs vormen één koppel · telt mee voor capaciteit
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {!loading ? (
                <Badge variant="secondary" className="rounded-full text-[11px]">
                  {actiefCount} actief
                </Badge>
              ) : null}
              <ChevronDown
                className={cn(
                  "size-4 text-muted transition-transform",
                  open && "rotate-180"
                )}
              />
            </span>
          </CollapsibleTrigger>
          <Button
            type="button"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => {
              setError(null);
              setNieuwOpen(true);
            }}
          >
            Nieuw koppel
          </Button>
        </div>

        <CollapsibleContent>
          <CardContent
            className={cn(
              "space-y-3 border-t border-line",
              compact ? "p-3" : "px-4 py-4"
            )}
          >
            {hint ? (
              <Notice tone="warn" compact>
                {hint}
              </Notice>
            ) : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {okMsg ? <Notice tone="ok">{okMsg}</Notice> : null}

            {loading ? (
              <p className="py-4 text-center text-sm text-muted">Laden…</p>
            ) : items.length === 0 ? (
              <p className="py-2 text-sm text-muted">
                Nog geen koppels — klik op Nieuw koppel.
              </p>
            ) : (
              <div className="space-y-2">
                {items.map((k) => {
                  const inactive = k.actief === false;
                  const itemOpen = openKoppelId === k.id;
                  return (
                    <Collapsible
                      key={k.id}
                      open={itemOpen}
                      onOpenChange={(next) =>
                        setOpenKoppelId(next ? k.id : null)
                      }
                    >
                      <div
                        className={cn(
                          "overflow-hidden rounded-lg border border-line",
                          inactive && "bg-wash/40"
                        )}
                      >
                        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-wash/50">
                          <span className="min-w-0">
                            <span
                              className={cn(
                                "block text-sm font-medium text-ink",
                                inactive && "text-muted line-through"
                              )}
                            >
                              {koppelLabel(k)}
                            </span>
                            {k.naam?.trim() &&
                            koppelLabel(k) !== k.naam.trim() ? (
                              <span className="mt-0.5 block truncate text-[11px] text-muted">
                                {k.naam}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {inactive ? (
                              <Badge variant="outline" className="text-muted">
                                Inactief
                              </Badge>
                            ) : null}
                            <ChevronDown
                              className={cn(
                                "size-4 text-muted transition-transform",
                                itemOpen && "rotate-180"
                              )}
                            />
                          </span>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="space-y-3 border-t border-line px-3 py-3">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1.5 sm:col-span-2">
                                <Label>Naam</Label>
                                <Input
                                  defaultValue={k.naam}
                                  onBlur={(e) => {
                                    const next = e.target.value.trim();
                                    if (next && next !== k.naam) {
                                      void patchKoppel(
                                        k.id,
                                        { naam: next },
                                        "Naam opgeslagen"
                                      );
                                    }
                                  }}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label>Monteur 1</Label>
                                <NativeSelect
                                  className="w-full"
                                  value={k.monteur_1_id || ""}
                                  onChange={(e) =>
                                    void patchKoppel(
                                      k.id,
                                      { monteur_1_id: e.target.value || null },
                                      "Monteur 1 opgeslagen"
                                    )
                                  }
                                >
                                  <NativeSelectOption value="">
                                    — Kies —
                                  </NativeSelectOption>
                                  {actieveMonteurs.map((t) => (
                                    <NativeSelectOption
                                      key={t.id}
                                      value={t.id}
                                      disabled={t.id === k.monteur_2_id}
                                    >
                                      {t.naam}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </div>
                              <div className="space-y-1.5">
                                <Label>Monteur 2</Label>
                                <NativeSelect
                                  className="w-full"
                                  value={k.monteur_2_id || ""}
                                  onChange={(e) =>
                                    void patchKoppel(
                                      k.id,
                                      { monteur_2_id: e.target.value || null },
                                      "Monteur 2 opgeslagen"
                                    )
                                  }
                                >
                                  <NativeSelectOption value="">
                                    — Kies —
                                  </NativeSelectOption>
                                  {actieveMonteurs.map((t) => (
                                    <NativeSelectOption
                                      key={t.id}
                                      value={t.id}
                                      disabled={t.id === k.monteur_1_id}
                                    >
                                      {t.naam}
                                    </NativeSelectOption>
                                  ))}
                                </NativeSelect>
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1">
                              {inactive ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="xs"
                                  onClick={() =>
                                    void patchKoppel(
                                      k.id,
                                      { actief: true },
                                      "Actief"
                                    )
                                  }
                                >
                                  Activeren
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  onClick={() =>
                                    void patchKoppel(
                                      k.id,
                                      { actief: false },
                                      "Gedeactiveerd"
                                    )
                                  }
                                >
                                  Deactiveren
                                </Button>
                              )}
                              <Button
                                type="button"
                                variant="destructive"
                                size="xs"
                                onClick={() =>
                                  void remove(k.id, koppelLabel(k))
                                }
                              >
                                Verwijderen
                              </Button>
                            </div>
                          </div>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>

    <Dialog
      open={nieuwOpen}
      onOpenChange={(next) => {
        setNieuwOpen(next);
        if (!next) {
          setNaam("");
          setM1("");
          setM2("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!saving}>
        <form
          onSubmit={(e) => void addKoppel(e)}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Nieuw koppel</DialogTitle>
            <DialogDescription>
              Kies twee monteurs. De naam mag leeg — dan gebruiken we hun namen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="kp-naam">Naam (optioneel)</Label>
            <Input
              id="kp-naam"
              value={naam}
              onChange={(e) => setNaam(e.target.value)}
              placeholder="Bijv. Team Noord"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kp-m1">Monteur 1 *</Label>
              <NativeSelect
                id="kp-m1"
                className="w-full"
                value={m1}
                onChange={(e) => setM1(e.target.value)}
                required
              >
                <NativeSelectOption value="">Kies…</NativeSelectOption>
                {actieveMonteurs.map((t) => (
                  <NativeSelectOption
                    key={t.id}
                    value={t.id}
                    disabled={t.id === m2}
                  >
                    {t.naam}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kp-m2">Monteur 2 *</Label>
              <NativeSelect
                id="kp-m2"
                className="w-full"
                value={m2}
                onChange={(e) => setM2(e.target.value)}
                required
              >
                <NativeSelectOption value="">Kies…</NativeSelectOption>
                {actieveMonteurs.map((t) => (
                  <NativeSelectOption
                    key={t.id}
                    value={t.id}
                    disabled={t.id === m1}
                  >
                    {t.naam}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setNieuwOpen(false)}
            >
              Annuleren
            </Button>
            <Button type="submit" disabled={saving || !m1 || !m2}>
              {saving ? "Bezig…" : "Koppel maken"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}
