import { getSupabaseAdmin } from "@/lib/supabase";
import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export type ProposedActionKind =
  | "plan_schouw"
  | "plan_installatie"
  | "send_mail";

export type ProposedAction = {
  kind: ProposedActionKind;
  label: string;
  project_id: string;
  project_nummer: string | null;
  klant: string;
  warning?: string;
  schouw_at?: string | null;
  installatie_at?: string | null;
  partner_id?: string | null;
  partner_naam?: string | null;
  to?: string | null;
  subject?: string | null;
  bericht?: string | null;
};

type ProjectHit = {
  id: string;
  project_nummer: string | null;
  titel: string | null;
  status: string;
  schouw_at: string | null;
  installatie_at: string | null;
  installatie_partner_id: string | null;
  created_at: string;
  leads: {
    naam?: string | null;
    email?: string | null;
    plaats?: string | null;
    telefoon?: string | null;
    lead_number?: string | null;
    status?: string | null;
  } | null;
  installatie_partners: { id?: string; naam?: string | null } | null;
  offertes: {
    ondertekend_op?: string | null;
    financiering_voorbehoud?: boolean | null;
  } | null;
};

function asOne<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] || null : v;
}

function parseWhen(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function defaultSlotInDays(days: number): string {
  const local = toZonedTime(new Date(), AMSTERDAM_TZ);
  const target = addDays(local, days);
  return fromZonedTime(
    new Date(target.getFullYear(), target.getMonth(), target.getDate(), 9, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
}

export async function buildProposedAction(args: {
  kind: string;
  query?: string;
  project_id?: string;
  datetime?: string;
  to?: string;
  subject?: string;
  bericht?: string;
}): Promise<{ proposed_action?: ProposedAction; error?: string; matches?: unknown[] }> {
  const kind = args.kind as ProposedActionKind;
  if (
    kind !== "plan_schouw" &&
    kind !== "plan_installatie" &&
    kind !== "send_mail"
  ) {
    return { error: "Onbekende actie. Gebruik plan_schouw, plan_installatie of send_mail." };
  }

  const sb = getSupabaseAdmin();
  const projectId = String(args.project_id || "").trim();
  const q = String(args.query || "").trim();

  let query = sb
    .from("projecten")
    .select(
      "id, project_nummer, titel, status, schouw_at, installatie_at, installatie_partner_id, created_at, leads(naam, email, plaats, telefoon, lead_number, status), installatie_partners(id, naam), offertes(ondertekend_op, financiering_voorbehoud)"
    )
    .neq("status", "annulering")
    .order("updated_at", { ascending: false })
    .limit(projectId ? 1 : 80);

  if (projectId) query = query.eq("id", projectId);

  const { data, error } = await query;
  if (error) return { error: error.message };

  let list = (data || []) as unknown as ProjectHit[];
  list = list.map((p) => ({
    ...p,
    leads: asOne(p.leads),
    installatie_partners: asOne(p.installatie_partners),
    offertes: asOne(p.offertes),
  }));

  if (!projectId && q) {
    const ql = q.toLowerCase();
    list = list.filter((p) => {
      const hay = [
        p.project_nummer,
        p.titel,
        p.leads?.naam,
        p.leads?.email,
        p.leads?.plaats,
        p.leads?.lead_number,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(ql);
    });
  }

  if (list.length === 0) {
    return { error: "Geen order gevonden. Zoek eerst met zoek_projecten of zoek_leads." };
  }
  if (list.length > 1) {
    return {
      error: "Meerdere orders — kies er één via project_id.",
      matches: list.slice(0, 8).map((p) => ({
        project_id: p.id,
        project_nummer: p.project_nummer,
        klant: p.leads?.naam || p.titel,
        plaats: p.leads?.plaats,
        status: p.status,
      })),
    };
  }

  const p = list[0];
  const klant = p.leads?.naam || p.titel || p.project_nummer || "Klant";
  const partnerId =
    p.installatie_partner_id || p.installatie_partners?.id || null;
  const partnerNaam = p.installatie_partners?.naam || null;
  const when = parseWhen(args.datetime);

  if (kind === "plan_schouw") {
    let schouwAt = when || p.schouw_at;
    if (!schouwAt) {
      schouwAt = defaultSlotInDays(7);
    }
    return {
      proposed_action: {
        kind,
        label: `Schouw inplannen · ${klant}`,
        project_id: p.id,
        project_nummer: p.project_nummer,
        klant,
        schouw_at: schouwAt,
        partner_id: partnerId,
        partner_naam: partnerNaam,
        warning: partnerId
          ? undefined
          : "Geen installatiepartner op de order — Plan kan mislukken tot er een partner is.",
      },
    };
  }

  if (kind === "plan_installatie") {
    const installatieAt = when || p.installatie_at;
    if (!installatieAt) {
      return {
        error:
          "Geen datum/tijd. Geef datetime (ISO, Europe/Amsterdam), bijv. 2026-10-23T10:00:00+02:00.",
      };
    }
    return {
      proposed_action: {
        kind,
        label: `Installatie inplannen · ${klant}`,
        project_id: p.id,
        project_nummer: p.project_nummer,
        klant,
        installatie_at: installatieAt,
        partner_id: partnerId,
        partner_naam: partnerNaam,
        warning: partnerId
          ? undefined
          : "Geen installatiepartner op de order — Plan kan mislukken tot er een partner is.",
      },
    };
  }

  const to = (args.to || p.leads?.email || "").trim();
  const first = klant.split(/\s+/)[0] || klant;
  const subject =
    (args.subject || "").trim() ||
    `Bericht over jouw project ${p.project_nummer || ""}`.trim();
  const bericht =
    (args.bericht || "").trim() ||
    `Hoi ${first},\n\nIk mail je even over jouw batterijproject bij Batterijconcept.\n\nMet vriendelijke groet`;

  return {
    proposed_action: {
      kind,
      label: `Klantmail · ${klant}`,
      project_id: p.id,
      project_nummer: p.project_nummer,
      klant,
      to: to || null,
      subject,
      bericht,
      warning: to ? undefined : "Geen e-mailadres bekend — vul het adres in vóór Verstuur.",
    },
  };
}
