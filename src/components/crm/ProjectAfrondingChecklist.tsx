"use client";

import { useEffect, useState } from "react";
import type { Project } from "@/types/database";
import { Check } from "lucide-react";
import {
  isMonteurBeoordelingGezet,
} from "@/lib/backoffice-acties";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import { normalizeProjectStatus } from "@/lib/labels";
import { toOperationalStatus } from "@/lib/project-status-config";
import { formatDateTimeNl } from "@/lib/format";

const SHOW_FROM = new Set([
  "installatie_ingepland",
  "installatie_voltooid",
  "after_sale",
  "review_gevraagd",
  "afgerond",
  "service",
]);

export type AfterSaleItemId =
  | "overstap_dynamische_leverancier_at"
  | "btw_terugvragen_aangevraagd_at"
  | "review_gevraagd_at";

export type AfterSaleCheckId = AfterSaleItemId | "monteur_beoordeling";

const ITEMS: {
  id: AfterSaleItemId;
  label: string;
  detail: string;
}[] = [
  {
    id: "overstap_dynamische_leverancier_at",
    label: "Dynamische energie-overstap",
    detail:
      "Stuur de Batterijconcept × Frank Energie-mail naar de klant.",
  },
  {
    id: "btw_terugvragen_aangevraagd_at",
    label: "BTW terugvrage starten",
    detail: "Start de BTW-terugvrage voor deze order.",
  },
  {
    id: "review_gevraagd_at",
    label: "Review vragen",
    detail: "Stuur de Trustpilot-link naar de klant.",
  },
];

function isDone(project: Project, id: AfterSaleItemId): boolean {
  return Boolean(project[id]);
}

function allAfterSaleDone(
  project: Project,
  override?: Partial<Record<AfterSaleItemId, string | null>> & {
    monteur_beoordeling_sterren?: number | null;
  }
): boolean {
  const btw =
    override && "btw_terugvragen_aangevraagd_at" in override
      ? override.btw_terugvragen_aangevraagd_at
      : project.btw_terugvragen_aangevraagd_at;
  const overstap =
    override && "overstap_dynamische_leverancier_at" in override
      ? override.overstap_dynamische_leverancier_at
      : project.overstap_dynamische_leverancier_at;
  const review =
    override && "review_gevraagd_at" in override
      ? override.review_gevraagd_at
      : project.review_gevraagd_at;
  const sterren =
    override && "monteur_beoordeling_sterren" in override
      ? override.monteur_beoordeling_sterren
      : project.monteur_beoordeling_sterren;
  return Boolean(
    btw &&
      overstap &&
      review &&
      isMonteurBeoordelingGezet({ monteur_beoordeling_sterren: sterren })
  );
}

function AfterSaleStars({
  value,
  onPick,
  disabled,
}: {
  value: number | null;
  onPick: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5">
      {[0, 1, 2, 3, 4, 5].map((n) => {
        if (n === 0) {
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              title="0 sterren"
              onClick={() => onPick(0)}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center border text-[11px] font-semibold disabled:opacity-50",
                value === 0
                  ? "border-line bg-wash text-ink"
                  : "border-line bg-white text-muted hover:bg-wash"
              )}
            >
              0
            </button>
          );
        }
        const filled = value != null && value >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            title={`${n} ster${n === 1 ? "" : "ren"}`}
            onClick={() => onPick(n)}
            className={cn(
              "inline-flex h-8 min-w-8 items-center justify-center border text-sm leading-none disabled:opacity-50",
              filled
                ? "border-[#D97706] bg-[#FFFBEB] text-[#B45309]"
                : "border-line bg-white text-muted hover:border-[#D97706]/50 hover:text-[#B45309]"
            )}
          >
            ★
          </button>
        );
      })}
      <span className="ml-1.5 text-[12px] text-muted">
        {value == null ? "Nog geen score" : `${value} / 5`}
      </span>
    </div>
  );
}

function overstapLeverancierLabel(project: Project): string | null {
  if (project.energie_overstap_leverancier === "frank") return "Frank Energie";
  if (project.energie_overstap_leverancier === "next_energy") {
    return "Next Energy";
  }
  return null;
}

function leadEmail(project: Project): string | null {
  const raw = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  return raw?.email?.trim() || null;
}

export function afterSaleChecklistItems(project: Project): {
  id: AfterSaleCheckId;
  label: string;
  detail: string;
  done: boolean;
}[] {
  const lev = overstapLeverancierLabel(project);
  const checks = ITEMS.map((item) => {
    if (item.id === "overstap_dynamische_leverancier_at") {
      return {
        ...item,
        detail: lev
          ? `Stuur de Batterijconcept × Frank-mail (${lev}).`
          : item.detail,
        done: isDone(project, item.id),
      };
    }
    return { ...item, done: isDone(project, item.id) };
  });
  checks.push({
    id: "monteur_beoordeling",
    label: "Beoordeling monteur",
    detail:
      "0–5 sterren + notitie. De installatiepartner ziet dit.",
    done: isMonteurBeoordelingGezet(project),
  });
  return checks;
}

export function showProjectAfronding(project: Project): boolean {
  const op = toOperationalStatus(project.status);
  return SHOW_FROM.has(op);
}

export function ProjectAfrondingChecklist({
  project,
  onUpdated,
  compact = false,
  authorNaam = null,
}: {
  project: Project;
  onUpdated?: (p: Project) => void;
  compact?: boolean;
  authorNaam?: string | null;
}) {
  const [busy, setBusy] = useState<AfterSaleItemId | "monteur_beoordeling" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<AfterSaleItemId | null>(null);
  const [optimisticDone, setOptimisticDone] = useState<Set<AfterSaleItemId>>(
    () => new Set()
  );
  const [noteDraft, setNoteDraft] = useState(
    () => project.monteur_beoordeling_notitie || ""
  );

  useEffect(() => {
    setNoteDraft(project.monteur_beoordeling_notitie || "");
  }, [project.id, project.monteur_beoordeling_notitie]);

  if (!showProjectAfronding(project)) return null;

  const status = normalizeProjectStatus(project.status);
  const isAfterSale = status === "afgerond";
  const items = afterSaleChecklistItems(project);
  const email = leadEmail(project);
  const sterren =
    typeof project.monteur_beoordeling_sterren === "number"
      ? project.monteur_beoordeling_sterren
      : null;

  async function saveBeoordeling(nextSterren: number, nextNotitie: string) {
    setBusy("monteur_beoordeling");
    setError(null);
    try {
      const body: Record<string, unknown> = {
        monteur_beoordeling_sterren: nextSterren,
        monteur_beoordeling_notitie: nextNotitie.trim() || null,
        monteur_beoordeling_door: authorNaam?.trim() || null,
      };
      if (
        allAfterSaleDone(project, {
          monteur_beoordeling_sterren: nextSterren,
        }) &&
        status !== "afgerond" &&
        status !== "service"
      ) {
        body.status = "afgerond";
      }
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Beoordeling opslaan mislukt"
        );
      }
      onUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Beoordeling opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function checkItem(id: AfterSaleItemId) {
    if (isDone(project, id) || optimisticDone.has(id)) return;
    setBusy(id);
    setError(null);
    setOptimisticDone((prev) => new Set(prev).add(id));
    const next = new Date().toISOString();
    try {
      const body: Record<string, string | null> = { [id]: next };
      if (
        allAfterSaleDone(project, { [id]: next }) &&
        status !== "afgerond" &&
        status !== "service"
      ) {
        body.status = "afgerond";
      }
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      onUpdated?.(data.project as Project);
    } catch (e) {
      setOptimisticDone((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: AfterSaleItemId) {
    if (compact) {
      if (!isDone(project, id) && !optimisticDone.has(id)) {
        setConfirmId(id);
      }
      return;
    }
    setBusy(id);
    setError(null);
    const next = isDone(project, id) ? null : new Date().toISOString();
    try {
      const body: Record<string, string | null> = { [id]: next };
      if (
        next &&
        allAfterSaleDone(project, { [id]: next }) &&
        status !== "afgerond" &&
        status !== "service"
      ) {
        body.status = "afgerond";
      }
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      onUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  function confirmTekst(id: AfterSaleItemId): {
    title: string;
    description: string;
  } {
    if (id === "review_gevraagd_at") {
      return {
        title: "Trustpilot-review versturen?",
        description: email
          ? `We sturen de Trustpilot-link naar ${email}.`
          : "We sturen de Trustpilot-link naar de klant. Let op: er staat geen e-mailadres op de lead.",
      };
    }
    if (id === "overstap_dynamische_leverancier_at") {
      return {
        title: "Frank Energie-mail versturen?",
        description: email
          ? `We sturen de Batterijconcept × Frank Energie-mail naar ${email}.`
          : "We sturen de Batterijconcept × Frank Energie-mail naar de klant. Let op: er staat geen e-mailadres op de lead.",
      };
    }
    return {
      title: "BTW-terugvrage starten?",
      description: "Je vinkt af dat de BTW-terugvrage is gestart.",
    };
  }

  const confirmCopy = confirmId ? confirmTekst(confirmId) : null;
  const confirmDialog = (
    <AlertDialog
      open={confirmId != null}
      onOpenChange={(open) => {
        if (!open) setConfirmId(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {confirmCopy?.title ?? "Weet je zeker?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmCopy?.description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Nee</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              const id = confirmId;
              setConfirmId(null);
              if (id) void checkItem(id);
            }}
          >
            Ja, doe het
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        {error ? (
          <p className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
            {error}
          </p>
        ) : null}
        <ItemGroup className="min-h-0 gap-2 overflow-y-auto pr-0.5">
          {items.map((item) => {
            if (item.id === "monteur_beoordeling") {
              const ratingBusy = busy === "monteur_beoordeling";
              return (
                <Item
                  key={item.id}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "flex-col items-stretch gap-2 py-3",
                    item.done && "border-primary/30 bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <ItemMedia>
                      {item.done ? (
                        <span
                          className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          aria-label="Beoordeling monteur gezet"
                        >
                          <Check className="size-3.5" strokeWidth={2.5} />
                        </span>
                      ) : (
                        <span className="size-5 rounded-full border border-line" />
                      )}
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle className="text-[15px]">{item.label}</ItemTitle>
                      <ItemDescription className="text-[13px]">
                        {item.detail}
                      </ItemDescription>
                    </ItemContent>
                  </div>
                  <AfterSaleStars
                    value={sterren}
                    disabled={ratingBusy}
                    onPick={(n) => void saveBeoordeling(n, noteDraft)}
                  />
                  <textarea
                    value={noteDraft}
                    disabled={ratingBusy}
                    rows={2}
                    placeholder="Notitie voor de installatiepartner…"
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onBlur={() => {
                      if (
                        sterren == null ||
                        noteDraft.trim() ===
                          (project.monteur_beoordeling_notitie || "").trim()
                      ) {
                        return;
                      }
                      void saveBeoordeling(sterren, noteDraft);
                    }}
                    className="w-full resize-y border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none focus:border-green disabled:opacity-60"
                  />
                </Item>
              );
            }
            const done = item.done || optimisticDone.has(item.id);
            const checking = busy === item.id;
            return (
              <Item
                key={item.id}
                variant="outline"
                size="sm"
                className={cn(
                  "transition-colors duration-200",
                  done && "border-primary/30 bg-primary/5",
                  !done && "border-primary/30 bg-primary/5"
                )}
              >
                <ItemMedia>
                  {done ? (
                    <span
                      className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                      aria-label={`${item.label} voltooid`}
                    >
                      <Check className="size-3.5" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <Checkbox
                      checked={false}
                      disabled={checking}
                      aria-label={`${item.label} check`}
                      onCheckedChange={(checked) => {
                        if (checked === true) setConfirmId(item.id);
                      }}
                    />
                  )}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-[15px]">{item.label}</ItemTitle>
                  {done ? (
                    <ItemDescription className="flex items-center gap-1.5 font-medium text-primary">
                      <Check className="size-3.5" aria-hidden />
                      Actie voltooid
                    </ItemDescription>
                  ) : (
                    <ItemDescription className="text-[13px]">
                      {item.detail}
                    </ItemDescription>
                  )}
                </ItemContent>
                {done ? (
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    disabled={checking}
                    onClick={() => setConfirmId(item.id)}
                  >
                    {checking ? "…" : "Check"}
                  </Button>
                )}
              </Item>
            );
          })}
        </ItemGroup>
        {confirmDialog}
      </div>
    );
  }

  return (
    <section className="border border-line bg-white px-4 py-4 sm:px-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
        After sale
      </h2>
      <p className="mt-1 text-[11px] text-muted">
        {isAfterSale
          ? "Alle stappen klaar — status Afgerond."
          : "Na oplevering: overstap, BTW-terugvrage, review en beoordeling monteur. Daarna → Afgerond."}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => {
          if (item.id === "monteur_beoordeling") {
            const ratingBusy = busy === "monteur_beoordeling";
            return (
              <li key={item.id} className="border border-line px-3 py-3">
                <p className="text-sm font-medium text-ink">{item.label}</p>
                <p className="mt-0.5 text-[11px] text-muted">{item.detail}</p>
                <div className="mt-2">
                  <AfterSaleStars
                    value={sterren}
                    disabled={ratingBusy}
                    onPick={(n) => void saveBeoordeling(n, noteDraft)}
                  />
                </div>
                <textarea
                  value={noteDraft}
                  disabled={ratingBusy}
                  rows={3}
                  placeholder="Notitie voor de installatiepartner…"
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onBlur={() => {
                    if (
                      sterren == null ||
                      noteDraft.trim() ===
                        (project.monteur_beoordeling_notitie || "").trim()
                    ) {
                      return;
                    }
                    void saveBeoordeling(sterren, noteDraft);
                  }}
                  className="mt-2 w-full resize-y border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
                />
                {project.monteur_beoordeling_op ? (
                  <p className="mt-1.5 text-[11px] text-muted">
                    Laatst beoordeeld {formatDateTimeNl(project.monteur_beoordeling_op)}
                    {project.monteur_beoordeling_door
                      ? ` · ${project.monteur_beoordeling_door}`
                      : ""}
                  </p>
                ) : null}
              </li>
            );
          }
          const done = item.done;
          const at = project[item.id];
          return (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={busy === item.id}
                  onChange={() => void toggle(item.id)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <span
                    className={[
                      "text-sm font-medium",
                      done ? "text-green-dark" : "text-ink",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                  {done && at ? (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {formatDateTimeNl(at)}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {item.detail}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-[#C45A12]">{error}</p> : null}
      {confirmDialog}
    </section>
  );
}
