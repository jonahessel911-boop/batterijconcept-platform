import assert from "node:assert/strict";
import { belDeltaCopy, buildBelCockpitOverview } from "./bel-rapportage";

assert.equal(belDeltaCopy(12.4), "12% gestegen");
assert.equal(belDeltaCopy(-8), "8% gedaald");
assert.equal(belDeltaCopy(0), "gelijk");
assert.equal(belDeltaCopy(null), "nieuw");

const now = new Date("2026-11-26T12:00:00+01:00");
const overview = buildBelCockpitOverview({
  now,
  adviseurs: [
    {
      id: "b1",
      naam: "Simon",
      rol: "beller",
      actief: true,
      email: "simon@example.com",
    },
  ],
  leads: [
    {
      id: "l1",
      naam: "A",
      lead_number: "1",
      status: "afspraak",
      laatst_gebeld_at: "2026-11-26T10:00:00+01:00",
      laatst_gebeld_door: "b1",
    },
    {
      id: "l2",
      naam: "B",
      lead_number: "2",
      status: "geen_interesse",
      laatst_gebeld_at: "2026-11-26T11:00:00+01:00",
      laatst_gebeld_door: "b1",
    },
    {
      id: "l3",
      naam: "C",
      lead_number: "3",
      status: "geen_contact",
      laatst_gebeld_at: "2026-11-25T11:00:00+01:00",
      laatst_gebeld_door: "b1",
    },
  ],
  afspraken: [
    {
      id: "a1",
      lead_id: "l1",
      created_at: "2026-11-26T10:05:00+01:00",
      start_at: "2026-11-28T10:00:00+01:00",
      status: "bevestigd",
      soort: "nieuw",
      adviseur_id: "adv1",
      ingepland_door_id: "b1",
    },
  ],
});

assert.deepEqual(
  overview.periods.map((p) => p.id),
  ["vandaag", "week", "maand", "vorige_maand"]
);
const today = overview.periods.find((p) => p.id === "vandaag")!;
assert.equal(today.current.gebeld, 2);
assert.equal(today.current.ingepland, 1);
assert.equal(today.current.geenInteresse, 1);
assert.equal(today.previous.geenContact, 1);
assert.ok(overview.series.length >= 120);
assert.equal(overview.series.at(-1)?.key, "2026-11-26");
assert.equal(overview.seriesTo, "2026-11-26");
assert.equal(overview.series[0]?.key, overview.seriesFrom);
assert.equal(overview.seriesFrom, "2026-01-01");
assert.ok(overview.leaderboards.week.length >= 1);
assert.equal(overview.leaderboards.week[0]?.naam, "Simon");

const last = overview.series.at(-1)!;
assert.equal(typeof last.uitvalH3Rijp, "number");
assert.equal(typeof last.uitvalD3Rijp, "number");
assert.equal(typeof last.uitvalD7Rijp, "number");
assert.equal(typeof last.lateUitval3uRijp, "number");
assert.equal(typeof last.lateUitval24uRijp, "number");
// a1 is ~2u oud t.o.v. now → te jong voor 3u/3d/7d na inplannen
assert.equal(last.uitvalH3Rijp, 0);
assert.equal(last.uitvalD3Rijp, 0);
assert.equal(last.uitvalD7Rijp, 0);
// start_at 28 nov ligt in de toekomst → late-uitval te jong op 26 nov
assert.equal(last.lateUitval24uRijp, 0);

const vorigeMaand = overview.periods.find((p) => p.id === "vorige_maand")!;
assert.equal(vorigeMaand.range.from, "2026-10-01");
assert.equal(vorigeMaand.range.to, "2026-10-31");

console.log("bel-rapportage.test.ts ok");
