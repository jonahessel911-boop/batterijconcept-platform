/** Energiecontract + verbruik (Frank Energie-overstap). */

export const ENERGIE_CONTRACT_TYPES = ["vast", "variabel", "dynamisch"] as const;

export type EnergieContractType = (typeof ENERGIE_CONTRACT_TYPES)[number];

export const ENERGIE_CONTRACT_TYPE_LABEL: Record<EnergieContractType, string> = {
  vast: "Vast",
  variabel: "Variabel",
  dynamisch: "Dynamisch",
};

export type EnergieVerbruikFields = {
  elektra_verbruik_kwh: number | null;
  gas_verbruik_m3: number | null;
  teruglevering_kwh: number | null;
  energie_contract_type: EnergieContractType | null;
  energie_contract_einddatum: string | null;
};

/** Formuliervelden (strings voor inputs). */
export type EnergieVerbruikFormValues = {
  elektraVerbruikKwh: string;
  gasVerbruikM3: string;
  terugleveringKwh: string;
  energieContractType: EnergieContractType | "";
  energieContractEinddatum: string;
};

export const EMPTY_ENERGIE_FORM: EnergieVerbruikFormValues = {
  elektraVerbruikKwh: "",
  gasVerbruikM3: "",
  terugleveringKwh: "",
  energieContractType: "",
  energieContractEinddatum: "",
};

export function isEnergieContractType(
  v: unknown
): v is EnergieContractType {
  return (
    typeof v === "string" &&
    (ENERGIE_CONTRACT_TYPES as readonly string[]).includes(v)
  );
}

function parseNonNegNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** YYYY-MM-DD of null. */
function parseDateYmd(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return t;
}

/**
 * Parse energievelden bij afronden sale → backoffice.
 * Alles optioneel; alleen formatfouten als iets wél is ingevuld.
 */
export function validateEnergieVerbruikForm(
  form: EnergieVerbruikFormValues
): { ok: true; data: EnergieVerbruikFields } | { ok: false; error: string } {
  const elektraRaw = form.elektraVerbruikKwh.trim();
  let elektra: number | null = null;
  if (elektraRaw) {
    elektra = parseNonNegNumber(form.elektraVerbruikKwh);
    if (elektra == null) {
      return { ok: false, error: "Ongeldig elektraverbruik (kWh/jaar)." };
    }
  }
  const gasRaw = form.gasVerbruikM3.trim();
  let gas: number | null = null;
  if (gasRaw) {
    gas = parseNonNegNumber(form.gasVerbruikM3);
    if (gas == null) {
      return { ok: false, error: "Ongeldig gasverbruik (m³/jaar)." };
    }
  }
  const terugRaw = form.terugleveringKwh.trim();
  let terug: number | null = null;
  if (terugRaw) {
    terug = parseNonNegNumber(form.terugleveringKwh);
    if (terug == null) {
      return { ok: false, error: "Ongeldige teruglevering (kWh/jaar)." };
    }
  }
  const contractType = isEnergieContractType(form.energieContractType)
    ? form.energieContractType
    : null;
  let einddatum: string | null = null;
  const eindRaw = form.energieContractEinddatum.trim();
  if (eindRaw) {
    einddatum = parseDateYmd(form.energieContractEinddatum);
    if (!einddatum) {
      return { ok: false, error: "Ongeldige einddatum vast contract." };
    }
  }
  return {
    ok: true,
    data: {
      elektra_verbruik_kwh: elektra,
      gas_verbruik_m3: gas,
      teruglevering_kwh: terug,
      energie_contract_type: contractType,
      energie_contract_einddatum:
        contractType === "vast" ? einddatum : null,
    },
  };
}

export type BackofficeDoorzettenFormValues = EnergieVerbruikFormValues & {
  backofficeNotitie: string;
  installateurNotitie: string;
  aanbetalingModus?: string;
  aanbetalingHandmatig?: string;
};

/**
 * Validatie bij doorzetten signed offerte → backoffice.
 * Notities en energievelden zijn optioneel; handmatig bedrag alleen
 * verplicht als die modus gekozen is.
 */
export function validateBackofficeDoorzettenForm(
  form: BackofficeDoorzettenFormValues
):
  | { ok: true; data: EnergieVerbruikFields }
  | { ok: false; error: string } {
  if (form.aanbetalingModus === "handmatig") {
    const raw = (form.aanbetalingHandmatig || "").trim();
    if (!raw) {
      return { ok: false, error: "Vul het handmatige aanbetalingsbedrag in." };
    }
    const n = Number(raw.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        error: "Handmatig aanbetalingsbedrag moet groter dan 0 zijn.",
      };
    }
  }
  return validateEnergieVerbruikForm(form);
}

/** Server-side parse van PATCH body (alles optioneel; formatfouten wel). */
export function parseEnergieVerbruikBody(body: {
  elektra_verbruik_kwh?: number | string | null;
  gas_verbruik_m3?: number | string | null;
  teruglevering_kwh?: number | string | null;
  energie_contract_type?: string | null;
  energie_contract_einddatum?: string | null;
}):
  | { ok: true; data: EnergieVerbruikFields }
  | { ok: false; error: string } {
  const num = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  };

  const has = (v: number | string | null | undefined) =>
    v !== null && v !== undefined && v !== "";

  let elektra: number | null = null;
  if (has(body.elektra_verbruik_kwh)) {
    elektra = num(body.elektra_verbruik_kwh);
    if (elektra == null) {
      return { ok: false, error: "Ongeldig elektraverbruik." };
    }
  }
  let gas: number | null = null;
  if (has(body.gas_verbruik_m3)) {
    gas = num(body.gas_verbruik_m3);
    if (gas == null) {
      return { ok: false, error: "Ongeldig gasverbruik." };
    }
  }
  let terug: number | null = null;
  if (has(body.teruglevering_kwh)) {
    terug = num(body.teruglevering_kwh);
    if (terug == null) {
      return { ok: false, error: "Ongeldige teruglevering." };
    }
  }
  const contractType = isEnergieContractType(body.energie_contract_type)
    ? body.energie_contract_type
    : null;
  if (
    body.energie_contract_type != null &&
    body.energie_contract_type !== "" &&
    !contractType
  ) {
    return { ok: false, error: "Ongeldig contracttype." };
  }
  let einddatum: string | null = null;
  const eindRaw = body.energie_contract_einddatum;
  if (has(eindRaw)) {
    einddatum = parseDateYmd(String(eindRaw));
    if (!einddatum) {
      return { ok: false, error: "Ongeldige einddatum vast contract." };
    }
  }
  return {
    ok: true,
    data: {
      elektra_verbruik_kwh: elektra,
      gas_verbruik_m3: gas,
      teruglevering_kwh: terug,
      energie_contract_type: contractType,
      energie_contract_einddatum:
        contractType === "vast" ? einddatum : null,
    },
  };
}

export function formatEnergieContractEinddatum(
  ymd: string | null | undefined
): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  if (!y || !m || !d) return ymd;
  return `${d}-${m}-${y}`;
}
