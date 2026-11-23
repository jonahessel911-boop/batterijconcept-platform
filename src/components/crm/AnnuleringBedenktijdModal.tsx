"use client";

import { useEffect, useMemo, useState } from "react";
import type { Project } from "@/types/database";
import {
  bedenktijdVanOndertekening,
  ondertekendOpVanProject,
} from "@/lib/bedenktijd";
import { isWarmtefondsProject } from "@/lib/backoffice-acties";
import {
  annuleringAfrekening,
  type AnnuleringAfrekening,
} from "@/lib/av-annulering";
import { formatEuro } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export type AnnuleringKeuze = {
  binnenBedenktijd: boolean;
  stuurMail: boolean;
  /** Binnen bedenktijd: verstuurde facturen meteen crediteren. */
  creditFacturen: boolean;
};

type WarmtefondsVervolg = "meewerken" | "annuleren_kosten";

type FactuurLike = {
  status: string;
  bedrag_inc_btw: number | null;
  credit_van_factuur_id?: string | null;
  omschrijving?: string | null;
};

function AfrekeningSheet({ afrekening }: { afrekening: AnnuleringAfrekening }) {
  const bij = afrekening.richting === "bijbetalen";
  const terug = afrekening.richting === "terugbetalen";
  return (
    <div className="rounded-lg border bg-muted/40 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Rekensom · art. 4A AV
      </p>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Order incl. btw</dt>
          <dd className="tabular-nums font-medium">
            {formatEuro(afrekening.orderInc)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            Annuleringskosten ({afrekening.pct}%)
          </dt>
          <dd className="tabular-nums font-medium">
            {formatEuro(afrekening.kostenInc)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Al betaald (aanbetaling e.d.)</dt>
          <dd className="tabular-nums font-medium">
            − {formatEuro(afrekening.alBetaaldInc)}
          </dd>
        </div>
        <div className="border-t pt-1.5">
          {bij ? (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-[#9A3B1A]">
                Nog bij te betalen
              </dt>
              <dd className="tabular-nums font-semibold text-[#9A3B1A]">
                {formatEuro(afrekening.saldoInc)}
              </dd>
            </div>
          ) : terug ? (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold text-green-deeper">
                Terug te betalen aan klant
              </dt>
              <dd className="tabular-nums font-semibold text-green-deeper">
                {formatEuro(Math.abs(afrekening.saldoInc))}
              </dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="font-semibold">Vereffend</dt>
              <dd className="tabular-nums font-semibold">
                {formatEuro(0)}
              </dd>
            </div>
          )}
        </div>
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {bij
          ? "Bij doorzetten: factuur voor dit restant wordt automatisch aangemaakt en naar de klant gemaild."
          : terug
            ? "Klant heeft meer betaald dan de 20% — dit bedrag terugbetalen / crediteren (geen extra factuur)."
            : "Al betaald dekt precies de annuleringskosten — geen extra factuur."}
      </p>
    </div>
  );
}

/**
 * Popup vóór order-annulering: bedenktijd-check bepaalt of
 * annuleringskosten in de klantmail komen.
 * Warmtefonds + na bedenktijd: eerst kiezen meewerken vs. kosten.
 * Bij «na bedenktijd»: korte rekensom (bijbetalen / terugbetalen).
 */
export function AnnuleringBedenktijdModal({
  project,
  onClose,
  onConfirm,
  busy,
  /** Alleen mail versturen (status staat al op annulering). */
  mailOnly = false,
  orderIncBtw = 0,
  facturen = [],
}: {
  project: Project;
  onClose: () => void;
  onConfirm: (keuze: AnnuleringKeuze) => void | Promise<void>;
  busy?: boolean;
  mailOnly?: boolean;
  orderIncBtw?: number | null;
  facturen?: FactuurLike[];
}) {
  const warmtefonds = isWarmtefondsProject(project);
  const [ondertekendOp, setOndertekendOp] = useState<string | null>(() =>
    ondertekendOpVanProject(project)
  );
  const [loadingDatum, setLoadingDatum] = useState(
    !ondertekendOpVanProject(project)
  );
  const [binnenBedenktijd, setBinnenBedenktijd] = useState<boolean | null>(
    null
  );
  const [wfVervolg, setWfVervolg] = useState<WarmtefondsVervolg | null>(null);
  const [stuurMail, setStuurMail] = useState(true);
  const [creditFacturen, setCreditFacturen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedOrderInc, setLoadedOrderInc] = useState<number | null>(null);
  const [loadedFacturen, setLoadedFacturen] = useState<FactuurLike[] | null>(
    null
  );

  const effectiveOrderInc =
    Number(orderIncBtw) > 0
      ? Number(orderIncBtw)
      : loadedOrderInc != null
        ? loadedOrderInc
        : Number(
            (Array.isArray(project.offertes)
              ? project.offertes[0]
              : project.offertes
            )?.totaal_inc_btw
          ) || 0;
  const effectiveFacturen = facturen.length
    ? facturen
    : loadedFacturen || [];

  const afrekening = useMemo(
    () =>
      annuleringAfrekening({
        orderIncBtw: effectiveOrderInc,
        facturen: effectiveFacturen,
      }),
    [effectiveOrderInc, effectiveFacturen]
  );

  // Laad order + facturen voor rekensom als parent ze niet doorgeeft.
  useEffect(() => {
    if (binnenBedenktijd !== false) return;
    if (Number(orderIncBtw) > 0 && facturen.length > 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const [pRes, fRes] = await Promise.all([
          Number(orderIncBtw) > 0
            ? null
            : fetch(`/api/projecten/${project.id}`),
          facturen.length > 0
            ? null
            : fetch(`/api/projecten/${project.id}/facturen`),
        ]);
        if (cancelled) return;
        if (pRes) {
          const data = await pRes.json().catch(() => ({}));
          const p = (data as { project?: Project }).project;
          const off = p
            ? Array.isArray(p.offertes)
              ? p.offertes[0]
              : p.offertes
            : null;
          setLoadedOrderInc(Number(off?.totaal_inc_btw) || 0);
        }
        if (fRes) {
          const data = await fRes.json().catch(() => ({}));
          setLoadedFacturen(
            ((data as { facturen?: FactuurLike[] }).facturen ||
              []) as FactuurLike[]
          );
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [binnenBedenktijd, orderIncBtw, facturen.length, project.id]);

  useEffect(() => {
    if (ondertekendOpVanProject(project)) {
      setOndertekendOp(ondertekendOpVanProject(project));
      setLoadingDatum(false);
      return;
    }
    let cancelled = false;
    setLoadingDatum(true);
    void (async () => {
      try {
        const res = await fetch(`/api/projecten/${project.id}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const p = (data as { project?: Project }).project;
        setOndertekendOp(p ? ondertekendOpVanProject(p) : null);
      } catch {
        if (!cancelled) setOndertekendOp(null);
      } finally {
        if (!cancelled) setLoadingDatum(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project]);

  const info = bedenktijdVanOndertekening(ondertekendOp);
  const toontWfFork =
    !mailOnly && warmtefonds && binnenBedenktijd === false;
  const wilMeewerken = toontWfFork && wfVervolg === "meewerken";
  const wilAnnulerenMetKosten =
    !toontWfFork || wfVervolg === "annuleren_kosten";
  const toontRekensom =
    binnenBedenktijd === false &&
    wilAnnulerenMetKosten &&
    !wilMeewerken &&
    afrekening.orderInc > 0;

  async function submit() {
    if (binnenBedenktijd == null) {
      setError(
        "Kies of de klant binnen of na de bedenktijd heeft geannuleerd."
      );
      return;
    }
    if (toontWfFork && wfVervolg == null) {
      setError("Kies of de klant meewerkt met Warmtefonds of annuleert.");
      return;
    }
    if (wilMeewerken) {
      setError(null);
      onClose();
      return;
    }
    setError(null);
    await onConfirm({
      binnenBedenktijd,
      stuurMail: mailOnly ? true : stuurMail,
      creditFacturen: binnenBedenktijd === true && creditFacturen,
    });
  }

  const canSubmit =
    binnenBedenktijd != null &&
    (!toontWfFork || wfVervolg != null);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {mailOnly ? "Annuleringsmail versturen" : "Order annuleren"}
          </DialogTitle>
          <DialogDescription>
            {project.project_nummer || "Project"} ·{" "}
            {project.leads?.naam || "klant"}
            {warmtefonds ? " · Warmtefonds" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">
              Heeft de klant binnen zijn bedenktijd geannuleerd?
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Schriftelijke annulering had moeten plaatsvinden vóór{" "}
              {loadingDatum ? (
                "…"
              ) : info ? (
                <span className="font-medium text-foreground">
                  {info.eindLabel}
                </span>
              ) : (
                "(ondertekeningsdatum onbekend)"
              )}
              {info && !loadingDatum ? (
                <>
                  {" "}
                  (
                  {info.klaar
                    ? "bedenktijd is verlopen"
                    : `nog ${info.dagenOver} dag${info.dagenOver === 1 ? "" : "en"}`}
                  ).
                </>
              ) : null}
            </p>
          </div>

          <RadioGroup
            value={
              binnenBedenktijd === true
                ? "ja"
                : binnenBedenktijd === false
                  ? "nee"
                  : ""
            }
            disabled={busy}
            onValueChange={(v) => {
              const value = Array.isArray(v) ? v[0] : v;
              if (value === "ja") {
                setBinnenBedenktijd(true);
                setCreditFacturen(true);
                setWfVervolg(null);
                setError(null);
              } else if (value === "nee") {
                setBinnenBedenktijd(false);
                setWfVervolg(null);
                setError(null);
              }
            }}
          >
            <Label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
                binnenBedenktijd === true
                  ? "border-primary bg-primary/5"
                  : "border-border"
              )}
            >
              <RadioGroupItem value="ja" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  Ja — binnen bedenktijd
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Geen annuleringskosten in de mail
                </span>
              </span>
            </Label>
            <Label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
                binnenBedenktijd === false
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border"
              )}
            >
              <RadioGroupItem value="nee" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium">
                  Nee — na de bedenktijd
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {warmtefonds && !mailOnly
                    ? "Kies hieronder: meewerken of annuleringskosten"
                    : "20% annuleringskosten · zie rekensom"}
                </span>
              </span>
            </Label>
          </RadioGroup>

          {toontWfFork ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">
                Warmtefonds — wat wil de klant?
              </p>
              <p className="text-xs text-muted-foreground">
                Na de bedenktijd: meewerken met de Warmtefonds-aanvraag en
                verder inregelen, of annuleren met de kosten uit de AV.
              </p>
              <RadioGroup
                value={wfVervolg || ""}
                disabled={busy}
                onValueChange={(v) => {
                  const value = Array.isArray(v) ? v[0] : v;
                  if (value === "meewerken" || value === "annuleren_kosten") {
                    setWfVervolg(value);
                    setError(null);
                  }
                }}
              >
                <Label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
                    wfVervolg === "meewerken"
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  )}
                >
                  <RadioGroupItem value="meewerken" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">
                      Meewerken met Warmtefonds
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Order blijft staan — verder inregelen (aanvraag / schouw)
                    </span>
                  </span>
                </Label>
                <Label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal",
                    wfVervolg === "annuleren_kosten"
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-border"
                  )}
                >
                  <RadioGroupItem value="annuleren_kosten" className="mt-0.5" />
                  <span>
                    <span className="block text-sm font-medium">
                      Annuleren met annuleringskosten
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      20% van het orderbedrag (art. 4A AV) · zie rekensom
                    </span>
                  </span>
                </Label>
              </RadioGroup>
            </div>
          ) : null}

          {toontRekensom ? <AfrekeningSheet afrekening={afrekening} /> : null}

          {wilAnnulerenMetKosten && !wilMeewerken ? (
            mailOnly ? (
              <p className="text-xs text-muted-foreground">
                De mail gaat naar de klant
                {binnenBedenktijd === true
                  ? " zonder annuleringskosten."
                  : binnenBedenktijd === false
                    ? " met annuleringskosten."
                    : "."}
              </p>
            ) : (
              <Label className="items-start font-normal">
                <Checkbox
                  checked={stuurMail}
                  disabled={busy}
                  onCheckedChange={(c) => setStuurMail(c === true)}
                  className="mt-0.5"
                />
                <span>
                  Direct annuleringsmail naar de klant sturen
                  {binnenBedenktijd === true
                    ? " (zonder kosten)"
                    : binnenBedenktijd === false
                      ? " (met annuleringskosten)"
                      : ""}
                </span>
              </Label>
            )
          ) : null}

          {binnenBedenktijd === true && !wilMeewerken ? (
            <Label className="items-start font-normal">
              <Checkbox
                checked={creditFacturen}
                disabled={busy}
                onCheckedChange={(c) => setCreditFacturen(c === true)}
                className="mt-0.5"
              />
              <span>
                Facturen direct crediteren
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  Binnen de 14 dagen: elke verstuurde factuur (betaald, deels
                  betaald of nog open) krijgt een eigen creditfactuur. Die gaat
                  naar de klant en wordt meteen geboekt. Conceptfacturen blijven
                  staan.
                </span>
              </span>
            </Label>
          ) : null}

          {wilMeewerken ? (
            <p className="text-xs text-muted-foreground">
              De order wordt niet geannuleerd. Sluit deze popup en regel de
              Warmtefonds-aanvraag verder.
            </p>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Sluiten
          </Button>
          <Button
            type="button"
            variant={wilMeewerken ? "default" : "destructive"}
            disabled={busy || !canSubmit}
            onClick={() => void submit()}
          >
            {busy
              ? "Bezig…"
              : wilMeewerken
                ? "Verder met Warmtefonds"
                : mailOnly
                  ? "Mail versturen"
                  : "Order annuleren"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
