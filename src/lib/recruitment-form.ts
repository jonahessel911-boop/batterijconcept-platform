/** Multi-step Werkenbij-formulier (button / text / checkboxes / contact). */

export type RecruitmentFormStepType =
  | "buttons"
  | "text"
  | "checkboxes"
  | "contact";

export type RecruitmentFormShowIf = {
  step_id: string;
  /** Stap is zichtbaar als het antwoord op step_id één van deze is. */
  any_of: string[];
};

export type RecruitmentFormStep = {
  id: string;
  type: RecruitmentFormStepType;
  vraag: string;
  /** Hint / label boven input of checkboxes */
  label?: string;
  placeholder?: string;
  required?: boolean;
  /** Buttons of checkboxes */
  opties?: string[];
  /** Alleen bij contact */
  subtitle?: string;
  /** Conditionele weergave */
  show_if?: RecruitmentFormShowIf;
};

/** Scheidingsteken voor multi-select antwoorden in opslag. */
export const MULTI_ANSWER_SEP = " · ";

export function encodeMultiAnswers(vals: string[]): string {
  return vals
    .map((v) => v.trim())
    .filter(Boolean)
    .join(MULTI_ANSWER_SEP);
}

export function decodeMultiAnswers(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\s*[·|,]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isStepVisible(
  step: RecruitmentFormStep,
  answers: Record<string, string>
): boolean {
  if (!step.show_if) return true;
  const dep = (answers[step.show_if.step_id] || "").trim();
  if (!dep) return false;
  return step.show_if.any_of.includes(dep);
}

export function visibleSteps(
  steps: RecruitmentFormStep[],
  answers: Record<string, string>
): RecruitmentFormStep[] {
  return steps.filter((s) => isStepVisible(s, answers));
}

export type RecruitmentForm = {
  headline: string;
  subheadline: string;
  footer: string;
  voordelen: string[];
  steps: RecruitmentFormStep[];
};

export function newStepId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Stabiele id voor templates (niet random — anders matchen antwoorden niet bij opslaan). */
export function stableStepId(key: string) {
  return `step_${key.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}`;
}

export type RecruitmentAnswerRow = {
  step_id?: string;
  vraag: string;
  antwoord: string;
  type?: RecruitmentFormStepType;
};

export function emptyButtonsStep(): RecruitmentFormStep {
  return {
    id: newStepId(),
    type: "buttons",
    vraag: "Nieuwe vraag",
    opties: ["Ja", "Nee"],
    required: true,
  };
}

export function emptyTextStep(): RecruitmentFormStep {
  return {
    id: newStepId(),
    type: "text",
    vraag: "Nieuwe vraag",
    label: "Antwoord",
    placeholder: "",
    required: true,
  };
}

export function emptyContactStep(): RecruitmentFormStep {
  return {
    id: newStepId(),
    type: "contact",
    vraag: "Laat je gegevens achter",
    subtitle: "Dan nemen we zo snel mogelijk contact op.",
    required: true,
  };
}

export function emptyCheckboxesStep(): RecruitmentFormStep {
  return {
    id: newStepId(),
    type: "checkboxes",
    vraag: "Waar heb je ervaring mee?",
    label: "(meerdere antwoorden mogelijk)",
    opties: ["Batterijen", "Warmtepompen", "Isolatie", "Laadpalen"],
    required: true,
  };
}

/** Standaard sales-flow zoals de landingspagina-screenshots. */
export function defaultSalesForm(): RecruitmentForm {
  const ervaringId = stableStepId("sales_ervaring");
  return {
    headline:
      "Bekijk of je in aanmerking komt voor deze sales vacature waar je écht veel kan verdienen",
    subheadline: "Thuisbatterijen · buitendienst · tot €10.000 per maand",
    footer: "Meedoen duurt maar 1 minuut",
    voordelen: [
      "Buitendienst met veel vrijheid",
      "Commissie met upside tot €10.000 per maand",
      "Warme leads (afspraken) en een sterk product",
      "Direct impact op verduurzaming in Nederland",
    ],
    steps: [
      {
        id: stableStepId("sales_markt"),
        type: "buttons",
        vraag: "We verkopen thuisbatterijen. Ken je deze markt al?",
        opties: ["Ja", "Nee", "Een beetje"],
        required: true,
      },
      {
        id: stableStepId("sales_fulltime"),
        type: "buttons",
        vraag:
          "We zoeken mensen die full-time aan de slag willen, en minimaal €10k per maand willen verdienen. Ben jij dat?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId("sales_leeftijd"),
        type: "text",
        vraag: "Hoe oud ben je?",
        label: "Leeftijd",
        placeholder: "Bijv. 28",
        required: true,
      },
      {
        id: ervaringId,
        type: "buttons",
        vraag: "Heb je al ervaring in de verduurzaming?",
        opties: ["Ja, 1 jaar", "Ja, meer dan 1 jaar", "Nee"],
        required: true,
      },
      {
        id: stableStepId("sales_producten"),
        type: "checkboxes",
        vraag: "Met welke producten heb je ervaring?",
        label: "(meerdere antwoorden mogelijk)",
        opties: ["Batterijen", "Warmtepompen", "Isolatie", "Laadpalen"],
        required: true,
        show_if: {
          step_id: ervaringId,
          any_of: ["Ja, 1 jaar", "Ja, meer dan 1 jaar"],
        },
      },
      {
        id: stableStepId("sales_rijbewijs"),
        type: "buttons",
        vraag: "Heb je rijbewijs B?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId("sales_kvk"),
        type: "buttons",
        vraag: "Heb je al een KvK?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId("sales_contact"),
        type: "contact",
        vraag: "Laat je gegevens achter",
        subtitle: "Dan tonen we meteen of je in aanmerking komt.",
        required: true,
      },
    ],
  };
}

/** Appointment setter — kantoor Utrecht, KvK, verduurzaming. */
export function defaultAppointmentSetterForm(): RecruitmentForm {
  return {
    headline:
      "Check of je past als appointment setter bij BatterijConcept",
    subheadline: "Fulltime · kantoor Utrecht · warme leads voor adviseurs",
    footer: "Meedoen duurt maar 1 minuut",
    voordelen: [
      "Fulltime op kantoor in Utrecht met een scherp team",
      "Direct impact: jij vult de agenda van adviseurs",
      "Groei in een snel opschalende verduurzamer",
      "Duidelijke targets en een product waar mensen écht blij van worden",
    ],
    steps: [
      {
        id: stableStepId("as_utrecht"),
        type: "buttons",
        vraag:
          "Ben je bereid 5 dagen per week naar ons kantoor in Utrecht te komen?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId("as_kvk"),
        type: "buttons",
        vraag: "Heb je een KvK (of kun je die snel regelen)?",
        opties: ["Ja, ik heb een KvK", "Nee, maar kan snel", "Nee"],
        required: true,
      },
      {
        id: stableStepId("as_verduurzaming"),
        type: "buttons",
        vraag: "Heb je ervaring in de verduurzaming?",
        opties: ["Ja", "Nee", "Een beetje"],
        required: true,
      },
      {
        id: stableStepId("as_bellen"),
        type: "buttons",
        vraag:
          "Heb je ervaring met bellen / appointment setting / telemarketing?",
        opties: ["Ja, meer dan 1 jaar", "Ja, minder dan 1 jaar", "Nee"],
        required: true,
      },
      {
        id: stableStepId("as_fulltime"),
        type: "buttons",
        vraag: "Kun je fulltime (40 uur) starten?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId("as_leeftijd"),
        type: "text",
        vraag: "Hoe oud ben je?",
        label: "Leeftijd",
        placeholder: "Bijv. 28",
        required: true,
      },
      {
        id: stableStepId("as_contact"),
        type: "contact",
        vraag: "Laat je gegevens achter",
        subtitle: "Dan tonen we meteen of je in aanmerking komt.",
        required: true,
      },
    ],
  };
}

/** Generieke check voor montage / overige rollen. */
export function defaultGenericForm(rolLabel = "deze rol"): RecruitmentForm {
  const key = rolLabel.replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "rol";
  return {
    headline: `Check of je past voor ${rolLabel}`,
    subheadline: "Fulltime · Nederland · verduurzaming",
    footer: "Meedoen duurt maar 1 minuut",
    voordelen: [
      "Meebouwen aan de grootste B2C-verduurzamer van Nederland",
      "Duidelijke rol met impact",
      "Team dat tempo maakt",
    ],
    steps: [
      {
        id: stableStepId(`${key}_fulltime`),
        type: "buttons",
        vraag: "Kun je fulltime (5 dagen per week) aan de slag?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId(`${key}_ervaring`),
        type: "buttons",
        vraag: "Heb je ervaring in de verduurzaming?",
        opties: ["Ja", "Nee", "Een beetje"],
        required: true,
      },
      {
        id: stableStepId(`${key}_rijbewijs`),
        type: "buttons",
        vraag: "Heb je rijbewijs B?",
        opties: ["Ja", "Nee"],
        required: true,
      },
      {
        id: stableStepId(`${key}_leeftijd`),
        type: "text",
        vraag: "Hoe oud ben je?",
        label: "Leeftijd",
        placeholder: "Bijv. 28",
        required: true,
      },
      {
        id: stableStepId(`${key}_contact`),
        type: "contact",
        vraag: "Laat je gegevens achter",
        subtitle: "Dan tonen we meteen of je in aanmerking komt.",
        required: true,
      },
    ],
  };
}

/** Kies standaardformulier op basis van vacature-rol. */
export function defaultFormForRol(
  rol: string | null | undefined
): RecruitmentForm {
  const r = (rol || "").trim();
  if (r === "adviseur_sales") return defaultSalesForm();
  if (r === "appointment_setter") return defaultAppointmentSetterForm();
  if (r === "monteur") return defaultGenericForm("monteur");
  if (r === "installateur") return defaultGenericForm("installatieteam");
  if (r === "bezorger") return defaultGenericForm("bezorger / bus");
  if (r === "am_maintenance") return defaultGenericForm("AM Maintenance");
  return defaultGenericForm("deze rol");
}

export function emptyForm(): RecruitmentForm {
  return {
    headline: "",
    subheadline: "",
    footer: "Meedoen duurt maar 1 minuut",
    voordelen: [],
    steps: [emptyButtonsStep(), emptyContactStep()],
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function parseShowIf(raw: unknown): RecruitmentFormShowIf | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const step_id = typeof o.step_id === "string" ? o.step_id.trim() : "";
  const any_of = asStringArray(o.any_of);
  if (!step_id || any_of.length === 0) return undefined;
  return { step_id, any_of };
}

export function parseRecruitmentForm(raw: unknown): RecruitmentForm | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const stepsRaw = Array.isArray(o.steps) ? o.steps : [];
  const steps: RecruitmentFormStep[] = [];
  for (const s of stepsRaw) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    const row = s as Record<string, unknown>;
    const type = row.type;
    if (
      type !== "buttons" &&
      type !== "text" &&
      type !== "checkboxes" &&
      type !== "contact"
    ) {
      continue;
    }
    const vraag =
      typeof row.vraag === "string" && row.vraag.trim()
        ? row.vraag.trim()
        : "Vraag";
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : newStepId();
    const show_if = parseShowIf(row.show_if);
    if (type === "buttons") {
      const opties = asStringArray(row.opties);
      steps.push({
        id,
        type,
        vraag,
        opties: opties.length ? opties : ["Ja", "Nee"],
        required: row.required !== false,
        show_if,
      });
    } else if (type === "checkboxes") {
      const opties = asStringArray(row.opties);
      steps.push({
        id,
        type,
        vraag,
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label.trim()
            : "(meerdere antwoorden mogelijk)",
        opties: opties.length
          ? opties
          : ["Batterijen", "Warmtepompen", "Isolatie", "Laadpalen"],
        required: row.required !== false,
        show_if,
      });
    } else if (type === "text") {
      steps.push({
        id,
        type,
        vraag,
        label:
          typeof row.label === "string" && row.label.trim()
            ? row.label.trim()
            : "Antwoord",
        placeholder:
          typeof row.placeholder === "string" ? row.placeholder : "",
        required: row.required !== false,
        show_if,
      });
    } else {
      steps.push({
        id,
        type,
        vraag,
        subtitle:
          typeof row.subtitle === "string" ? row.subtitle : undefined,
        required: true,
        show_if,
      });
    }
  }
  if (!steps.length) return null;
  if (!steps.some((s) => s.type === "contact")) {
    steps.push(emptyContactStep());
  }
  return {
    headline: typeof o.headline === "string" ? o.headline : "",
    subheadline: typeof o.subheadline === "string" ? o.subheadline : "",
    footer:
      typeof o.footer === "string" && o.footer.trim()
        ? o.footer.trim()
        : "Meedoen duurt maar 1 minuut",
    voordelen: asStringArray(o.voordelen),
    steps,
  };
}

export function formOrDefault(
  raw: unknown,
  rol?: string | null
): RecruitmentForm {
  return parseRecruitmentForm(raw) || defaultFormForRol(rol);
}

function parseAnswerRows(raw: unknown): RecruitmentAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RecruitmentAnswerRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const vraag = typeof o.vraag === "string" ? o.vraag.trim() : "";
    const antwoord =
      typeof o.antwoord === "string"
        ? o.antwoord.trim()
        : Array.isArray(o.antwoord)
          ? o.antwoord
              .map((x) => (typeof x === "string" ? x.trim() : ""))
              .filter(Boolean)
              .join(" · ")
          : "";
    if (!vraag || !antwoord) continue;
    const type =
      o.type === "buttons" ||
      o.type === "text" ||
      o.type === "checkboxes" ||
      o.type === "contact"
        ? o.type
        : undefined;
    out.push({
      step_id: typeof o.step_id === "string" ? o.step_id : undefined,
      vraag,
      antwoord,
      type,
    });
  }
  return out;
}

/**
 * Bouwt de sollicitatie-notitie.
 * Prefer answer_rows (vraag+antwoord van de client) — die overleven ID-mismatches.
 * Valt terug op form.steps × answers[step.id].
 */
export function formatFormAnswersNotitie(
  form: RecruitmentForm,
  answers: Record<string, string>,
  answerRowsRaw?: unknown
): string {
  const lines: string[] = ["— Sollicitatieformulier —"];
  const rows = parseAnswerRows(answerRowsRaw);
  if (rows.length) {
    for (const row of rows) {
      if (row.type === "contact") continue;
      lines.push(`${row.vraag}: ${row.antwoord}`);
    }
    return lines.join("\n");
  }
  for (const step of form.steps) {
    if (step.type === "contact") continue;
    const val = (answers[step.id] || "").trim();
    if (!val) continue;
    lines.push(`${step.vraag}: ${val}`);
  }
  return lines.join("\n");
}
