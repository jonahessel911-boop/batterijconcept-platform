/**
 * Twee klantmails voor het Warmtefonds-portaal:
 * bij binnenkomst, en 1 dag voor de afspraak.
 * Opgeslagen in de privé-bucket (geen extra tabel).
 */
import { formatInTimeZone } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail } from "@/lib/email/postmark";
import { INFO_REPLY_TO } from "@/lib/email/adviseur-reply-to";
import { klantContactEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";
import { adresRegel, formatDateTimeLongNl, formatDateTimeNl } from "@/lib/format";
import { isWarmtefondsPortalProject } from "@/lib/warmtefonds-portal";

const BUCKET = "crm-private";
const OBJECT = "warmtefonds/automatisering.json";
const TZ = "Europe/Amsterdam";

export type WfMail = {
  actief: boolean;
  onderwerp: string;
  bericht: string;
};

export type WfMailSoort = "binnenkomst" | "dag_ervoor";

type Verzonden = { key: string; at: string };

export type WfAutomatiseringConfig = {
  binnenkomst: WfMail;
  dag_ervoor: WfMail;
  verzonden: Verzonden[];
};

export const WF_MAIL_LABEL: Record<WfMailSoort, string> = {
  binnenkomst: "Aanvraag komt binnen",
  dag_ervoor: "1 dag voor de afspraak",
};

function leegMail(): WfMail {
  return { actief: false, onderwerp: "", bericht: "" };
}

function leegConfig(): WfAutomatiseringConfig {
  return {
    binnenkomst: leegMail(),
    dag_ervoor: leegMail(),
    verzonden: [],
  };
}

function schoonMail(raw: unknown): WfMail {
  if (!raw || typeof raw !== "object") return leegMail();
  const x = raw as Record<string, unknown>;
  return {
    actief: x.actief === true,
    onderwerp: typeof x.onderwerp === "string" ? x.onderwerp : "",
    bericht: typeof x.bericht === "string" ? x.bericht : "",
  };
}

export function normaliseerConfig(raw: unknown): WfAutomatiseringConfig {
  if (!raw || typeof raw !== "object") return leegConfig();
  const o = raw as Record<string, unknown>;
  const verzonden = (Array.isArray(o.verzonden) ? o.verzonden : [])
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const x = v as Record<string, unknown>;
      if (typeof x.key !== "string" || !x.key) return null;
      return {
        key: x.key,
        at: typeof x.at === "string" ? x.at : new Date().toISOString(),
      };
    })
    .filter((v): v is Verzonden => Boolean(v))
    .slice(-2000);

  return {
    binnenkomst: schoonMail(o.binnenkomst),
    dag_ervoor: schoonMail(o.dag_ervoor),
    verzonden,
  };
}

/** Templates voor de handmatige Contact-mail. Alleen gevulde mails. */
export function wfContactTemplates(config: WfAutomatiseringConfig): {
  id: WfMailSoort;
  naam: string;
  onderwerp: string;
  bericht: string;
}[] {
  return (["binnenkomst", "dag_ervoor"] as const)
    .map((id) => {
      const mail = config[id];
      if (!mail.onderwerp.trim() && !mail.bericht.trim()) return null;
      return {
        id,
        naam: WF_MAIL_LABEL[id],
        onderwerp: mail.onderwerp,
        bericht: mail.bericht,
      };
    })
    .filter((t): t is NonNullable<typeof t> => Boolean(t));
}

export async function leesWarmtefondsConfig(): Promise<WfAutomatiseringConfig> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
    if (error || !data) return leegConfig();
    return normaliseerConfig(JSON.parse(await data.text()));
  } catch {
    return leegConfig();
  }
}

export async function schrijfWarmtefondsConfig(
  config: WfAutomatiseringConfig
): Promise<void> {
  const sb = getSupabaseAdmin();
  const body = JSON.stringify(normaliseerConfig(config));
  const up = await sb.storage.from(BUCKET).upload(OBJECT, body, {
    upsert: true,
    contentType: "application/json",
  });
  if (up.error) throw new Error(up.error.message);
}

function vul(tekst: string, vars: Record<string, string>): string {
  return tekst.replace(
    /\{(voornaam|naam|project|afspraak|adres|warmtefonds)\}/gi,
    (_, key: string) => vars[key.toLowerCase()] ?? ""
  );
}

type LeadJoin = {
  id?: string;
  naam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

function leadOf(raw: unknown): LeadJoin | null {
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) as LeadJoin;
}

function dagenTotAfspraak(iso: string, now: Date): number | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const appt = formatInTimeZone(at, TZ, "yyyy-MM-dd");
  const vandaag = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const [ay, am, ad] = appt.split("-").map(Number);
  const [ny, nm, nd] = vandaag.split("-").map(Number);
  return Math.round(
    (Date.UTC(ay, am - 1, ad) - Date.UTC(ny, nm - 1, nd)) / 86400000
  );
}

async function operatorNaam(): Promise<string> {
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("warmtefonds_operators")
    .select("naam")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();
  return (data?.naam as string | undefined)?.trim() || "Warmtefonds";
}

async function verstuurMail(
  config: WfAutomatiseringConfig,
  projectId: string,
  soort: WfMailSoort
): Promise<boolean> {
  const mail = config[soort];
  if (!mail.actief || !mail.onderwerp.trim() || !mail.bericht.trim()) {
    return false;
  }

  const sb = getSupabaseAdmin();
  const { data: project } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, titel, status, betaalwijze, financiering_status, lead_id, warmtefonds_afspraak_at, leads(id, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project || !isWarmtefondsPortalProject(project)) return false;

  const lead = leadOf(project.leads);
  const to = lead?.email?.trim() || "";
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false;

  const sleutel =
    soort === "dag_ervoor"
      ? `dag_ervoor:${projectId}:${project.warmtefonds_afspraak_at || ""}`
      : `binnenkomst:${projectId}`;
  if (config.verzonden.some((v) => v.key === sleutel)) return false;

  const naam = lead?.naam?.trim() || project.titel?.trim() || "klant";
  const voornaam = naam.split(/\s+/)[0] || naam;
  const adres = lead ? adresRegel(lead) : "";
  const vars: Record<string, string> = {
    voornaam,
    naam,
    project: project.project_nummer || "",
    afspraak: project.warmtefonds_afspraak_at
      ? formatDateTimeNl(project.warmtefonds_afspraak_at)
      : "",
    adres: adres === "—" ? "" : adres,
    warmtefonds: "",
  };
  const onderwerp = vul(mail.onderwerp, vars).trim();
  const bericht = vul(mail.bericht, vars).trim();
  if (!onderwerp || !bericht) return false;

  const html = klantContactEmail({
    klantNaam: naam,
    bericht,
    medewerkerNaam: await operatorNaam(),
  });
  const result = await sendEmail({
    to,
    subject: onderwerp,
    html,
    tag: "warmtefonds-automatisering",
    replyTo: INFO_REPLY_TO,
    bcc:
      to.toLowerCase() === "info@batterijconcept.nl"
        ? null
        : "info@batterijconcept.nl",
  });
  if (!result.ok) return false;

  config.verzonden.push({ key: sleutel, at: new Date().toISOString() });
  const leadId = lead?.id || (project.lead_id as string | null);
  if (leadId) {
    await logLeadEvent({
      leadId,
      soort: "email",
      titel: `Warmtefonds-mail: ${WF_MAIL_LABEL[soort]}`,
      detail: `Naar ${to}\n\n${bericht}`,
      meta: {
        to,
        subject: onderwerp,
        project_id: projectId,
        soort,
        bron: "warmtefonds_automatisering",
        ok: true,
      },
    });
  }
  return true;
}

/** Bevestiging naar de klant zodra een WF-afspraak is gezet of verzet. */
export async function verstuurWfAfspraakBevestiging(
  projectId: string
): Promise<"verzonden" | "geen_email" | "mislukt"> {
  const sb = getSupabaseAdmin();
  const { data: project } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, titel, status, betaalwijze, financiering_status, lead_id, warmtefonds_afspraak_at, leads(id, naam, email, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("id", projectId)
    .maybeSingle();
  if (!project || !isWarmtefondsPortalProject(project)) return "mislukt";
  const wanneer = project.warmtefonds_afspraak_at;
  if (!wanneer) return "mislukt";

  const lead = leadOf(project.leads);
  const to = lead?.email?.trim() || "";
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return "geen_email";

  const naam = lead?.naam?.trim() || project.titel?.trim() || "klant";
  const adres = lead ? adresRegel(lead) : "";
  const regels = [
    `Je Warmtefonds-afspraak staat op ${formatDateTimeLongNl(wanneer)}.`,
    adres && adres !== "—" ? `Adres: ${adres}.` : "",
    "Tot dan.",
  ].filter(Boolean);
  const projectNummer = project.project_nummer || "";
  const onderwerp = `Warmtefonds - ${projectNummer}`.trim();
  const html = klantContactEmail({
    klantNaam: naam,
    bericht: regels.join("\n\n"),
    medewerkerNaam: await operatorNaam(),
  });
  const result = await sendEmail({
    to,
    subject: onderwerp,
    html,
    tag: "warmtefonds-afspraak",
    replyTo: INFO_REPLY_TO,
    bcc:
      to.toLowerCase() === "info@batterijconcept.nl"
        ? null
        : "info@batterijconcept.nl",
  });
  if (!result.ok) return "mislukt";

  const leadId = lead?.id || (project.lead_id as string | null);
  if (leadId) {
    await logLeadEvent({
      leadId,
      soort: "email",
      titel: "Warmtefonds-afspraak bevestigd",
      detail: `Naar ${to}\n\n${regels.join("\n\n")}`,
      meta: {
        to,
        subject: onderwerp,
        project_id: projectId,
        warmtefonds_afspraak_at: wanneer,
        bron: "warmtefonds_afspraak",
        ok: true,
      },
    });
  }
  return "verzonden";
}

/** Eerste keer dat een aanvraag een financieringsstatus krijgt. */
export async function verstuurWarmtefondsStapFlows(opts: {
  projectId: string;
  van: string | null;
  naar: string | null;
}): Promise<number> {
  if (!opts.naar || opts.naar === opts.van || opts.van) return 0;
  const config = await leesWarmtefondsConfig();
  const ok = await verstuurMail(config, opts.projectId, "binnenkomst");
  if (ok) await schrijfWarmtefondsConfig(config);
  return ok ? 1 : 0;
}

/** Ochtendcron: 1 dag voor de interne afspraak. */
export async function verstuurWarmtefondsAfspraakFlows(
  now = new Date()
): Promise<{ bekeken: number; verstuurd: number }> {
  const config = await leesWarmtefondsConfig();
  const mail = config.dag_ervoor;
  if (!mail.actief || !mail.onderwerp.trim() || !mail.bericht.trim()) {
    return { bekeken: 0, verstuurd: 0 };
  }

  const sb = getSupabaseAdmin();
  const tot = new Date(now.getTime() + 2 * 86400000);
  const { data: rows } = await sb
    .from("projecten")
    .select("id, warmtefonds_afspraak_at, status, betaalwijze, financiering_status")
    .gte("warmtefonds_afspraak_at", now.toISOString())
    .lte("warmtefonds_afspraak_at", tot.toISOString())
    .neq("status", "annulering")
    .limit(200);

  let verstuurd = 0;
  let bekeken = 0;
  for (const row of rows || []) {
    if (!row.warmtefonds_afspraak_at || !isWarmtefondsPortalProject(row)) {
      continue;
    }
    if (dagenTotAfspraak(row.warmtefonds_afspraak_at, now) !== 1) continue;
    bekeken += 1;
    if (await verstuurMail(config, row.id, "dag_ervoor")) verstuurd += 1;
  }
  if (verstuurd > 0) await schrijfWarmtefondsConfig(config);
  return { bekeken, verstuurd };
}
