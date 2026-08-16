"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { Lead } from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import { adresRegel } from "@/lib/format";
import { AdviesShell } from "./AdviesShell";
import {
  INITIAL_ANSWERS,
  STEP_ORDER,
  type AdviesAnswers,
  type AdviesStepId,
} from "./types";
import { StepAdres } from "./steps/StepAdres";
import { StepKwalificatie } from "./steps/StepKwalificatie";
import { StepSaldering } from "./steps/StepSaldering";
import { StepBatterij } from "./steps/StepBatterij";
import {
  StepMensen,
  StepOverOns,
  StepTrustpilot,
} from "./steps/StepOverOns";
import { StepFinanciering } from "./steps/StepFinanciering";
import { StepProduct, StepTechCheck } from "./steps/StepProduct";
import { StepPrijs } from "./steps/StepPrijs";
import { StepBevestiging } from "./steps/StepBevestiging";

export function AdviesFlow() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;

  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [straat, setStraat] = useState("");
  const [postcode, setPostcode] = useState("");
  const [huisnummer, setHuisnummer] = useState("");
  const [toevoeging, setToevoeging] = useState("");
  const [plaats, setPlaats] = useState("");
  const [adresConfirmed, setAdresConfirmed] = useState(false);

  const [step, setStep] = useState<AdviesStepId>("adres");
  const [answers, setAnswers] = useState<AdviesAnswers>(INITIAL_ANSWERS);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        setError("Supabase niet geconfigureerd");
        setLoading(false);
        return;
      }
      try {
        const sb = getSupabaseBrowser();
        const { data, error: err } = await sb
          .from("leads")
          .select("*")
          .eq("id", leadId)
          .single();
        if (err || !data) {
          if (!cancelled) setError("Lead niet gevonden");
        } else if (!cancelled) {
          const l = data as Lead;
          setLead(l);
          setStraat(l.straat || "");
          setPostcode(l.postcode || "");
          setHuisnummer(l.huisnummer || "");
          setToevoeging(l.toevoeging || "");
          setPlaats(l.plaats || "");
        }
      } catch {
        if (!cancelled) setError("Laden mislukt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  const leadNaam = lead?.naam || "de klant";
  const plaatsNaam = plaats || lead?.plaats || "";
  const adres = useMemo(
    () =>
      adresRegel({
        straat,
        postcode,
        huisnummer,
        toevoeging,
        plaats,
      }),
    [straat, postcode, huisnummer, toevoeging, plaats]
  );

  const patchAnswers = useCallback((patch: Partial<AdviesAnswers>) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
  }, []);

  const go = useCallback((s: AdviesStepId) => setStep(s), []);

  const stepIndex = STEP_ORDER.indexOf(step);
  const back = useCallback(() => {
    if (stepIndex <= 0) return;
    // Tech-check niet opnieuw afspelen bij terugnavigeren
    if (STEP_ORDER[stepIndex] === "product") {
      go("financiering");
      return;
    }
    go(STEP_ORDER[stepIndex - 1]!);
  }, [go, stepIndex]);

  const next = useCallback(() => {
    if (stepIndex >= STEP_ORDER.length - 1) return;
    go(STEP_ORDER[stepIndex + 1]!);
  }, [go, stepIndex]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7faf8] text-muted">
        Adviesproces laden…
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f7faf8] text-ink">
        <p>{error || "Lead niet gevonden"}</p>
        <Link href="/" className="text-sm text-green underline">
          Terug naar CRM
        </Link>
      </div>
    );
  }

  const hideNav = step === "tech_check";

  let canNext = true;
  let nextLabel = "Verder";

  if (step === "adres") {
    canNext = adresConfirmed;
    nextLabel = "Naar kwalificatie";
  } else if (step === "kwalificatie") {
    canNext =
      answers.heeftZonnepanelen !== null &&
      (answers.heeftZonnepanelen === false ||
        (answers.aantalPanelen ?? 0) > 0) &&
      (answers.jaarverbruikKwh ?? 0) > 0 &&
      answers.teruglevering !== null &&
      (answers.prijsPerKwh ?? 0) > 0 &&
      (answers.terugleverkostenModus === "totaal"
        ? answers.terugleverkostenTotaalJaar !== null
        : answers.terugleverkostenPerKwh !== null);
    nextLabel = "Naar saldering";
  } else if (step === "financiering") {
    canNext = answers.financieringen.length > 0;
  } else if (step === "prijs") {
    canNext = answers.subsidieCheckGedaan;
    nextLabel = "Naar afronden";
  } else if (step === "bevestiging") {
    canNext = false;
  } else if (step === "product") {
    nextLabel = "Naar prijs";
  }

  return (
    <AdviesShell
      leadNaam={leadNaam}
      leadId={lead.id}
      step={step}
      hideNav={hideNav}
      onBack={stepIndex > 0 && step !== "tech_check" ? back : undefined}
      onNext={
        step === "bevestiging" ||
        step === "tech_check" ||
        step === "batterij" ||
        step === "over_ons" ||
        step === "mensen" ||
        step === "product" ||
        !canNext
          ? undefined
          : next
      }
      nextLabel={nextLabel}
      nextDisabled={!canNext}
    >
      {step === "adres" && (
        <StepAdres
          leadNaam={leadNaam}
          adres={adres}
          straat={straat}
          postcode={postcode}
          huisnummer={huisnummer}
          toevoeging={toevoeging}
          plaats={plaats}
          confirmed={adresConfirmed}
          onChange={(p) => {
            if (p.straat !== undefined) setStraat(p.straat);
            if (p.postcode !== undefined) setPostcode(p.postcode);
            if (p.huisnummer !== undefined) setHuisnummer(p.huisnummer);
            if (p.toevoeging !== undefined) setToevoeging(p.toevoeging);
            if (p.plaats !== undefined) setPlaats(p.plaats);
            setAdresConfirmed(false);
          }}
          onConfirm={() => {
            setAdresConfirmed(true);
            window.setTimeout(() => go("kwalificatie"), 350);
          }}
        />
      )}
      {step === "kwalificatie" && (
        <StepKwalificatie
          leadNaam={leadNaam}
          answers={answers}
          onChange={patchAnswers}
        />
      )}
      {step === "saldering" && <StepSaldering leadNaam={leadNaam} />}
      {step === "batterij" && (
        <StepBatterij leadNaam={leadNaam} onDone={next} />
      )}
      {step === "over_ons" && <StepOverOns onDone={next} />}
      {step === "mensen" && <StepMensen onDone={next} />}
      {step === "trustpilot" && <StepTrustpilot />}
      {step === "financiering" && (
        <StepFinanciering
          answers={answers}
          onChange={patchAnswers}
          plaatsNaam={plaatsNaam}
        />
      )}
      {step === "tech_check" && (
        <StepTechCheck
          leadNaam={leadNaam}
          plaatsNaam={plaatsNaam}
          adres={adres}
          onDone={() => go("product")}
        />
      )}
      {step === "product" && (
        <StepProduct
          leadNaam={leadNaam}
          plaatsNaam={plaatsNaam}
          heeftZonnepanelen={answers.heeftZonnepanelen}
          onDone={next}
        />
      )}
      {step === "prijs" && (
        <StepPrijs
          leadNaam={leadNaam}
          plaatsNaam={plaatsNaam}
          answers={answers}
          onChange={patchAnswers}
        />
      )}
      {step === "bevestiging" && (
        <StepBevestiging
          leadNaam={leadNaam}
          answers={answers}
          onChange={patchAnswers}
        />
      )}
    </AdviesShell>
  );
}
