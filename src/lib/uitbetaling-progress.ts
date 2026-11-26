import type { SupabaseClient } from "@supabase/supabase-js";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import {
  isBelcommissieCreditfactuur,
  isOpsCommissieCreditfactuur,
} from "@/lib/callcenter-creditfactuur";
import {
  isProjectGeannuleerd,
  isProjectHoldSales,
} from "@/lib/backoffice-acties";
import {
  orderCommissiePctVanOfferte,
  resolveNettoCommissie,
  resolveOrderCommissiePct,
} from "@/lib/netto-boord";
import {
  isUitgeslotenVanSalesCommissie,
  normalizeRol,
} from "@/lib/rollen";

function klaarVoorRest(project: {
  status?: string | null;
  installatie_voltooid_at?: string | null;
}): boolean {
  if (project.installatie_voltooid_at) return true;
  const s = String(project.status || "");
  return (
    s === "installatie_voltooid" ||
    s === "after_sale" ||
    s === "review_gevraagd" ||
    s === "afgerond" ||
    s === "service"
  );
}

export type UitbetalingProgressPersoon = {
  id: string;
  naam: string;
  rol: string;
  groep: "adviseur" | "backoffice";
  orders: number;
  /** Totale verwachte salescommissie (10% of override). */
  totaal: number;
  /** Al uitbetaald (creditfactuur status=betaald). */
  groen: number;
  /** Getriggerd, nog niet uitbetaald (aanbetaling en/of rest na installatie). */
  oranje: number;
  /** Nog niet getriggerd — restcommissie wacht op installatie. */
  blauw: number;
};

export type UitbetalingProgressOverzicht = {
  personen: UitbetalingProgressPersoon[];
  totals: {
    totaal: number;
    groen: number;
    oranje: number;
    blauw: number;
  };
};

function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const size = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < size) break;
    from += size;
  }
  return out;
}

function omzetEx(off: {
  subtotaal_ex_btw?: number | null;
  totaal_inc_btw?: number | null;
}): number {
  const ex = Number(off.subtotaal_ex_btw) || 0;
  if (ex > 0) return ex;
  const inc = Number(off.totaal_inc_btw) || 0;
  if (inc > 0) return cents(inc / 1.21);
  return 0;
}

/**
 * Per actieve adviseur + backoffice: commissie-voortgang.
 * Groen = uitbetaald, oranje = getriggerd nog open, blauw = rest nog niet getriggerd.
 */
export async function buildUitbetalingProgress(
  sb: SupabaseClient
): Promise<UitbetalingProgressOverzicht> {
  const { data: people, error: peopleErr } = await sb
    .from("adviseurs")
    .select("id, naam, rol, actief, commissie_pct")
    .eq("actief", true)
    .order("naam");
  if (peopleErr) throw new Error(peopleErr.message);

  const personenBron = (people || []).filter((p) => {
    const rol = normalizeRol(p.rol);
    return rol === "adviseur" || rol === "backoffice";
  });
  const personById = new Map(
    personenBron.map((p) => [p.id as string, p] as const)
  );

  type OfferteRow = {
    id: string;
    lead_id: string | null;
    subtotaal_ex_btw: number | null;
    totaal_inc_btw: number | null;
    notities: string | null;
  };
  const offertes = await fetchAllPages<OfferteRow>((from, to) =>
    sb
      .from("offertes")
      .select("id, lead_id, subtotaal_ex_btw, totaal_inc_btw, notities")
      .eq("status", "ondertekend")
      .range(from, to)
  );

  const leadIds = [
    ...new Set(offertes.map((o) => o.lead_id).filter((x): x is string => Boolean(x))),
  ];
  type LeadRow = { id: string; adviseur_id: string | null };
  const leads: LeadRow[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const chunk = leadIds.slice(i, i + 200);
    const { data, error } = await sb
      .from("leads")
      .select("id, adviseur_id")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    leads.push(...((data || []) as LeadRow[]));
  }
  const leadById = new Map(leads.map((l) => [l.id, l] as const));

  const offerteIds = offertes.map((o) => o.id);
  type ProjectRow = {
    id: string;
    offerte_id: string | null;
    lead_id: string | null;
    status: string | null;
    installatie_voltooid_at: string | null;
  };
  const projecten: ProjectRow[] = [];
  for (let i = 0; i < offerteIds.length; i += 200) {
    const chunk = offerteIds.slice(i, i + 200);
    const { data, error } = await sb
      .from("projecten")
      .select("id, offerte_id, lead_id, status, installatie_voltooid_at")
      .in("offerte_id", chunk);
    if (error) throw new Error(error.message);
    projecten.push(...((data || []) as ProjectRow[]));
  }
  const projectByOfferte = new Map<string, ProjectRow>();
  for (const p of projecten) {
    if (p.offerte_id && !projectByOfferte.has(p.offerte_id)) {
      projectByOfferte.set(p.offerte_id, p);
    }
  }

  type FacRow = {
    id: string;
    lead_id: string | null;
    offerte_id: string | null;
    status: string | null;
    omschrijving: string | null;
  };
  const facturen = await fetchAllPages<FacRow>((from, to) =>
    sb
      .from("facturen")
      .select("id, lead_id, offerte_id, status, omschrijving")
      .eq("status", "betaald")
      .range(from, to)
  );
  const aanbetalingBetaald = new Set<string>();
  for (const f of facturen) {
    if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) continue;
    if (f.offerte_id) aanbetalingBetaald.add(`o:${f.offerte_id}`);
    if (f.lead_id) aanbetalingBetaald.add(`l:${f.lead_id}`);
  }

  type CfRow = {
    id: string;
    adviseur_id: string | null;
    status: string | null;
    notities: string | null;
    factuur_nummer: string | null;
    adviseur_creditfactuur_regels?: { bedrag: number | null }[] | null;
  };
  const { data: cfs, error: cfErr } = await sb
    .from("adviseur_creditfacturen")
    .select(
      "id, adviseur_id, status, notities, factuur_nummer, adviseur_creditfactuur_regels(bedrag)"
    )
    .neq("status", "geannuleerd")
    .limit(4000);
  if (cfErr) throw new Error(cfErr.message);

  const paidByPerson = new Map<string, number>();
  const openCfByPerson = new Map<string, number>();
  for (const cf of (cfs || []) as CfRow[]) {
    const advId = cf.adviseur_id;
    if (!advId) continue;
    const sales =
      !isBelcommissieCreditfactuur(cf) && !isOpsCommissieCreditfactuur(cf);
    if (!sales) continue;
    const som = cents(
      (cf.adviseur_creditfactuur_regels || []).reduce(
        (s, r) => s + (Number(r.bedrag) || 0),
        0
      )
    );
    if (cf.status === "betaald") {
      paidByPerson.set(advId, cents((paidByPerson.get(advId) || 0) + som));
    } else if (
      cf.status === "concept" ||
      cf.status === "verzonden" ||
      cf.status === "goedgekeurd"
    ) {
      openCfByPerson.set(advId, cents((openCfByPerson.get(advId) || 0) + som));
    }
  }

  const acc = new Map<
    string,
    { totaal: number; triggered: number; orders: number }
  >();
  for (const id of personById.keys()) {
    acc.set(id, { totaal: 0, triggered: 0, orders: 0 });
  }

  for (const off of offertes) {
    const lead = off.lead_id ? leadById.get(off.lead_id) : null;
    const advId = lead?.adviseur_id;
    if (!advId || !personById.has(advId)) continue;
    const person = personById.get(advId)!;
    if (isUitgeslotenVanSalesCommissie(person)) continue;

    const project = projectByOfferte.get(off.id) ?? null;
    const geannuleerd =
      Boolean(project && isProjectGeannuleerd(project)) ||
      Boolean(project && isProjectHoldSales(project));
    if (geannuleerd) continue;

    const omzet = omzetEx(off);
    if (!(omzet > 0)) continue;

    const pct = resolveOrderCommissiePct(
      orderCommissiePctVanOfferte({
        id: off.id,
        notities: off.notities,
      }),
      (person as { commissie_pct?: number | null }).commissie_pct
    );
    const aanbetalingOk =
      aanbetalingBetaald.has(`o:${off.id}`) ||
      (off.lead_id ? aanbetalingBetaald.has(`l:${off.lead_id}`) : false);
    const restDone = project ? klaarVoorRest(project) : false;
    const comm = resolveNettoCommissie({
      omzetExBtw: omzet,
      geannuleerd: false,
      aanbetalingBetaald: aanbetalingOk,
      restOfInstallatieDone: restDone,
      commissiePct: pct,
    });
    if (!(comm.verwacht > 0)) continue;

    const row = acc.get(advId)!;
    row.totaal = cents(row.totaal + comm.verwacht);
    row.triggered = cents(row.triggered + comm.verdiend);
    row.orders += 1;
  }

  const personen: UitbetalingProgressPersoon[] = personenBron.map((p) => {
    const id = p.id as string;
    const rol = normalizeRol(p.rol);
    const stats = acc.get(id) || { totaal: 0, triggered: 0, orders: 0 };
    const paid = paidByPerson.get(id) || 0;
    const openCf = openCfByPerson.get(id) || 0;
    const triggered = Math.max(stats.triggered, openCf, paid);
    const groen = cents(paid);
    const oranje = cents(Math.max(0, triggered - groen));
    const blauw = cents(Math.max(0, stats.totaal - triggered));
    const totaal = cents(Math.max(stats.totaal, groen + oranje + blauw));
    return {
      id,
      naam: String(p.naam || "Onbekend"),
      rol,
      groep: rol === "backoffice" ? "backoffice" : "adviseur",
      orders: stats.orders,
      totaal,
      groen,
      oranje,
      blauw,
    };
  });

  personen.sort((a, b) => {
    if (a.groep !== b.groep) return a.groep === "adviseur" ? -1 : 1;
    if (b.oranje !== a.oranje) return b.oranje - a.oranje;
    if (b.totaal !== a.totaal) return b.totaal - a.totaal;
    return a.naam.localeCompare(b.naam, "nl");
  });

  const totals = personen.reduce(
    (s, p) => ({
      totaal: cents(s.totaal + p.totaal),
      groen: cents(s.groen + p.groen),
      oranje: cents(s.oranje + p.oranje),
      blauw: cents(s.blauw + p.blauw),
    }),
    { totaal: 0, groen: 0, oranje: 0, blauw: 0 }
  );

  return { personen, totals };
}
