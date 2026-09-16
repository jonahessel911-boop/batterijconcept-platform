import type OpenAI from "openai";
import { getSupabaseAdmin } from "@/lib/supabase";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const AI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "pipeline_overzicht",
      description:
        "Geeft aantallen leads per status, plus openstaande facturen en offertes. Gebruik voor overzichts-/KPI-vragen.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "zoek_leads",
      description:
        "Zoek leads op naam, e-mail, telefoon, plaats, leadnummer of status. Max 25 resultaten.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Vrije zoekterm (naam, email, tel, plaats, leadnummer)",
          },
          status: {
            type: "string",
            description: "Optioneel exacte leadstatus, bijv. afspraak, geen_contact, nieuw",
          },
          limit: { type: "number", description: "Max resultaten (default 15, max 25)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lead_detail",
      description: "Haal één lead op met recente afspraken, offertes en facturen.",
      parameters: {
        type: "object",
        properties: {
          lead_id: { type: "string", description: "UUID van de lead" },
          lead_number: {
            type: "string",
            description: "Leadnummer zoals BC-20260905-…",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "agenda_vandaag",
      description: "Lijst afspraken vandaag (Europe/Amsterdam), optioneel gefilterd op adviseur-naam.",
      parameters: {
        type: "object",
        properties: {
          adviseur: {
            type: "string",
            description: "Optioneel deel van adviseurnaam",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_facturen",
      description: "Openstaande facturen (verzonden / deels_betaald), optioneel zoeken op klantnaam of factuurnummer.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "zoek_offertes",
      description: "Zoek offertes op nummer, status of klantnaam.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "zoek_projecten",
      description: "Zoek backoffice-projecten op status of klant.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bel_queue_stats",
      description:
        "Statistieken over belpogingen: hoeveel leads op geen_contact, verdeling belpogingen.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];

function clampLimit(n: unknown, def = 15, max = 25): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.min(max, Math.max(1, v));
}

function dayBoundsAmsterdam(isoDay: string): { start: string; end: string } {
  const probe = new Date();
  const offsetSample = formatInTimeZone(probe, AMSTERDAM_TZ, "xxx");
  const s = new Date(`${isoDay}T00:00:00${offsetSample}`);
  const e = new Date(`${isoDay}T23:59:59.999${offsetSample}`);
  return { start: s.toISOString(), end: e.toISOString() };
}

export async function runAiTool(
  name: string,
  rawArgs: string
): Promise<unknown> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    args = {};
  }
  const sb = getSupabaseAdmin();

  switch (name) {
    case "pipeline_overzicht": {
      const [leads, facturen, offertes, afspraken] = await Promise.all([
        sb.from("leads").select("status"),
        sb.from("facturen").select("status, bedrag_inc_btw"),
        sb.from("offertes").select("status"),
        sb
          .from("afspraken")
          .select("status")
          .gte(
            "start_at",
            dayBoundsAmsterdam(
              formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd")
            ).start
          )
          .lte(
            "start_at",
            dayBoundsAmsterdam(
              formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd")
            ).end
          ),
      ]);
      const byStatus: Record<string, number> = {};
      for (const l of leads.data || []) {
        const s = (l as { status: string }).status || "onbekend";
        byStatus[s] = (byStatus[s] || 0) + 1;
      }
      const factuurOpen = (facturen.data || []).filter((f) =>
        ["verzonden", "deels_betaald", "concept"].includes(
          (f as { status: string }).status
        )
      );
      const openSom = factuurOpen.reduce(
        (sum, f) => sum + Number((f as { bedrag_inc_btw: number }).bedrag_inc_btw || 0),
        0
      );
      const offerteByStatus: Record<string, number> = {};
      for (const o of offertes.data || []) {
        const s = (o as { status: string }).status || "onbekend";
        offerteByStatus[s] = (offerteByStatus[s] || 0) + 1;
      }
      return {
        leads_totaal: leads.data?.length || 0,
        leads_per_status: byStatus,
        afspraken_vandaag: afspraken.data?.length || 0,
        offertes_per_status: offerteByStatus,
        open_facturen_aantal: factuurOpen.length,
        open_facturen_som_inc_btw: Math.round(openSom * 100) / 100,
      };
    }

    case "zoek_leads": {
      const q = String(args.query || "").trim().toLowerCase();
      const status = String(args.status || "").trim();
      const limit = clampLimit(args.limit);
      let query = sb
        .from("leads")
        .select(
          "id, lead_number, naam, email, telefoon, plaats, status, belpogingen, created_at, adviseur_id, beller_id"
        )
        .order("created_at", { ascending: false })
        .limit(q ? 200 : limit);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: error.message };
      let list = data || [];
      if (q) {
        list = list
          .filter((l) => {
            const row = l as {
              naam?: string;
              email?: string;
              telefoon?: string;
              plaats?: string;
              lead_number?: string;
            };
            const hay = [
              row.naam,
              row.email,
              row.telefoon,
              row.plaats,
              row.lead_number,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          })
          .slice(0, limit);
      }
      return { count: list.length, leads: list };
    }

    case "lead_detail": {
      const leadId = String(args.lead_id || "").trim();
      const leadNumber = String(args.lead_number || "").trim();
      let leadQ = sb.from("leads").select("*");
      if (leadId) leadQ = leadQ.eq("id", leadId);
      else if (leadNumber) leadQ = leadQ.eq("lead_number", leadNumber);
      else return { error: "lead_id of lead_number verplicht" };
      const { data: lead, error } = await leadQ.maybeSingle();
      if (error) return { error: error.message };
      if (!lead) return { error: "Lead niet gevonden" };
      const id = (lead as { id: string }).id;
      const [afspraken, offertes, facturen] = await Promise.all([
        sb
          .from("afspraken")
          .select(
            "id, start_at, end_at, status, soort, adviseur_id, notities"
          )
          .eq("lead_id", id)
          .order("start_at", { ascending: false })
          .limit(10),
        sb
          .from("offertes")
          .select("id, offerte_nummer, status, totaal_inc_btw, created_at")
          .eq("lead_id", id)
          .order("created_at", { ascending: false })
          .limit(10),
        sb
          .from("facturen")
          .select(
            "id, factuur_nummer, status, bedrag_inc_btw, factuurdatum, omschrijving"
          )
          .eq("lead_id", id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      return {
        lead,
        afspraken: afspraken.data || [],
        offertes: offertes.data || [],
        facturen: facturen.data || [],
      };
    }

    case "agenda_vandaag": {
      const today = formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd");
      const { start, end } = dayBoundsAmsterdam(today);
      const adviseurFilter = String(args.adviseur || "").trim().toLowerCase();
      const { data: afspraken, error } = await sb
        .from("afspraken")
        .select(
          "id, start_at, end_at, status, soort, adviseur_id, lead_id, notities, leads(naam, plaats, telefoon, lead_number), adviseurs(naam)"
        )
        .gte("start_at", start)
        .lte("start_at", end)
        .neq("status", "geannuleerd")
        .order("start_at", { ascending: true });
      if (error) return { error: error.message };
      let list = afspraken || [];
      if (adviseurFilter) {
        list = list.filter((a) => {
          const naam =
            (
              a as {
                adviseurs?: { naam?: string } | { naam?: string }[] | null;
              }
            ).adviseurs;
          const n = Array.isArray(naam) ? naam[0]?.naam : naam?.naam;
          return (n || "").toLowerCase().includes(adviseurFilter);
        });
      }
      return { dag: today, aantal: list.length, afspraken: list };
    }

    case "open_facturen": {
      const q = String(args.query || "").trim();
      const limit = clampLimit(args.limit, 20, 40);
      let query = sb
        .from("facturen")
        .select(
          "id, factuur_nummer, status, bedrag_inc_btw, factuurdatum, vervaldatum, omschrijving, leads(naam, lead_number)"
        )
        .in("status", ["concept", "verzonden", "deels_betaald"])
        .order("factuurdatum", { ascending: false })
        .limit(limit);
      if (q) {
        const like = `%${q}%`;
        query = query.or(
          `factuur_nummer.ilike.${like},omschrijving.ilike.${like}`
        );
      }
      const { data, error } = await query;
      if (error) return { error: error.message };
      return { count: data?.length || 0, facturen: data || [] };
    }

    case "zoek_offertes": {
      const q = String(args.query || "").trim();
      const status = String(args.status || "").trim();
      const limit = clampLimit(args.limit);
      let query = sb
        .from("offertes")
        .select(
          "id, offerte_nummer, status, totaal_inc_btw, created_at, leads(naam, lead_number)"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      if (q) {
        query = query.ilike("offerte_nummer", `%${q}%`);
      }
      const { data, error } = await query;
      if (error) return { error: error.message };
      let list = data || [];
      if (q) {
        const ql = q.toLowerCase();
        list = list.filter((o) => {
          const leads = (
            o as { leads?: { naam?: string } | { naam?: string }[] | null }
          ).leads;
          const naam = Array.isArray(leads) ? leads[0]?.naam : leads?.naam;
          const num = (o as { offerte_nummer?: string }).offerte_nummer || "";
          return (
            num.toLowerCase().includes(ql) ||
            (naam || "").toLowerCase().includes(ql)
          );
        });
      }
      return { count: list.length, offertes: list };
    }

    case "zoek_projecten": {
      const q = String(args.query || "").trim();
      const status = String(args.status || "").trim();
      const limit = clampLimit(args.limit);
      let query = sb
        .from("projecten")
        .select(
          "id, status, created_at, leads(naam, lead_number, plaats), installatie_partners(naam)"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return { error: error.message };
      let list = data || [];
      if (q) {
        const ql = q.toLowerCase();
        list = list.filter((p) => {
          const leads = (
            p as { leads?: { naam?: string } | { naam?: string }[] | null }
          ).leads;
          const naam = Array.isArray(leads) ? leads[0]?.naam : leads?.naam;
          return (naam || "").toLowerCase().includes(ql);
        });
      }
      return { count: list.length, projecten: list };
    }

    case "bel_queue_stats": {
      const { data, error } = await sb
        .from("leads")
        .select("status, belpogingen")
        .in("status", ["nieuw", "geen_contact", "vervolg_geen_contact"]);
      if (error) return { error: error.message };
      const byPogingen: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      for (const l of data || []) {
        const s = (l as { status: string }).status;
        const p = Number((l as { belpogingen?: number }).belpogingen || 0);
        byStatus[s] = (byStatus[s] || 0) + 1;
        const key = String(p);
        byPogingen[key] = (byPogingen[key] || 0) + 1;
      }
      return {
        in_bel_statussen: data?.length || 0,
        per_status: byStatus,
        per_belpogingen: byPogingen,
      };
    }

    default:
      return { error: `Onbekende tool: ${name}` };
  }
}
