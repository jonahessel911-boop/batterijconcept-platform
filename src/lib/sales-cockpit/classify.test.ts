import assert from "node:assert/strict";
import { totalsFor } from "./aggregate";
import { classifyLead, type RawAppt, type RawLead } from "./classify";
import { daysInclusive, presetRange, shiftRange, ymdEndIso, ymdInRange, ymdStartIso } from "./range";

const TODAY = "2026-10-30";
const RANGE = { from: "2026-10-01", to: "2026-10-31" };

function lead(status: string, id = "l1"): RawLead {
  return { id, leadNumber: "L-1", naam: "Test", status, bron: "meta" };
}

function appt(partial: Partial<RawAppt> & Pick<RawAppt, "startAt" | "soort">): RawAppt {
  return {
    id: partial.id ?? "a1",
    leadId: "l1",
    adviseurId: partial.adviseurId ?? "adv-bezoek",
    plannerId: partial.plannerId ?? "planner-1",
    startAt: partial.startAt,
    status: partial.status ?? "voltooid",
    soort: partial.soort,
  };
}

function run() {
  const follow = classifyLead({
    todayYmd: TODAY,
    lead: lead("vervolg_tel"),
    appointments: [
      appt({ id: "n", startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw" }),
      appt({ id: "t", startAt: "2026-10-10T08:00:00.000Z", soort: "vervolg_tel", status: "gepland" }),
      appt({ id: "f", startAt: "2026-10-12T08:00:00.000Z", soort: "vervolg_fysiek", status: "gepland" }),
    ],
    offers: [],
    projects: [],
    invoices: [],
  });
  assert.equal(follow.gelopen, true);
  assert.equal(follow.stand, "open_vervolg");
  assert.equal(follow.conversationYmd, "2026-10-06");
  assert.equal(follow.adviseurId, "adv-bezoek");

  const later = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal"),
    appointments: [
      appt({ id: "n", startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw", adviseurId: "adv-bezoek" }),
    ],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-20T10:00:00.000Z",
        ex: 8000,
        btw: 1680,
        inc: 9680,
        modus: "helft",
        bedragInc: null,
        teInnen: 4840,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(later.stand, "sale");
  assert.equal(later.conversationYmd, "2026-10-06");
  assert.equal(later.signedYmd, "2026-10-20");

  const door = classifyLead({
    todayYmd: TODAY,
    lead: lead("deur_niet_open"),
    appointments: [appt({ startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw", status: "voltooid" })],
    offers: [],
    projects: [],
    invoices: [],
  });
  assert.equal(door.gelopen, false);
  assert.equal(door.bezoek, "deur_dicht");
  assert.equal(door.stand, "afgeboekt");

  const elapsed = classifyLead({
    todayYmd: TODAY,
    lead: lead("afspraak"),
    appointments: [appt({ startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw", status: "voltooid" })],
    offers: [],
    projects: [],
    invoices: [],
  });
  assert.equal(elapsed.gelopen, true);
  assert.equal(elapsed.gelopenBenadering, true);
  assert.equal(elapsed.conversationYmd, "2026-10-06");
  assert.equal(elapsed.bezoek, "gesprek");
  assert.equal(elapsed.stand, "open");

  const versions = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal"),
    appointments: [appt({ startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw" })],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-08T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
      {
        id: "o2",
        leadId: "l1",
        ondertekendOp: "2026-10-15T10:00:00.000Z",
        ex: 1500,
        btw: 315,
        inc: 1815,
        modus: "helft",
        bedragInc: null,
        teInnen: 900,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(versions.stand, "sale");
  assert.equal(versions.extraOrders, 1);
  assert.equal(versions.signedEx, 1000);

  const zero = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal"),
    appointments: [appt({ startAt: "2026-10-02T08:00:00.000Z", soort: "nieuw" })],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-02T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "handmatig",
        bedragInc: 0,
        teInnen: 0,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(zero.depositNone, true);
  assert.equal(zero.openOver7, false);
  assert.equal(zero.timelyKnown, null);

  const partial = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal"),
    appointments: [appt({ startAt: "2026-10-01T08:00:00.000Z", soort: "nieuw" })],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-01T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [
      {
        leadId: "l1",
        offerteId: "o1",
        status: "deels_betaald",
        inc: 100,
        betaaldOp: "2026-10-03",
        creditOf: null,
        bunq: true,
      },
    ],
  });
  assert.equal(partial.depositMet, false);
  assert.equal(partial.openOver7, true);

  const paid = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal"),
    appointments: [appt({ startAt: "2026-10-01T08:00:00.000Z", soort: "nieuw", adviseurId: "verkoper" })],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-01T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
    ],
    projects: [
      {
        leadId: "l1",
        offerteId: "o1",
        status: "annulering",
        installatieVoltooidAt: null,
        projectkosten: 0,
        betaalwijze: "eigen_middelen",
      },
    ],
    invoices: [
      {
        leadId: "l1",
        offerteId: "o1",
        status: "betaald",
        inc: 605,
        betaaldOp: "2026-10-04",
        creditOf: null,
        bunq: true,
      },
    ],
  });
  assert.equal(paid.stand, "sale");
  assert.equal(paid.cancelled, true);
  assert.equal(paid.depositMet, true);
  assert.equal(paid.payDays, 3);
  assert.equal(paid.timelyKnown, true);
  assert.equal(paid.adviseurId, "verkoper");

  const otherOwner = classifyLead({
    todayYmd: TODAY,
    lead: { ...lead("deal"), adviseurId: "huidige-eigenaar" },
    appointments: [appt({ startAt: "2026-10-06T08:00:00.000Z", soort: "nieuw", adviseurId: "bezoeker" })],
    offers: [
      {
        id: "o1",
        leadId: "l1",
        ondertekendOp: "2026-10-06T15:00:00.000Z",
        ex: 100,
        btw: 21,
        inc: 121,
        modus: "handmatig",
        bedragInc: 0,
        teInnen: 0,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(otherOwner.adviseurId, "bezoeker");
  assert.equal(otherOwner.attribution, "afspraak");

  // Referral: adviseur maakt zelf lead + offerte, zonder huisbezoekafspraak.
  const referral = classifyLead({
    todayYmd: TODAY,
    lead: { ...lead("deal", "l-ref"), adviseurId: "adv-referral" },
    appointments: [],
    offers: [
      {
        id: "o-ref",
        leadId: "l-ref",
        ondertekendOp: "2026-10-28T14:00:00.000Z",
        ex: 5000,
        btw: 1050,
        inc: 6050,
        modus: "helft",
        bedragInc: null,
        teInnen: 3025,
        financiering: false,
        aangemaaktDoorId: "adv-referral",
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(referral.stand, "sale");
  assert.equal(referral.adviseurId, "adv-referral");
  assert.equal(referral.attribution, "offerte");
  assert.equal(referral.signedYmd, "2026-10-28");

  const referralLeadOnly = classifyLead({
    todayYmd: TODAY,
    lead: { ...lead("deal", "l-ref2"), adviseurId: "adv-referral-2" },
    appointments: [],
    offers: [
      {
        id: "o-ref2",
        leadId: "l-ref2",
        ondertekendOp: "2026-10-29T11:00:00.000Z",
        ex: 3000,
        btw: 630,
        inc: 3630,
        modus: "helft",
        bedragInc: null,
        teInnen: 1815,
        financiering: false,
      },
    ],
    projects: [],
    invoices: [],
  });
  assert.equal(referralLeadOnly.adviseurId, "adv-referral-2");
  assert.equal(referralLeadOnly.attribution, "lead");

  // Op tijd: na BO-bel + verstuurde aanbetalingsfactuur → 3 dagen.
  const timelyDeposit = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal", "l-tijdig"),
    appointments: [
      appt({
        startAt: "2026-10-01T08:00:00.000Z",
        soort: "nieuw",
        adviseurId: "verkoper",
      }),
    ],
    offers: [
      {
        id: "o-tijdig",
        leadId: "l-tijdig",
        ondertekendOp: "2026-10-01T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
    ],
    projects: [
      {
        leadId: "l-tijdig",
        offerteId: "o-tijdig",
        status: "opstarten",
        installatieVoltooidAt: null,
        projectkosten: 0,
        betaalwijze: "eigen_middelen",
        belSchouwAanbetalingAt: "2026-10-20T14:00:00.000Z",
      },
    ],
    invoices: [
      {
        leadId: "l-tijdig",
        offerteId: "o-tijdig",
        status: "betaald",
        inc: 605,
        betaaldOp: "2026-10-22",
        creditOf: null,
        bunq: true,
        omschrijving: "Aanbetaling batterij",
        factuurdatum: "2026-10-20",
        vervaldatum: "2026-10-23",
      },
    ],
  });
  assert.equal(timelyDeposit.depositMet, true);
  assert.equal(timelyDeposit.depositClockStartYmd, "2026-10-20");
  assert.equal(timelyDeposit.depositPayDeadlineYmd, "2026-10-23");
  assert.equal(timelyDeposit.timelyDepositKnown, true);

  // Zonder bel-timestamp: klok start op factuurdatum (live DB mist de kolom soms).
  const invoiceOnlyClock = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal", "l-factuur"),
    appointments: [
      appt({
        startAt: "2026-10-01T08:00:00.000Z",
        soort: "nieuw",
        adviseurId: "verkoper",
      }),
    ],
    offers: [
      {
        id: "o-factuur",
        leadId: "l-factuur",
        ondertekendOp: "2026-10-01T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
    ],
    projects: [
      {
        leadId: "l-factuur",
        offerteId: "o-factuur",
        status: "opstarten",
        installatieVoltooidAt: null,
        projectkosten: 0,
        betaalwijze: "eigen_middelen",
      },
    ],
    invoices: [
      {
        leadId: "l-factuur",
        offerteId: "o-factuur",
        status: "betaald",
        inc: 605,
        betaaldOp: "2026-10-22",
        creditOf: null,
        bunq: true,
        omschrijving: "Aanbetaling",
        factuurdatum: "2026-10-20",
        vervaldatum: "2026-10-23",
      },
    ],
  });
  assert.equal(invoiceOnlyClock.depositClockStartYmd, "2026-10-20");
  assert.equal(invoiceOnlyClock.timelyDepositKnown, true);

  const lateDeposit = classifyLead({
    todayYmd: TODAY,
    lead: lead("deal", "l-laat"),
    appointments: [
      appt({
        startAt: "2026-10-01T08:00:00.000Z",
        soort: "nieuw",
        adviseurId: "verkoper",
      }),
    ],
    offers: [
      {
        id: "o-laat",
        leadId: "l-laat",
        ondertekendOp: "2026-10-01T10:00:00.000Z",
        ex: 1000,
        btw: 210,
        inc: 1210,
        modus: "helft",
        bedragInc: null,
        teInnen: 605,
        financiering: false,
      },
    ],
    projects: [
      {
        leadId: "l-laat",
        offerteId: "o-laat",
        status: "opstarten",
        installatieVoltooidAt: null,
        projectkosten: 0,
        betaalwijze: "eigen_middelen",
        belSchouwAanbetalingAt: "2026-10-10T09:00:00.000Z",
      },
    ],
    invoices: [
      {
        leadId: "l-laat",
        offerteId: "o-laat",
        status: "betaald",
        inc: 605,
        betaaldOp: "2026-10-20",
        creditOf: null,
        bunq: true,
        omschrijving: "Aanbetaling",
        factuurdatum: "2026-10-10",
        vervaldatum: "2026-10-13",
      },
    ],
  });
  assert.equal(lateDeposit.depositClockStartYmd, "2026-10-10");
  assert.equal(lateDeposit.depositPayDeadlineYmd, "2026-10-13");
  assert.equal(lateDeposit.timelyDepositKnown, false);

  const rows = [follow, later, door, elapsed].map((d, i) => ({ ...d, leadId: `l${i}` }));
  const totals = totalsFor(rows, RANGE);
  assert.equal(totals.gelopen, 3);
  assert.equal(totals.soldCohort, 1);
  assert.equal(totals.conversion.num, 1);
  assert.equal(totals.conversion.den, 3);
  assert.equal(totals.openVervolg, 1);

  const week = presetRange("deze_week", new Date("2026-10-30T12:00:00.000Z"));
  assert.equal(week.from <= "2026-10-30" && week.to >= "2026-10-30", true);
  assert.equal(daysInclusive(week.from, week.to), 7);
  const prev = shiftRange(week, -1);
  assert.equal(daysInclusive(prev.from, prev.to), 7);
  assert.equal(prev.to < week.from, true);

  const start = ymdStartIso("2026-10-25");
  const end = ymdEndIso("2026-10-25");
  assert.equal(ymdInRange("2026-10-25", { from: "2026-10-25", to: "2026-10-25" }), true);
  assert.ok(new Date(end).getTime() > new Date(start).getTime());
  const evening = new Date("2026-10-25T21:30:00.000Z");
  assert.ok(evening.getTime() >= new Date(start).getTime());
  assert.ok(evening.getTime() <= new Date(end).getTime());

  console.log("sales-cockpit classify tests ok");
}

run();
