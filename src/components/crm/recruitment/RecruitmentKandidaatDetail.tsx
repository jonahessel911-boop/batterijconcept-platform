"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarPlus,
  Copy,
  Mail,
  MapPin,
  Phone,
  Upload,
} from "lucide-react";
import type {
  Sollicitatie,
  SollicitatieAfspraak,
  SollicitatieBestand,
  SollicitatieStatus,
  TrainingMoment,
} from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
  SOLLICITATIE_STATUS_MET_TRAINING,
  SOLLICITATIE_STATUS_MET_VERVOLG,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import { formatDateShort, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import { parseProjectNotitieEntries } from "@/lib/lead-notitie";
import {
  extractAdresFromNotitie,
  formatSollicitatieAdres,
  mergeSollicitatieAdres,
  type SollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import {
  isQuizNotitieText,
  enrichAntwoordRowsWithAdres,
  parseSollicitatieAntwoordRows,
} from "@/lib/sollicitatie-antwoorden";
import { provincieVanPostcode } from "@/lib/postcode-provincie";
import { normalizePostcode } from "@/lib/postcode";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { SollicitatieAntwoordenRows } from "@/components/crm/recruitment/SollicitatieAntwoordenRows";

const STATUS_TONE: Record<
  SollicitatieStatus,
  { bar: string; soft: string; text: string }
> = {
  nieuw: { bar: "#1A4A6E", soft: "#E8F0F6", text: "#1A4A6E" },
  geen_contact: { bar: "#6B7280", soft: "#F3F4F6", text: "#4B5563" },
  definitief_geen_contact: { bar: "#455A64", soft: "#CFD8DC", text: "#263238" },
  diskwalificatie: { bar: "#9B2C2C", soft: "#FCEAEA", text: "#9B2C2C" },
  gesprek_gepland: { bar: "#A16207", soft: "#FEF7E6", text: "#854D0E" },
  gesprek_gehad: { bar: "#C2410C", soft: "#FFF4ED", text: "#9A3412" },
  gesprek_gehad_diskwalificatie: {
    bar: "#9B2C2C",
    soft: "#FCEAEA",
    text: "#9B2C2C",
  },
  aangenomen_training_gepland: {
    bar: "#0F766E",
    soft: "#E6F7F5",
    text: "#0F766E",
  },
  aangenomen_actief: { bar: "#166534", soft: "#DCFCE7", text: "#14532D" },
};

/** Teamnotities uit sollicitatie.notitie — quiz/sollicitatie-antwoorden eruit. */
function parseSollicitatieTeamNotities(notitie: string | null | undefined) {
  return parseProjectNotitieEntries(notitie).filter(
    (e) => e.text.trim() && !isQuizNotitieText(e.text)
  );
}

type KandidaatSavePatch = Partial<Sollicitatie> & {
  notitie_append?: string;
};

function adresFromKandidaat(k: Sollicitatie): SollicitatieAdres {
  return mergeSollicitatieAdres(
    {
      postcode: k.postcode || null,
      huisnummer: k.huisnummer || null,
      toevoeging: k.toevoeging || null,
      straat: k.straat || null,
      plaats: k.plaats || null,
    },
    extractAdresFromNotitie(k.notitie)
  );
}

function PhoneCopyButton({ telefoon }: { telefoon: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      title={ok ? "Gekopieerd" : "Kopieer"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard.writeText(telefoon).then(() => {
          setOk(true);
          window.setTimeout(() => setOk(false), 1200);
        });
      }}
    >
      <Copy className="size-3" />
    </Button>
  );
}

function AdresEditor({
  kandidaat,
  saving,
  onSave,
}: {
  kandidaat: Sollicitatie;
  saving: boolean;
  onSave: (patch: KandidaatSavePatch) => Promise<void>;
}) {
  const seeded = adresFromKandidaat(kandidaat);
  const initialPostcode = seeded.postcode || "";
  const initialHuisnummer = seeded.huisnummer || "";
  const initialToevoeging = seeded.toevoeging || "";

  const [postcode, setPostcode] = useState(initialPostcode);
  const [huisnummer, setHuisnummer] = useState(initialHuisnummer);
  const [toevoeging, setToevoeging] = useState(initialToevoeging);
  const [straat, setStraat] = useState(seeded.straat || "");
  const [plaats, setPlaats] = useState(seeded.plaats || "");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastLookupKey = useRef<string>("");

  useEffect(() => {
    const from = adresFromKandidaat(kandidaat);
    setPostcode(from.postcode || "");
    setHuisnummer(from.huisnummer || "");
    setToevoeging(from.toevoeging || "");
    setStraat(from.straat || "");
    setPlaats(from.plaats || "");
    setMsg(null);
    setErr(null);
    lastLookupKey.current = "";
  }, [
    kandidaat.id,
    kandidaat.postcode,
    kandidaat.huisnummer,
    kandidaat.toevoeging,
    kandidaat.straat,
    kandidaat.plaats,
    kandidaat.notitie,
  ]);

  const dirty =
    (postcode.trim() || null) !== (kandidaat.postcode || null) ||
    (huisnummer.trim() || null) !== (kandidaat.huisnummer || null) ||
    (toevoeging.trim() || null) !== (kandidaat.toevoeging || null) ||
    (straat.trim() || null) !== (kandidaat.straat || null) ||
    (plaats.trim() || null) !== (kandidaat.plaats || null);

  async function lookupAdres(opts?: { autosave?: boolean }) {
    const pc = postcode.trim();
    const nr = huisnummer.trim();
    if (!pc) {
      if (!opts?.autosave) setErr("Vul een postcode in");
      return;
    }
    const key = `${normalizePostcode(pc)}|${nr}|${toevoeging.trim()}`;
    if (opts?.autosave && lastLookupKey.current === key && plaats) {
      return;
    }
    setLookupBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const qs = new URLSearchParams({ postcode: pc });
      if (nr) qs.set("number", nr);
      if (toevoeging.trim()) qs.set("toevoeging", toevoeging.trim());
      const res = await fetch(`/api/postcode?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Adres niet gevonden");
      const nextPostcode = data.postcode
        ? normalizePostcode(String(data.postcode))
        : normalizePostcode(pc);
      const nextHuisnummer = data.huisnummer
        ? String(data.huisnummer)
        : nr || "";
      const nextStraat = data.straat ? String(data.straat) : straat;
      const nextPlaats = data.plaats ? String(data.plaats) : plaats;
      setPostcode(nextPostcode);
      if (nextHuisnummer) setHuisnummer(nextHuisnummer);
      if (data.straat) setStraat(String(data.straat));
      if (data.plaats) setPlaats(String(data.plaats));
      lastLookupKey.current = key;
      if (opts?.autosave) {
        await onSave({
          postcode: nextPostcode || null,
          huisnummer: nextHuisnummer.trim() || null,
          toevoeging: toevoeging.trim() || null,
          straat: nextStraat.trim() || null,
          plaats: nextPlaats.trim() || null,
        });
        setMsg("Adres automatisch aangevuld");
      } else {
        setMsg("Adres opgehaald — klik Opslaan om te bewaren");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lookup mislukt");
    } finally {
      setLookupBusy(false);
    }
  }

  async function save() {
    setErr(null);
    setMsg(null);
    try {
      await onSave({
        postcode: postcode.trim() ? normalizePostcode(postcode) : null,
        huisnummer: huisnummer.trim() || null,
        toevoeging: toevoeging.trim() || null,
        straat: straat.trim() || null,
        plaats: plaats.trim() || null,
      });
      setMsg("Adres opgeslagen");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Opslaan mislukt");
    }
  }

  // Automatisch plaats (+ straat) ophalen zodra postcode bekend is
  useEffect(() => {
    const pc = postcode.trim();
    if (!pc || saving || lookupBusy) return;
    const nr = huisnummer.trim();
    const key = `${normalizePostcode(pc)}|${nr}|${toevoeging.trim()}`;
    if (lastLookupKey.current === key && plaats.trim()) return;
    if (
      kandidaat.postcode &&
      kandidaat.plaats &&
      normalizePostcode(pc) === normalizePostcode(kandidaat.postcode) &&
      (!nr || nr === (kandidaat.huisnummer || ""))
    ) {
      lastLookupKey.current = key;
      return;
    }
    const t = window.setTimeout(() => {
      void lookupAdres({ autosave: true });
    }, 450);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen bij PC/nr/toev
  }, [postcode, huisnummer, toevoeging, kandidaat.id]);

  return (
    <Card className="rounded-xl border-line shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3 sm:px-5">
        <div>
          <CardTitle className="text-sm font-semibold text-ink">Adres</CardTitle>
          <CardDescription className="text-xs">
            Straat en plaats worden automatisch opgehaald
          </CardDescription>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lookupBusy || !postcode.trim()}
            onClick={() => void lookupAdres()}
          >
            {lookupBusy ? "Zoeken…" : "Opnieuw ophalen"}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            Opslaan
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_88px_72px] sm:px-5">
        <div className="grid gap-1.5">
          <Label>Postcode</Label>
          <Input
            value={postcode}
            onChange={(e) => {
              lastLookupKey.current = "";
              setPostcode(e.target.value.toUpperCase());
              setStraat("");
              setPlaats("");
            }}
            placeholder="1234AB"
            disabled={saving}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Nr</Label>
          <Input
            value={huisnummer}
            onChange={(e) => {
              lastLookupKey.current = "";
              setHuisnummer(e.target.value);
              setStraat("");
              setPlaats("");
            }}
            inputMode="numeric"
            disabled={saving}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Toev.</Label>
          <Input
            value={toevoeging}
            onChange={(e) => {
              lastLookupKey.current = "";
              setToevoeging(e.target.value);
              setStraat("");
              setPlaats("");
            }}
            disabled={saving}
          />
        </div>
      </CardContent>
      <Separator />
      <CardContent className="grid gap-3 p-4 sm:grid-cols-2 sm:px-5">
        <div className="grid gap-1.5">
          <Label>Straat</Label>
          <Input
            value={straat}
            onChange={(e) => setStraat(e.target.value)}
            disabled={saving || lookupBusy}
            placeholder={lookupBusy ? "Ophalen…" : undefined}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Plaats</Label>
          <Input
            value={plaats}
            onChange={(e) => setPlaats(e.target.value)}
            disabled={saving || lookupBusy}
            placeholder={lookupBusy ? "Ophalen…" : undefined}
          />
        </div>
      </CardContent>
      {msg || err ? (
        <Alert
          variant={err ? "destructive" : "default"}
          className="rounded-none border-x-0 border-b-0"
        >
          <AlertDescription>{err || msg}</AlertDescription>
        </Alert>
      ) : null}
    </Card>
  );
}

export function RecruitmentKandidaatDetail({
  kandidaat,
  afspraken,
  afsprakenLoading,
  trainingen,
  saving,
  uploading,
  onBack,
  onSave,
  onRequestBeoordeling,
  onRequestTraining,
  onPlan,
  onDeleteAfspraak,
  onUpload,
  onDeleteFile,
}: {
  kandidaat: Sollicitatie;
  afspraken: SollicitatieAfspraak[];
  afsprakenLoading: boolean;
  trainingen: TrainingMoment[];
  saving: boolean;
  uploading: boolean;
  onBack: () => void;
  onSave: (patch: KandidaatSavePatch) => Promise<void>;
  onRequestBeoordeling: () => void;
  onRequestTraining: () => void;
  onPlan: () => void;
  onDeleteAfspraak: (id: string) => void;
  onUpload: (file: File) => void;
  onDeleteFile: (fileId: string) => void;
}) {
  const status = normalizeSollicitatieStatus(kandidaat.status);
  const tone = STATUS_TONE[status];
  const bestanden = kandidaat.sollicitatie_bestanden || [];
  const now = Date.now();
  const upcoming = afspraken.filter(
    (a) => new Date(a.start_at).getTime() >= now - 60_000
  );
  const past = afspraken.filter(
    (a) => new Date(a.start_at).getTime() < now - 60_000
  );
  const adresResolved = adresFromKandidaat(kandidaat);
  const provincie =
    adresResolved.postcode
      ? provincieVanPostcode(adresResolved.postcode)
      : "";
  const quizPairs = enrichAntwoordRowsWithAdres(
    parseSollicitatieAntwoordRows(kandidaat.notitie),
    adresResolved,
    provincie && provincie !== "(onbekend)" ? provincie : null
  );
  const noteEntries = parseSollicitatieTeamNotities(kandidaat.notitie);
  const adresWeergave = formatSollicitatieAdres(adresResolved);
  const gekoppeldeTraining =
    trainingen.find((t) => t.id === kandidaat.training_moment_id) ||
    kandidaat.training_moment ||
    null;
  const [noteDraft, setNoteDraft] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    setNoteDraft("");
    setNoteError(null);
  }, [kandidaat.id]);

  async function addNotitie() {
    const text = noteDraft.trim();
    if (!text) return;
    setNoteBusy(true);
    setNoteError(null);
    try {
      await onSave({ notitie_append: text });
      setNoteDraft("");
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setNoteBusy(false);
    }
  }

  const whatsappHref = kandidaat.telefoon
    ? `https://wa.me/${kandidaat.telefoon.replace(/\D/g, "").replace(/^0/, "31")}`
    : null;

  async function changeStatus(next: SollicitatieStatus) {
    if (next === status || saving) return;
    if (next === SOLLICITATIE_STATUS_MET_TRAINING) {
      onRequestTraining();
      return;
    }
    await onSave({ status: next });
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Terug
        </Button>
        <nav className="flex items-center gap-1.5 text-xs text-muted">
          <button
            type="button"
            onClick={onBack}
            className="font-medium hover:text-green-deeper"
          >
            Aanmeldingen
          </button>
          <span>/</span>
          <span className="font-medium text-ink">{kandidaat.naam}</span>
        </nav>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden rounded-xl border-line shadow-none">
            <CardHeader className="gap-3 space-y-0 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
              <div className="min-w-0">
                <CardDescription className="font-mono text-[11px] font-semibold tracking-wide">
                  {kandidaat.functie || "Sollicitatie"}
                </CardDescription>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <CardTitle className="font-display text-2xl font-semibold tracking-tight text-ink">
                    {kandidaat.naam}
                  </CardTitle>
                  <Badge
                    className="rounded-md border-0 font-semibold"
                    style={{ background: tone.soft, color: tone.text }}
                  >
                    {SOLLICITATIE_STATUS_LABEL[status]}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs text-muted">
                  Binnengekomen {formatDateTimeNl(kandidaat.created_at)}
                  {kandidaat.bron ? ` · via ${kandidaat.bron}` : ""}
                </p>
              </div>
              <Button type="button" onClick={onPlan} className="shrink-0">
                <CalendarPlus className="size-4" />
                Gesprek plannen
              </Button>
            </CardHeader>

            <Separator />

            <CardContent className="space-y-3 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="grid min-w-[14rem] flex-1 gap-1.5">
                  <Label htmlFor="kandidaat-status" className="text-xs text-muted">
                    Status
                    {saving ? (
                      <span className="ml-2 font-normal">opslaan…</span>
                    ) : null}
                  </Label>
                  <NativeSelect
                    id="kandidaat-status"
                    value={status}
                    disabled={saving}
                    aria-label="Status wijzigen"
                    onChange={(e) => {
                      void changeStatus(e.target.value as SollicitatieStatus);
                    }}
                    className="w-full max-w-md font-semibold [&_select]:font-semibold"
                    style={{
                      background: tone.soft,
                      color: tone.text,
                      borderColor: `${tone.bar}33`,
                    }}
                  >
                    {SOLLICITATIE_STATUSES.map((st) => (
                      <NativeSelectOption key={st} value={st}>
                        {SOLLICITATIE_STATUS_LABEL[st]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <div className="flex flex-wrap gap-2">
                  {status === SOLLICITATIE_STATUS_MET_VERVOLG ? (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0"
                      onClick={onRequestBeoordeling}
                    >
                      + Notitie &amp; vervolgtaak
                    </Button>
                  ) : null}
                </div>
              </div>
            </CardContent>

            <Separator />

            <CardContent className="space-y-3 px-4 py-4 sm:px-5">
              <div
                className="rounded-lg border px-3.5 py-3"
                style={{
                  borderColor: gekoppeldeTraining
                    ? "#0F766E44"
                    : "var(--line, #E5E7EB)",
                  background: gekoppeldeTraining ? "#E6F7F5" : "transparent",
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Training
                    </p>
                    {gekoppeldeTraining ? (
                      <>
                        <p className="mt-0.5 text-sm font-semibold text-ink">
                          {gekoppeldeTraining.naam}
                        </p>
                        <p className="mt-0.5 text-xs text-muted">
                          {formatDateShort(
                            `${gekoppeldeTraining.periode_van.slice(0, 10)}T12:00:00`
                          )}{" "}
                          –{" "}
                          {formatDateShort(
                            `${gekoppeldeTraining.periode_tot.slice(0, 10)}T12:00:00`
                          )}
                          {gekoppeldeTraining.adres
                            ? ` · ${gekoppeldeTraining.adres}`
                            : ""}
                        </p>
                        {(gekoppeldeTraining.dagen || []).length > 0 ? (
                          <p className="mt-1 text-[11px] text-muted">
                            {(gekoppeldeTraining.dagen || []).length} dag
                            {(gekoppeldeTraining.dagen || []).length === 1
                              ? ""
                              : "en"}{" "}
                            gepland
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-0.5 text-sm text-muted">
                        Nog niet op een training gezet
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant={gekoppeldeTraining ? "outline" : "default"}
                    size="sm"
                    onClick={onRequestTraining}
                  >
                    {gekoppeldeTraining ? "Wijzigen" : "Op training zetten"}
                  </Button>
                </div>
              </div>
            </CardContent>

            <Separator />

            <CardContent className="space-y-3 px-4 py-4 sm:px-5">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                    <Phone className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Telefoon
                    </p>
                    {kandidaat.telefoon ? (
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <a
                          href={`tel:${kandidaat.telefoon}`}
                          className="break-all text-sm font-semibold text-ink hover:text-green-deeper hover:underline"
                        >
                          {kandidaat.telefoon}
                        </a>
                        <PhoneCopyButton telefoon={kandidaat.telefoon} />
                      </div>
                    ) : (
                      <p className="mt-0.5 text-sm text-muted">—</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                    <Mail className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      E-mail
                    </p>
                    {kandidaat.email ? (
                      <a
                        href={`mailto:${kandidaat.email}`}
                        className="mt-0.5 block break-all text-sm font-semibold text-ink hover:text-green-deeper hover:underline"
                      >
                        {kandidaat.email}
                      </a>
                    ) : (
                      <p className="mt-0.5 text-sm text-muted">—</p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                    <MapPin className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Adres
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm font-semibold text-ink">
                      {adresWeergave || "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-dark">
                    <Upload className="size-4 rotate-180" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Bron / ads
                    </p>
                    <p className="mt-0.5 break-words text-sm font-semibold text-ink">
                      {kandidaat.bron || "—"}
                    </p>
                    {kandidaat.campaign_name ||
                    kandidaat.ad_name ||
                    kandidaat.meta_campaign_id ||
                    kandidaat.utm_source ? (
                      <div className="mt-1 space-y-0.5 font-mono text-[10px] text-muted">
                        {kandidaat.campaign_name ||
                        kandidaat.meta_campaign_id ? (
                          <p className="truncate">
                            Campagne:{" "}
                            {kandidaat.campaign_name ||
                              kandidaat.meta_campaign_id}
                          </p>
                        ) : null}
                        {kandidaat.adset_name || kandidaat.meta_adset_id ? (
                          <p className="truncate">
                            Adset:{" "}
                            {kandidaat.adset_name || kandidaat.meta_adset_id}
                          </p>
                        ) : null}
                        {kandidaat.ad_name || kandidaat.meta_ad_id ? (
                          <p className="truncate">
                            Ad: {kandidaat.ad_name || kandidaat.meta_ad_id}
                          </p>
                        ) : null}
                        {kandidaat.utm_source ||
                        kandidaat.utm_medium ||
                        kandidaat.utm_campaign ? (
                          <p className="truncate">
                            UTM:{" "}
                            {[
                              kandidaat.utm_source,
                              kandidaat.utm_medium,
                              kandidaat.utm_campaign,
                            ]
                              .filter(Boolean)
                              .join(" / ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {(kandidaat.telefoon || kandidaat.email) && (
                <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                  {kandidaat.telefoon ? (
                    <a
                      href={`tel:${kandidaat.telefoon}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "gap-1.5"
                      )}
                    >
                      <Phone className="size-3.5" />
                      Bellen
                    </a>
                  ) : null}
                  {whatsappHref ? (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" })
                      )}
                    >
                      WhatsApp
                    </a>
                  ) : null}
                  {kandidaat.email ? (
                    <a
                      href={`mailto:${kandidaat.email}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "gap-1.5"
                      )}
                    >
                      <Mail className="size-3.5" />
                      Mailen
                    </a>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          {quizPairs.length > 0 ? (
            <Card className="rounded-xl border-line shadow-none">
              <CardHeader className="px-4 py-3 sm:px-5">
                <CardTitle className="text-sm font-semibold">
                  Sollicitatie-antwoorden
                </CardTitle>
              </CardHeader>
              <Separator />
              <CardContent className="p-0">
                <SollicitatieAntwoordenRows
                  rows={quizPairs}
                  className="border-0"
                />
              </CardContent>
            </Card>
          ) : null}

          <Card className="rounded-xl border-line shadow-none">
            <CardHeader className="px-4 py-3 sm:px-5">
              <CardTitle className="text-sm font-semibold">Notities</CardTitle>
              <CardDescription>
                Interne teamnotities over deze kandidaat.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="space-y-3 p-4 sm:p-5">
              <div className="grid gap-1.5">
                <Label htmlFor={`note-${kandidaat.id}`}>Nieuwe notitie</Label>
                <Textarea
                  id={`note-${kandidaat.id}`}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={3}
                  disabled={saving || noteBusy}
                  placeholder="Bijv. gebeld, geen gehoor / komt niet op gesprek…"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={saving || noteBusy || !noteDraft.trim()}
                  onClick={() => void addNotitie()}
                >
                  {noteBusy ? "Opslaan…" : "Notitie toevoegen"}
                </Button>
              </div>
              {noteError ? (
                <Alert variant="destructive">
                  <AlertDescription>{noteError}</AlertDescription>
                </Alert>
              ) : null}
              {noteEntries.length === 0 ? (
                <p className="text-xs text-muted">Nog geen notities.</p>
              ) : (
                <ul className="space-y-2">
                  {[...noteEntries].reverse().map((e, i) => (
                    <li
                      key={`${e.at}-${i}`}
                      className="rounded-lg border border-line bg-wash/40 px-3 py-2.5"
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {formatDateTimeNl(e.at)}
                        {e.author ? ` · ${e.author}` : ""}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                        {e.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <AdresEditor
            kandidaat={kandidaat}
            saving={saving}
            onSave={onSave}
          />

          <Card className="rounded-xl border-line shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3 sm:px-5">
              <CardTitle className="text-sm font-semibold">
                Bestanden
                {bestanden.length > 0 ? (
                  <span className="ml-1.5 font-normal text-muted">
                    ({bestanden.length})
                  </span>
                ) : null}
              </CardTitle>
              <label
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "cursor-pointer gap-1.5",
                  uploading ? "pointer-events-none opacity-50" : ""
                )}
              >
                <Upload className="size-3.5" />
                {uploading ? "Uploaden…" : "Uploaden"}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </CardHeader>
            <Separator />
            {bestanden.length === 0 ? (
              <CardContent className="px-4 py-6 text-sm text-muted sm:px-5">
                Nog geen bestanden.
              </CardContent>
            ) : (
              <ul className="divide-y divide-line">
                {bestanden.map((file: SollicitatieBestand) => (
                  <li
                    key={file.id}
                    className="group flex items-center justify-between gap-3 px-4 py-3 sm:px-5"
                  >
                    <a
                      href={file.url || "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm font-medium text-green-deeper hover:underline"
                    >
                      {file.bestandsnaam || "Bestand"}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="opacity-0 transition group-hover:opacity-100"
                      onClick={() => onDeleteFile(file.id)}
                    >
                      Verwijderen
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card className="rounded-xl border-line shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-3">
              <CardTitle className="text-sm font-semibold">
                Gesprekken
                {upcoming.length > 0 ? (
                  <Badge className="ml-1.5 bg-green-soft text-green-deeper hover:bg-green-soft">
                    {upcoming.length}
                  </Badge>
                ) : null}
              </CardTitle>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto px-0"
                onClick={onPlan}
              >
                + Plannen
              </Button>
            </CardHeader>
            <Separator />
            <CardContent className="min-h-[140px] p-0">
              {afsprakenLoading ? (
                <p className="px-4 py-8 text-sm text-muted">Laden…</p>
              ) : afspraken.length === 0 ? (
                <div className="flex flex-col items-stretch gap-3 px-4 py-5">
                  <p className="text-sm text-muted">Nog geen gesprekken.</p>
                  <Button type="button" onClick={onPlan}>
                    <CalendarPlus className="size-4" />
                    Eerste gesprek plannen
                  </Button>
                </div>
              ) : (
                <div>
                  {upcoming.length > 0 && (
                    <div>
                      <p className="bg-wash px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Gepland
                      </p>
                      <ul className="divide-y divide-line">
                        {upcoming.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-start justify-between gap-2 px-4 py-2.5"
                          >
                            <div>
                              <p className="text-sm font-medium text-ink">
                                {formatDateTimeNl(a.start_at)}
                              </p>
                              <p className="text-[11px] text-muted">
                                {a.soort === "telefonisch"
                                  ? "Telefonisch"
                                  : "Fysiek"}
                                {" · 30 min"}
                                {(a.interviewer?.naam || a.adviseurs?.naam) &&
                                  ` · met ${(a.interviewer?.naam || a.adviseurs?.naam || "").trim().split(/\s+/)[0]}`}
                                {a.notitie ? ` · ${a.notitie}` : ""}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => onDeleteAfspraak(a.id)}
                            >
                              Verwijder
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {past.length > 0 && (
                    <div>
                      <p className="bg-wash px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Eerder
                      </p>
                      <ul className="divide-y divide-line">
                        {past.map((a) => (
                          <li
                            key={a.id}
                            className="flex items-start justify-between gap-2 px-4 py-2.5 opacity-70"
                          >
                            <div>
                              <p className="text-sm font-medium text-ink">
                                {formatDateTimeNl(a.start_at)}
                              </p>
                              <p className="text-[11px] text-muted">
                                {formatTimeNl(a.start_at)} ·{" "}
                                {a.soort === "telefonisch"
                                  ? "Telefonisch"
                                  : "Fysiek"}
                                {(a.interviewer?.naam || a.adviseurs?.naam) &&
                                  ` · met ${(a.interviewer?.naam || a.adviseurs?.naam || "").trim().split(/\s+/)[0]}`}
                              </p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => onDeleteAfspraak(a.id)}
                            >
                              Verwijder
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-line shadow-none">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm font-semibold">Status</CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-col gap-2 p-3">
              <NativeSelect
                value={status}
                disabled={saving}
                aria-label="Status wijzigen"
                onChange={(e) => {
                  void changeStatus(e.target.value as SollicitatieStatus);
                }}
                className="w-full font-semibold [&_select]:font-semibold"
                style={{
                  background: tone.soft,
                  color: tone.text,
                  borderColor: `${tone.bar}33`,
                }}
              >
                {SOLLICITATIE_STATUSES.map((st) => (
                  <NativeSelectOption key={st} value={st}>
                    {SOLLICITATIE_STATUS_LABEL[st]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {status === SOLLICITATIE_STATUS_MET_VERVOLG ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={onRequestBeoordeling}
                >
                  Notitie &amp; vervolgtaak
                </Button>
              ) : null}
            </CardContent>
            <Separator />
            <CardContent className="space-y-2 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Training
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {gekoppeldeTraining?.naam || "Nog niet gezet"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={onRequestTraining}
              >
                {gekoppeldeTraining ? "Training wijzigen" : "Op training zetten"}
              </Button>
            </CardContent>
            <Separator />
            <CardContent className="space-y-3 px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Functie
                </p>
                <p className="mt-1 text-sm font-medium text-ink">
                  {kandidaat.functie || "—"}
                </p>
              </div>
              <Button type="button" className="w-full" onClick={onPlan}>
                <CalendarPlus className="size-4" />
                Gesprek plannen
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
