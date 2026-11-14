import type { CockpitSettings } from "@/lib/sales-cockpit/settings";
import type { AdviseurKaart, Kans, Order } from "@/lib/sales-cockpit/model";
import { pct, sampleBasis } from "@/lib/sales-cockpit/model";

export type SignaalSoort = "verplichting" | "onderzoek" | "verbeterkans" | "groeikans";
export type SignaalPlek = "commercieel" | "operationeel";

export type Signaal = {
  key: string;
  plek: SignaalPlek;
  soort: SignaalSoort;
  adviseurId: string | null;
  adviseur: string;
  titel: string;
  observatie: string;
  volume: string;
  periode: string;
  trend: string;
  betrouwbaarheid: string;
  actie: string;
  verantwoordelijke: string;
  doorklik: string;
};

function rate(orders: Order[], pred: (o: Order) => boolean): { n: number; d: number; p: number | null } {
  const d = orders.length;
  const n = orders.filter(pred).length;
  return { n, d, p: pct(n, d) };
}

export function bouwSignalen(opts: {
  adviseurs: AdviseurKaart[];
  kansenVenster: Kans[];
  kansenVorig: Kans[];
  ordersOud: Order[];
  ordersVorigOud: Order[];
  capaciteit: { adviseurId: string; volgende: number | null; daarna: number | null }[];
  periode: string;
  vorigePeriode: string;
  settings: CockpitSettings;
  afboek?: {
    meetbaar: boolean;
    teLaat: number | null;
    zonderTijd: number | null;
    vandaagOpen: number | null;
    percentage: number | null;
    beoordeeld: number;
    herhaling: string[];
  };
}): { commercieel: Signaal[]; operationeel: Signaal[] } {
  const naam = new Map(opts.adviseurs.map((a) => [a.id, a.naam]));
  const commercieel: Signaal[] = [];
  const operationeel: Signaal[] = [];

  const teamOrders = opts.ordersOud.filter((o) => !o.annuleringOnduidelijk);
  const teamUitval = rate(teamOrders, (o) => o.geannuleerd);
  const teamTijdig = rate(
    teamOrders.filter((o) => !o.geenAanbetaling && o.tijdig != null),
    (o) => o.tijdig === true
  );

  for (const a of opts.adviseurs) {
    const kansen = opts.kansenVenster.filter((k) => k.toegewezenAan === a.id);
    const vorig = opts.kansenVorig.filter((k) => k.toegewezenAan === a.id);
    const helder = kansen.filter(
      (k) => !k.order || (k.order.toerekening === "helder" && k.order.verkoperId === a.id)
    );
    const verkocht = helder.filter((k) => k.order && k.order.toerekening === "helder" && k.order.verkoperId === a.id);
    const vorigHelder = vorig.filter((k) => !k.order || (k.order.toerekening === "helder" && k.order.verkoperId === a.id));
    const vorigVerkocht = vorigHelder.filter((k) => k.order && k.order.verkoperId === a.id);
    const nuP = pct(verkocht.length, helder.length);
    const oudP = pct(vorigVerkocht.length, vorigHelder.length);
    const basis = sampleBasis(helder.length, opts.settings.convIndicatie, opts.settings.convStevig);
    const basisOud = sampleBasis(vorigHelder.length, opts.settings.convIndicatie, opts.settings.convStevig);

    if (
      basis !== "geen" &&
      basisOud !== "geen" &&
      nuP != null &&
      oudP != null &&
      oudP - nuP >= opts.settings.conversieTrendPp
    ) {
      commercieel.push({
        key: `onderzoek:conversie:${a.id}`,
        plek: "commercieel",
        soort: "onderzoek",
        adviseurId: a.id,
        adviseur: a.naam,
        titel: "Conversie op toegewezen kansen daalt",
        observatie:
          "Dit vergelijkt getekende orders met toegewezen huisbezoeken. De 40%-norm staat op gelopen kansen, op de conversiekaart.",
        volume: `${verkocht.length} van ${helder.length} toegewezen kansen`,
        periode: opts.periode,
        trend: `${oudP}% → ${nuP}% (${Math.round((nuP - oudP) * 10) / 10} pp)`,
        betrouwbaarheid: basis === "stevig" && basisOud === "stevig" ? "Stevige basis" : "Beperkte basis",
        actie: "Bekijk de dossiers voordat je een coaching afspreekt. Geen conclusie over gesprekskwaliteit.",
        verantwoordelijke: "Admin",
        doorklik: "conversie",
      });
    }

    const orders = teamOrders.filter((o) => o.verkoperId === a.id && o.toerekening === "helder");
    const uitval = rate(orders, (o) => o.geannuleerd);
    const dealBasis = sampleBasis(orders.length, opts.settings.dealIndicatie, opts.settings.dealStevig);
    if (
      dealBasis !== "geen" &&
      uitval.p != null &&
      teamUitval.p != null &&
      uitval.p - teamUitval.p >= opts.settings.uitvalPp
    ) {
      commercieel.push({
        key: `onderzoek:uitval:${a.id}`,
        plek: "commercieel",
        soort: "onderzoek",
        adviseurId: a.id,
        adviseur: a.naam,
        titel: "Meer uitval dan het team",
        observatie: "Ondertekening blijft zichtbaar. Uitval is een latere projectstatus, geen oorzaak.",
        volume: `${uitval.n} van ${uitval.d} getekende orders geannuleerd`,
        periode: `Ondertekening ouder dan ${opts.settings.uitvalVensterDagen} dagen, ${opts.periode}`,
        trend: `Team ${teamUitval.p}% · deze adviseur ${uitval.p}%`,
        betrouwbaarheid: dealBasis === "stevig" ? "Stevige basis" : "Beperkte basis",
        actie: "Onderzoek de geannuleerde dossiers. Leg geen oorzaak vast die niet in de bron staat.",
        verantwoordelijke: "Admin",
        doorklik: "deals",
      });
    }

    const betalend = orders.filter((o) => !o.geenAanbetaling && !o.geannuleerd && o.tijdig != null);
    const tijdig = rate(betalend, (o) => o.tijdig === true);
    const payBasis = sampleBasis(betalend.length, opts.settings.dealIndicatie, opts.settings.dealStevig);
    const achter = orders.filter((o) => o.achterstallig).length;
    if (payBasis !== "geen" && tijdig.p != null && teamTijdig.p != null && teamTijdig.p - tijdig.p >= 15) {
      commercieel.push({
        key: `proces:aanbetaling:${a.id}`,
        plek: "commercieel",
        soort: "verplichting",
        adviseurId: a.id,
        adviseur: a.naam,
        titel: "Weinig tijdige aanbetalingen",
        observatie: "Aanbetaald is niet hetzelfde als netto afgerond. Opvolging van betaling ligt bij backoffice.",
        volume: `${tijdig.n} van ${tijdig.d} beoordeelbare orders tijdig · ${achter} nog achterstallig`,
        periode: opts.periode,
        trend: `Team tijdig ${teamTijdig.p}% · deze adviseur ${tijdig.p}%`,
        betrouwbaarheid: "Beperkt: aanbetaling wordt herkend aan factuuromschrijving en een datum, niet aan een aparte betaalgebeurtenis",
        actie: "Laat backoffice de openstaande aanbetalingen nalopen. Geen salesoordeel over betaalgedrag van de klant.",
        verantwoordelijke: "Backoffice",
        doorklik: "deals",
      });
    }

    const cap = opts.capaciteit.find((c) => c.adviseurId === a.id);
    const convTeam = pct(
      opts.kansenVenster.filter((k) => k.order && k.order.toerekening === "helder").length,
      opts.kansenVenster.filter((k) => !k.order || k.order.toerekening === "helder").length
    );
    const sterk =
      basis === "stevig" && nuP != null && convTeam != null && nuP >= convTeam;
    if (a.planbaar && cap && cap.volgende != null && cap.volgende < opts.settings.beschikbaarMin && sterk) {
      commercieel.push({
        key: `groei:capaciteit:${a.id}`,
        plek: "commercieel",
        soort: "groeikans",
        adviseurId: a.id,
        adviseur: a.naam,
        titel: "Sterke toerekening, weinig opengezette capaciteit",
        observatie:
          "Dit gaat over aangeboden blokken, inclusief al geboekte blokken. Geen advies om vrije blokken te vullen.",
        volume: `${cap.volgende} blokken volgende week · norm ${opts.settings.beschikbaarMin}`,
        periode: "Volgende week",
        trend: cap.daarna == null ? "Week daarna onbekend" : `Week daarna ${cap.daarna} blokken`,
        betrouwbaarheid: "Capaciteit is de actuele agenda. De vergelijking gebruikt toegewezen kansen.",
        actie: "Bespreek of deze adviseur meer beschikbaarheid kan openzetten.",
        verantwoordelijke: "Admin",
        doorklik: "capaciteit",
      });
    }

    if (
      basis === "stevig" &&
      nuP != null &&
      convTeam != null &&
      nuP - convTeam >= opts.settings.conversieTrendPp
    ) {
      commercieel.push({
        key: `onderzoek:positief:${a.id}`,
        plek: "commercieel",
        soort: "onderzoek",
        adviseurId: a.id,
        adviseur: a.naam,
        titel: "Hogere conversie op toegewezen kansen dan het team",
        observatie: "Geen bewijs dat de aanpak beter is. Wel een aanleiding om dossiers te vergelijken.",
        volume: `${verkocht.length} van ${helder.length}`,
        periode: opts.periode,
        trend: `Team ${convTeam}% · deze adviseur ${nuP}%`,
        betrouwbaarheid: "Stevige basis op toegewezen kansen.",
        actie: "Kijk welke omstandigheden meespelen voordat je de aanpak deelt.",
        verantwoordelijke: "Admin",
        doorklik: "conversie",
      });
    }
  }

  const onder = opts.capaciteit.filter(
    (c) => c.volgende != null && c.volgende < opts.settings.beschikbaarMin
  );
  if (onder.length) {
    operationeel.push({
      key: "verplichting:beschikbaarheid:team",
      plek: "operationeel",
      soort: "verplichting",
      adviseurId: null,
      adviseur: "Team",
      titel: "Beschikbaarheid onder 15 blokken",
      observatie: `${onder.length} planbare adviseurs zetten volgende week minder dan ${opts.settings.beschikbaarMin} blokken open.`,
      volume: onder
        .slice(0, 6)
        .map((c) => `${naam.get(c.adviseurId) || "Adviseur"} ${c.volgende}`)
        .join(" · "),
      periode: "Volgende week",
      trend: "Actuele blokkades, geen historische reconstructie",
      betrouwbaarheid: "Betrouwbaar voor de huidige agenda",
      actie: "Bespreken in de weekmeeting. Geen planningsactie.",
      verantwoordelijke: "Admin",
      doorklik: "capaciteit",
    });
  }

  const achterstallig = teamOrders.filter((o) => o.achterstallig).length;
  if (achterstallig > 0) {
    operationeel.push({
      key: "verplichting:aanbetaling:open",
      plek: "operationeel",
      soort: "verplichting",
      adviseurId: null,
      adviseur: "Backoffice",
      titel: "Achterstallige aanbetaling",
      observatie: `${achterstallig} getekende orders zijn ouder dan ${opts.settings.aanbetalingDagen} dagen zonder volledige herkende aanbetaling.`,
      volume: `${achterstallig} open`,
      periode: "Vanaf dag 8 na ondertekening",
      trend: "Blijft naast het betaalgemiddelde zichtbaar",
      betrouwbaarheid: "Beperkt waar de factuuromschrijving de aanbetaling niet benoemt",
      actie: "Backoffice volgt betalingen. Dit is geen salesblokkade.",
      verantwoordelijke: "Backoffice",
      doorklik: "deals",
    });
  }

  const afboek = opts.afboek;
  if (afboek?.meetbaar && ((afboek.teLaat || 0) > 0 || afboek.herhaling.length > 0)) {
    operationeel.push({
      key: "verplichting:afboeken",
      plek: "operationeel",
      soort: "verplichting",
      adviseurId: null,
      adviseur: "Team",
      titel: "Afboekingen na middernacht",
      observatie: "Het tijdstip komt uit de tijdlijnregel Via afboek. Een automatische voltooiing telt niet.",
      volume: `${afboek.teLaat} te laat van ${afboek.beoordeeld} met een tijdstip · ${afboek.percentage ?? "—"}% op tijd`,
      periode: "Kalenderdag van het bezoek, tot 00:00 Amsterdam",
      trend: afboek.herhaling.length ? afboek.herhaling.slice(0, 4).join(" · ") : "Geen herhaling van te late dagen",
      betrouwbaarheid: `${afboek.zonderTijd} afspraken hebben geen tijdlijnregel en zitten niet in dit percentage`,
      actie: "Bespreek de te late dagen. Vandaag nog open is geen overtreding.",
      verantwoordelijke: "Admin",
      doorklik: "afboeken",
    });
  }

  commercieel.sort((a, b) => a.titel.localeCompare(b.titel, "nl"));
  return { commercieel: commercieel.slice(0, 5), operationeel };
}
