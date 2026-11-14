import assert from "node:assert/strict";
import { isNietGelopenUitkomst } from "./labels";
import { classifyVisit } from "./sales-cockpit/cockpit-metrics";
import type { RawAppt } from "./sales-cockpit/classify";

function appt(partial: Partial<RawAppt> & Pick<RawAppt, "startAt">): RawAppt {
  return {
    id: partial.id ?? "a1",
    leadId: partial.leadId ?? "l1",
    adviseurId: partial.adviseurId ?? "adv-1",
    plannerId: partial.plannerId ?? "planner-1",
    startAt: partial.startAt,
    status: partial.status ?? "voltooid",
    soort: partial.soort ?? "nieuw",
  };
}

function run() {
  assert.equal(isNietGelopenUitkomst("deur_niet_open"), true);
  assert.equal(isNietGelopenUitkomst("afspraak_afgezegd_klant"), true);
  assert.equal(isNietGelopenUitkomst("geen_interesse"), false);
  assert.equal(isNietGelopenUitkomst("sale_eigen_middelen"), false);
  assert.equal(isNietGelopenUitkomst(null), false);

  const visit = classifyVisit(
    appt({ startAt: "2026-10-06T08:00:00.000Z" }),
    "deur_niet_open",
    [],
    "2026-10-30"
  );
  assert.equal(visit.klasse, "niet_gelopen");
  assert.match(visit.outcome, /deur niet open/i);

  const sale = classifyVisit(
    appt({ startAt: "2026-10-06T08:00:00.000Z" }),
    "sale_eigen_middelen",
    [],
    "2026-10-30"
  );
  assert.equal(sale.klasse, "gelopen");

  const open = classifyVisit(
    appt({ startAt: "2026-10-06T08:00:00.000Z", status: "gepland" }),
    "afspraak",
    [],
    "2026-10-30"
  );
  assert.equal(open.klasse, "gelopen");
  assert.equal(open.outcome, "Niet afgeboekt");

  console.log("labels-gelopen.test.ts ok");
}

run();
