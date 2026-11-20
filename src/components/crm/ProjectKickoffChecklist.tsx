"use client";

import { useMemo, useState } from "react";
import type { Factuur, Project } from "@/types/database";
import { Check } from "lucide-react";
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
import {
  kickoffCompletionPatch,
  kickoffWarmtefondsBedragen,
  projectKickoffItems,
  showProjectKickoff,
  type KickoffItemId,
} from "@/lib/project-kickoff";
import {
  isWarmtefondsProject,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
} from "@/lib/backoffice-acties";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Voorstel: maandag van de aanbevolen week om 10:00 (lokale tijd). */
function defaultSchouwdagLocal(
  jaar: number,
  week: number
): string {
  try {
    const monday = new Date(schouwWeekToMondayIso(jaar, week));
    monday.setHours(10, 0, 0, 0);
    return toDatetimeLocalValue(monday.toISOString());
  } catch {
    return "";
  }
}

function aanbetalingConcept(facturen: Factuur[]): Factuur | null {
  const list = facturen.filter(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
  return (
    list.find((f) => f.status === "concept") ||
    list.find(
      (f) =>
        f.status !== "betaald" &&
        f.status !== "verzonden" &&
        f.status !== "deels_betaald"
    ) ||
    null
  );
}

/**
 * Focus tijdens opstart: WF parallel; EM sequentieel (factuur → betaling → schouw).
 */
export function ProjectKickoffChecklist({
  project,
  facturen,
  onFinancieringUpdated,
  onProjectUpdated,
  onFacturenChanged,
  onFactuurUpdated,
  compact = false,
}: {
  project: Project;
  facturen: Factuur[];
  onFinancieringUpdated?: (project: Project) => void;
  onProjectUpdated?: (project: Project) => void;
  onFacturenChanged?: () => void;
  onFactuurUpdated?: (factuur: Factuur) => void;
  compact?: boolean;
}) {
  const [afvinkBusy, setAfvinkBusy] = useState(false);
  const [waHint, setWaHint] = useState<string | null>(null);
  const [facBusy, setFacBusy] = useState(false);
  const [weekBusy, setWeekBusy] = useState(false);
  const [actionHint, setActionHint] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [optimisticDone, setOptimisticDone] = useState<Set<KickoffItemId>>(
    () => new Set()
  );
  const [checkingId, setCheckingId] = useState<KickoffItemId | null>(null);
  const [confirmId, setConfirmId] = useState<KickoffItemId | null>(null);

  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(40), []);
  const recommended = useMemo(
    () => recommendedSchouwWeekForProject(project, saleMomentVanProject(project)),
    [project]
  );
  const [schouwWeek, setSchouwWeek] = useState(() =>
    schouwWeekValue(recommended.jaar, recommended.week)
  );
  const [schouwdagLocal, setSchouwdagLocal] = useState(() =>
    defaultSchouwdagLocal(recommended.jaar, recommended.week)
  );

  if (!showProjectKickoff(project, facturen)) return null;

  const items = projectKickoffItems(project, facturen);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  const offerteId = off?.id || project.offerte_id || null;
  const draftAanbetaling = aanbetalingConcept(facturen);
  const wf = isWarmtefondsProject(project);

  async function afvinkEdwinIntake() {
    setAfvinkBusy(true);
    setWaHint(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: "doorgestuurd_naar_edwin",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data as { error?: string }).error ||
          "Afvinken mislukt. Probeer opnieuw.";
        setWaHint(msg);
        throw new Error(msg);
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || {
        ...project,
        financiering_status: "doorgestuurd_naar_edwin" as const,
      };
      const finalized = await finalizeKickoffIfReady(base, facturen);
      if (finalized) {
        /* onProjectUpdated al via finalize */
      } else if (updated) {
        onFinancieringUpdated?.(updated);
      } else {
        onFinancieringUpdated?.(base);
      }
    } finally {
      setAfvinkBusy(false);
    }
  }

  /** Alle stappen klaar → bel_schouw + bij WF status afwachten_wf. */
  async function finalizeKickoffIfReady(
    nextProject: Project,
    nextFacturen: Factuur[]
  ): Promise<Project | null> {
    const patch = kickoffCompletionPatch(nextProject, nextFacturen);
    if (!patch) return null;
    const res = await fetch(`/api/projecten/${nextProject.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const updated = (data as { project?: Project }).project;
    if (updated) {
      onProjectUpdated?.(updated);
      return updated;
    }
    return null;
  }

  async function verstuurAanbetaling(opts?: { silent?: boolean }) {
    setFacBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      let factuurId = draftAanbetaling?.id || null;
      let nummer = draftAanbetaling?.factuur_nummer || null;

      if (!factuurId) {
        if (!offerteId) {
          throw new Error("Geen offerte gekoppeld — kan geen factuur maken.");
        }
        const createRes = await fetch(`/api/offertes/${offerteId}/factuur`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soort: "aanbetaling" }),
        });
        const createData = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          throw new Error(
            (createData as { error?: string }).error ||
              "Conceptfactuur aanmaken mislukt"
          );
        }
        if ((createData as { skipped?: boolean }).skipped) {
          throw new Error(
            (createData as { reason?: string }).reason ||
              "Geen aanbetaling voor deze offerte"
          );
        }
        const created = (createData as {
          factuur?: { id?: string; factuur_nummer?: string };
        }).factuur;
        factuurId = created?.id || null;
        nummer = created?.factuur_nummer || null;
        if (!factuurId) {
          throw new Error("Geen factuur-id teruggekregen");
        }
      }

      const email = lead?.email?.trim();
      const facLabel = wf ? "BTW-factuur" : "50%-aanbetaling";
      if (
        !opts?.silent &&
        !confirm(
          `${facLabel}${nummer ? ` ${nummer}` : ""} mailen${
            email ? ` naar ${email}` : " naar de klant"
          }?`
        )
      ) {
        return;
      }

      const res = await fetch(`/api/facturen/${factuurId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Versturen mislukt"
        );
      }
      const sentFac = (data as { factuur?: Factuur }).factuur;
      if (sentFac) onFactuurUpdated?.(sentFac);
      const nextFac = sentFac
        ? [
            ...facturen.filter((f) => f.id !== sentFac.id),
            sentFac,
          ]
        : facturen.map((f) =>
            f.id === factuurId ? { ...f, status: "verzonden" as const } : f
          );
      const finalized = await finalizeKickoffIfReady(project, nextFac);
      setActionHint(
        finalized?.status === "opstarten_voltooid_afwachten_wf"
          ? `${facLabel}${nummer ? ` ${nummer}` : ""} verstuurd · status → Opstarten voltooid — afwachten WF`
          : `${facLabel}${nummer ? ` ${nummer}` : ""} verstuurd.`
      );
      onFacturenChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Versturen mislukt");
      throw e;
    } finally {
      setFacBusy(false);
    }
  }

  async function planSchouwdag(opts?: { silent?: boolean }) {
    const parsed = new Date(schouwdagLocal);
    if (!schouwdagLocal.trim() || Number.isNaN(parsed.getTime())) {
      setActionError("Kies een geldige schouwdag en tijd");
      return;
    }
    const derived = schouwWeekFromDate(parsed);
    const email = lead?.email?.trim();
    if (
      !opts?.silent &&
      !confirm(
        `Schouwdag zetten${email ? ` en mail sturen naar ${email}` : ""}?\n\nDe klant krijgt de schouwdag + knop naar track & trace.`
      )
    ) {
      return;
    }
    setWeekBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schouw_at: parsed.toISOString(),
          schouw_jaar: derived.jaar,
          schouw_week: derived.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Schouwdag opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || project;
      const finalized = await finalizeKickoffIfReady(base, facturen);
      const result = finalized || updated;
      if (result && !finalized) onProjectUpdated?.(result);
      const mailOk = (data as { mails?: { klant?: { ok?: boolean } } }).mails
        ?.klant?.ok;
      const dagLabel = parsed.toLocaleString("nl-NL", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      setActionHint(
        mailOk
          ? `Schouwdag gezet · ${dagLabel} — klantmail met track & trace verstuurd`
          : `Schouwdag gezet · ${dagLabel}`
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Schouwdag opslaan mislukt"
      );
      throw e;
    } finally {
      setWeekBusy(false);
    }
  }

  async function planSchouwweek(opts?: { silent?: boolean }) {
    const opt = weekOptions.find((o) => o.value === schouwWeek);
    if (!opt) {
      setActionError("Kies een geldige schouwweek");
      return;
    }
    const email = lead?.email?.trim();
    if (
      !opts?.silent &&
      !confirm(
        `Schouwweek zetten${email ? ` en mail sturen naar ${email}` : ""}?\n\nDe klant krijgt de schouwweek + knop naar track & trace.`
      )
    ) {
      return;
    }
    setWeekBusy(true);
    setActionError(null);
    setActionHint(null);
    try {
      // POST /schouw: plant week + stuurt klantmail met track & trace (geen aparte taak)
      const res = await fetch(`/api/projecten/${project.id}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schouw_jaar: opt.jaar,
          schouw_week: opt.week,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Schouwweek opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      const base = updated || project;
      const finalized = await finalizeKickoffIfReady(base, facturen);
      const result = finalized || updated;
      if (result && !finalized) onProjectUpdated?.(result);
      const mailOk = (data as { mails?: { klant?: { ok?: boolean } } }).mails
        ?.klant?.ok;
      const weekLabel = formatSchouwWeekLabel(opt.jaar, opt.week);
      setActionHint(
        finalized?.status === "opstarten_voltooid_afwachten_wf"
          ? `Schouwweek gezet · ${weekLabel} — status → Opstarten voltooid — afwachten WF`
          : mailOk
            ? `Schouwweek gezet · ${weekLabel} — klantmail met track & trace verstuurd`
            : `Schouwweek gezet · ${weekLabel}`
      );
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Schouwweek opslaan mislukt"
      );
      throw e;
    } finally {
      setWeekBusy(false);
    }
  }

  const bedragen = kickoffWarmtefondsBedragen(project, facturen);
  const email = lead?.email?.trim();

  function confirmTekst(id: KickoffItemId): {
    title: string;
    description: string;
  } {
    const naar = email ? ` naar ${email}` : " naar de klant";
    if (id === "aanbetaling") {
      return {
        title: "Weet je zeker dat je dit wilt versturen?",
        description: wf
          ? `De BTW-factuur wordt nu gemaild${naar}.`
          : `De 50%-aanbetaling wordt nu gemaild${naar}.`,
      };
    }
    if (id === "wf_afspraak") {
      return {
        title: "Weet je zeker dat je dit wilt afvinken?",
        description:
          "Je vinkt af dat de klant in het Warmtefonds-portaal staat. Er gaat geen mail de deur uit.",
      };
    }
    return {
      title: "Weet je zeker dat je dit wilt zetten?",
      description: wf
        ? `De schouwweek wordt gezet en de klantmail wordt verstuurd${naar}.`
        : `De schouwdag wordt gezet en de klantmail wordt verstuurd${naar}.`,
    };
  }

  function vraagBevestiging(id: KickoffItemId) {
    const item = items.find((i) => i.id === id);
    if (!item || item.done || item.blocked || optimisticDone.has(id)) return;
    setConfirmId(id);
  }

  async function checkItem(id: KickoffItemId) {
    const item = items.find((i) => i.id === id);
    if (!item || item.done || item.blocked || optimisticDone.has(id)) return;
    setOptimisticDone((prev) => new Set(prev).add(id));
    setCheckingId(id);
    setActionError(null);
    try {
      if (id === "aanbetaling") {
        await verstuurAanbetaling({ silent: true });
      } else if (id === "wf_afspraak") {
        await afvinkEdwinIntake();
      } else if (id === "schouwweek") {
        if (wf) await planSchouwweek({ silent: true });
        else await planSchouwdag({ silent: true });
      }
    } catch {
      setOptimisticDone((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } finally {
      setCheckingId(null);
    }
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
        {actionError ? (
          <p className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">
            {actionError}
          </p>
        ) : null}
        <ItemGroup className="min-h-0 gap-2 overflow-y-auto pr-0.5">
          {items.map((item) => {
            const done = item.done || optimisticDone.has(item.id);
            const busy = checkingId === item.id;
            return (
              <Item
                key={item.id}
                variant="outline"
                size="sm"
                className={cn(
                  "transition-colors duration-200",
                  done && "border-primary/30 bg-primary/5",
                  !done && !item.blocked && "border-primary/30 bg-primary/5"
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
                      disabled={item.blocked || busy}
                      aria-label={`${item.label} check`}
                      onCheckedChange={(checked) => {
                        if (checked === true) vraagBevestiging(item.id);
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
                      {item.blocked && item.blockedReason
                        ? item.blockedReason
                        : item.detail}
                    </ItemDescription>
                  )}
                </ItemContent>
                {done ? (
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-4" strokeWidth={2.5} aria-hidden />
                  </span>
                ) : !item.blocked ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => vraagBevestiging(item.id)}
                  >
                    {busy ? "…" : "Check"}
                  </Button>
                ) : null}
              </Item>
            );
          })}
        </ItemGroup>
        {confirmDialog}
      </div>
    );
  }

  return (
    <section
      id="project-kickoff"
      className="border border-line bg-white px-4 py-5 sm:px-5"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Direct na tekenen
      </p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Dit moet nu gebeuren
      </h2>

      {waHint || actionHint ? (
        <p className="mt-3 border border-[#0D9488]/25 bg-[#F0FDFA] px-3 py-2 text-[12px] text-[#115E59]">
          {actionHint || waHint}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-800">
          {actionError}
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {open.map((item, idx) => (
            <li
              key={item.id}
              className={
                item.blocked
                  ? "flex flex-col gap-3 border border-line bg-[#F8FAFC] px-3.5 py-3 sm:flex-row sm:items-start"
                  : "flex flex-col gap-3 border border-[#FDBA74]/60 bg-[#FFF7ED] px-3.5 py-3 sm:flex-row sm:items-start"
              }
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={
                    item.blocked
                      ? "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#94A3B8] text-[11px] font-bold text-white"
                      : "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-[11px] font-bold text-white"
                  }
                >
                  {idx + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {item.blocked && item.blockedReason
                      ? item.blockedReason
                      : item.detail}
                    {!item.blocked &&
                    item.id === "aanbetaling" &&
                    bedragen.aanbetalingInc != null
                      ? ` · ${formatEuro(bedragen.aanbetalingInc)}`
                      : ""}
                  </span>
                </span>
              </div>

              {item.blocked ? (
                <p className="shrink-0 text-[12px] font-medium text-muted sm:max-w-[14rem] sm:text-right">
                  {item.blockedReason}
                </p>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={checkingId === item.id}
                  onClick={() => vraagBevestiging(item.id)}
                >
                  {checkingId === item.id ? "…" : "Check"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {done.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 px-1 py-1 text-[13px] text-[#0F766E]"
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0D9488] text-white"
                aria-hidden
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                  <path
                    d="M2.5 6.2 4.8 8.5 9.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="font-medium">{item.label}</span>
              <span className="text-muted">· {item.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {confirmDialog}
    </section>
  );
}
