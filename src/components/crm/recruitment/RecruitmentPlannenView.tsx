"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { CalendarPlus, Check } from "lucide-react";
import type {
  Adviseur,
  Sollicitatie,
  SollicitatieAfspraak,
  SollicitatieAfspraakSoort,
} from "@/types/database";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";
import {
  amsterdamYmd,
  buildGesprekSlots,
  GESPREK_DUUR_MIN,
  upcomingWorkdays,
  type GesprekSlot,
} from "@/lib/recruitment-gesprek-slots";
import { CRM_SIDEBAR_EMAIL, isAdminAdviseur } from "@/lib/admin-adviseur";
import {
  RECRUITMENT_GESPREK_LOCATIE,
  RECRUITMENT_GESPREK_LOCATIE_OPTIES,
} from "@/lib/sollicitatie";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DEFAULT_INTERVIEWER_EMAIL = CRM_SIDEBAR_EMAIL;

function dayChipLabel(ymd: string): { top: string; bottom: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return {
    top: formatInTimeZone(noon, AMSTERDAM_TZ, "EEE", { locale: nl }),
    bottom: formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM", { locale: nl }),
  };
}

function interviewerLabel(a: Pick<Adviseur, "naam">): string {
  return (a.naam || "").trim().split(/\s+/)[0] || a.naam || "—";
}

export function RecruitmentPlannenView({
  kandidaten = [],
  defaultSollicitatieId,
  lockedKandidaat = null,
  afspraken,
  onCreated,
  onOpenKandidaat,
  onBack,
}: {
  kandidaten?: Sollicitatie[];
  defaultSollicitatieId?: string | null;
  /** Vastgezet op één kandidaat — geen andere kiezen. */
  lockedKandidaat?: Sollicitatie | null;
  afspraken: SollicitatieAfspraak[];
  onCreated: (
    a: SollicitatieAfspraak,
    mail?: {
      mailSent: boolean;
      mailSkipped: boolean;
      mailError: string | null;
    }
  ) => void;
  onOpenKandidaat?: (id: string) => void;
  onBack?: () => void;
}) {
  const locked = Boolean(lockedKandidaat?.id);
  const days = useMemo(() => upcomingWorkdays(10), []);
  const [sollicitatieId, setSollicitatieId] = useState(
    lockedKandidaat?.id || defaultSollicitatieId || ""
  );
  const [soort, setSoort] = useState<SollicitatieAfspraakSoort>("fysiek");
  const [locatie, setLocatie] = useState(RECRUITMENT_GESPREK_LOCATIE);
  const [dayYmd, setDayYmd] = useState(days[0] || amsterdamYmd());
  const [slotStart, setSlotStart] = useState<string | null>(null);
  const [notitie, setNotitie] = useState("");
  const [interviewers, setInterviewers] = useState<Adviseur[]>([]);
  const [interviewerId, setInterviewerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const locatiePreset = RECRUITMENT_GESPREK_LOCATIE_OPTIES.includes(
    locatie as (typeof RECRUITMENT_GESPREK_LOCATIE_OPTIES)[number]
  )
    ? locatie
    : "__custom__";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/adviseurs?include_inactive=1", {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = ((data.adviseurs || []) as Adviseur[])
          .filter(
            (a) =>
              a.actief !== false &&
              !isAdminAdviseur(a) &&
              (a.naam || "").trim().toLowerCase() !== "admin"
          )
          .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
        setInterviewers(list);
        const jona =
          list.find(
            (a) =>
              (a.email || "").trim().toLowerCase() === DEFAULT_INTERVIEWER_EMAIL
          ) ||
          list.find((a) =>
            (a.naam || "").toLowerCase().includes("jona")
          );
        setInterviewerId((prev) => prev || jona?.id || list[0]?.id || "");
      } catch {
        if (!cancelled) setInterviewers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (lockedKandidaat?.id) {
      setSollicitatieId(lockedKandidaat.id);
      return;
    }
    if (defaultSollicitatieId) {
      setSollicitatieId(defaultSollicitatieId);
    } else if (!sollicitatieId && kandidaten[0]?.id) {
      setSollicitatieId(kandidaten[0].id);
    }
  }, [lockedKandidaat?.id, defaultSollicitatieId, kandidaten, sollicitatieId]);

  const lockedLabel = lockedKandidaat
    ? [
        lockedKandidaat.naam,
        lockedKandidaat.functie,
        lockedKandidaat.plaats,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const busyForInterviewer = useMemo(() => {
    if (!interviewerId) return afspraken;
    return afspraken.filter(
      (a) =>
        !a.interviewer_id ||
        a.interviewer_id === interviewerId
    );
  }, [afspraken, interviewerId]);

  const slots: GesprekSlot[] = useMemo(
    () =>
      buildGesprekSlots({
        dayYmd,
        busyRanges: busyForInterviewer.map((a) => ({
          start_at: a.start_at,
          end_at: a.end_at,
        })),
      }),
    [dayYmd, busyForInterviewer]
  );

  useEffect(() => {
    setSlotStart(null);
  }, [dayYmd, interviewerId]);

  const selectedSlot = slots.find((s) => s.startAt === slotStart) || null;
  const selectedInterviewer =
    interviewers.find((a) => a.id === interviewerId) || null;

  const submit = useCallback(async () => {
    if (!sollicitatieId || !slotStart) {
      setError("Kies een kandidaat en een tijdslot");
      return;
    }
    if (!interviewerId) {
      setError("Kies wie het gesprek doet");
      return;
    }
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/instroom/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sollicitatie_id: sollicitatieId,
          start_at: slotStart,
          end_at: selectedSlot?.endAt,
          soort,
          locatie: soort === "fysiek" ? locatie.trim() || RECRUITMENT_GESPREK_LOCATIE : null,
          notitie,
          interviewer_id: interviewerId,
          duur_min: GESPREK_DUUR_MIN,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Plannen mislukt");
      onCreated(data.afspraak as SollicitatieAfspraak, {
        mailSent: Boolean(data.mail_sent),
        mailSkipped: Boolean(data.mail_skipped),
        mailError: (data.mail_error as string) || null,
      });
      setSlotStart(null);
      setNotitie("");
      setLocatie(RECRUITMENT_GESPREK_LOCATIE);
      const wie = interviewerLabel(selectedInterviewer || { naam: "—" });
      setOkMsg(
        `Ingepland${selectedSlot ? ` om ${selectedSlot.label}` : ""} met ${wie}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Plannen mislukt");
    } finally {
      setSaving(false);
    }
  }, [
    sollicitatieId,
    slotStart,
    interviewerId,
    selectedSlot,
    soort,
    locatie,
    notitie,
    onCreated,
    selectedInterviewer,
  ]);

  const vandaag = amsterdamYmd();
  // In sheet (locked): altijd onder elkaar — 2-col knijpt het formulier weg.
  const stackLayout = locked;

  const planForm = (
    <Card className="min-w-0 w-full rounded-xl border-line shadow-none">
      <CardHeader className="gap-1 px-4 py-4 sm:px-5">
        <CardTitle className="font-display text-xl tracking-tight text-ink">
          Gesprek plannen
        </CardTitle>
        <CardDescription>
          30 minuten · kandidaat krijgt een bevestigingsmail (als er e-mail
          is). Standaardlocatie: {RECRUITMENT_GESPREK_LOCATIE}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-4 pb-5 sm:px-5">
        <div className="grid gap-1.5">
          <Label>Kandidaat</Label>
          {locked ? (
            <div className="rounded-lg border border-line bg-wash/50 px-3 py-2.5 text-sm font-semibold text-ink">
              {lockedLabel}
            </div>
          ) : (
            <NativeSelect
              value={sollicitatieId}
              onChange={(e) => setSollicitatieId(e.target.value)}
              className="w-full"
              required
            >
              <NativeSelectOption value="">Kies…</NativeSelectOption>
              {kandidaten.map((k) => (
                <NativeSelectOption key={k.id} value={k.id}>
                  {k.naam}
                  {k.functie ? ` · ${k.functie}` : ""}
                  {k.plaats ? ` · ${k.plaats}` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label>Gesprek met *</Label>
          <NativeSelect
            value={interviewerId}
            onChange={(e) => setInterviewerId(e.target.value)}
            className="w-full"
            required
          >
            <NativeSelectOption value="">Kies…</NativeSelectOption>
            {interviewers.map((a) => (
              <NativeSelectOption key={a.id} value={a.id}>
                {a.naam}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <p className="text-[11px] text-muted">
            Standaard Jona — kies iemand anders indien nodig.
          </p>
        </div>

        <fieldset className="grid gap-1.5">
          <Label>Type *</Label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["telefonisch", "Telefonisch"],
                ["fysiek", "Fysiek"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setSoort(value);
                  if (value === "fysiek" && !locatie.trim()) {
                    setLocatie(RECRUITMENT_GESPREK_LOCATIE);
                  }
                }}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-sm font-medium transition",
                  soort === value
                    ? "border-green bg-green-soft text-green-deeper"
                    : "border-line text-muted hover:bg-wash"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {soort === "fysiek" ? (
          <div className="grid gap-1.5">
            <Label>Locatie *</Label>
            <NativeSelect
              value={locatiePreset}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") {
                  setLocatie((prev) =>
                    RECRUITMENT_GESPREK_LOCATIE_OPTIES.includes(
                      prev as (typeof RECRUITMENT_GESPREK_LOCATIE_OPTIES)[number]
                    )
                      ? ""
                      : prev
                  );
                  return;
                }
                setLocatie(v);
              }}
              className="w-full"
            >
              {RECRUITMENT_GESPREK_LOCATIE_OPTIES.map((opt) => (
                <NativeSelectOption key={opt} value={opt}>
                  {opt}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value="__custom__">
                Anders…
              </NativeSelectOption>
            </NativeSelect>
            {locatiePreset === "__custom__" ? (
              <Input
                value={locatie}
                onChange={(e) => setLocatie(e.target.value)}
                placeholder={RECRUITMENT_GESPREK_LOCATIE}
                className="h-11"
              />
            ) : null}
            <p className="text-[11px] text-muted">
              Standaard {RECRUITMENT_GESPREK_LOCATIE} — dit adres komt in de
              bevestigingsmail.
            </p>
          </div>
        ) : null}

        <div className="grid gap-2">
          <Label>Dag *</Label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((ymd) => {
              const chip = dayChipLabel(ymd);
              const active = ymd === dayYmd;
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => setDayYmd(ymd)}
                  className={cn(
                    "flex min-w-[4.25rem] shrink-0 flex-col items-center rounded-lg border px-2.5 py-2 text-center transition",
                    active
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-ink hover:bg-wash",
                    ymd === vandaag && !active ? "ring-1 ring-green/30" : ""
                  )}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                    {chip.top}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {chip.bottom}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Beschikbare tijdsloten · {GESPREK_DUUR_MIN} min *</Label>
            <span className="text-[11px] text-muted">
              {slots.filter((s) => !s.busy).length} vrij
            </span>
          </div>
          {slots.length === 0 ? (
            <p className="rounded-lg border border-line bg-wash px-3 py-4 text-sm text-muted">
              Geen slots meer vandaag. Kies een andere dag.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const active = s.startAt === slotStart;
                return (
                  <button
                    key={s.startAt}
                    type="button"
                    disabled={s.busy}
                    onClick={() => setSlotStart(s.startAt)}
                    className={cn(
                      "rounded-lg border px-2 py-2.5 text-sm font-semibold tabular-nums transition",
                      s.busy
                        ? "cursor-not-allowed border-line bg-wash text-muted line-through opacity-50"
                        : active
                          ? "border-green bg-green text-white"
                          : "border-line bg-white text-ink hover:border-green hover:bg-green-soft/50"
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-1.5">
          <Label>Notitie</Label>
          <Textarea
            value={notitie}
            onChange={(e) => setNotitie(e.target.value)}
            rows={3}
            placeholder="Bijv. tweede ronde, meenemen CV…"
          />
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {okMsg ? (
          <Alert>
            <AlertDescription className="flex items-center gap-2">
              <Check className="size-4 shrink-0 text-green" />
              {okMsg}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="text-xs text-muted">
            {selectedSlot && selectedInterviewer
              ? `${formatDateTimeNl(selectedSlot.startAt)} · ${GESPREK_DUUR_MIN} min · met ${interviewerLabel(selectedInterviewer)}`
              : "Kies dag en tijdslot"}
          </p>
          <Button
            type="button"
            disabled={saving || !sollicitatieId || !slotStart || !interviewerId}
            onClick={() => void submit()}
            className="gap-1.5"
          >
            <CalendarPlus className="size-4" />
            {saving ? "Bezig…" : "Inplannen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const agendaSide = (
    <Card className="h-auto min-w-0 w-full max-w-full self-start rounded-xl border-line shadow-none">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-sm font-semibold">
          Agenda{" "}
          {selectedInterviewer ? interviewerLabel(selectedInterviewer) : ""}
        </CardTitle>
        <CardDescription className="text-xs">
          Bezet = al een gesprek op dit slot
        </CardDescription>
      </CardHeader>
      <CardContent className="max-h-64 space-y-2 overflow-y-auto px-4 pb-4">
        {busyForInterviewer
          .filter((a) => amsterdamYmd(a.start_at) === dayYmd)
          .sort(
            (a, b) =>
              new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
          )
          .map((a) => {
            const isSelf =
              !locked || a.sollicitatie_id === lockedKandidaat?.id;
            const clickable = Boolean(onOpenKandidaat) && isSelf && !locked;
            return (
              <button
                key={a.id}
                type="button"
                disabled={!clickable}
                onClick={() => {
                  if (!clickable) return;
                  onOpenKandidaat?.(a.sollicitatie_id);
                }}
                className={cn(
                  "flex w-full items-start justify-between gap-2 rounded-lg border border-line bg-wash/60 px-3 py-2 text-left",
                  clickable ? "hover:bg-wash" : "cursor-default"
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold tabular-nums text-ink">
                    {formatInTimeZone(a.start_at, AMSTERDAM_TZ, "HH:mm")}
                    {" · "}
                    {a.soort === "fysiek" ? "Fysiek" : "Tel"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {a.sollicitaties?.naam || "Kandidaat"}
                  </p>
                </div>
              </button>
            );
          })}
        {busyForInterviewer.filter((a) => amsterdamYmd(a.start_at) === dayYmd)
          .length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted">
            Nog geen gesprekken op deze dag
          </p>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {onBack || locked ? (
        <div className="flex flex-wrap items-center gap-2">
          {onBack ? (
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              ← Terug naar kandidaat
            </Button>
          ) : null}
          {lockedLabel ? (
            <nav className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span className="font-medium text-ink">{lockedKandidaat?.naam}</span>
              <span>/</span>
              <span className="font-medium text-ink">Gesprek plannen</span>
            </nav>
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "grid w-full min-w-0 gap-4",
          stackLayout
            ? "grid-cols-1"
            : "xl:grid-cols-[minmax(0,1fr)_minmax(16rem,18rem)]"
        )}
      >
        {planForm}
        {agendaSide}
      </div>
    </div>
  );
}
