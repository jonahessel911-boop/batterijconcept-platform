"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Clock } from "lucide-react";
import type { RecruitmentForm } from "@/lib/recruitment-form";
import {
  decodeMultiAnswers,
  encodeMultiAnswers,
  visibleSteps,
} from "@/lib/recruitment-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type ContactState = {
  voornaam: string;
  achternaam: string;
  email: string;
  telefoon: string;
  postcode: string;
  huisnummer: string;
};

const emptyContact = (): ContactState => ({
  voornaam: "",
  achternaam: "",
  email: "",
  telefoon: "",
  postcode: "",
  huisnummer: "",
});

export function WerkenbijQuiz({
  vacatureId,
  vacatureTitel,
  form,
}: {
  vacatureId: string;
  vacatureTitel: string;
  form: RecruitmentForm;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [textDraft, setTextDraft] = useState("");
  const [checkDraft, setCheckDraft] = useState<string[]>([]);
  const [contact, setContact] = useState<ContactState>(emptyContact);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const steps = useMemo(
    () => visibleSteps(form.steps, answers),
    [form.steps, answers]
  );

  const step = steps[cursor] || null;
  const total = steps.length;

  // Als visibility verandert (bijv. Nee op ervaring), cursor binnen bereik houden
  useEffect(() => {
    if (cursor > steps.length - 1) {
      setCursor(Math.max(0, steps.length - 1));
    }
  }, [steps.length, cursor]);

  // Sync checkbox draft bij step-wissel
  useEffect(() => {
    if (!step || step.type !== "checkboxes") {
      setCheckDraft([]);
      return;
    }
    setCheckDraft(decodeMultiAnswers(answers[step.id]));
  }, [step?.id, step?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = useMemo(
    () =>
      steps.map((_, i) =>
        i < cursor ? "done" : i === cursor ? "current" : "todo"
      ),
    [steps, cursor]
  );

  function goNext() {
    setError(null);
    setTextDraft("");
    setCursor((i) => Math.min(i + 1, Math.max(0, total - 1)));
  }

  function chooseButton(optie: string) {
    if (!step) return;
    const nextAnswers = { ...answers, [step.id]: optie };
    // Verwijder antwoorden van stappen die hierdoor verdwijnen
    for (const s of form.steps) {
      if (s.show_if?.step_id === step.id && !s.show_if.any_of.includes(optie)) {
        delete nextAnswers[s.id];
      }
    }
    setAnswers(nextAnswers);
    window.setTimeout(() => {
      const nextVisible = visibleSteps(form.steps, nextAnswers);
      const at = nextVisible.findIndex((s) => s.id === step.id);
      const nextIdx = Math.min(at + 1, nextVisible.length - 1);
      setCursor(Math.max(0, nextIdx));
      setError(null);
      setTextDraft("");
    }, 120);
  }

  function toggleCheck(optie: string) {
    setCheckDraft((prev) =>
      prev.includes(optie)
        ? prev.filter((x) => x !== optie)
        : [...prev, optie]
    );
  }

  function submitCheckboxes() {
    if (!step) return;
    if (step.required !== false && checkDraft.length === 0) {
      setError("Selecteer minstens één optie");
      return;
    }
    const encoded = encodeMultiAnswers(checkDraft);
    setAnswers((a) => ({ ...a, [step.id]: encoded }));
    goNext();
  }

  function submitText() {
    if (!step) return;
    const val = textDraft.trim();
    if (step.required !== false && !val) {
      setError("Vul dit veld in");
      return;
    }
    setAnswers((a) => ({ ...a, [step.id]: val }));
    goNext();
  }

  async function submitContact() {
    if (!contact.voornaam.trim() || !contact.achternaam.trim()) {
      setError("Vul je naam in");
      return;
    }
    if (!contact.email.trim() && !contact.telefoon.trim()) {
      setError("E-mail of telefoon is verplicht");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const naam = `${contact.voornaam.trim()} ${contact.achternaam.trim()}`;
      // Alleen antwoorden van zichtbare stappen meesturen (met vraagtekst — server kan IDs niet altijd matchen)
      const finalVisible = visibleSteps(form.steps, answers);
      const cleanAnswers: Record<string, string> = {};
      const answerRows: {
        step_id: string;
        vraag: string;
        antwoord: string;
        type: string;
      }[] = [];
      for (const s of finalVisible) {
        if (s.type === "contact") continue;
        const v = answers[s.id];
        if (!v) continue;
        cleanAnswers[s.id] = v;
        answerRows.push({
          step_id: s.id,
          vraag: s.vraag,
          antwoord: v,
          type: s.type,
        });
      }
      const res = await fetch("/api/werkenbij/solliciteer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vacature_id: vacatureId,
          naam,
          email: contact.email.trim() || null,
          telefoon: contact.telefoon.trim() || null,
          postcode: contact.postcode.trim()
            ? contact.postcode.replace(/[^0-9A-Za-z]/g, "").toUpperCase()
            : null,
          huisnummer: contact.huisnummer.trim() || null,
          answers: cleanAnswers,
          answer_rows: answerRows,
          motivatie: null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-white px-5 py-10 text-center shadow-sm ring-1 ring-line sm:px-8">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-green-soft text-green-deeper">
          <Check className="size-6" />
        </div>
        <p className="font-display text-2xl text-green-deeper">Bedankt!</p>
        <p className="mt-2 text-sm text-muted">
          We hebben je aanmelding voor <strong>{vacatureTitel}</strong>{" "}
          ontvangen. We nemen snel contact op.
        </p>
      </div>
    );
  }

  if (!step) return null;

  return (
    <div className="rounded-2xl bg-white px-4 py-6 shadow-sm ring-1 ring-line sm:px-8 sm:py-8">
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {progress.map((st, i) => (
          <span
            key={steps[i]?.id || i}
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-xs font-semibold",
              st === "done" && "bg-green text-white",
              st === "current" && "bg-green-deeper text-white",
              st === "todo" && "bg-[#E8EDE9] text-muted"
            )}
            aria-label={`Stap ${i + 1}`}
          >
            {st === "done" ? <Check className="size-3.5" /> : i + 1}
          </span>
        ))}
      </div>

      <h2 className="text-center font-display text-2xl font-semibold leading-snug tracking-tight text-ink sm:text-3xl">
        {step.vraag}
      </h2>
      {step.type === "checkboxes" && step.label ? (
        <p className="mt-2 text-center text-base text-muted">{step.label}</p>
      ) : null}
      {step.type === "contact" && step.subtitle ? (
        <p className="mt-2 text-center text-base text-muted">{step.subtitle}</p>
      ) : null}

      <div className="mt-7 space-y-3.5">
        {step.type === "buttons"
          ? (step.opties || []).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => chooseButton(opt)}
                className="flex w-full items-center justify-between rounded-full bg-green px-6 py-4 text-left text-base font-semibold text-white transition hover:bg-green-deeper sm:text-lg"
              >
                <span>{opt}</span>
                <ArrowRight className="size-5 shrink-0 opacity-90" />
              </button>
            ))
          : null}

        {step.type === "checkboxes" ? (
          <>
            <div className="space-y-2.5">
              {(step.opties || []).map((opt) => {
                const on = checkDraft.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleCheck(opt)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-4 text-left text-base font-medium transition",
                      on
                        ? "border-green bg-green-soft text-green-deeper"
                        : "border-line bg-white text-ink hover:border-green"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded border",
                        on
                          ? "border-green bg-green text-white"
                          : "border-line bg-white"
                      )}
                    >
                      {on ? <Check className="size-4" /> : null}
                    </span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={submitCheckboxes}
              className="flex w-full items-center justify-between rounded-full bg-green px-6 py-4 text-base font-semibold text-white transition hover:bg-green-deeper sm:text-lg"
            >
              <span>Verder</span>
              <ArrowRight className="size-5 shrink-0" />
            </button>
          </>
        ) : null}

        {step.type === "text" ? (
          <>
            <div className="space-y-2">
              <Label className="text-base text-muted">
                {step.label || "Antwoord"}
              </Label>
              <Input
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                placeholder={step.placeholder || ""}
                className="h-14 rounded-xl px-4 text-base md:text-base"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitText();
                  }
                }}
              />
            </div>
            <button
              type="button"
              onClick={submitText}
              className="flex w-full items-center justify-between rounded-full bg-green px-6 py-4 text-base font-semibold text-white transition hover:bg-green-deeper sm:text-lg"
            >
              <span>Verder</span>
              <ArrowRight className="size-5 shrink-0" />
            </button>
          </>
        ) : null}

        {step.type === "contact" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-base">Voornaam *</Label>
                <Input
                  value={contact.voornaam}
                  onChange={(e) =>
                    setContact((c) => ({ ...c, voornaam: e.target.value }))
                  }
                  className="h-14 rounded-xl px-4 text-base md:text-base"
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base">Achternaam *</Label>
                <Input
                  value={contact.achternaam}
                  onChange={(e) =>
                    setContact((c) => ({ ...c, achternaam: e.target.value }))
                  }
                  className="h-14 rounded-xl px-4 text-base md:text-base"
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-base">Email *</Label>
              <Input
                type="email"
                value={contact.email}
                onChange={(e) =>
                  setContact((c) => ({ ...c, email: e.target.value }))
                }
                className="h-14 rounded-xl px-4 text-base md:text-base"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-base">Telefoonnummer *</Label>
              <Input
                type="tel"
                value={contact.telefoon}
                onChange={(e) =>
                  setContact((c) => ({ ...c, telefoon: e.target.value }))
                }
                className="h-14 rounded-xl px-4 text-base md:text-base"
                autoComplete="tel"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-base">Postcode</Label>
                <Input
                  value={contact.postcode}
                  onChange={(e) =>
                    setContact((c) => ({ ...c, postcode: e.target.value }))
                  }
                  placeholder="1234 AB"
                  className="h-14 rounded-xl px-4 text-base md:text-base"
                  autoComplete="postal-code"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-base">Huisnummer</Label>
                <Input
                  value={contact.huisnummer}
                  onChange={(e) =>
                    setContact((c) => ({ ...c, huisnummer: e.target.value }))
                  }
                  placeholder="12"
                  className="h-14 rounded-xl px-4 text-base md:text-base"
                />
              </div>
            </div>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void submitContact()}
              className="h-14 w-full justify-between rounded-full bg-green px-6 text-base font-semibold hover:bg-green-deeper sm:text-lg"
            >
              <span>{busy ? "Versturen…" : "Bekijk uitslag"}</span>
              <ArrowRight className="size-5" />
            </Button>
          </>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {form.footer ? (
        <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
          <Clock className="size-3.5" />
          {form.footer}
        </p>
      ) : null}
    </div>
  );
}
