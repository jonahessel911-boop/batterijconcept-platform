import assert from "node:assert/strict";
import {
  buildDayOverview,
  buildSalesQuality,
  buildWeekLeaderboard,
  buildWeekOverview,
  huisbezoekenInRange,
  vervolgAfsprakenInRange,
} from "./cockpit-metrics";
import type { Dossier, RawAppt } from "./classify";

const WEEK = { from: "2026-10-27", to: "2026-11-02", key: "2026-W44" };
const TODAY = "2026-10-30";

function appt(partial: Partial<RawAppt> & Pick<RawAppt, "id" | "leadId" | "startAt">): RawAppt {
  return {
    id: partial.id,
    leadId: partial.leadId,
    adviseurId: partial.adviseurId ?? "adv-1",
    plannerId: partial.plannerId ?? "pl-1",
    startAt: partial.startAt,
    endAt: partial.endAt ?? null,
    status: partial.status ?? "gepland",
    soort: partial.soort ?? "nieuw",
  };
}

function dossier(partial: Partial<Dossier> & Pick<Dossier, "leadId">): Dossier {
  return {
    leadId: partial.leadId,
    leadNumber: partial.leadNumber ?? `L-${partial.leadId}`,
    naam: partial.naam ?? partial.leadId,
    bron: partial.bron ?? null,
    status: partial.status ?? "nieuw",
    adviseurId: partial.adviseurId ?? "adv-1",
    attribution: partial.attribution ?? "afspraak",
    plannerId: partial.plannerId ?? "pl-1",
    financiering: partial.financiering ?? "onbekend",
    assignmentYmd: partial.assignmentYmd ?? null,
    conversationYmd: partial.conversationYmd ?? null,
    gelopen: partial.gelopen ?? false,
    gelopenBenadering: partial.gelopenBenadering ?? false,
    stand: partial.stand ?? "open",
    bezoek: partial.bezoek ?? "onbekend",
    vervolgYmd: partial.vervolgYmd ?? null,
    signedYmd: partial.signedYmd ?? null,
    signedEx: partial.signedEx ?? 0,
    signedInc: partial.signedInc ?? 0,
    offerId: partial.offerId ?? null,
    extraOrders: partial.extraOrders ?? 0,
    extraEx: partial.extraEx ?? 0,
    depositRequiredInc: partial.depositRequiredInc ?? 0,
    depositNone: partial.depositNone ?? true,
    depositMet: partial.depositMet ?? false,
    depositYmd: partial.depositYmd ?? null,
    depositDateQuality: partial.depositDateQuality ?? null,
    payDays: partial.payDays ?? null,
    timelyKnown: partial.timelyKnown ?? null,
    depositClockStartYmd: partial.depositClockStartYmd ?? null,
    depositPayDeadlineYmd: partial.depositPayDeadlineYmd ?? null,
    timelyDepositKnown: partial.timelyDepositKnown ?? null,
    inTerm: partial.inTerm ?? false,
    openOver7: partial.openOver7 ?? false,
    cancelled: partial.cancelled ?? false,
    conflict: partial.conflict ?? false,
    netto: partial.netto ?? false,
    nettoYmd: partial.nettoYmd ?? null,
    projectkosten: partial.projectkosten ?? 0,
    commissiePct: partial.commissiePct ?? 0,
    marginEx: partial.marginEx ?? 0,
  };
}

function run() {
  const visits = huisbezoekenInRange(
    [
      appt({
        id: "a1",
        leadId: "l1",
        startAt: "2026-10-28T08:00:00.000Z",
        status: "geannuleerd",
      }),
      appt({
        id: "a2",
        leadId: "l1",
        startAt: "2026-10-29T08:00:00.000Z",
        status: "gepland",
      }),
      appt({
        id: "a3",
        leadId: "l2",
        startAt: "2026-10-28T10:00:00.000Z",
        soort: "vervolg_fysiek",
      }),
      appt({
        id: "a4",
        leadId: "l3",
        startAt: "2026-10-27T09:00:00.000Z",
        status: "voltooid",
      }),
    ],
    WEEK
  );
  assert.equal(visits.length, 2);
  assert.equal(visits.find((v) => v.leadId === "l1")?.id, "a2");
  assert.equal(visits.find((v) => v.leadId === "l3")?.id, "a4");

  const sold = dossier({
    leadId: "l3",
    status: "sale_eigen_middelen",
    gelopen: true,
    stand: "sale",
    bezoek: "gesprek",
    signedYmd: "2026-10-29",
    signedEx: 5000,
    signedInc: 6050,
    offerId: "o1",
    marginEx: 5000,
    financiering: "eigen_middelen",
    assignmentYmd: "2026-10-27",
    conversationYmd: "2026-10-27",
  });

  const followSold = dossier({
    leadId: "lv1",
    status: "sale_eigen_middelen",
    gelopen: true,
    stand: "sale",
    bezoek: "gesprek",
    signedYmd: "2026-10-30",
    signedEx: 2000,
    signedInc: 2420,
    offerId: "o2",
    marginEx: 2000,
  });

  const weekAppts = [
    appt({ id: "a1", leadId: "l1", startAt: "2026-10-29T08:00:00.000Z", status: "gepland" }),
    appt({ id: "a1b", leadId: "l1", startAt: "2026-10-28T08:00:00.000Z", status: "verzet" }),
    appt({ id: "a3", leadId: "l3", startAt: "2026-10-27T09:00:00.000Z", status: "voltooid" }),
    appt({
      id: "a4",
      leadId: "l4",
      startAt: "2026-10-27T11:00:00.000Z",
      status: "geannuleerd",
    }),
    // Vervolg uit eerdere week: gelopen + sale
    appt({
      id: "vn1",
      leadId: "lv1",
      startAt: "2026-10-20T09:00:00.000Z",
      status: "voltooid",
    }),
    appt({
      id: "vf1",
      leadId: "lv1",
      startAt: "2026-10-28T13:00:00.000Z",
      soort: "vervolg_fysiek",
      status: "voltooid",
    }),
    // Vervolg uit eerdere week: nog te lopen
    appt({
      id: "vn2",
      leadId: "lv2",
      startAt: "2026-10-15T09:00:00.000Z",
      status: "voltooid",
    }),
    appt({
      id: "vf2",
      leadId: "lv2",
      startAt: "2026-10-31T13:00:00.000Z",
      soort: "vervolg_fysiek",
      status: "gepland",
    }),
    // Vervolg zonder eerdere nieuw → telt niet
    appt({
      id: "vf3",
      leadId: "lv3",
      startAt: "2026-10-29T15:00:00.000Z",
      soort: "vervolg_tel",
      status: "gepland",
    }),
  ];

  const appointmentsByLead = new Map<string, RawAppt[]>();
  for (const a of weekAppts) {
    const list = appointmentsByLead.get(a.leadId);
    if (list) list.push(a);
    else appointmentsByLead.set(a.leadId, [a]);
  }

  const followOnly = vervolgAfsprakenInRange(weekAppts, appointmentsByLead, WEEK);
  assert.equal(followOnly.length, 2);
  assert.equal(followOnly.find((v) => v.leadId === "lv1")?.id, "vf1");
  assert.equal(followOnly.find((v) => v.leadId === "lv2")?.id, "vf2");

  const week = buildWeekOverview({
    dossiers: [sold, followSold],
    appointments: weekAppts,
    leadStatusById: new Map([
      ["l1", "nieuw"],
      ["l3", "sale_eigen_middelen"],
      ["l4", "afspraak_afgezegd_klant"],
      ["lv1", "sale_eigen_middelen"],
      ["lv2", "vervolg_fysiek"],
      ["lv3", "vervolg_tel"],
    ]),
    appointmentsByLead,
    week: WEEK,
    todayYmd: TODAY,
    label: "27 okt – 2 nov",
    isCurrent: true,
  });

  assert.equal(week.ingepland, 3);
  assert.equal(week.nogTeLopen, 0);
  assert.equal(week.gelopen, 2); // l1 niet afgeboekt + l3 sale
  assert.equal(week.nietGelopen, 1); // l4 geannuleerd
  assert.equal(week.salesFromGelopen, 1); // l3
  assert.equal(week.conversionNieuwGelopenSalePct, 50); // 1 van 2 gelopen
  assert.equal(week.deals, 2);
  assert.equal(week.orderwaardeEx, 7000);
  assert.equal(week.orderwaardeInc, 8470);
  assert.equal(week.aanbetalingenInc, 0);
  assert.equal(week.advisorsWithAppointments, 1);
  // l1 + l3 + lv1 + lv2 fysiek = 4; l4 geannuleerd telt niet; vf2 open; rest gelopen
  assert.equal(week.physicalGelopen, 3);
  assert.equal(week.physicalOpen, 1);
  assert.equal(week.physicalBooked, 4);
  assert.equal(week.avgPhysicalBookedPerAdvisor, 4);
  assert.equal(week.avgAvailableBlocksPerAdvisor, null);
  assert.equal(week.capacityFillPct, null);
  assert.equal(week.planbaarAdvisors, 0);

  assert.equal(week.vervolgIngepland, 2);
  assert.equal(week.vervolgGelopen, 1);
  assert.equal(week.vervolgNogTeLopen, 1);
  assert.equal(week.vervolgNietGelopen, 0);
  assert.equal(week.vervolgSalesFromGelopen, 1); // lv1
  assert.equal(week.conversionVervolgGelopenSalePct, 100); // 1 van 1 gelopen

  const board = buildWeekLeaderboard({
    advisors: [
      { id: "adv-1", naam: "Ada", actief: true },
      { id: "adv-2", naam: "Ben", actief: true },
      { id: "adv-x", naam: "Inactief", actief: false },
    ],
    dossiers: [sold, followSold],
    appointments: weekAppts,
    leadStatusById: new Map([
      ["l1", "nieuw"],
      ["l3", "sale_eigen_middelen"],
      ["l4", "afspraak_afgezegd_klant"],
      ["lv1", "sale_eigen_middelen"],
      ["lv2", "vervolg_fysiek"],
      ["lv3", "vervolg_tel"],
    ]),
    appointmentsByLead,
    week: WEEK,
    todayYmd: TODAY,
  });
  assert.equal(board.length, 2);
  assert.equal(board[0]!.id, "adv-1");
  assert.equal(board[0]!.deals, 2);
  assert.equal(board[0]!.nieuwGelopen, 2);
  assert.equal(board[0]!.vervolgGelopen, 1);
  assert.equal(board[1]!.id, "adv-2");
  assert.equal(board[1]!.deals, 0);

  const dayAppts = [
    appt({
      id: "d1",
      leadId: "ld1",
      adviseurId: "adv-1",
      startAt: "2026-10-30T07:00:00.000Z",
      endAt: "2026-10-30T09:00:00.000Z",
      soort: "nieuw",
    }),
    appt({
      id: "d2",
      leadId: "ld2",
      adviseurId: "adv-1",
      startAt: "2026-10-30T12:00:00.000Z",
      endAt: "2026-10-30T14:00:00.000Z",
      soort: "vervolg_tel",
    }),
    appt({
      id: "d3",
      leadId: "ld3",
      adviseurId: "adv-2",
      startAt: "2026-10-30T10:00:00.000Z",
      endAt: "2026-10-30T12:00:00.000Z",
      soort: "vervolg_fysiek",
    }),
  ];
  const day = buildDayOverview({
    advisors: [
      { id: "adv-1", naam: "Ada", actief: true },
      { id: "adv-2", naam: "Ben", actief: true },
    ],
    dossiers: [
      dossier({
        leadId: "ld1",
        adviseurId: "adv-1",
        signedYmd: "2026-10-30",
        signedEx: 4000,
        signedInc: 4840,
        extraOrders: 1,
        extraEx: 1500,
      }),
    ],
    appointments: dayAppts,
    offers: [
      {
        id: "o1",
        leadId: "ld1",
        ondertekendOp: "2026-10-30T09:00:00.000Z",
        ex: 4000,
        btw: 840,
        inc: 4840,
        modus: null,
        bedragInc: null,
        teInnen: null,
        financiering: null,
      },
      {
        id: "o2",
        leadId: "ld1",
        ondertekendOp: "2026-10-30T15:00:00.000Z",
        ex: 1500,
        btw: 315,
        inc: 1815,
        modus: null,
        bedragInc: null,
        teInnen: null,
        financiering: null,
      },
    ],
    leadMetaById: new Map([
      ["ld1", { leadNumber: "1001", naam: "Klant 1" }],
      ["ld2", { leadNumber: "1002", naam: "Klant 2" }],
      ["ld3", { leadNumber: "1003", naam: "Klant 3" }],
    ]),
    offerFlagsByLead: new Map([
      ["ld1", { created: true, sent: true, signed: true }],
    ]),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T08:00:00.000Z",
  });
  assert.equal(day.nieuw, 1);
  assert.equal(day.vervolgTel, 1);
  assert.equal(day.vervolgFysiek, 1);
  assert.equal(day.deals, 2);
  assert.equal(day.orderwaardeEx, 5500);
  assert.equal(day.advisors.length, 2);
  // ld1 is al getekend tijdens het tijdblok → niet meer “in afspraak”.
  assert.equal(day.advisors[0]!.liveStatus, "vrij");
  assert.equal(day.advisors[0]!.current, null);
  assert.equal(day.advisors[0]!.justFinished?.leadId, "ld1");
  assert.equal(day.advisors[0]!.next?.leadId, "ld2");
  assert.equal(day.advisors[0]!.deals, 2);
  assert.equal(day.advisors[1]!.liveStatus, "volgende");
  assert.equal(day.advisors[1]!.deals, 0);
  assert.equal(day.offerSignals.length, 3);
  assert.equal(
    day.offerSignals.find((s) => s.leadId === "ld1")?.signed,
    true
  );

  const stillLive = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "live1",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "live-a",
        leadId: "live1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T09:00:00.000Z",
        soort: "nieuw",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["live1", { leadNumber: "2001", naam: "Open lead" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T08:00:00.000Z",
  });
  assert.equal(stillLive.advisors[0]!.liveStatus, "in_afspraak");
  assert.equal(stillLive.advisors[0]!.current?.leadId, "live1");

  // Telefonisch: na eindtijd niet meer “in afspraak”, ook zonder afboek.
  const telEnded = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "tel1",
        adviseurId: "adv-1",
        status: "vervolg_tel",
        stand: "open",
      }),
      dossier({
        leadId: "tel2",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "tel-a",
        leadId: "tel1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T08:00:00.000Z",
        soort: "vervolg_tel",
      }),
      appt({
        id: "tel-b",
        leadId: "tel2",
        adviseurId: "adv-1",
        startAt: "2026-10-30T12:00:00.000Z",
        endAt: "2026-10-30T13:00:00.000Z",
        soort: "nieuw",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["tel1", { leadNumber: "4001", naam: "Tel klaar" }],
      ["tel2", { leadNumber: "4002", naam: "Later fysiek" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T08:15:00.000Z",
  });
  // justFinished + next → “vrij” (niet meer in telefonische afspraak).
  assert.equal(telEnded.advisors[0]!.liveStatus, "vrij");
  assert.equal(telEnded.advisors[0]!.current, null);
  assert.equal(telEnded.advisors[0]!.justFinished?.leadId, "tel1");
  assert.equal(telEnded.advisors[0]!.next?.leadId, "tel2");

  // Telefonisch tijdens het blok: wel in afspraak.
  const telLive = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "tel1",
        adviseurId: "adv-1",
        status: "vervolg_tel",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "tel-live",
        leadId: "tel1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T09:00:00.000Z",
        soort: "vervolg_tel",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["tel1", { leadNumber: "4001", naam: "Tel bezig" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T08:00:00.000Z",
  });
  assert.equal(telLive.advisors[0]!.liveStatus, "in_afspraak");
  assert.equal(telLive.advisors[0]!.current?.leadId, "tel1");

  // Na gepland eind → niet meer in afspraak; wel volgende in zicht.
  const overdueOpen = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "ov1",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
      dossier({
        leadId: "ov2",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "ov-a",
        leadId: "ov1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T08:30:00.000Z",
        soort: "nieuw",
      }),
      appt({
        id: "ov-b",
        leadId: "ov2",
        adviseurId: "adv-1",
        startAt: "2026-10-30T12:00:00.000Z",
        endAt: "2026-10-30T13:30:00.000Z",
        soort: "nieuw",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["ov1", { leadNumber: "3001", naam: "Nog bezig" }],
      ["ov2", { leadNumber: "3002", naam: "Later" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    // 2,5 uur na gepland eind van ov-a, ov-b is nog niet begonnen
    nowIso: "2026-10-30T11:00:00.000Z",
  });
  assert.equal(overdueOpen.advisors[0]!.liveStatus, "vrij");
  assert.equal(overdueOpen.advisors[0]!.current, null);
  assert.equal(overdueOpen.advisors[0]!.justFinished?.leadId, "ov1");
  assert.equal(overdueOpen.advisors[0]!.next?.leadId, "ov2");

  // Pas als het volgende blok start, springen naar die afspraak.
  const nextBlockStarted = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "ov1",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
      dossier({
        leadId: "ov2",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "ov-a",
        leadId: "ov1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T08:30:00.000Z",
        soort: "nieuw",
      }),
      appt({
        id: "ov-b",
        leadId: "ov2",
        adviseurId: "adv-1",
        startAt: "2026-10-30T12:00:00.000Z",
        endAt: "2026-10-30T13:30:00.000Z",
        soort: "nieuw",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["ov1", { leadNumber: "3001", naam: "Nog bezig" }],
      ["ov2", { leadNumber: "3002", naam: "Later" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T12:15:00.000Z",
  });
  assert.equal(nextBlockStarted.advisors[0]!.liveStatus, "in_afspraak");
  assert.equal(nextBlockStarted.advisors[0]!.current?.leadId, "ov2");
  assert.equal(nextBlockStarted.advisors[0]!.previous?.leadId, "ov1");

  // Later tel-blok is geweest → eerdere fysieke open afspraak niet terug “in afspraak”.
  const afterLaterTelBlock = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "fy1",
        adviseurId: "adv-1",
        status: "nieuw",
        stand: "open",
      }),
      dossier({
        leadId: "te1",
        adviseurId: "adv-1",
        status: "vervolg_tel",
        stand: "open",
      }),
    ],
    appointments: [
      appt({
        id: "fy-a",
        leadId: "fy1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T08:00:00.000Z",
        soort: "nieuw",
      }),
      appt({
        id: "te-a",
        leadId: "te1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T09:00:00.000Z",
        endAt: "2026-10-30T09:30:00.000Z",
        soort: "vervolg_tel",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["fy1", { leadNumber: "5001", naam: "Fysiek oud" }],
      ["te1", { leadNumber: "5002", naam: "Tel geweest" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T10:00:00.000Z",
  });
  assert.equal(afterLaterTelBlock.advisors[0]!.liveStatus, "klaar");
  assert.equal(afterLaterTelBlock.advisors[0]!.current, null);
  assert.equal(afterLaterTelBlock.advisors[0]!.justFinished?.leadId, "te1");

  const afterAfboek = buildDayOverview({
    advisors: [{ id: "adv-1", naam: "Ada", actief: true }],
    dossiers: [
      dossier({
        leadId: "af1",
        adviseurId: "adv-1",
        status: "geen_interesse",
        stand: "afgeboekt",
      }),
    ],
    appointments: [
      appt({
        id: "af-a",
        leadId: "af1",
        adviseurId: "adv-1",
        startAt: "2026-10-30T07:00:00.000Z",
        endAt: "2026-10-30T09:00:00.000Z",
        soort: "nieuw",
      }),
    ],
    offers: [],
    leadMetaById: new Map([
      ["af1", { leadNumber: "2002", naam: "Afgeboekt" }],
    ]),
    offerFlagsByLead: new Map(),
    dayYmd: "2026-10-30",
    todayYmd: "2026-10-30",
    nowIso: "2026-10-30T08:00:00.000Z",
  });
  assert.equal(afterAfboek.advisors[0]!.liveStatus, "klaar");
  assert.equal(afterAfboek.advisors[0]!.current, null);
  assert.ok(
    (afterAfboek.advisors[0]!.justFinished?.settledLabel || "").includes(
      "Geen interesse"
    )
  );
  assert.equal(afterAfboek.advisors[0]!.previous?.leadId, "af1");

  const quality = buildSalesQuality({
    advisors: [
      { id: "adv-1", naam: "Ada", actief: true },
      { id: "adv-2", naam: "Ben", actief: true },
    ],
    dossiers: [
      dossier({
        leadId: "q1",
        adviseurId: "adv-1",
        signedYmd: "2026-10-28",
        depositNone: false,
        depositMet: true,
        depositYmd: "2026-10-30",
        timelyDepositKnown: true,
        stand: "sale",
      }),
      dossier({
        leadId: "q2",
        adviseurId: "adv-1",
        signedYmd: "2026-10-29",
        depositNone: false,
        depositMet: true,
        depositYmd: "2026-11-05",
        timelyDepositKnown: false,
        stand: "sale",
      }),
      dossier({
        leadId: "q3",
        adviseurId: "adv-2",
        signedYmd: "2026-10-30",
        depositNone: false,
        depositMet: false,
        timelyDepositKnown: null,
        stand: "sale",
      }),
    ],
    projects: [],
    range: WEEK,
  });
  assert.equal(quality.deals, 3);
  assert.equal(quality.tijdig, 1);
  assert.equal(quality.tijdigBeoordeeld, 2);
  assert.equal(quality.tijdigPct, 50);
  assert.equal(quality.advisors[0]!.id, "adv-1");
  assert.equal(quality.advisors[0]!.tijdig, 1);
  assert.equal(quality.advisors[0]!.tijdigBeoordeeld, 2);
  assert.equal(quality.advisors[0]!.tijdigPct, 50);
  assert.equal(quality.advisors[1]!.tijdigBeoordeeld, 0);
  assert.equal(quality.advisors[1]!.tijdigPct, null);

  console.log("cockpit-metrics.test.ts ok");
}

run();
