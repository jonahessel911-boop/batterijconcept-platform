import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import type { CockpitSettings } from "@/lib/sales-cockpit/settings";
import { bouwSignalen, type Signaal } from "@/lib/sales-cockpit/signals";
import {
  advisorCards,
  blockSets,
  buildKansen,
  buildOrders,
  capacityForWeek,
  inWeeks,
  pct,
  sampleBasis,
  type AdviseurKaart,
  type Kans,
  type Order,
  type Poging,
  type RawAdviseur,
  type RawAfspraak,
  type RawBlok,
  type RawFactuur,
  type RawOfferte,
  type RawProject,
} from "@/lib/sales-cockpit/model";
import { bouwAfboekRegels, koppelAfboekingen, type RawStatusEvent } from "@/lib/sales-cockpit/uitkomst";
import {
  latestTargets,
  readActions,
  readSettings,
  readTargets,
  type ActionRow,
  type TargetRow,
} from "@/lib/sales-cockpit/store";
import {
  addYmd,
  completedWeekKeys,
  currentWeekKey,
  shiftWeek,
  weekBounds,
  weekKeyOfInstant,
  ymdAmsterdam,
  type WeekBounds,
} from "@/lib/sales-cockpit/weeks";

const BEPERKINGEN = [
  "Een gelopen kans volgt uit een afboekregel in de tijdlijn: vervolg op locatie of een einduitkomst na een gesprek. Zonder die regel telt het dossier niet mee.",
  "Het afboektijdstip is created_at van de regel Via afboek. updated_at en automatisch voltooien tellen niet.",
  "De tijdlijn noemt geen afspraaknummer. Bij meerdere bezoeken koppelt de cockpit op volgorde.",
  "Beschikbaarheid uit het verleden is niet reconstrueerbaar. Alleen nieuwe snapshots vanaf nu.",
  "Een extra ondertekende offerte op dezelfde lead telt niet automatisch als nieuwe order.",
  "De verkoper is alleen toegewezen als één adviseur de fysieke afspraken tot en met de tekeningsdag deed.",
  "Aanbetaling wordt herkend aan de factuuromschrijving. Ongemarkeerde ontvangsten tellen niet mee.",
];

async function safe<T>(label: string, fn: () => Promise<T>, errors: Record<string, string>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errors[label] = e instanceof Error ? e.message : "Laden mislukt";
    return fallback;
  }
}

function sumTargets(rows: TargetRow[], key: "gelopen_target" | "deals_target"): number | null {
  const vals = rows.map((r) => r[key]).filter((n): n is number => n != null);
  if (!vals.length) return null;
  return vals.reduce((s, n) => s + n, 0);
}

function doelWaarschuwing(row: TargetRow | undefined): string | null {
  if (!row) return null;
  const g = row.gelopen_target;
  const d = row.deals_target;
  const c = row.conversie_target;
  if (g == null || d == null || c == null) return null;
  const verwacht = Math.round((g * Number(c)) / 100);
  if (verwacht !== d) {
    return `${g} gesprekken bij ${c}% wijzen op ${verwacht} deals, niet op ${d}. Niet automatisch gecorrigeerd.`;
  }
  return null;
}

const cockpitCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof buildCockpit>> }>();

export function clearCockpitCache() {
  cockpitCache.clear();
}

export async function getCockpit(sb: SupabaseClient, weekKey: string, now = new Date()) {
  const hit = cockpitCache.get(weekKey);
  if (hit && Date.now() - hit.at < 20_000) return hit.value;
  const value = await buildCockpit(sb, weekKey, now);
  cockpitCache.set(weekKey, { at: Date.now(), value });
  return value;
}

export async function buildCockpit(
  sb: SupabaseClient,
  weekKey: string,
  now = new Date()
) {
  const errors: Record<string, string> = {};
  const anchor = weekBounds(weekKey) || weekBounds(currentWeekKey(now))!;
  const today = ymdAmsterdam(now);
  const trendStart = weekBounds(shiftWeek(anchor.key, -15))!;
  const settingsRow = await safe("instellingen", () => readSettings(sb), errors, {
    settings: (await import("@/lib/sales-cockpit/settings")).DEFAULT_COCKPIT_SETTINGS,
    version: 0,
    updatedAt: null,
    missing: true,
  });
  const settings = settingsRow.settings;
  const niveau = completedWeekKeys(now, anchor.key, settings.niveauWeken);
  const vergelijk = niveau.length
    ? completedWeekKeys(now, shiftWeek(niveau[0]!, -1), settings.vergelijkWeken)
    : [];
  const trend = completedWeekKeys(now, anchor.key, settings.trendWeken);

  const adviseurs = await safe(
    "adviseurs",
    () =>
      fetchAllRows<RawAdviseur>((from, to) =>
        sb
          .from("adviseurs")
          .select("id, naam, actief, rol, email, startdatum, commissie_pct")
          .order("id")
          .range(from, to)
      ),
    errors,
    []
  );

  const afspraken = await safe(
    "afspraken",
    () =>
      fetchAllRows<RawAfspraak>((from, to) =>
        sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, status, soort, ingepland_door_id")
          .gte("start_at", trendStart.startIso)
          .lt("start_at", anchor.endIsoExclusive)
          .order("id")
          .range(from, to)
      ),
    errors,
    []
  );

  const leadIds = [...new Set(afspraken.map((a) => a.lead_id).filter(Boolean))];
  const offertes = await safe("offertes", () => loadOffertes(sb, leadIds, trendStart.startIso, anchor.endIsoExclusive), errors, []);
  const projecten = await safe("projecten", () => loadByLead<RawProject>(sb, "projecten", "id, lead_id, offerte_id, status, installatie_voltooid_at, projectkosten", leadIds), errors, []);
  const facturen = await safe("facturen", () => loadByLead<RawFactuur>(sb, "facturen", "id, lead_id, status, bedrag_inc_btw, omschrijving, betaald_op, credit_van_factuur_id", leadIds), errors, []);

  const events = await safe(
    "tijdlijn",
    () => loadStatusEvents(sb, leadIds),
    errors,
    [] as RawStatusEvent[]
  );
  const koppeling = errors.tijdlijn ? new Map() : koppelAfboekingen(afspraken, events);
  const afboekRegels = bouwAfboekRegels(afspraken, koppeling, today);

  const { orders, extraOfferteIds } = errors.offertes
    ? { orders: [] as Order[], extraOfferteIds: [] as string[] }
    : buildOrders({ offertes, projecten, facturen, afspraken, now, settings });
  const kansen = errors.afspraken ? [] : buildKansen({ afspraken, orders, now, koppeling: errors.tijdlijn ? undefined : koppeling });
  const kaarten = advisorCards(
    adviseurs.map((a) => ({ ...a, actief: a.actief !== false, commissie_pct: a.commissie_pct == null ? null : Number(a.commissie_pct) })),
    kansen,
    anchor.key
  );

  const nextKey = shiftWeek(currentWeekKey(now), 1);
  const afterKey = shiftWeek(currentWeekKey(now), 2);
  const next = weekBounds(nextKey)!;
  const after = weekBounds(afterKey)!;
  const cap = await loadCapacity(sb, kaarten, adviseurs, next, after, errors);

  const targets = await safe("targets", () => readTargets(sb, anchor.key), errors, { rows: [] as TargetRow[], missing: true });
  const currentTargets = latestTargets(targets.rows);
  const actions = await safe("acties", () => readActions(sb), errors, { rows: [] as ActionRow[], missing: true });

  const kansenNiveau = inWeeks(kansen, niveau);
  const kansenVorig = inWeeks(kansen, vergelijk);
  const ordersWeek = orders.filter((o) => o.weekKey === anchor.key);
  const ordersNiveau = inWeeks(orders, niveau);
  const uitvalGrens = addYmd(today, -settings.uitvalVensterDagen);
  const ordersOud = ordersNiveau.filter((o) => o.signYmd <= uitvalGrens);
  const ordersVorigOud = inWeeks(orders, vergelijk).filter((o) => o.signYmd <= uitvalGrens);

  const afboekBeeld = afboekOverzicht(afboekRegels, kaarten, Boolean(errors.tijdlijn), settings.afboekHerhaling);

  const signalen = bouwSignalen({
    adviseurs: kaarten,
    kansenVenster: kansenNiveau,
    kansenVorig,
    ordersOud,
    ordersVorigOud: ordersVorigOud,
    capaciteit: cap.rijen,
    periode: niveau.length ? `${niveau[0]} – ${niveau[niveau.length - 1]}` : anchor.key,
    vorigePeriode: vergelijk.length ? `${vergelijk[0]} – ${vergelijk[vergelijk.length - 1]}` : "",
    settings,
    afboek: afboekBeeld,
  });

  const snapshots = await safe("snapshots", async () => {
    await captureSnapshots(sb, next, after, cap.rijen);
    const { data, error } = await sb
      .from("sales_cockpit_snapshots")
      .select("week_key, soort, opgenomen_at, bron_van, bron_tot, payload")
      .eq("soort", "capaciteit")
      .order("opgenomen_at", { ascending: false })
      .limit(40);
    if (error) {
      const msg = error.message || "";
      if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("sales_cockpit_")) {
        return { rows: [], missing: true };
      }
      throw error;
    }
    return { rows: data || [], missing: false };
  }, errors, { rows: [], missing: true });

  const evaluations = await safe("evaluaties", async () => {
    const { data, error } = await sb
      .from("sales_cockpit_evaluations")
      .select("id, week_key, vastgelegd_at, vastgelegd_door_naam, bronkwaliteit, beeld")
      .eq("week_key", anchor.key)
      .order("vastgelegd_at", { ascending: false })
      .limit(12);
    if (error) {
      const msg = error.message || "";
      if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("sales_cockpit_")) {
        return { rows: [], missing: true };
      }
      throw error;
    }
    return { rows: data || [], missing: false };
  }, errors, { rows: [], missing: true });

  const missing = [
    settingsRow.missing ? "sales_cockpit_settings" : null,
    targets.missing ? "sales_cockpit_week_targets" : null,
    actions.missing ? "sales_cockpit_actions" : null,
    snapshots.missing ? "sales_cockpit_snapshots" : null,
    evaluations.missing ? "sales_cockpit_evaluations" : null,
  ].filter(Boolean) as string[];

  const toegewezenNiveau = kansenNiveau.length;
  const verkochtNiveau = kansenNiveau.filter((k) => k.order).length;
  const helderNiveau = kansenNiveau.filter((k) => !k.order || k.order.toerekening === "helder");
  const verkochtHelder = helderNiveau.filter((k) => k.order && k.order.toerekening === "helder").length;
  const onduidelijk = kansenNiveau.filter((k) => k.order && k.order.toerekening !== "helder").length;

  const beoordeelbaar = ordersNiveau.filter(
    (o) => !o.geenAanbetaling && !o.geannuleerd && (o.tijdig != null || o.achterstallig)
  );
  const tijdig = beoordeelbaar.filter((o) => o.tijdig === true).length;
  const uitval = ordersOud.filter((o) => o.geannuleerd).length;

  const pogingenWeek = kansen.flatMap((k) => k.pogingen).filter((p) => p.weekKey === anchor.key);

  const bundle = {
    refreshedAt: now.toISOString(),
    week: {
      ...anchor,
      current: anchor.key === currentWeekKey(now),
      complete: today > anchor.endYmd,
    },
    settings,
    settingsVersion: settingsRow.version,
    storage: { ok: missing.length === 0, missing },
    beperkingen: BEPERKINGEN,
    errors,
    home: {
      gelopen: gelopenKaart(kansen, anchor.key, errors.tijdlijn, sumTargets(currentTargets, "gelopen_target")),
      getekend: {
        aantal: ordersWeek.length,
        target: sumTargets(currentTargets, "deals_target"),
        geannuleerdLater: ordersWeek.filter((o) => o.geannuleerd).length,
      },
      conversie: conversieKaart(kansen, niveau, settings, errors.tijdlijn, {
        toegewezen: toegewezenNiveau,
        verkocht: verkochtNiveau,
        pct: pct(verkochtNiveau, toegewezenNiveau),
        uitgesloten: onduidelijk,
      }),
      dealkwaliteit: {
        tijdig,
        beoordeeld: beoordeelbaar.length,
        tijdigPct: pct(tijdig, beoordeelbaar.length),
        uitval,
        uitvalVan: ordersOud.length,
        uitvalPct: pct(uitval, ordersOud.length),
        achterstallig: orders.filter((o) => o.achterstallig).length,
        basis: sampleBasis(beoordeelbaar.length, settings.dealIndicatie, settings.dealStevig),
      },
      prioriteiten: signalen.commercieel,
      operationeel: signalen.operationeel,
      capaciteit: {
        volgende: next,
        daarna: after,
        gemiddelde: gemiddelde(cap.rijen.map((r) => r.volgende)),
        onder15: cap.rijen.filter((r) => r.volgende != null && r.volgende < settings.beschikbaarMin).length,
        adviseurs: cap.rijen.filter((r) => r.volgende != null).length,
      },
    },
    adviseurs: kaarten.map((a) => {
      const rij = adviseurRij(a, kansenNiveau, ordersOud, cap.rijen, currentTargets, settings);
      const eigenGelopen = kansen.filter(
        (k) =>
          k.gelopen &&
          k.gesprekWeekKey &&
          niveau.includes(k.gesprekWeekKey) &&
          k.pogingen.find((p) => p.klasse === "gesprek")?.adviseurId === a.id
      );
      const helderGelopen = eigenGelopen.filter((k) => !k.order || (k.order.toerekening === "helder" && k.order.verkoperId === a.id));
      const verkochtGelopen = helderGelopen.filter((k) => k.order && k.order.toerekening === "helder");
      return {
        ...rij,
        gelopen: errors.tijdlijn ? null : eigenGelopen.length,
        gelopenVerkocht: errors.tijdlijn ? null : verkochtGelopen.length,
        gelopenNoemer: errors.tijdlijn ? null : helderGelopen.length,
        gelopenPct: errors.tijdlijn ? null : pct(verkochtGelopen.length, helderGelopen.length),
        gelopenOpen: eigenGelopen.filter((k) => k.nogOpen).length,
      };
    }),
    capaciteit: {
      volgende: next,
      daarna: after,
      rijen: cap.rijen.map((r) => ({
        ...r,
        naam: kaarten.find((a) => a.id === r.adviseurId)?.naam || "Adviseur",
        onder: r.volgende != null && r.volgende < settings.beschikbaarMin,
      })),
      trend: trend.map((key) => ({
        weekKey: key,
        toegewezen: kansen.filter((k) => k.weekKey === key).length,
        getekend: orders.filter((o) => o.weekKey === key).length,
        capaciteit: null as number | null,
      })),
      snapshots: snapshots.rows,
      noot: "Historische capaciteit staat alleen als er op dat moment een snapshot is gemaakt. Ontbrekende weken zijn niet achteraf ingevuld.",
    },
    afspraken: {
      pogingen: telPogingen(pogingenWeek),
      kansen: telKansen(kansen.filter((k) => k.weekKey === anchor.key)),
      noot: errors.tijdlijn
        ? "De tijdlijn kon niet geladen worden. Uitkomsten zijn dan onbekend."
        : "Gesprek, deur dicht en afgezegd komen uit de afboekregel. Zonder die regel blijft de poging onbekend. Verplaatst staat niet als status op de afspraak.",
    },
    conversie: {
      niveau,
      vergelijk,
      trend: trend.map((key) => {
        const ks = kansen.filter((k) => k.gesprekWeekKey === key);
        const helder = ks.filter((k) => !k.order || k.order.toerekening === "helder");
        const sold = helder.filter((k) => k.order && k.order.toerekening === "helder");
        return {
          weekKey: key,
          toegewezen: kansen.filter((k) => k.weekKey === key).length,
          helder: helder.length,
          verkocht: sold.length,
          open: ks.filter((k) => k.nogOpen).length,
          pct: pct(sold.length, helder.length),
          basis: errors.tijdlijn ? "geen" : sampleBasis(helder.length, settings.convIndicatie, settings.convStevig),
        };
      }),
      matrix: kaarten.filter((a) => a.planbaar || a.actief).map((a) => ({
        adviseurId: a.id,
        naam: a.naam,
        fase: a.fase,
        cellen: trend.map((key) => targetCel(a.id, key, kansen, orders, currentTargets, settings, anchor.key)),
      })),
    },
    deals: dealOverzicht(orders, ordersWeek, settings, today),
    afboeken: afboekBeeld,
    meeting: {
      rijen: kaarten.filter((a) => a.planbaar).map((a) => {
        const target = currentTargets.find((t) => t.adviseur_id === a.id);
        const capRij = cap.rijen.find((r) => r.adviseurId === a.id);
        const gepland = kansen
          .filter((k) => k.toegewezenAan === a.id && k.weekKey === anchor.key)
          .length;
        return {
          adviseurId: a.id,
          naam: a.naam,
          gepland,
          volgende: capRij?.volgende ?? null,
          daarna: capRij?.daarna ?? null,
          target: target || null,
          historie: targets.rows.filter((t) => t.adviseur_id === a.id),
          waarschuwing: doelWaarschuwing(target),
        };
      }),
    },
    acties: actions.rows,
    evaluaties: evaluations.rows,
    ids: {
      extraOffertes: extraOfferteIds,
    },
  };

  return { bundle, kansen, orders, afspraken, kaarten };
}

function gelopenKaart(kansen: Kans[], weekKey: string, mislukt: string | undefined, target: number | null) {
  if (mislukt) {
    return {
      status: "niet_meetbaar" as const,
      tekst: "De tijdlijn kon niet geladen worden.",
      aantal: null as number | null,
      nogOpen: null as number | null,
      zonderRegel: null as number | null,
      target,
    };
  }
  const gelopen = kansen.filter((k) => k.gesprekWeekKey === weekKey);
  const zonder = kansen.filter((k) => k.weekKey === weekKey && k.bucket === "onbekend");
  return {
    status: "meetbaar" as const,
    tekst: `${gelopen.length} unieke kansen met een afboekregel die een gesprek aantoont`,
    aantal: gelopen.length,
    nogOpen: gelopen.filter((k) => k.nogOpen).length,
    zonderRegel: zonder.length,
    target,
  };
}

function conversieKaart(
  kansen: Kans[],
  niveau: string[],
  settings: CockpitSettings,
  mislukt: string | undefined,
  toegewezen: { toegewezen: number; verkocht: number; pct: number | null; uitgesloten: number }
) {
  if (mislukt) {
    return {
      status: "niet_meetbaar" as const,
      tekst: "De tijdlijn kon niet geladen worden. De 40%-norm wordt niet beoordeeld.",
      pct: null as number | null,
      verkocht: null as number | null,
      gelopen: null as number | null,
      open: null as number | null,
      uitgesloten: toegewezen.uitgesloten,
      basis: "geen" as const,
      toegewezen: toegewezen.toegewezen,
      toegewezenVerkocht: toegewezen.verkocht,
      toegewezenPct: toegewezen.pct,
    };
  }
  const ks = kansen.filter((k) => k.gesprekWeekKey && niveau.includes(k.gesprekWeekKey));
  const helder = ks.filter((k) => !k.order || k.order.toerekening === "helder");
  const sold = helder.filter((k) => k.order && k.order.toerekening === "helder");
  return {
    status: "meetbaar" as const,
    tekst: "Verkocht gedeeld door gelopen kansen. Nog open vervolgen zitten in de noemer. De 40%-norm hoort bij dit cijfer.",
    pct: pct(sold.length, helder.length),
    verkocht: sold.length,
    gelopen: helder.length,
    open: ks.filter((k) => k.nogOpen).length,
    uitgesloten: ks.length - helder.length,
    basis: sampleBasis(helder.length, settings.convIndicatie, settings.convStevig),
    toegewezen: toegewezen.toegewezen,
    toegewezenVerkocht: toegewezen.verkocht,
    toegewezenPct: toegewezen.pct,
  };
}

function afboekOverzicht(
  regels: ReturnType<typeof bouwAfboekRegels>,
  kaarten: AdviseurKaart[],
  tijdlijnMislukt: boolean,
  herhalingDrempel: number
) {
  if (tijdlijnMislukt) {
    return {
      meetbaar: false,
      tekst: "De tijdlijn kon niet geladen worden.",
      opTijd: null as number | null,
      teLaat: null as number | null,
      zonderTijd: null as number | null,
      vandaagOpen: null as number | null,
      percentage: null as number | null,
      beoordeeld: 0,
      herhaling: [] as string[],
    };
  }
  const bekend = regels.filter((r) => r.tijdBekend);
  const opTijd = bekend.filter((r) => r.opTijd).length;
  const teLaat = regels.filter((r) => r.teLaat);
  const dagen = new Map<string, Set<string>>();
  for (const regel of teLaat) {
    if (!regel.adviseurId) continue;
    const set = dagen.get(regel.adviseurId) || new Set<string>();
    set.add(regel.dag);
    dagen.set(regel.adviseurId, set);
  }
  const naam = new Map(kaarten.map((k) => [k.id, k.naam]));
  const herhaling = [...dagen.entries()]
    .filter(([, set]) => set.size >= herhalingDrempel)
    .map(([id, set]) => `${naam.get(id) || "Adviseur"}: ${set.size} te late dagen`);
  return {
    meetbaar: true,
    tekst: "Op tijd betekent dat de afboekregel op de kalenderdag van het bezoek valt, vóór 00:00 in Amsterdam. Afspraken zonder tijdlijnregel zitten niet in het percentage.",
    opTijd,
    teLaat: teLaat.length,
    zonderTijd: regels.filter((r) => r.zonderTijd).length,
    vandaagOpen: regels.filter((r) => r.vandaagOpen).length,
    percentage: pct(opTijd, bekend.length),
    beoordeeld: bekend.length,
    herhaling,
  };
}

async function loadStatusEvents(sb: SupabaseClient, leadIds: string[]): Promise<RawStatusEvent[]> {
  const out: RawStatusEvent[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const rows = await fetchAllRows<RawStatusEvent>((from, to) =>
      sb
        .from("lead_events")
        .select("id, lead_id, titel, detail, created_at")
        .eq("soort", "status")
        .in("lead_id", chunk)
        .order("id")
        .range(from, to)
    );
    out.push(...rows);
  }
  return out;
}

function adviseurRij(
  a: AdviseurKaart,
  kansen: Kans[],
  ordersOud: Order[],
  cap: { adviseurId: string; volgende: number | null; daarna: number | null }[],
  targets: TargetRow[],
  settings: CockpitSettings
) {
  const eigen = kansen.filter((k) => k.toegewezenAan === a.id);
  const helder = eigen.filter((k) => !k.order || (k.order.toerekening === "helder" && k.order.verkoperId === a.id));
  const sold = helder.filter((k) => k.order && k.order.verkoperId === a.id);
  const orders = ordersOud.filter((o) => o.verkoperId === a.id && o.toerekening === "helder");
  const pay = orders.filter((o) => !o.geenAanbetaling && o.tijdig != null);
  const capRij = cap.find((c) => c.adviseurId === a.id);
  const target = targets.find((t) => t.adviseur_id === a.id);
  const basis = sampleBasis(helder.length, settings.convIndicatie, settings.convStevig);
  let signaal = "Geen hard signaal";
  if (!a.actief) signaal = "Niet meer actief";
  else if (basis === "geen") signaal = "Onvoldoende data";
  else if (capRij?.volgende != null && capRij.volgende < settings.beschikbaarMin) signaal = "Weinig capaciteit vooruit";
  return {
    ...a,
    email: undefined,
    toegewezen: eigen.length,
    conversiePct: pct(sold.length, helder.length),
    conversieTeller: sold.length,
    conversieNoemer: helder.length,
    basis,
    aanbetalingPct: pct(pay.filter((o) => o.tijdig).length, pay.length),
    uitvalPct: pct(orders.filter((o) => o.geannuleerd).length, orders.length),
    volgende: capRij?.volgende ?? null,
    daarna: capRij?.daarna ?? null,
    targetGelopen: target?.gelopen_target ?? null,
    targetDeals: target?.deals_target ?? null,
    targetConversie: target?.conversie_target ?? null,
    signaal,
  };
}

function telPogingen(pogingen: Poging[]) {
  const count = (klasse: Poging["klasse"]) => pogingen.filter((p) => p.klasse === klasse).length;
  return {
    totaal: pogingen.length,
    gepland: count("gepland"),
    geannuleerd: count("geannuleerd"),
    onbekend: count("onbekend"),
    gesprek: count("gesprek"),
    deurDicht: count("deur_dicht"),
    klantAfgezegd: count("afgezegd"),
    verplaatst: null,
  };
}

function telKansen(kansen: Kans[]) {
  const count = (b: Kans["bucket"]) => kansen.filter((k) => k.bucket === b).length;
  return {
    totaal: kansen.length,
    nogGepland: count("nog_gepland"),
    nietUitgevoerd: count("niet_uitgevoerd"),
    onbekend: count("onbekend"),
    gesprek: count("gesprek"),
  };
}

function dealOverzicht(orders: Order[], week: Order[], settings: CockpitSettings, today: string) {
  const bucket = {
    getekend: orders.length,
    wacht: orders.filter((o) => !o.geenAanbetaling && !o.aanbetaald && !o.gedeeltelijk && !o.geannuleerd).length,
    gedeeltelijk: orders.filter((o) => o.gedeeltelijk).length,
    aanbetaald: orders.filter((o) => o.aanbetaald).length,
    geenAanbetaling: orders.filter((o) => o.geenAanbetaling).length,
    netto: orders.filter((o) => o.nettoAfgerond).length,
    geannuleerd: orders.filter((o) => o.geannuleerd).length,
  };
  const metDatum = orders.filter((o) => o.aanbetaald && o.drempelYmd && !o.geenAanbetaling);
  const duren = metDatum.map((o) => dagenTussen(o.signYmd, o.drempelYmd!));
  const gem = duren.length ? Math.round((duren.reduce((s, n) => s + n, 0) / duren.length) * 10) / 10 : null;
  return {
    bucket,
    dezeWeek: week.length,
    dezeWeekGeannuleerd: week.filter((o) => o.geannuleerd).length,
    gemiddeldeDagen: gem,
    verdeling: {
      t0_4: duren.filter((d) => d <= 4).length,
      t5_7: duren.filter((d) => d >= 5 && d <= settings.aanbetalingDagen).length,
      later: duren.filter((d) => d > settings.aanbetalingDagen).length,
    },
    achterstallig: orders.filter((o) => o.achterstallig).length,
    binnenTermijn: orders.filter((o) => !o.geenAanbetaling && !o.aanbetaald && !o.geannuleerd && o.signYmd > addYmd(today, -settings.aanbetalingDagen)).length,
    onduidelijkeOntvangsten: orders.filter((o) => o.onduidelijkeOntvangstInc > 0).length,
  };
}

function dagenTussen(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

function gemiddelde(vals: (number | null)[]): number | null {
  const n = vals.filter((v): v is number => v != null);
  if (!n.length) return null;
  return Math.round((n.reduce((s, v) => s + v, 0) / n.length) * 10) / 10;
}

function targetCel(
  adviseurId: string,
  weekKey: string,
  kansen: Kans[],
  orders: Order[],
  targets: TargetRow[],
  settings: CockpitSettings,
  anchorKey: string
) {
  const target = weekKey === anchorKey ? targets.find((t) => t.adviseur_id === adviseurId) : undefined;
  const ks = kansen.filter((k) => k.weekKey === weekKey && k.toegewezenAan === adviseurId);
  const deals = orders.filter((o) => o.weekKey === weekKey && o.verkoperId === adviseurId && o.toerekening === "helder");
  return {
    weekKey,
    gesprekken: null as number | null,
    gesprekTarget: target?.gelopen_target ?? null,
    gesprekGehaald: null as boolean | null,
    deals: deals.length,
    dealsTarget: target?.deals_target ?? null,
    dealsGehaald: target?.deals_target != null ? deals.length >= target.deals_target : null,
    conversieTarget: target?.conversie_target ?? null,
    conversieGehaald: null as boolean | null,
    basis: sampleBasis(ks.length, settings.convIndicatie, settings.convStevig),
    noot: "Gesprekken en conversie op geopende deuren zijn niet meetbaar. Dealtarget vergelijkt getekende orders in die week.",
  };
}

async function loadOffertes(
  sb: SupabaseClient,
  leadIds: string[],
  fromIso: string,
  toIso: string
): Promise<RawOfferte[]> {
  const cols =
    "id, lead_id, status, ondertekend_op, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, financiering_voorbehoud, aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc";
  const byId = new Map<string, RawOfferte>();
  const inWindow = await fetchAllRows<RawOfferte>((from, to) =>
    sb
      .from("offertes")
      .select(cols)
      .eq("status", "ondertekend")
      .gte("ondertekend_op", fromIso)
      .lt("ondertekend_op", toIso)
      .order("id")
      .range(from, to)
  );
  for (const o of inWindow) byId.set(o.id, o);
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const rows = await fetchAllRows<RawOfferte>((from, to) =>
      sb.from("offertes").select(cols).in("lead_id", chunk).eq("status", "ondertekend").order("id").range(from, to)
    );
    for (const o of rows) byId.set(o.id, o);
  }
  return [...byId.values()];
}

async function loadByLead<T>(sb: SupabaseClient, table: string, cols: string, leadIds: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const rows = await fetchAllRows<T>((from, to) =>
      sb.from(table).select(cols).in("lead_id", chunk).order("id").range(from, to) as PromiseLike<{
        data: T[] | null;
        error: { message?: string; code?: string } | null;
      }>
    );
    out.push(...rows);
  }
  return out;
}

async function loadCapacity(
  sb: SupabaseClient,
  kaarten: AdviseurKaart[],
  raw: RawAdviseur[],
  next: WeekBounds,
  after: WeekBounds,
  errors: Record<string, string>
) {
  const ids = kaarten.filter((a) => a.planbaar).map((a) => a.id);
  const blokken = await safe(
    "blokkades",
    () =>
      fetchAllRows<RawBlok>((from, to) =>
        sb
          .from("adviseur_afblokkingen")
          .select("adviseur_id, dag, slot_hour")
          .in("adviseur_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .gte("dag", next.startYmd)
          .lte("dag", after.endYmd)
          .order("id")
          .range(from, to)
      ),
    errors,
    []
  );
  const vrij = await safe(
    "vrijgaven",
    () =>
      fetchAllRows<RawBlok>((from, to) =>
        sb
          .from("adviseur_slot_vrijgaven")
          .select("adviseur_id, dag, slot_hour")
          .in("adviseur_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
          .gte("dag", next.startYmd)
          .lte("dag", after.endYmd)
          .order("id")
          .range(from, to)
      ),
    errors,
    []
  );
  const unavail = await safe(
    "weekdicht",
    async () => {
      const { data, error } = await sb
        .from("adviseur_beschikbaarheid")
        .select("adviseur_id, jaar, week, beschikbaar")
        .in("adviseur_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("beschikbaar", false);
      if (error) {
        const msg = error.message || "";
        if (error.code === "42P01" || msg.includes("adviseur_beschikbaarheid")) return [];
        throw error;
      }
      return data || [];
    },
    errors,
    []
  );
  const afblok = blockSets(blokken);
  const vrijgave = blockSets(vrij);
  const dicht = new Set(
    (unavail as { adviseur_id: string; jaar: number; week: number }[]).map(
      (r) => `${r.adviseur_id}:${r.jaar}-W${String(r.week).padStart(2, "0")}`
    )
  );
  const rijen = ids.map((id) => {
    const adv = raw.find((a) => a.id === id)!;
    const cardAdv = {
      ...adv,
      actief: adv.actief !== false,
      commissie_pct: adv.commissie_pct == null ? null : Number(adv.commissie_pct),
    };
    return {
      adviseurId: id,
      volgende: capacityForWeek({
        adviseur: cardAdv,
        startYmd: next.startYmd,
        endYmd: next.endYmd,
        afblok,
        vrijgave,
        weekUnavailable: dicht.has(`${id}:${next.key}`),
      }),
      daarna: capacityForWeek({
        adviseur: cardAdv,
        startYmd: after.startYmd,
        endYmd: after.endYmd,
        afblok,
        vrijgave,
        weekUnavailable: dicht.has(`${id}:${after.key}`),
      }),
    };
  });
  return { rijen };
}

async function captureSnapshots(
  sb: SupabaseClient,
  next: WeekBounds,
  after: WeekBounds,
  rijen: { adviseurId: string; volgende: number | null; daarna: number | null }[]
) {
  for (const week of [
    { bounds: next, field: "volgende" as const },
    { bounds: after, field: "daarna" as const },
  ]) {
    const payload = rijen
      .filter((r) => r[week.field] != null)
      .map((r) => ({ adviseurId: r.adviseurId, blokken: r[week.field] }));
    const { error } = await sb.from("sales_cockpit_snapshots").insert({
      week_key: week.bounds.key,
      soort: "capaciteit",
      bron_van: week.bounds.startYmd,
      bron_tot: week.bounds.endYmd,
      payload,
    });
    if (!error) continue;
    if (error.code === "23505") continue;
    const msg = error.message || "";
    if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("sales_cockpit_")) return;
  }
}

export function filterDossiers(opts: {
  kansen: Kans[];
  orders: Order[];
  kind: string;
  weekKey: string;
  adviseurId: string | null;
}) {
  const adv = opts.adviseurId;
  if (opts.kind === "getekend") {
    return opts.orders
      .filter((o) => o.weekKey === opts.weekKey && (!adv || o.verkoperId === adv))
      .map((o) => o.leadId);
  }
  if (opts.kind === "achterstallig") {
    return opts.orders.filter((o) => o.achterstallig && (!adv || o.verkoperId === adv)).map((o) => o.leadId);
  }
  if (opts.kind === "geannuleerd") {
    return opts.orders.filter((o) => o.geannuleerd && (!adv || o.verkoperId === adv)).map((o) => o.leadId);
  }
  if (opts.kind === "toegewezen") {
    return opts.kansen
      .filter((k) => k.weekKey === opts.weekKey && (!adv || k.toegewezenAan === adv))
      .map((k) => k.leadId);
  }
  if (opts.kind === "gesprek" || opts.kind === "deur_dicht" || opts.kind === "afgezegd") {
    return opts.kansen
      .filter((k) =>
        k.pogingen.some(
          (p) => p.weekKey === opts.weekKey && p.klasse === opts.kind && (!adv || p.adviseurId === adv)
        )
      )
      .map((k) => k.leadId);
  }
  if (opts.kind === "poging_onbekend" || opts.kind === "poging_geannuleerd" || opts.kind === "poging_gepland") {
    const klasse =
      opts.kind === "poging_onbekend" ? "onbekend" : opts.kind === "poging_geannuleerd" ? "geannuleerd" : "gepland";
    return opts.kansen
      .filter((k) =>
        k.pogingen.some(
          (p) => p.weekKey === opts.weekKey && p.klasse === klasse && (!adv || p.adviseurId === adv)
        )
      )
      .map((k) => k.leadId);
  }
  if (opts.kind === "uitsluiting") {
    return opts.kansen
      .filter((k) => k.weekKey === opts.weekKey && k.order && k.order.toerekening !== "helder")
      .map((k) => k.leadId);
  }
  return [];
}

export type { Signaal, WeekBounds };
