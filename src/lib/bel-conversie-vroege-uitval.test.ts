import assert from "node:assert/strict";
import { countLateUitval, countVroegeUitval } from "./bel-conversie";
import { ymdEndIso, ymdStartIso } from "./sales-cockpit/range";

const now = new Date("2026-11-26T18:00:00+01:00");
const range = {
  start: new Date(ymdStartIso("2026-11-01")),
  end: new Date(ymdEndIso("2026-11-26")),
};

const statuses = new Map<string, string | null>([
  ["l1", "afspraak"],
  ["l2", "afspraak"],
  ["l3", "afspraak"],
  ["l4", "deur_niet_open"],
  ["l5", "afspraak"],
  ["l6", "afspraak"],
]);

const afspraken = [
  // Rijp + geannuleerd binnen 3d (telt in 3d én 7d)
  {
    id: "a1",
    lead_id: "l1",
    created_at: "2026-11-10T10:00:00+01:00",
    updated_at: "2026-11-12T12:00:00+01:00",
    start_at: "2026-11-20T10:00:00+01:00",
    status: "geannuleerd",
    soort: "nieuw",
  },
  // Rijp + blijft staan
  {
    id: "a2",
    lead_id: "l2",
    created_at: "2026-11-11T10:00:00+01:00",
    start_at: "2026-11-21T10:00:00+01:00",
    status: "bevestigd",
    soort: "nieuw",
  },
  // Rijp + geannuleerd na 7d → geen vroege uitval
  {
    id: "a3",
    lead_id: "l3",
    created_at: "2026-11-10T10:00:00+01:00",
    updated_at: "2026-11-20T10:00:00+01:00",
    start_at: "2026-11-22T10:00:00+01:00",
    status: "geannuleerd",
    soort: "nieuw",
  },
  // deur_niet_open → buiten telling
  {
    id: "a4",
    lead_id: "l4",
    created_at: "2026-11-10T10:00:00+01:00",
    updated_at: "2026-11-11T10:00:00+01:00",
    start_at: "2026-11-20T10:00:00+01:00",
    status: "geannuleerd",
    soort: "nieuw",
  },
  // Te jong voor 3d/7d (vandaag 10:00, now 18:00 → wel rijp voor 3u)
  {
    id: "a5",
    lead_id: "l5",
    created_at: "2026-11-26T10:00:00+01:00",
    start_at: "2026-12-05T10:00:00+01:00",
    status: "bevestigd",
    soort: "nieuw",
  },
  // Rijp + geannuleerd na 3d maar binnen 7d → alleen in 7d
  {
    id: "a6",
    lead_id: "l6",
    created_at: "2026-11-10T10:00:00+01:00",
    updated_at: "2026-11-15T10:00:00+01:00",
    start_at: "2026-11-22T10:00:00+01:00",
    status: "geannuleerd",
    soort: "nieuw",
  },
];

const counts7 = countVroegeUitval({
  ...range,
  now,
  withinHours: 168,
  leadStatusById: statuses,
  afspraken,
});

assert.equal(counts7.geplaatst, 5); // l4 uitgesloten
assert.equal(counts7.teJong, 1); // a5
assert.equal(counts7.geplaatstRijp, 4);
assert.equal(counts7.geannuleerdVroeg, 2); // a1 + a6
assert.equal(counts7.uitvalPct, 50);

const counts3d = countVroegeUitval({
  ...range,
  now,
  withinHours: 72,
  leadStatusById: statuses,
  afspraken,
});

assert.equal(counts3d.geplaatst, 5);
assert.equal(counts3d.teJong, 1);
assert.equal(counts3d.geplaatstRijp, 4);
assert.equal(counts3d.geannuleerdVroeg, 1); // alleen a1
assert.equal(counts3d.uitvalPct, 25);

// a1: geannuleerd na ~2 dagen → telt niet in 3u
const counts3u = countVroegeUitval({
  ...range,
  now,
  withinHours: 3,
  leadStatusById: statuses,
  afspraken,
});
assert.equal(counts3u.geplaatst, 5);
assert.equal(counts3u.teJong, 0); // a5 is 8u oud → rijp voor 3u
assert.equal(counts3u.geplaatstRijp, 5);
assert.equal(counts3u.geannuleerdVroeg, 0);
assert.equal(counts3u.uitvalPct, 0);

// Extra: annulering binnen 3u
const counts3uHit = countVroegeUitval({
  ...range,
  now,
  withinHours: 3,
  leadStatusById: new Map([...statuses, ["l7", "afspraak"]]),
  afspraken: [
    ...afspraken,
    {
      id: "a7",
      lead_id: "l7",
      created_at: "2026-11-10T10:00:00+01:00",
      updated_at: "2026-11-10T12:00:00+01:00",
      start_at: "2026-11-20T10:00:00+01:00",
      status: "geannuleerd",
      soort: "nieuw",
    },
  ],
});
assert.equal(counts3uHit.geplaatstRijp, 6);
assert.equal(counts3uHit.geannuleerdVroeg, 1);
assert.equal(counts3uHit.uitvalPct, 16.67);

// Last-minute: cohort op start_at, annulering binnen 24u vóór bezoek
const late = countLateUitval({
  ...range,
  now,
  withinHoursBeforeStart: 24,
  leadStatusById: statuses,
  afspraken: [
    {
      id: "b1",
      lead_id: "l1",
      created_at: "2026-11-01T10:00:00+01:00",
      updated_at: "2026-11-19T12:00:00+01:00",
      start_at: "2026-11-20T10:00:00+01:00",
      status: "geannuleerd",
      soort: "nieuw",
    },
    {
      id: "b2",
      lead_id: "l2",
      created_at: "2026-11-01T10:00:00+01:00",
      start_at: "2026-11-20T14:00:00+01:00",
      status: "bevestigd",
      soort: "nieuw",
    },
    // Geannuleerd 2 dagen vóór → geen 24u-late
    {
      id: "b3",
      lead_id: "l3",
      created_at: "2026-11-01T10:00:00+01:00",
      updated_at: "2026-11-18T10:00:00+01:00",
      start_at: "2026-11-20T10:00:00+01:00",
      status: "geannuleerd",
      soort: "nieuw",
    },
  ],
});
assert.equal(late.gepland, 3);
assert.equal(late.geplandRijp, 3);
assert.equal(late.geannuleerdLaat, 1);
assert.equal(late.uitvalPct, 33.33);

console.log("bel-conversie-vroege-uitval.test.ts ok");
