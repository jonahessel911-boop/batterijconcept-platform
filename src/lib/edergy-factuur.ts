/**
 * Creditfacturen van Edergy (Edwin Veenendaal) voor Warmtefonds-aanvragen.
 * Eén factuur per aanvraag, zodra de stap "Warmtefonds in behandeling" wordt gezet.
 * Opgeslagen in de privé-bucket (geen extra tabel).
 */
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  FINANCIERING_PIPELINE,
  normalizeFinancieringStatus,
} from "@/lib/financiering-status";
import { isWarmtefondsPortalProject } from "@/lib/warmtefonds-portal";
import {
  EDERGY_PER_AANVRAAG_BTW,
  EDERGY_PER_AANVRAAG_EXCL,
  EDERGY_PER_AANVRAAG_INC,
} from "@/lib/edergy-tarief";
import {
  buildEdergyFactuurPdf,
  type EdergyFactuurRegel,
} from "@/lib/pdf-edergy-factuur";

const BUCKET = "crm-private";
const OBJECT = "warmtefonds/edergy-facturen.json";
const TZ = "Europe/Amsterdam";
const EERSTE_NUMMER = 1102;

export type EdergyFactuur = {
  id: string;
  nummer: string;
  datum: string;
  datum_label: string;
  project_id: string;
  project_nummer: string;
  klant: string;
  bedrag_ex: number;
  btw: number;
  bedrag_inc: number;
  status: string | null;
  created_at: string;
};

type Store = {
  volgende: number;
  facturen: EdergyFactuur[];
};

function leeg(): Store {
  return { volgende: EERSTE_NUMMER, facturen: [] };
}

function normaliseer(raw: unknown): Store {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const volgende =
    typeof o.volgende === "number" && o.volgende >= EERSTE_NUMMER
      ? Math.floor(o.volgende)
      : EERSTE_NUMMER;
  const facturen = (Array.isArray(o.facturen) ? o.facturen : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const x = row as Record<string, unknown>;
      if (typeof x.id !== "string" || typeof x.project_id !== "string") return null;
      if (typeof x.nummer !== "string" || typeof x.klant !== "string") return null;
      return {
        id: x.id,
        nummer: x.nummer,
        datum: typeof x.datum === "string" ? x.datum : "",
        datum_label: typeof x.datum_label === "string" ? x.datum_label : "",
        project_id: x.project_id,
        project_nummer:
          typeof x.project_nummer === "string" ? x.project_nummer : "",
        klant: x.klant,
        bedrag_ex:
          typeof x.bedrag_ex === "number" && Number.isFinite(x.bedrag_ex)
            ? x.bedrag_ex
            : EDERGY_PER_AANVRAAG_EXCL,
        btw:
          typeof x.btw === "number" && Number.isFinite(x.btw)
            ? x.btw
            : EDERGY_PER_AANVRAAG_BTW,
        bedrag_inc:
          typeof x.bedrag_inc === "number" && Number.isFinite(x.bedrag_inc)
            ? x.bedrag_inc
            : EDERGY_PER_AANVRAAG_INC,
        status: typeof x.status === "string" ? x.status : null,
        created_at:
          typeof x.created_at === "string"
            ? x.created_at
            : new Date().toISOString(),
      } satisfies EdergyFactuur;
    })
    .filter((f): f is EdergyFactuur => Boolean(f));
  return { volgende, facturen };
}

async function lees(): Promise<Store> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
    if (error || !data) return leeg();
    return normaliseer(JSON.parse(await data.text()));
  } catch {
    return leeg();
  }
}

async function schrijf(store: Store): Promise<void> {
  const sb = getSupabaseAdmin();
  const up = await sb.storage.from(BUCKET).upload(OBJECT, JSON.stringify(store), {
    upsert: true,
    contentType: "application/json",
  });
  if (up.error) throw new Error(up.error.message);
}

function stapRank(status: string | null | undefined): number {
  const n = normalizeFinancieringStatus(status);
  if (!n || n === "afgewezen") return 0;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  return idx >= 0 ? idx + 1 : 0;
}

const BEHANDELING_RANK =
  FINANCIERING_PIPELINE.indexOf("in_behandeling") + 1;

export function edergyKlantRegel(opts: {
  naam: string | null | undefined;
  plaats: string | null | undefined;
  adviseur: string | null | undefined;
}): string {
  const naam = (opts.naam || "").trim() || "Klant";
  const plaats = (opts.plaats || "").trim();
  const adv = ((opts.adviseur || "").trim().split(/\s+/)[0] || "").trim();
  const kern = plaats ? `${naam} - ${plaats}` : naam;
  return adv ? `${kern} (verkoopadviseur ${adv})` : kern;
}

export async function lijstEdergyFacturen(): Promise<EdergyFactuur[]> {
  const store = await lees();
  return [...store.facturen].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function edergyFactuurPdf(
  id: string
): Promise<{ pdf: Uint8Array; nummer: string } | null> {
  const store = await lees();
  const factuur = store.facturen.find((f) => f.id === id);
  if (!factuur) return null;
  const regel: EdergyFactuurRegel = { klant: factuur.klant };
  return {
    pdf: buildEdergyFactuurPdf({
      nummer: factuur.nummer,
      datumLabel: factuur.datum_label,
      regels: [regel],
      bedragExcl: factuur.bedrag_ex,
      bedragBtw: factuur.btw,
      bedragInc: factuur.bedrag_inc,
    }),
    nummer: factuur.nummer,
  };
}

/**
 * Maak de factuur als de aanvraag net "in behandeling" (of verder) wordt.
 * Eén keer per project. Bestaande aanvragen die al op die stap staan blijven buiten
 * deze factuur, zodat 2026.1101 niet dubbel gaat.
 */
export async function zorgEdergyFactuurBijStap(opts: {
  projectId: string;
  van: string | null;
  naar: string | null;
  /** Eigen tarief van de WF-operator (opgeslagen incl. btw). Null/undefined = globaal €150 excl. */
  operatorTariefInc?: number | null;
}): Promise<void> {
  const vanRank = stapRank(opts.van);
  const naarRank = stapRank(opts.naar);
  if (naarRank < BEHANDELING_RANK || vanRank >= BEHANDELING_RANK) return;

  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, status, betaalwijze, financiering_status, leads(naam, plaats, adviseur_id)"
    )
    .eq("id", opts.projectId)
    .maybeSingle();
  if (error || !data) return;
  const row = data as {
    id: string;
    project_nummer?: string | null;
    status?: string | null;
    betaalwijze?: string | null;
    financiering_status?: string | null;
    leads?:
      | {
          naam?: string | null;
          plaats?: string | null;
          adviseur_id?: string | null;
        }
      | {
          naam?: string | null;
          plaats?: string | null;
          adviseur_id?: string | null;
        }[]
      | null;
  };
  if (
    !isWarmtefondsPortalProject({
      status: row.status,
      betaalwijze: row.betaalwijze,
      financiering_status: row.financiering_status,
    })
  ) {
    return;
  }

  const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
  let adviseur: string | null = null;
  const adviseurId = lead?.adviseur_id || null;
  if (adviseurId) {
    const { data: adv } = await sb
      .from("adviseurs")
      .select("naam")
      .eq("id", adviseurId)
      .maybeSingle();
    adviseur = (adv?.naam as string | null) ?? null;
  }

  const store = await lees();
  if (store.facturen.some((f) => f.project_id === opts.projectId)) return;

  const { leesEdergyTariefVoorOperator } = await import("@/lib/edergy-tarief");
  const tarief = await leesEdergyTariefVoorOperator(opts.operatorTariefInc);
  const now = new Date();
  const jaar = formatInTimeZone(now, TZ, "yyyy");
  const nummer = `${jaar}.${String(store.volgende).padStart(4, "0")}`;
  const factuur: EdergyFactuur = {
    id: crypto.randomUUID(),
    nummer,
    datum: formatInTimeZone(now, TZ, "yyyy-MM-dd"),
    datum_label: formatInTimeZone(now, TZ, "dd-MMMM-yyyy", { locale: nl }),
    project_id: opts.projectId,
    project_nummer: row.project_nummer || "",
    klant: edergyKlantRegel({
      naam: lead?.naam,
      plaats: lead?.plaats,
      adviseur,
    }),
    bedrag_ex: tarief.perAanvraagExcl,
    btw: tarief.perAanvraagBtw,
    bedrag_inc: tarief.perAanvraagInc,
    status: "concept",
    created_at: now.toISOString(),
  };
  store.facturen.push(factuur);
  store.volgende += 1;
  await schrijf(store);
}

/**
 * Verstuur Edergy-creditfactuur (PDF) naar BatterijConcept facturen-mailbox.
 */
export async function verstuurEdergyFactuur(opts: {
  factuurId: string;
}): Promise<
  | { ok: true; factuur: EdergyFactuur }
  | { ok: false; error: string }
> {
  const id = (opts.factuurId || "").trim();
  if (!id) return { ok: false, error: "Factuur niet gevonden" };

  const store = await lees();
  const factuur = store.facturen.find((f) => f.id === id);
  if (!factuur) return { ok: false, error: "Factuur niet gevonden" };

  const pdf = await edergyFactuurPdf(id);
  if (!pdf) return { ok: false, error: "PDF genereren mislukt" };

  const { sendEmail } = await import("@/lib/email/postmark");
  const { FACTUREN_MAILBOX_EMAIL } = await import("@/lib/facturen-mailbox");
  const { formatEuro } = await import("@/lib/format");

  const to = FACTUREN_MAILBOX_EMAIL;
  const html = `
    <p>Hierbij de Edergy-creditfactuur <strong>${factuur.nummer}</strong>.</p>
    <p>Klant: ${factuur.klant}<br/>
    Project: ${factuur.project_nummer || "—"}<br/>
    Bedrag incl.: ${formatEuro(factuur.bedrag_inc)}</p>
  `;

  const sent = await sendEmail({
    to,
    subject: `Edergy creditfactuur ${factuur.nummer}`,
    html,
    tag: "edergy-creditfactuur",
    attachments: [
      {
        name: `${factuur.nummer}.pdf`,
        contentType: "application/pdf",
        content: Buffer.from(pdf.pdf),
      },
    ],
  });

  if (!sent.ok) {
    return { ok: false, error: sent.error || "Mail versturen mislukt" };
  }
  return { ok: true, factuur };
}
