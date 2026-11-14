import { DEFAULT_COCKPIT_SETTINGS } from "./settings";
import { expectedVersionConflict } from "./store";
import {
  buildKansen,
  buildOrders,
  capacityForWeek,
  type RawAdviseur,
  type RawAfspraak,
  type RawFactuur,
  type RawOfferte,
  type RawProject,
} from "./model";
import { bouwAfboekRegels, koppelAfboekingen } from "./uitkomst";
import { weekKeyOfInstant } from "./weeks";

const settings = DEFAULT_COCKPIT_SETTINGS;
const now = new Date("2026-10-30T12:00:00.000Z");
let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`ok  ${name}`);
    return;
  }
  failed += 1;
  console.error(`fail ${name}`, detail ?? "");
}

const adv: RawAdviseur = {
  id: "a1",
  naam: "Adviseur A",
  email: "a@example.test",
  actief: true,
  rol: "adviseur",
  commissie_pct: null,
  startdatum: "2026-01-01",
};
const advB: RawAdviseur = { ...adv, id: "b1", naam: "Adviseur B", email: "b@example.test" };

function appt(partial: Partial<RawAfspraak> & Pick<RawAfspraak, "id" | "lead_id" | "start_at" | "soort">): RawAfspraak {
  return {
    adviseur_id: "a1",
    status: "gepland",
    ingepland_door_id: null,
    ...partial,
  };
}

const afspraken: RawAfspraak[] = [
  appt({ id: "p1", lead_id: "l1", start_at: "2026-09-01T08:00:00.000Z", soort: "nieuw", status: "geannuleerd" }),
  appt({ id: "p2", lead_id: "l1", start_at: "2026-09-08T08:00:00.000Z", soort: "vervolg_fysiek", status: "gepland" }),
  appt({ id: "p3", lead_id: "l2", start_at: "2026-09-02T08:00:00.000Z", soort: "nieuw", status: "gepland" }),
  appt({ id: "p4", lead_id: "l2", start_at: "2026-09-09T08:00:00.000Z", soort: "vervolg_fysiek", status: "geannuleerd" }),
  appt({ id: "p5", lead_id: "l2", start_at: "2026-09-10T08:00:00.000Z", soort: "vervolg_tel", status: "gepland" }),
  appt({ id: "p6", lead_id: "l3", start_at: "2026-09-15T08:00:00.000Z", soort: "nieuw", status: "gepland" }),
  appt({ id: "p7", lead_id: "l5", start_at: "2026-10-01T08:00:00.000Z", soort: "nieuw", adviseur_id: "a1" }),
  appt({ id: "p8", lead_id: "l5", start_at: "2026-10-02T08:00:00.000Z", soort: "vervolg_fysiek", adviseur_id: "b1" }),
  appt({ id: "p9", lead_id: "l8", start_at: "2026-10-06T08:00:00.000Z", soort: "nieuw", adviseur_id: "a1" }),
];

function offerte(partial: Partial<RawOfferte> & Pick<RawOfferte, "id" | "lead_id" | "ondertekend_op">): RawOfferte {
  return {
    status: "ondertekend",
    subtotaal_ex_btw: 10000,
    btw_bedrag: 2100,
    totaal_inc_btw: 12100,
    financiering_voorbehoud: false,
    aanbetaling_modus: "handmatig",
    aanbetaling_bedrag_inc: 1000,
    aanbetaling_te_innen_inc: 1000,
    ...partial,
  };
}

const offertes: RawOfferte[] = [
  offerte({ id: "o3", lead_id: "l3", ondertekend_op: "2026-10-22T10:00:00.000Z" }),
  offerte({ id: "o3b", lead_id: "l3", ondertekend_op: "2026-10-23T10:00:00.000Z" }),
  offerte({ id: "o4", lead_id: "l4", ondertekend_op: "2026-09-01T10:00:00.000Z", aanbetaling_te_innen_inc: 0, aanbetaling_bedrag_inc: 0 }),
  offerte({ id: "o5", lead_id: "l5", ondertekend_op: "2026-10-03T10:00:00.000Z" }),
  offerte({ id: "o6", lead_id: "l6", ondertekend_op: "2026-10-10T10:00:00.000Z" }),
  offerte({ id: "o7", lead_id: "l7", ondertekend_op: "2026-10-12T10:00:00.000Z" }),
  offerte({ id: "o8", lead_id: "l8", ondertekend_op: "2026-10-28T10:00:00.000Z" }),
  offerte({ id: "o9", lead_id: "l9", ondertekend_op: "2026-10-12T10:00:00.000Z" }),
];

const projecten: RawProject[] = [
  { id: "pr6", lead_id: "l6", offerte_id: "o6", status: "annulering", installatie_voltooid_at: null, projectkosten: null },
  { id: "pr7", lead_id: "l7", offerte_id: "o7", status: "ingepland", installatie_voltooid_at: null, projectkosten: null },
  { id: "pr9", lead_id: "l9", offerte_id: "o9", status: "installatie_voltooid", installatie_voltooid_at: "2026-10-20T10:00:00.000Z", projectkosten: null },
];

const facturen: RawFactuur[] = [
  {
    id: "f7",
    lead_id: "l7",
    status: "betaald",
    omschrijving: "Aanbetaling",
    bedrag_inc_btw: 1000,
    betaald_op: "2026-10-14",
    credit_van_factuur_id: null,
  },
  {
    id: "f8",
    lead_id: "l8",
    status: "betaald",
    omschrijving: "Overige ontvangst",
    bedrag_inc_btw: 12100,
    betaald_op: "2026-10-29",
    credit_van_factuur_id: null,
  },
];

const { orders, extraOfferteIds } = buildOrders({ offertes, projecten, facturen, afspraken, now, settings });
const kansen = buildKansen({ afspraken, orders, now });
const byLead = (id: string) => orders.find((o) => o.leadId === id);
const kans = (id: string) => kansen.find((k) => k.leadId === id);

check("vervolg telt niet als extra kans", kansen.filter((k) => k.leadId === "l1").length === 1 && (kans("l1")?.pogingen.length || 0) === 2);
check("eerste mislukte poging blijft zichtbaar", kans("l1")?.pogingen.some((p) => p.id === "p1" && p.klasse === "geannuleerd") === true);
check("later mislukt vervolg wist de kans niet", Boolean(kans("l2")) && kans("l2")?.bucket !== "niet_uitgevoerd");
check("telefonisch vervolg is geen nieuwe kans", !kansen.some((k) => k.pogingen.some((p) => p.id === "p5")));
check("vervangende offerte telt niet dubbel", orders.filter((o) => o.leadId === "l3").length === 1 && extraOfferteIds.includes("o3b"));
check("annulering laat ondertekening staan", byLead("l6")?.geannuleerd === true);
check(
  "aanbetaald is niet hetzelfde als netto afgerond",
  byLead("l7")?.aanbetaald === true &&
    byLead("l7")?.nettoAfgerond === false &&
    byLead("l9")?.nettoAfgerond === true &&
    byLead("l9")?.aanbetaald === false
);
check("nul euro is niet achterstallig", byLead("l4")?.geenAanbetaling === true && byLead("l4")?.achterstallig === false);
check("onbetaalde order na zeven dagen is achterstallig", byLead("l5")?.achterstallig === true);
check("eindfactuur telt niet als aanbetaling", byLead("l8")?.aanbetaald === false && byLead("l8")?.onduidelijkeOntvangstInc === 12100);
check("twee adviseurs geven onduidelijke toerekening", byLead("l5")?.toerekening === "onduidelijk" && byLead("l5")?.verkoperId == null);
check("enkele uitvoerder is de verkoper", byLead("l3")?.toerekening === "helder" && byLead("l3")?.verkoperId === "a1");
check(
  "week van ondertekening is niet de week van het eerste bezoek",
  byLead("l3")?.weekKey !== kans("l3")?.weekKey
);

const open = capacityForWeek({
  adviseur: adv,
  startYmd: "2026-11-02",
  endYmd: "2026-11-08",
  afblok: new Set(),
  vrijgave: new Set(),
  weekUnavailable: false,
});
const metBoekingNietAfgetrokken = capacityForWeek({
  adviseur: adv,
  startYmd: "2026-11-02",
  endYmd: "2026-11-08",
  afblok: new Set(),
  vrijgave: new Set(),
  weekUnavailable: false,
});
check("beschikbaarheid trekt geboekte blokken niet af", open != null && open === metBoekingNietAfgetrokken && open > 15, open);
check("hele week dicht is nul", capacityForWeek({ adviseur: adv, startYmd: "2026-11-02", endYmd: "2026-11-08", afblok: new Set(), vrijgave: new Set(), weekUnavailable: true }) === 0);
check("inactief geeft geen capaciteitscijfer", capacityForWeek({ adviseur: { ...adv, actief: false }, startYmd: "2026-11-02", endYmd: "2026-11-08", afblok: new Set(), vrijgave: new Set(), weekUnavailable: false }) == null);

const zondag = weekKeyOfInstant("2026-10-25T21:30:00.000Z");
const maandag = weekKeyOfInstant("2026-10-25T23:30:00.000Z");
check("zondagavond Amsterdam blijft in de oude week", zondag != null && maandag != null && zondag !== maandag, { zondag, maandag });
check("versieconflict bij afwijkende versie", expectedVersionConflict(2, 1) && !expectedVersionConflict(2, 2));
check("tweede adviseur bestaat in fixture", advB.id === "b1");

const bezoeken: RawAfspraak[] = [
  appt({ id: "v1", lead_id: "lx", start_at: "2026-10-20T08:00:00.000Z", soort: "nieuw" }),
  appt({ id: "v2", lead_id: "lx", start_at: "2026-10-27T08:00:00.000Z", soort: "vervolg_fysiek" }),
  appt({ id: "v3", lead_id: "ly", start_at: "2026-10-20T08:00:00.000Z", soort: "nieuw" }),
];
const tijdlijn = [
  {
    id: "e1",
    lead_id: "lx",
    titel: "Status → Vervolg op locatie",
    detail: "Via afboek + vervolg gepland",
    created_at: "2026-10-20T16:00:00.000Z",
  },
  {
    id: "e2",
    lead_id: "lx",
    titel: "Status → Geen interesse — overig",
    detail: "Via afboek (eindstatus)",
    created_at: "2026-10-28T10:00:00.000Z",
  },
  {
    id: "e3",
    lead_id: "ly",
    titel: "Status → Deur niet open / klant niet bereikbaar",
    detail: "Via afboek (eindstatus)",
    created_at: "2026-10-21T08:00:00.000Z",
  },
];
const gekoppeld = koppelAfboekingen(bezoeken, tijdlijn);
const metUitkomst = buildKansen({ afspraken: bezoeken, orders: [], now, koppeling: gekoppeld });
const lx = metUitkomst.find((k) => k.leadId === "lx");
const ly = metUitkomst.find((k) => k.leadId === "ly");
check("vervolg op locatie maakt het eerste bezoek gelopen", lx?.gelopen === true && lx.pogingen[0]?.klasse === "gesprek");
check("latere eindstatus wist het eerste gesprek niet", lx?.pogingen[0]?.klasse === "gesprek" && lx.pogingen[1]?.klasse === "gesprek" && lx.nogOpen === false);
check("deur niet open is niet gelopen en blijft zichtbaar", ly?.gelopen === false && ly?.bucket === "niet_uitgevoerd" && ly?.pogingen[0]?.klasse === "deur_dicht");
const regels = bouwAfboekRegels(bezoeken, gekoppeld, "2026-10-30");
check("afboeken dezelfde dag is op tijd", regels.find((r) => r.afspraakId === "v1")?.opTijd === true);
check("afboeken de volgende dag is te laat", regels.find((r) => r.afspraakId === "v3")?.teLaat === true);
const zonder = koppelAfboekingen(bezoeken, []);
check(
  "zonder tijdlijnregel geen verzonnen tijdstip",
  bouwAfboekRegels(bezoeken, zonder, "2026-10-30").every((r) => r.zonderTijd && !r.teLaat && !r.opTijd)
);

if (failed) {
  console.error(`${failed} checks failed`);
  process.exit(1);
}
console.log("all checks passed");
