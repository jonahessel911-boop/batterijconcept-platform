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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

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
    if (!naam.trim()) return;
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
            naam: naam.trim(),
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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="gap-0 overflow-hidden py-0 shadow-xs">
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center justify-between gap-3 text-left transition hover:bg-wash/50",
            compact ? "px-3 py-2.5" : "px-4 py-3"
          )}
        >
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

        <CollapsibleContent>
          <CardContent
            className={cn(
              "space-y-4 border-t border-line",
              compact ? "p-3" : "px-4 py-4"
            )}
          >
            <form
              onSubmit={(e) => void addKoppel(e)}
              className="grid gap-3 sm:grid-cols-2"
            >
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="kp-naam">Naam koppel *</Label>
                <Input
                  id="kp-naam"
                  required
                  value={naam}
                  onChange={(e) => setNaam(e.target.value)}
                  placeholder="Bijv. Team Noord · Ahmed & Youssef"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kp-m1">Monteur 1</Label>
                <NativeSelect
                  id="kp-m1"
                  className="w-full"
                  value={m1}
                  onChange={(e) => setM1(e.target.value)}
                >
                  <NativeSelectOption value="">— Kies —</NativeSelectOption>
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
                <Label htmlFor="kp-m2">Monteur 2</Label>
                <NativeSelect
                  id="kp-m2"
                  className="w-full"
                  value={m2}
                  onChange={(e) => setM2(e.target.value)}
                >
                  <NativeSelectOption value="">— Kies —</NativeSelectOption>
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
              <div className="sm:col-span-2">
                <Button type="submit" disabled={saving || !naam.trim()}>
                  {saving ? "Bezig…" : "+ Koppel toevoegen"}
                </Button>
              </div>
            </form>

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
                Nog geen koppels — voeg eerst monteurs toe, daarna een koppel
                van twee.
              </p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-8 px-3 text-[11px] font-medium text-muted">
                        Koppel
                      </TableHead>
                      <TableHead className="h-8 px-3 text-[11px] font-medium text-muted">
                        Monteurs
                      </TableHead>
                      <TableHead className="h-8 px-3 text-right text-[11px] font-medium text-muted">
                        Acties
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((k) => {
                      const inactive = k.actief === false;
                      const n1 =
                        k.monteur_1?.naam ||
                        teamgenoten.find((t) => t.id === k.monteur_1_id)
                          ?.naam ||
                        "—";
                      const n2 =
                        k.monteur_2?.naam ||
                        teamgenoten.find((t) => t.id === k.monteur_2_id)
                          ?.naam ||
                        "—";
                      return (
                        <TableRow
                          key={k.id}
                          className={inactive ? "bg-wash/40 text-muted" : ""}
                        >
                          <TableCell className="px-3 py-2.5 font-medium whitespace-normal text-ink">
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{k.naam}</span>
                              {inactive ? (
                                <Badge
                                  variant="outline"
                                  className="text-muted"
                                >
                                  Inactief
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-normal text-muted">
                            {n1} + {n2}
                          </TableCell>
                          <TableCell className="px-3 py-2.5">
                            <div className="flex flex-wrap items-center justify-end gap-1">
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
                                onClick={() => void remove(k.id, k.naam)}
                              >
                                Verwijderen
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
