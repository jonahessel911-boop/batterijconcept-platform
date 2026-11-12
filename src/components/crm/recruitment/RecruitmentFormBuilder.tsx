"use client";

import { useEffect, useRef } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Plus,
  Trash2,
  Type,
} from "lucide-react";
import type { RecruitmentForm, RecruitmentFormStep } from "@/lib/recruitment-form";
import {
  defaultAppointmentSetterForm,
  defaultFormForRol,
  defaultSalesForm,
  emptyButtonsStep,
  emptyCheckboxesStep,
  emptyContactStep,
  emptyTextStep,
} from "@/lib/recruitment-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

function AddStepsBar({
  onAdd,
  sticky,
}: {
  onAdd: (type: "buttons" | "text" | "checkboxes") => void;
  sticky?: boolean;
}) {
  return (
    <div
      className={
        sticky
          ? "sticky top-0 z-10 rounded-xl border border-green/40 bg-white p-3 shadow-sm ring-1 ring-green/20"
          : "rounded-xl border border-dashed border-green/40 bg-green-soft/30 p-3"
      }
    >
      <p className="mb-2 text-sm font-semibold text-ink">Vraag toevoegen</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          className="justify-start sm:flex-1"
          onClick={() => onAdd("buttons")}
        >
          <Plus className="size-4" />
          <CircleDot className="size-3.5" />
          Keuze (buttons)
        </Button>
        <Button
          type="button"
          variant="outline"
          className="justify-start sm:flex-1"
          onClick={() => onAdd("text")}
        >
          <Plus className="size-4" />
          <Type className="size-3.5" />
          Open vraag
        </Button>
        <Button
          type="button"
          variant="outline"
          className="justify-start sm:flex-1"
          onClick={() => onAdd("checkboxes")}
        >
          <Plus className="size-4" />
          <CheckSquare className="size-3.5" />
          Meerkeuze
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Nieuwe vragen komen vóór de contactgegevens. Verplaats met ↑ ↓.
      </p>
    </div>
  );
}

export function RecruitmentFormBuilder({
  value,
  onChange,
  rol,
}: {
  value: RecruitmentForm;
  onChange: (next: RecruitmentForm) => void;
  rol?: string | null;
}) {
  const lastAddedId = useRef<string | null>(null);

  useEffect(() => {
    if (!lastAddedId.current) return;
    const id = lastAddedId.current;
    const el = document.getElementById(`form-step-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = document.getElementById(
      `form-step-vraag-${id}`
    ) as HTMLTextAreaElement | null;
    window.setTimeout(() => {
      input?.focus();
      input?.select();
    }, 250);
    lastAddedId.current = null;
  }, [value.steps]);

  function patch(partial: Partial<RecruitmentForm>) {
    onChange({ ...value, ...partial });
  }

  function updateStep(id: string, partial: Partial<RecruitmentFormStep>) {
    onChange({
      ...value,
      steps: value.steps.map((s) => (s.id === id ? { ...s, ...partial } : s)),
    });
  }

  function moveStep(id: string, dir: -1 | 1) {
    const idx = value.steps.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = idx + dir;
    if (next < 0 || next >= value.steps.length) return;
    const steps = [...value.steps];
    const [row] = steps.splice(idx, 1);
    steps.splice(next, 0, row!);
    onChange({ ...value, steps });
  }

  function removeStep(id: string) {
    const steps = value.steps.filter((s) => s.id !== id);
    if (!steps.some((s) => s.type === "contact")) {
      steps.push(emptyContactStep());
    }
    onChange({ ...value, steps });
  }

  function addStep(type: "buttons" | "text" | "checkboxes") {
    const contactIdx = value.steps.findIndex((s) => s.type === "contact");
    const step =
      type === "buttons"
        ? emptyButtonsStep()
        : type === "checkboxes"
          ? emptyCheckboxesStep()
          : emptyTextStep();
    lastAddedId.current = step.id;
    const steps = [...value.steps];
    if (contactIdx >= 0) steps.splice(contactIdx, 0, step);
    else steps.push(step);
    onChange({ ...value, steps });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Formulier</p>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(defaultFormForRol(rol))}
          >
            Template voor rol
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(defaultSalesForm())}
          >
            Sales
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(defaultAppointmentSetterForm())}
          >
            Setter
          </Button>
        </div>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label className="text-sm">Headline (boven het form)</Label>
          <Textarea
            rows={3}
            value={value.headline}
            onChange={(e) => patch({ headline: e.target.value })}
            placeholder="Bekijk of je in aanmerking komt…"
            className="min-h-24 px-3 py-3 text-base md:text-base"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Subkop</Label>
          <Input
            value={value.subheadline}
            onChange={(e) => patch({ subheadline: e.target.value })}
            placeholder="Thuisbatterijen · buitendienst…"
            className="h-12 px-3 text-base md:text-base"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm">Voordelen (één per regel)</Label>
          <Textarea
            rows={4}
            value={value.voordelen.join("\n")}
            onChange={(e) =>
              patch({
                voordelen: e.target.value
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            className="min-h-28 px-3 py-3 text-base md:text-base"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          Vragen ({value.steps.filter((s) => s.type !== "contact").length})
        </p>
      </div>

      <AddStepsBar onAdd={addStep} sticky />

      <ul className="space-y-3">
        {value.steps.map((step, idx) => (
          <li
            key={step.id}
            id={`form-step-${step.id}`}
            className="rounded-xl bg-wash/40 p-3 ring-1 ring-line"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                Stap {idx + 1} ·{" "}
                {step.type === "buttons"
                  ? "Keuze"
                  : step.type === "checkboxes"
                    ? "Meerkeuze"
                    : step.type === "text"
                      ? "Open vraag"
                      : "Contact"}
              </Badge>
              <span className="truncate font-mono text-[10px] text-muted">
                id: {step.id}
              </span>
              <div className="ml-auto flex gap-0.5">
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center text-muted hover:bg-white hover:text-ink disabled:opacity-30"
                  disabled={idx === 0}
                  onClick={() => moveStep(step.id, -1)}
                  title="Omhoog"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center text-muted hover:bg-white hover:text-ink disabled:opacity-30"
                  disabled={idx === value.steps.length - 1}
                  onClick={() => moveStep(step.id, 1)}
                  title="Omlaag"
                >
                  <ChevronDown className="size-4" />
                </button>
                {step.type !== "contact" ? (
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center text-muted hover:bg-[#FCEAEA] hover:text-[#9B2C2C]"
                    onClick={() => removeStep(step.id)}
                    title="Vraag verwijderen"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-sm" htmlFor={`form-step-vraag-${step.id}`}>
                  Vraag / titel
                </Label>
                <Textarea
                  id={`form-step-vraag-${step.id}`}
                  rows={3}
                  value={step.vraag}
                  onChange={(e) =>
                    updateStep(step.id, { vraag: e.target.value })
                  }
                  className="min-h-24 px-3 py-3 text-base md:text-base"
                />
              </div>

              {step.type === "buttons" || step.type === "checkboxes" ? (
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    {step.type === "checkboxes"
                      ? "Opties (één per regel) — meerdere mogelijk"
                      : "Opties (één per regel) — klik = volgende stap"}
                  </Label>
                  <Textarea
                    rows={4}
                    value={(step.opties || []).join("\n")}
                    onChange={(e) =>
                      updateStep(step.id, {
                        opties: e.target.value
                          .split("\n")
                          .map((l) => l.trim())
                          .filter(Boolean),
                      })
                    }
                    className="min-h-28 px-3 py-3 text-base md:text-base"
                  />
                </div>
              ) : null}

              {step.type === "checkboxes" ? (
                <div className="space-y-1.5">
                  <Label className="text-sm">
                    Label boven opties (bijv. meerdere antwoorden)
                  </Label>
                  <Input
                    value={step.label || ""}
                    onChange={(e) =>
                      updateStep(step.id, { label: e.target.value })
                    }
                    placeholder="(meerdere antwoorden mogelijk)"
                    className="h-12 px-3 text-base md:text-base"
                  />
                </div>
              ) : null}

              {step.type !== "contact" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-sm">
                      Alleen tonen na stap-id (optioneel)
                    </Label>
                    <Input
                      value={step.show_if?.step_id || ""}
                      onChange={(e) => {
                        const step_id = e.target.value.trim();
                        if (!step_id) {
                          updateStep(step.id, { show_if: undefined });
                          return;
                        }
                        updateStep(step.id, {
                          show_if: {
                            step_id,
                            any_of: step.show_if?.any_of || [],
                          },
                        });
                      }}
                      placeholder="id van eerdere stap"
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">
                      Bij antwoorden (één per regel)
                    </Label>
                    <Textarea
                      rows={3}
                      value={(step.show_if?.any_of || []).join("\n")}
                      disabled={!step.show_if?.step_id}
                      onChange={(e) => {
                        if (!step.show_if?.step_id) return;
                        updateStep(step.id, {
                          show_if: {
                            step_id: step.show_if.step_id,
                            any_of: e.target.value
                              .split("\n")
                              .map((l) => l.trim())
                              .filter(Boolean),
                          },
                        });
                      }}
                      placeholder={"Ja, 1 jaar\nJa, meer dan 1 jaar"}
                      className="min-h-24 px-3 py-3 text-base md:text-base"
                    />
                  </div>
                </div>
              ) : null}

              {step.type === "text" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-sm">Label</Label>
                    <Input
                      value={step.label || ""}
                      onChange={(e) =>
                        updateStep(step.id, { label: e.target.value })
                      }
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-sm">Placeholder</Label>
                    <Input
                      value={step.placeholder || ""}
                      onChange={(e) =>
                        updateStep(step.id, { placeholder: e.target.value })
                      }
                      className="h-12 px-3 text-base md:text-base"
                    />
                  </div>
                </div>
              ) : null}

              {step.type === "contact" ? (
                <div className="space-y-1.5">
                  <Label className="text-sm">Subtitel</Label>
                  <Input
                    value={step.subtitle || ""}
                    onChange={(e) =>
                      updateStep(step.id, { subtitle: e.target.value })
                    }
                    className="h-12 px-3 text-base md:text-base"
                  />
                  <p className="text-sm text-muted">
                    Vast: voornaam, achternaam, e-mail, telefoon, postcode,
                    huisnummer.
                  </p>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <AddStepsBar onAdd={addStep} />

      <div className="space-y-2">
        <Label className="text-sm">Footer-tekst</Label>
        <Input
          value={value.footer}
          onChange={(e) => patch({ footer: e.target.value })}
          className="h-12 px-3 text-base md:text-base"
        />
      </div>

      <p className="text-[11px] text-muted">
        Tip: contactgegevens blijven altijd aan het eind. Keuze-vragen gaan
        automatisch door na een klik. Vergeet niet «Vragen opslaan».
      </p>
    </div>
  );
}
