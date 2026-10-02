/**
 * Volledige parameter-documentatie voor GET /api/v1
 */

import { agendaTypesDocs } from "./agenda-types";

export type ParamDoc = {
  name: string;
  in: "query" | "path" | "body";
  type: string;
  required?: boolean;
  description: string;
  example?: string | number | boolean | null;
};

export type EndpointDoc = {
  method: string;
  path: string;
  summary: string;
  params: ParamDoc[];
  example_body?: Record<string, unknown>;
  example_response?: Record<string, unknown>;
};

export const API_V1_DOCS: EndpointDoc[] = [
  // —— Facturen ——
  {
    method: "GET",
    path: "/api/v1/facturen",
    summary: "Lijst facturen",
    params: [
      { name: "project_id", in: "query", type: "uuid", description: "Filter op project" },
      { name: "lead_id", in: "query", type: "uuid", description: "Filter op lead" },
      {
        name: "status",
        in: "query",
        type: "string",
        description: "concept | verzonden | betaald | deels_betaald | vervallen",
        example: "verzonden",
      },
      {
        name: "openstaand",
        in: "query",
        type: "1|true",
        description: "Alleen openstaande facturen (verzonden / deels_betaald)",
        example: "1",
      },
      { name: "limit", in: "query", type: "number", description: "Max resultaten (1–500, default 100)", example: 100 },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/facturen",
    summary: "Conceptfactuur aanmaken",
    params: [
      { name: "project_id", in: "body", type: "uuid", required: true, description: "Project waaraan de factuur hangt" },
      {
        name: "bedrag_inc_btw",
        in: "body",
        type: "number|string",
        required: true,
        description: "Bedrag incl. btw (excl. + btw worden berekend)",
        example: 1887.85,
      },
      { name: "omschrijving", in: "body", type: "string", description: "Regeltekst op factuur", example: "Restfactuur installatie" },
      {
        name: "betaaltermijn_dagen",
        in: "body",
        type: "number",
        description: "Dagen tot vervaldatum (default 3)",
        example: 14,
      },
      {
        name: "adres_gegevens_op_factuur",
        in: "body",
        type: "boolean",
        description: "Zet Daltonlaan-bedrijfsadres op PDF",
        example: false,
      },
    ],
    example_body: {
      project_id: "<uuid>",
      bedrag_inc_btw: 1887.85,
      omschrijving: "Aanbetaling",
      betaaltermijn_dagen: 3,
      adres_gegevens_op_factuur: false,
    },
  },
  {
    method: "GET",
    path: "/api/v1/facturen/:id",
    summary: "Factuur detail",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Factuur-id" },
    ],
  },
  {
    method: "PATCH",
    path: "/api/v1/facturen/:id",
    summary: "Factuur bijwerken",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Factuur-id" },
      {
        name: "bedrag_inc_btw",
        in: "body",
        type: "number|string",
        description: "Alleen bij status=concept",
      },
      { name: "omschrijving", in: "body", type: "string", description: "Alleen bij status=concept" },
      {
        name: "betaaltermijn_dagen",
        in: "body",
        type: "number",
        description: "Herberekent vervaldatum (alleen concept)",
      },
      {
        name: "status",
        in: "body",
        type: "string",
        description: "concept | verzonden | betaald | deels_betaald | vervallen",
      },
      {
        name: "betaald_op",
        in: "body",
        type: "YYYY-MM-DD",
        description: "Betaaldatum (bij status=betaald of los)",
      },
    ],
    example_body: { bedrag_inc_btw: 2000, omschrijving: "Aangepaste omschrijving" },
  },
  {
    method: "DELETE",
    path: "/api/v1/facturen/:id",
    summary: "Factuur verwijderen",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Factuur-id" },
    ],
  },

  // —— Projecten ——
  {
    method: "GET",
    path: "/api/v1/projecten",
    summary: "Lijst projecten",
    params: [
      { name: "status", in: "query", type: "string", description: "Projectstatus-filter" },
      { name: "lead_id", in: "query", type: "uuid", description: "Filter op lead" },
      { name: "q", in: "query", type: "string", description: "Zoek in project_nummer / titel" },
      {
        name: "include",
        in: "query",
        type: "facturen",
        description: "Zet include=facturen voor openstaand-samenvatting per project",
      },
      { name: "limit", in: "query", type: "number", description: "Max resultaten (default 100)" },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/projecten/:id",
    summary: "Project detail + facturen_samenvatting",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Project-id" },
    ],
  },
  {
    method: "PATCH",
    path: "/api/v1/projecten/:id",
    summary: "Project bijwerken",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Project-id" },
      { name: "status", in: "body", type: "string", description: "Pipeline-status" },
      { name: "titel", in: "body", type: "string", description: "Projecttitel" },
      { name: "notities", in: "body", type: "string", description: "Algemene notities" },
      { name: "schouw_notities", in: "body", type: "string", description: "Schouw-notities" },
      { name: "installatie_notities", in: "body", type: "string", description: "Installatie-notities" },
      {
        name: "bel_schouw_aanbetaling_at",
        in: "body",
        type: "ISO datetime | true",
        description: "Zet timestamp (leeg/true = nu)",
      },
      {
        name: "financiering_geschakeld_at",
        in: "body",
        type: "ISO datetime | true",
        description: "Zet timestamp (leeg/true = nu)",
      },
    ],
    example_body: { status: "schouw_in_afwachting", schouw_notities: "Partner bevestigd" },
  },
  {
    method: "GET",
    path: "/api/v1/projecten/:id/facturen",
    summary: "Alle facturen van een project",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Project-id" },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/projecten/:id/openstaand",
    summary: "Openstaand bedrag + overdue facturen",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Project-id" },
    ],
    example_response: {
      openstaand_aantal: 1,
      openstaand_bedrag: 7381.5,
      overdue_aantal: 0,
      overdue_bedrag: 0,
      facturen: [],
    },
  },

  // —— Agenda ——
  {
    method: "GET",
    path: "/api/v1/agenda",
    summary: "Geplande schouw / installatie",
    params: [
      { name: "from", in: "query", type: "ISO datetime", description: "Vanaf (inclusief)" },
      { name: "to", in: "query", type: "ISO datetime", description: "Tot (inclusief)" },
      {
        name: "type",
        in: "query",
        type: "1|2|3",
        description: "1=schouwweek, 2=schouwdag, 3=installatie",
      },
      { name: "project_id", in: "query", type: "uuid", description: "Filter op project" },
      { name: "limit", in: "query", type: "number", description: "Max resultaten" },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/agenda/types",
    summary: "Uitleg agenda type-codes + voorbeelden",
    params: [],
  },
  {
    method: "POST",
    path: "/api/v1/agenda",
    summary: "Agenda-punt plannen (schouw/installatie)",
    params: [
      {
        name: "type",
        in: "body",
        type: "1|2|3|string",
        required: true,
        description: "1 / schouwweek · 2 / schouwdag · 3 / installatie",
        example: 2,
      },
      { name: "project_id", in: "body", type: "uuid", required: true, description: "Project" },
      {
        name: "schouw_jaar",
        in: "body",
        type: "number",
        description: "Verplicht bij type=1",
        example: 2026,
      },
      {
        name: "schouw_week",
        in: "body",
        type: "number",
        description: "Verplicht bij type=1 (ISO-week)",
        example: 38,
      },
      {
        name: "schouw_at",
        in: "body",
        type: "string",
        description: "Type=2: Amsterdam `YYYY-MM-DDTHH:mm` of ISO",
        example: "2026-09-18T10:00",
      },
      {
        name: "start_at",
        in: "body",
        type: "string",
        description: "Alias voor schouw_at (type 2) of installatie_at (type 3)",
      },
      {
        name: "installatie_at",
        in: "body",
        type: "string",
        description: "Verplicht bij type=3",
        example: "2026-10-02T09:00",
      },
      {
        name: "installatie_partner_id",
        in: "body",
        type: "uuid",
        description: "Type=3; anders bestaande partner of enige actieve partner",
      },
      { name: "partner_id", in: "body", type: "uuid", description: "Alias voor installatie_partner_id" },
      { name: "notities", in: "body", type: "string", description: "Schouw- of installatie-notities" },
    ],
    example_body: {
      type: 2,
      project_id: "<uuid>",
      schouw_at: "2026-09-18T10:00",
      notities: "Ochtend gewenst",
    },
  },

  // —— Sales-afspraken ——
  {
    method: "GET",
    path: "/api/v1/slots",
    summary:
      "Beste huisbezoek-momenten voor een lead (reistijd over adviseurs). Retell: lead_id. Legacy: adviseur_id.",
    params: [
      {
        name: "lead_id",
        in: "query",
        type: "uuid",
        description:
          "Lead — geeft beste momenten (route-fit). Adviseur zit in slot_id.",
      },
      {
        name: "adviseur_id",
        in: "query",
        type: "uuid",
        description: "Legacy: kale slots van één adviseur (zonder lead_id)",
      },
      {
        name: "days",
        in: "query",
        type: "number",
        description: "Horizon in dagen (1–60, default 21)",
        example: 21,
      },
      {
        name: "limit",
        in: "query",
        type: "number",
        description: "Max slots (default 6 met lead_id, 40 met adviseur_id)",
        example: 6,
      },
    ],
    example_response: {
      ok: true,
      mode: "route",
      slots_tekst: "1. maandag 22 september 13:00. 2. dinsdag 23 september 10:00",
      slots: [
        {
          slot_id: "<opaque>",
          start_at: "2026-09-22T11:00:00.000Z",
          label_nl: "maandag 22 september om dertien uur",
          adviseur_id: "<uuid>",
          adviseur_naam: "Huub Veldman",
        },
      ],
    },
  },
  {
    method: "GET",
    path: "/api/v1/afspraken",
    summary: "Sales-afspraken (huisbezoek / bel)",
    params: [
      { name: "lead_id", in: "query", type: "uuid", description: "Filter lead" },
      { name: "adviseur_id", in: "query", type: "uuid", description: "Filter adviseur" },
      {
        name: "status",
        in: "query",
        type: "string",
        description: "gepland | bevestigd | verzet | geannuleerd | voltooid",
        example: "geannuleerd",
      },
      { name: "from", in: "query", type: "ISO datetime", description: "start_at >= from" },
      { name: "to", in: "query", type: "ISO datetime", description: "start_at <= to" },
      { name: "limit", in: "query", type: "number", description: "Max resultaten" },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/afspraken",
    summary: "Sales-afspraak inplannen (Retell: lead_id + slot_id)",
    params: [
      { name: "lead_id", in: "body", type: "uuid", required: true, description: "Lead" },
      {
        name: "slot_id",
        in: "body",
        type: "string",
        description: "Uit GET /slots?lead_id=… — bevat adviseur + start_at",
      },
      {
        name: "adviseur_id",
        in: "body",
        type: "uuid",
        description: "Legacy i.p.v. slot_id",
      },
      {
        name: "start_at",
        in: "body",
        type: "string",
        description: "Legacy i.p.v. slot_id — ISO of Amsterdam YYYY-MM-DDTHH:mm",
        example: "2026-09-20T13:00",
      },
      {
        name: "soort",
        in: "body",
        type: "string",
        description: "nieuw | bel | warme_bel | vervolg_fysiek | vervolg_tel | vervolg_punt (default nieuw)",
        example: "nieuw",
      },
      {
        name: "partner_aanwezig",
        in: "body",
        type: "boolean|ja|nee",
        description: "Bij soort=nieuw (default true via API)",
      },
      {
        name: "andere_offertes_gehad",
        in: "body",
        type: "boolean|ja|nee",
        description: "Bij soort=nieuw (default false via API)",
      },
      { name: "notities", in: "body", type: "string", description: "Optionele notitie" },
    ],
    example_body: {
      lead_id: "<uuid>",
      slot_id: "<uit GET /api/v1/slots>",
      soort: "nieuw",
    },
  },

  // —— Herplan (bot 2) ——
  {
    method: "GET",
    path: "/api/v1/herplan",
    summary:
      "Wachtrij herplan-bot: geannuleerde huisbezoeken zonder nieuwe actieve afspraak. Bevat dynamic_variables voor outbound.",
    params: [
      {
        name: "mode",
        in: "query",
        type: "klant|all",
        description:
          "klant = alleen leadstatus afspraak_afgezegd_klant (default). all = ook andere geannuleerde bezoeken.",
        example: "klant",
      },
      { name: "limit", in: "query", type: "number", description: "Max items (default 50)", example: 50 },
    ],
    example_response: {
      ok: true,
      count: 1,
      herplan: [
        {
          lead_id: "<uuid>",
          first_name: "Jan",
          telefoon: "+316…",
          oude_afspraak_label_nl: "dinsdag 16 september 2026 om 13:00",
          annuleringsreden: "Past niet",
          dynamic_variables: {
            lead_id: "<uuid>",
            first_name: "Jan",
            oude_afspraak_label: "…",
          },
        },
      ],
    },
  },

  // —— Terugbel (Retell) ——
  {
    method: "GET",
    path: "/api/v1/terugbel",
    summary: "Openstaande terugbelverzoeken (bel / warme_bel)",
    params: [
      { name: "lead_id", in: "query", type: "uuid", description: "Filter lead" },
      {
        name: "due",
        in: "query",
        type: "1|true",
        description: "Alleen verzoeken waarvan de geplande dag ≤ vandaag (Amsterdam)",
        example: "1",
      },
      { name: "limit", in: "query", type: "number", description: "Max resultaten", example: 100 },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/terugbel",
    summary:
      "Terugbelverzoek aanmaken (Retell). Verschijnt in CRM → Bellen. Zet lead.terugbellen.",
    params: [
      { name: "lead_id", in: "body", type: "uuid", required: true, description: "Lead" },
      {
        name: "notitie",
        in: "body",
        type: "string",
        description: "Reden / intake-samenvatting (aliases: notities, reden)",
        example: "Agenda niet bij de hand — graag vandaag terugbellen",
      },
      {
        name: "start_at",
        in: "body",
        type: "string",
        description:
          "Gewenst terugbelmoment — ISO of Amsterdam YYYY-MM-DDTHH:mm (default: nu → meteen due)",
        example: "2026-09-18T16:00",
      },
      {
        name: "adviseur_id",
        in: "body",
        type: "uuid",
        description: "Optioneel; anders lead.adviseur_id of eerste planbare adviseur",
      },
      {
        name: "warm",
        in: "body",
        type: "boolean",
        description: "true → warme_bel (prioriteit in Bellen)",
        example: false,
      },
    ],
    example_body: {
      lead_id: "<uuid>",
      notitie: "Wil later teruggebeld worden — 12 panelen, interesse Warmtefonds",
      warm: false,
    },
    example_response: {
      ok: true,
      bericht: "Terugbelverzoek genoteerd — verschijnt in Bellen",
      terugbel: {
        afspraak_id: "<uuid>",
        lead_id: "<uuid>",
        start_at: "2026-09-18T10:05:00.000Z",
        soort: "bel",
        warm: false,
        notitie: "…",
      },
    },
  },

  // —— Leads ——
  {
    method: "GET",
    path: "/api/v1/leads",
    summary: "Leads lijst",
    params: [
      { name: "status", in: "query", type: "string", description: "Leadstatus" },
      { name: "adviseur_id", in: "query", type: "uuid", description: "Filter adviseur" },
      { name: "q", in: "query", type: "string", description: "Zoek naam/email/telefoon/lead_number" },
      { name: "limit", in: "query", type: "number", description: "Max resultaten" },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/leads/:id",
    summary: "Lead + projecten + facturen + afspraken",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Lead-id" },
    ],
  },

  // —— Rapportage / sales ——
  {
    method: "GET",
    path: "/api/v1/rapportage",
    summary: "Sales / financial / geo rapportage",
    params: [
      { name: "adviseur_id", in: "query", type: "uuid", description: "Filter op adviseur" },
      {
        name: "financial_range",
        in: "query",
        type: "string",
        description: "bijv. last_30_days | this_month | this_year",
        example: "last_30_days",
      },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/sales",
    summary: "Management sales KPIs",
    params: [
      {
        name: "period",
        in: "query",
        type: "string",
        description:
          "today | this_week | last_week | this_month | last_month | last_7_days | last_14_days | last_30_days | this_quarter | this_year | custom",
        example: "this_month",
      },
      { name: "custom_start", in: "query", type: "YYYY-MM-DD", description: "Bij period=custom" },
      { name: "custom_end", in: "query", type: "YYYY-MM-DD", description: "Bij period=custom" },
      { name: "adviseur_id", in: "query", type: "uuid", description: "Filter adviseur" },
      { name: "leadbron", in: "query", type: "string", description: "Filter leadbron" },
      { name: "campaign", in: "query", type: "string", description: "Filter campagne" },
      { name: "regio", in: "query", type: "string", description: "Filter regio" },
      { name: "order_status", in: "query", type: "string", description: "Filter orderstatus" },
      { name: "installateur_id", in: "query", type: "uuid", description: "Filter installateur" },
      { name: "product", in: "query", type: "string", description: "Filter productmodel" },
      { name: "lookback", in: "query", type: "30|60|90", description: "Forecast lookback dagen" },
    ],
  },

  // —— Backoffice / taken ——
  {
    method: "GET",
    path: "/api/v1/backoffice",
    summary: "Open backoffice-acties of rapportage",
    params: [
      {
        name: "view",
        in: "query",
        type: "acties|rapportage",
        description: "Default acties; rapportage = KPI-rapport",
        example: "acties",
      },
      {
        name: "period",
        in: "query",
        type: "string",
        description: "Alleen bij view=rapportage (this_week, last_14_days, …)",
      },
    ],
  },
  {
    method: "GET",
    path: "/api/v1/taken",
    summary: "Project-taken lijst",
    params: [
      { name: "project_id", in: "query", type: "uuid", description: "Filter project" },
      {
        name: "open",
        in: "query",
        type: "0|1",
        description: "Default open=1 (niet done). open=0 = ook afgeronde",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/v1/taken",
    summary: "Handmatige taak/actie aanmaken",
    params: [
      { name: "project_id", in: "body", type: "uuid", required: true, description: "Project" },
      { name: "titel", in: "body", type: "string", required: true, description: "Omschrijving / titel" },
      {
        name: "afdeling",
        in: "body",
        type: "string",
        required: true,
        description: "Backoffice | Planning | Installatie | Facturatie | Verkoop",
        example: "Backoffice",
      },
      {
        name: "verantwoordelijke_id",
        in: "body",
        type: "uuid",
        required: true,
        description: "Medewerker (adviseur-id)",
      },
      {
        name: "due_at",
        in: "body",
        type: "ISO datetime",
        description: "Deadline (of gebruik due_in_days)",
      },
      {
        name: "due_in_days",
        in: "body",
        type: "number",
        description: "Alternatief: dagen vanaf nu",
        example: 2,
      },
      { name: "notities", in: "body", type: "string", description: "Extra omschrijving" },
    ],
    example_body: {
      project_id: "<uuid>",
      titel: "Klant nabellen over planning",
      afdeling: "Backoffice",
      verantwoordelijke_id: "<uuid>",
      due_at: "2026-09-20T17:00:00.000Z",
      notities: "Bel na 14:00",
    },
  },
  {
    method: "PATCH",
    path: "/api/v1/taken/:id",
    summary: "Taak bijwerken / voltooien",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Taak-id" },
      { name: "titel", in: "body", type: "string", description: "Nieuwe titel" },
      { name: "status", in: "body", type: "todo|doing|done", description: "Status (done = voltooien)" },
      { name: "afdeling", in: "body", type: "string", description: "Afdeling" },
      { name: "verantwoordelijke_id", in: "body", type: "uuid|null", description: "Medewerker" },
      { name: "due_at", in: "body", type: "ISO datetime|null", description: "Deadline" },
      { name: "notities", in: "body", type: "string", description: "Notities" },
    ],
    example_body: { status: "done" },
  },
  {
    method: "DELETE",
    path: "/api/v1/taken/:id",
    summary: "Taak verwijderen",
    params: [
      { name: "id", in: "path", type: "uuid", required: true, description: "Taak-id" },
    ],
  },
];

export function buildApiV1DocsPayload(opts?: { scope?: "admin" | "sales" }) {
  const scope = opts?.scope || "admin";
  const endpoints =
    scope === "sales"
      ? API_V1_DOCS.filter(
          (e) =>
            e.path === "/api/v1/slots" ||
            e.path.startsWith("/api/v1/afspraken")
        )
      : API_V1_DOCS;

  return {
    ok: true,
    name: "Batterijconcept API v1",
    scope,
    auth: {
      header: "Authorization: Bearer <key>",
      alt: "x-api-key: <key>",
      scopes: {
        admin: "API_V1_KEY — volledige API",
        sales: "API_V1_SALES_KEY — alleen GET /slots + GET/POST /afspraken",
      },
    },
    ...(scope === "admin" ? { agenda_types: agendaTypesDocs() } : {}),
    endpoints,
  };
}
