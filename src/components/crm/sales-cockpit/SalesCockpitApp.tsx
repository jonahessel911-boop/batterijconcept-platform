"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Handshake,
  Menu,
  Percent,
  Users,
  Wallet,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiStat } from "@/components/ui/kpi-stat";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { currentWeekKey, shiftWeek } from "@/lib/sales-cockpit/weeks";

type Bundle = Record<string, any>;

const VIEWS = [
  ["home", "Cockpit"],
  ["adviseurs", "Adviseurs"],
  ["capaciteit", "Capaciteit"],
  ["afspraken", "Afspraken"],
  ["conversie", "Conversie"],
  ["deals", "Deals"],
  ["afboeken", "Afboeken"],
  ["meeting", "Weekmeeting"],
] as const;

const inputCls =
  "h-9 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink shadow-sm outline-none transition placeholder:text-muted/70 focus:border-green focus:ring-2 focus:ring-green/15";

function pctText(n: number | null | undefined) {
  if (n == null) return "—";
  return `${n.toLocaleString("nl-NL")}%`;
}

function initials(naam: string) {
  return naam
    .split(/\s+/)
    .filter((deel) => /[A-Za-zÀ-ÿ]/.test(deel))
    .slice(0, 2)
    .map((deel) => deel[0])
    .join("")
    .toUpperCase();
}

function soortClass(soort: string) {
  if (soort === "groeikans" || soort === "verbeterkans") return "bg-green-soft text-green-deeper";
  if (soort === "verplichting" || soort === "procesactie") return "bg-orange/10 text-[#9a3412]";
  if (soort === "onderzoek") return "bg-amber-50 text-amber-900";
  return "bg-zinc-100 text-zinc-600";
}

export function SalesCockpitApp({ onOpenMenu }: { onOpenMenu?: () => void }) {
  const router = useRouter();
  const sp = useSearchParams();
  const view = sp.get("cockpit") || "home";
  const week = sp.get("week") || currentWeekKey();
  const adv = sp.get("adv") || "";
  const [data, setData] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dossier, setDossier] = useState<{ kind: string; title: string } | null>(null);

  const setQuery = useCallback(
    (patch: Record<string, string | null>, scroll = false) => {
      const params = new URLSearchParams(sp.toString());
      params.set("tab", "sales_cockpit");
      for (const [key, value] of Object.entries(patch)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      if (!scroll) {
        try {
          sessionStorage.setItem(`bc-cockpit-scroll:${view}`, String(window.scrollY));
        } catch {
          /* ignore */
        }
      }
      router.replace(`/?${params.toString()}`, { scroll: false });
    },
    [router, sp, view]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/sales-cockpit?week=${encodeURIComponent(week)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Laden mislukt");
        if (!cancelled) setData(json);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Laden mislukt");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week]);

  useEffect(() => {
    setDossier(null);
    const y = Number(sessionStorage.getItem(`bc-cockpit-scroll:${view}`) || 0);
    if (y > 0) window.scrollTo(0, y);
  }, [view]);

  const adviseur = useMemo(
    () => (data?.adviseurs || []).find((a: { id: string }) => a.id === adv) || null,
    [data, adv]
  );
  const tab = VIEWS.some(([id]) => id === view) ? view : "adviseurs";

  return (
    <TooltipProvider>
      <div className="space-y-5 text-ink">
        <header className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {onOpenMenu ? (
              <Button type="button" variant="outline" size="icon" className="md:hidden" onClick={onOpenMenu} aria-label="Menu">
                <Menu />
              </Button>
            ) : null}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-green">Management</p>
              <h1 className="font-display text-2xl font-semibold tracking-tight text-green-deeper">Salescockpit</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                <CalendarRange className="size-4 text-green" />
                <span>
                  {data?.week?.startYmd || "…"} – {data?.week?.endYmd || "…"}
                </span>
                <Badge tone="accent">{data?.week?.label || week}</Badge>
                {data?.week?.current ? <Badge tone="positive">Deze week</Badge> : null}
                {data?.week && !data.week.complete ? <Badge>Nog niet afgerond</Badge> : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-wash p-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery({ week: shiftWeek(week, -1) })}>
                <ChevronLeft /> Vorige
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery({ week: currentWeekKey() })}>
                Deze week
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery({ week: shiftWeek(week, 1) })}>
                Volgende <ChevronRight />
              </Button>
            </div>
            <Button type="button" size="sm" onClick={() => setQuery({ cockpit: "meeting" })}>
              Weekmeeting
            </Button>
            <select
              className="h-8 max-w-52 rounded-lg border border-line bg-white px-2 text-sm shadow-sm"
              value={adv}
              onChange={(e) =>
                setQuery({
                  adv: e.target.value || null,
                  cockpit: e.target.value ? "adviseur" : view === "adviseur" ? "adviseurs" : view,
                })
              }
              aria-label="Adviseur"
            >
              <option value="">Alle adviseurs</option>
              {(data?.adviseurs || []).map((a: { id: string; naam: string }) => (
                <option key={a.id} value={a.id}>
                  {a.naam}
                </option>
              ))}
            </select>
            {adv || sp.get("cockpit") ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setQuery({ adv: null, cockpit: "home" })}>
                Filters wissen
              </Button>
            ) : null}
          </div>
        </header>

        <Tabs value={tab} onValueChange={(id) => setQuery({ cockpit: id === "home" ? null : id })}>
          <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-sm">
            {VIEWS.map(([id, label]) => (
              <TabsTrigger key={id} value={id} className="data-[state=active]:bg-green-soft data-[state=active]:text-green-deeper">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <p className="text-xs text-muted">
          Bijgewerkt{" "}
          {data?.refreshedAt
            ? new Date(data.refreshedAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })
            : "—"}
          {data?.storage && !data.storage.ok
            ? " · targets, acties en evaluaties bewaren wacht op de cockpit-migratie"
            : ""}
        </p>

        {error ? (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="p-5 text-sm text-rose-800">{error}</CardContent>
          </Card>
        ) : loading && !data ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : data ? (
          <>
            {view === "adviseur" && adviseur ? <AdviseurDetail row={adviseur} data={data} onOpen={setDossier} /> : null}
            {(view === "home" || view === "") && <Home data={data} onOpen={setQuery} onDossier={setDossier} />}
            {view === "adviseurs" && <Adviseurs data={data} adv={adv} onOpen={setQuery} />}
            {view === "capaciteit" && <Capaciteit data={data} />}
            {view === "afspraken" && <Afspraken data={data} onDossier={setDossier} />}
            {view === "conversie" && <Conversie data={data} week={week} onReload={() => setQuery({ week })} />}
            {view === "deals" && <Deals data={data} onDossier={setDossier} />}
            {view === "afboeken" && <Afboeken data={data} />}
            {view === "meeting" && <Meeting data={data} week={week} onSaved={() => setQuery({ week })} />}
            {dossier ? <Dossiers week={week} adv={adv} kind={dossier.kind} title={dossier.title} onClose={() => setDossier(null)} /> : null}
            <Beperkingen items={data.beperkingen || []} />
          </>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function Home({
  data,
  onOpen,
  onDossier,
}: {
  data: Bundle;
  onOpen: (p: Record<string, string | null>) => void;
  onDossier: (d: { kind: string; title: string }) => void;
}) {
  const h = data.home;
  const gelopen = h.gelopen.aantal;
  const conv = h.conversie.pct;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiStat
          label="Gelopen kansen"
          value={gelopen == null ? "—" : String(gelopen)}
          icon={<Users className="size-4" />}
          hint={[
            h.gelopen.target != null ? `Target ${h.gelopen.target}` : "Geen weektarget",
            h.gelopen.zonderRegel ? `${h.gelopen.zonderRegel} zonder afboekregel` : null,
            h.gelopen.nogOpen ? `${h.gelopen.nogOpen} nog open` : null,
          ].filter(Boolean).join(" · ")}
        />
        <button type="button" className="text-left" onClick={() => onDossier({ kind: "getekend", title: "Getekend deze week" })}>
          <KpiStat
            label="Getekende deals"
            value={String(h.getekend.aantal)}
            icon={<Handshake className="size-4" />}
            hint={h.getekend.geannuleerdLater ? `${h.getekend.geannuleerdLater} later geannuleerd` : h.getekend.target != null ? `Target ${h.getekend.target}` : "Ondertekening blijft meetellen"}
          />
        </button>
        <KpiStat
          label="Conversie, 4 weken"
          value={pctText(conv)}
          icon={<Percent className="size-4" />}
          hint={
            conv == null
              ? h.conversie.tekst
              : `${h.conversie.verkocht}/${h.conversie.gelopen} gelopen · basis ${h.conversie.basis} · ${h.conversie.open ?? 0} nog open · ${h.conversie.uitgesloten} uitgesloten · toegewezen ${pctText(h.conversie.toegewezenPct)}`
          }
        />
        <KpiStat
          label="Tijdig aanbetaald"
          value={h.dealkwaliteit.beoordeeld ? pctText(h.dealkwaliteit.tijdigPct) : "—"}
          icon={<Wallet className="size-4" />}
          hint={
            h.dealkwaliteit.beoordeeld
              ? `${h.dealkwaliteit.tijdig}/${h.dealkwaliteit.beoordeeld} tijdig · uitval ${h.dealkwaliteit.uitvalVan ? `${pctText(h.dealkwaliteit.uitvalPct)} (${h.dealkwaliteit.uitval}/${h.dealkwaliteit.uitvalVan})` : "nog niet beoordeelbaar"} · ${h.dealkwaliteit.achterstallig} achterstallig`
              : "Nog geen beoordeelbare aanbetalingen"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Commerciële prioriteiten</CardTitle>
            <CardDescription>Maximaal vijf. Geen verborgen totaalscore. De 40%-norm staat op gelopen kansen.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(h.prioriteiten || []).length === 0 ? (
              <p className="text-sm text-muted">Geen prioriteit met voldoende betrouwbare data.</p>
            ) : (
              h.prioriteiten.map((s: Bundle) => (
                <SignaalKaart key={s.key} s={s} acties={data.acties || []} onOpen={() => onOpen({ cockpit: s.doorklik, adv: s.adviseurId })} />
              ))
            )}
          </CardContent>
        </Card>
        <Card className="bg-green-deeper text-white">
          <CardHeader>
            <CardTitle className="text-white">Capaciteit vooruit</CardTitle>
            <CardDescription className="text-white/70">Aangeboden blokken, inclusief al geboekte. Geen vuladvies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-2 flex items-end justify-between">
                <p className="text-sm text-white/80">{h.capaciteit.volgende.label}</p>
                <p className="font-display text-3xl font-semibold tabular-nums">{h.capaciteit.gemiddelde ?? "—"}</p>
              </div>
              <Progress value={Math.min(100, ((h.capaciteit.gemiddelde || 0) / 24) * 100)} className="bg-white/15" indicatorClassName="bg-orange" />
              <p className="mt-2 text-sm text-white/80">
                {h.capaciteit.onder15} van {h.capaciteit.adviseurs} onder 15 blokken
              </p>
            </div>
            <p className="text-sm text-white/70">{h.capaciteit.daarna.label} staat op de capaciteitspagina.</p>
            <Button type="button" variant="outline" className="border-white/20 bg-white text-green-deeper hover:bg-green-soft" onClick={() => onOpen({ cockpit: "capaciteit" })}>
              Naar capaciteit <ArrowUpRight />
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operationeel</CardTitle>
          <CardDescription>Administratie staat los van de commerciële prioriteiten.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(h.operationeel || []).map((s: Bundle) => (
            <SignaalKaart key={s.key} s={s} acties={data.acties || []} onOpen={() => onOpen({ cockpit: s.doorklik, adv: null })} />
          ))}
          <ActieLijst acties={data.acties || []} />
        </CardContent>
      </Card>
    </div>
  );
}

function SignaalKaart({ s, acties, onOpen }: { s: Bundle; acties: Bundle[]; onOpen: () => void }) {
  const bestaand = acties.find((a) => a.signal_key === s.key);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [toelichting, setToelichting] = useState("");
  const [kpi, setKpi] = useState(bestaand?.kpi || "");
  const [uitgang, setUitgang] = useState(bestaand?.uitgangswaarde || s.volume || "");
  const [gewenst, setGewenst] = useState(bestaand?.gewenste_verbetering || "");
  const [aandacht, setAandacht] = useState(bestaand?.aandacht || "middel");
  const [evaluatie, setEvaluatie] = useState(bestaand?.evaluatie_op || "");
  const [resultaat, setResultaat] = useState(bestaand?.resultaat || "");
  async function bewaar(status: string, extra: Record<string, string | number | null> = {}) {
    const res = await fetch("/api/sales-cockpit/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signal_key: s.key,
        adviseur_id: s.adviseurId,
        soort: s.soort,
        status,
        titel: s.titel,
        observatie: s.observatie,
        actie: s.actie,
        verantwoordelijke: s.verantwoordelijke,
        kpi,
        uitgangswaarde: uitgang,
        gewenste_verbetering: gewenst,
        aandacht,
        evaluatie_op: evaluatie || null,
        resultaat,
        toelichting,
        expectedVersion: bestaand?.version || 0,
        ...extra,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Bewaard" : json.error || "Niet bewaard");
  }
  return (
    <article className="rounded-xl border border-line bg-wash/60 p-4">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${soortClass(s.soort)}`}>{s.soort}</span>
          <span className="text-sm font-semibold text-ink">{s.adviseur}</span>
          <span className="text-sm text-charcoal">{s.titel}</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-charcoal">{s.observatie}</p>
        <p className="mt-2 text-xs text-muted">
          {s.volume} · {s.periode} · {s.trend}
        </p>
      </button>
      <Separator className="my-3" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-xs leading-relaxed text-muted">
          {s.betrouwbaarheid}. {s.actie}
        </p>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          {open ? "Sluit actie" : "Actie vastleggen"}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => void bewaar("onderzoek")}>Oppakken</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void bewaar("loopt")}>Actie loopt</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void bewaar("evalueren", { uitgesteld_tot: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) })}>Uitstellen</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void bewaar("afgerond", { oorzaak_buiten_sales: toelichting || "Buiten sales" })}>Oorzaak buiten sales</Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <input className={inputCls} placeholder="KPI" value={kpi} onChange={(e) => setKpi(e.target.value)} />
            <input className={inputCls} placeholder="Uitgangswaarde" value={uitgang} onChange={(e) => setUitgang(e.target.value)} />
            <input className={inputCls} placeholder="Gewenste verbetering" value={gewenst} onChange={(e) => setGewenst(e.target.value)} />
            <select className={inputCls} value={aandacht} onChange={(e) => setAandacht(e.target.value)} aria-label="Benodigde aandacht">
              <option value="klein">Aandacht klein</option>
              <option value="middel">Aandacht middel</option>
              <option value="groot">Aandacht groot</option>
            </select>
            <input className={inputCls} type="date" value={String(evaluatie).slice(0, 10)} onChange={(e) => setEvaluatie(e.target.value)} aria-label="Evaluatiedatum" />
            <input className={inputCls} placeholder="Waargenomen resultaat" value={resultaat} onChange={(e) => setResultaat(e.target.value)} />
          </div>
          <input className={inputCls} placeholder="Toelichting, prioriteit of oorzaak buiten sales" value={toelichting} onChange={(e) => setToelichting(e.target.value)} />
          {msg ? <p className="text-xs text-green-deeper">{msg}</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function Adviseurs({ data, adv, onOpen }: { data: Bundle; adv: string; onOpen: (p: Record<string, string | null>) => void }) {
  const [filter, setFilter] = useState("aandacht");
  const [metric, setMetric] = useState<"conversie" | "aanbetaling" | "uitval">("conversie");
  const rows = (data.adviseurs || []).filter((a: Bundle) => {
    if (adv && a.id !== adv) return false;
    if (filter === "actief") return a.actief;
    if (filter === "historisch") return !a.actief;
    if (filter === "starters") return a.faseWeken != null && a.faseWeken <= 2;
    if (filter === "data") return a.basis === "geen";
    if (filter === "groei") return a.volgende != null && a.volgende < 15 && a.basis === "stevig";
    if (filter === "terugval") {
      return (data.home?.prioriteiten || []).some((s: Bundle) => s.adviseurId === a.id && String(s.key).includes("conversie"));
    }
    if (filter === "aandacht") return a.basis === "geen" || (a.volgende != null && a.volgende < 15) || a.signaal !== "Geen hard signaal";
    return true;
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {[
          ["aandacht", "Aandacht"],
          ["groei", "Groeikansen"],
          ["starters", "Starters"],
          ["terugval", "Terugval"],
          ["data", "Onvoldoende data"],
          ["actief", "Actief"],
          ["historisch", "Historisch"],
        ].map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={filter === id ? "default" : "outline"} onClick={() => setFilter(id)}>
            {label}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Vergelijking</CardTitle>
              <CardDescription>Zonder voldoende noemer geen ranglijst.</CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg bg-wash p-1">
              {(["conversie", "aanbetaling", "uitval"] as const).map((id) => (
                <Button key={id} type="button" size="sm" variant={metric === id ? "default" : "ghost"} onClick={() => setMetric(id)}>
                  {id}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((a: Bundle) => {
            const value = metric === "conversie" ? a.conversiePct : metric === "aanbetaling" ? a.aanbetalingPct : a.uitvalPct;
            const toon = a.basis !== "geen" && value != null;
            return (
              <button key={a.id} type="button" className="block w-full text-left" onClick={() => onOpen({ cockpit: "adviseur", adv: a.id })}>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Avatar className="size-7">
                      <AvatarFallback className="bg-green-soft text-green-deeper">{initials(a.naam)}</AvatarFallback>
                    </Avatar>
                    {a.naam}
                  </span>
                  <span className="text-xs text-muted">{toon ? pctText(value) : a.fase}</span>
                </div>
                {toon ? (
                  <Progress value={value} indicatorClassName={metric === "uitval" && value > 20 ? "bg-orange" : value >= 40 ? "bg-green" : "bg-green-dark"} />
                ) : (
                  <p className="text-xs text-muted">Onvoldoende data voor een balk</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {a.conversieTeller} verkocht van {a.conversieNoemer} helder toegewezen · capaciteit {a.volgende ?? "—"} / {a.daarna ?? "—"} · {a.signaal}
                </p>
              </button>
            );
          })}
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-2xl border border-line bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-wash text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {["Adviseur", "Gelopen", "Conversie", "Aanbetaling", "Uitval", "Capaciteit", "Targets", "Signaal"].map((h) => (
                <th key={h} className="px-3 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a: Bundle) => (
              <tr key={a.id} className="border-t border-line hover:bg-green-soft/40">
                <td className="px-3 py-3">
                  <button type="button" className="font-medium text-green-deeper" onClick={() => onOpen({ cockpit: "adviseur", adv: a.id })}>
                    {a.naam}
                  </button>
                  <div className="text-xs text-muted">{a.fase}</div>
                </td>
                <td className="px-3 py-3 tabular-nums">{a.gelopen == null ? "—" : a.gelopen}</td>
                <td className="px-3 py-3">{a.basis === "geen" ? "Te weinig" : `${pctText(a.conversiePct)} (${a.conversieTeller}/${a.conversieNoemer})`}</td>
                <td className="px-3 py-3">{pctText(a.aanbetalingPct)}</td>
                <td className="px-3 py-3">{pctText(a.uitvalPct)}</td>
                <td className="px-3 py-3 tabular-nums">
                  {a.volgende ?? "—"} / {a.daarna ?? "—"}
                </td>
                <td className="px-3 py-3">{a.targetDeals ?? "—"} deals</td>
                <td className="px-3 py-3 text-muted">{a.signaal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Capaciteit({ data }: { data: Bundle }) {
  const rows = data.capaciteit?.rijen || [];
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Volgende twee weken</CardTitle>
          <CardDescription>{data.capaciteit?.noot}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.map((r: Bundle) => (
            <div key={r.adviseurId}>
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium">{r.naam}</span>
                <span className="tabular-nums text-muted">
                  {r.volgende ?? "—"} · daarna {r.daarna ?? "—"}
                </span>
              </div>
              <Progress value={Math.min(100, ((r.volgende || 0) / 28) * 100)} indicatorClassName={r.onder ? "bg-orange" : "bg-green"} />
              {r.onder ? <p className="mt-1 text-xs text-orange">Onder 15 blokken</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Activiteit per week</CardTitle>
          <CardDescription>Toegewezen kansen en getekende orders. Oude capaciteit alleen als er een snapshot is.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data.capaciteit?.trend || []).map((w: Bundle) => (
            <div key={w.weekKey} className="grid grid-cols-[7rem_1fr_1fr] items-center gap-3 rounded-lg px-2 py-1.5 text-sm odd:bg-wash">
              <span className="font-medium text-green-deeper">{w.weekKey}</span>
              <span>Toegewezen {w.toegewezen}</span>
              <span>Getekend {w.getekend}</span>
            </div>
          ))}
          <p className="text-xs text-muted">Snapshots: {(data.capaciteit?.snapshots || []).length}. Ontbrekende weken zijn niet aangevuld.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Afspraken({ data, onDossier }: { data: Bundle; onDossier: (d: { kind: string; title: string }) => void }) {
  const p = data.afspraken?.pogingen || {};
  const k = data.afspraken?.kansen || {};
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Bezoekpogingen deze week</CardTitle>
          <CardDescription>{data.afspraken?.noot}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Segment label="Gesprek gevoerd" n={p.gesprek} tone="good" onClick={() => onDossier({ kind: "gesprek", title: "Gesprek gevoerd" })} />
          <Segment label="Deur dicht" n={p.deurDicht} tone="bad" onClick={() => onDossier({ kind: "deur_dicht", title: "Deur niet open" })} />
          <Segment label="Klant afgezegd" n={p.klantAfgezegd} onClick={() => onDossier({ kind: "afgezegd", title: "Afgezegd door de klant" })} />
          <Segment label="Nog gepland" n={p.gepland} onClick={() => onDossier({ kind: "poging_gepland", title: "Nog geplande pogingen" })} />
          <Segment label="Geannuleerd" n={p.geannuleerd} onClick={() => onDossier({ kind: "poging_geannuleerd", title: "Geannuleerde pogingen" })} />
          <Segment label="Uitkomst onbekend" n={p.onbekend} onClick={() => onDossier({ kind: "poging_onbekend", title: "Pogingen zonder afboekregel" })} />
          <Segment label="Verplaatst" n={null} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Unieke kansen deze week</CardTitle>
          <CardDescription>Een vervolg is geen nieuwe kans. Een eerdere mislukte poging blijft zichtbaar.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          <Segment label="Eerste gesprek" n={k.gesprek} tone="good" onClick={() => onDossier({ kind: "gesprek", title: "Kansen met een gesprek" })} />
          <Segment label="Nog gepland" n={k.nogGepland} onClick={() => onDossier({ kind: "toegewezen", title: "Toegewezen kansen" })} />
          <Segment label="Niet uitgevoerd" n={k.nietUitgevoerd} />
          <Segment label="Onbekend" n={k.onbekend} />
        </CardContent>
      </Card>
    </div>
  );
}

function Segment({ label, n, onClick, tone }: { label: string; n: number | null; onClick?: () => void; tone?: "good" | "bad" }) {
  const body = (
    <div className={`rounded-xl border p-3 text-left transition ${tone === "good" ? "border-green/30 bg-green-soft" : tone === "bad" ? "border-orange/30 bg-orange/5" : "border-line bg-white"} ${onClick ? "hover:shadow-sm" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-green-deeper">{n == null ? "—" : n}</p>
      {n == null ? <p className="text-xs text-muted">Niet meetbaar</p> : null}
    </div>
  );
  if (!onClick || n == null) return body;
  return (
    <button type="button" onClick={onClick}>
      {body}
    </button>
  );
}

function Conversie({ data, week, onReload }: { data: Bundle; week: string; onReload: () => void }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Wekelijkse conversie op gelopen kansen</CardTitle>
          <CardDescription>Eerste aangetoonde gesprek in die week. Nog open vervolgen blijven in de noemer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(data.conversie?.trend || []).map((w: Bundle) => (
            <div key={w.weekKey} className="grid grid-cols-[6.5rem_1fr_9rem] items-center gap-3 text-sm">
              <span className="font-medium text-green-deeper">{w.weekKey}</span>
              <Progress value={w.pct || 0} indicatorClassName={(w.pct || 0) >= 40 ? "bg-green" : "bg-orange"} />
              <span className="text-right tabular-nums text-muted">{w.basis === "geen" ? "te weinig" : `${pctText(w.pct)} (${w.verkocht}/${w.helder})`}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Targetrealisatie</CardTitle>
          <CardDescription>Het dealtarget van de geselecteerde week. Gesprekstargets worden bewaard, niet als gehaald of gemist beoordeeld zolang de tijdlijn ontbreekt op die cel.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {(data.conversie?.matrix || []).slice(0, 12).map((r: Bundle) => {
                const cel = (r.cellen || []).find((c: Bundle) => c.weekKey === data.week?.key) || (r.cellen || [])[0];
                return (
                  <tr key={r.adviseurId} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{r.naam}</td>
                    <td className="text-muted">{r.fase}</td>
                    <td className="px-3">
                      {cel?.dealsGehaald == null ? (
                        <Badge>Geen dealtarget</Badge>
                      ) : cel.dealsGehaald ? (
                        <Badge tone="positive">Deals {cel.deals}/{cel.dealsTarget}</Badge>
                      ) : (
                        <Badge tone="negative">Deals {cel.deals}/{cel.dealsTarget}</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <SettingsForm version={data.settingsVersion} settings={data.settings} missing={!data.storage?.ok} onSaved={onReload} week={week} />
      <EvalKnop week={week} evaluaties={data.evaluaties || []} onSaved={onReload} />
    </div>
  );
}

function Deals({ data, onDossier }: { data: Bundle; onDossier: (d: { kind: string; title: string }) => void }) {
  const d = data.deals;
  const items = [
    ["Getekend deze week", d.dezeWeek, () => onDossier({ kind: "getekend", title: "Getekend deze week" })],
    ["Aanbetaald", d.bucket.aanbetaald, null],
    ["Netto afgerond", d.bucket.netto, null],
    ["Geannuleerd", d.bucket.geannuleerd, () => onDossier({ kind: "geannuleerd", title: "Geannuleerde orders" })],
  ] as const;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, value, click]) => {
          const card = <KpiStat label={label} value={String(value)} />;
          return click ? (
            <button key={label} type="button" className="text-left" onClick={click}>
              {card}
            </button>
          ) : (
            <div key={label}>{card}</div>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Aanbetaling</CardTitle>
          <CardDescription>Tijdig is uiterlijk zeven kalenderdagen na ondertekening. Nul euro telt niet als achterstallig.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Stat label="Gemiddelde duur" value={d.gemiddeldeDagen == null ? "—" : `${d.gemiddeldeDagen} d`} />
          <Stat label="0–4 / 5–7 / later" value={`${d.verdeling.t0_4} · ${d.verdeling.t5_7} · ${d.verdeling.later}`} />
          <Stat label="Achterstallig" value={String(d.achterstallig)} />
          <p className="text-sm text-muted sm:col-span-3">
            Wacht op betaling {d.bucket.wacht} · gedeeltelijk {d.bucket.gedeeltelijk} · geen aanbetaling {d.bucket.geenAanbetaling}. {d.onduidelijkeOntvangsten} orders hebben een ontvangst die niet als aanbetaling is herkend.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => onDossier({ kind: "achterstallig", title: "Achterstallige aanbetaling" })}>
            Open achterstallige dossiers
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-wash px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold text-green-deeper">{value}</p>
    </div>
  );
}

function Afboeken({ data }: { data: Bundle }) {
  const a = data.afboeken;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Afboeken</CardTitle>
        <CardDescription>{a.tekst}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {a.meetbaar ? (
          <>
            <Stat label="Op tijd" value={`${a.opTijd}/${a.beoordeeld}`} />
            <Stat label="Percentage" value={pctText(a.percentage)} />
            <Stat label="Te laat" value={String(a.teLaat)} />
            <Stat label="Zonder regel" value={String(a.zonderTijd)} />
            <p className="text-sm text-muted sm:col-span-2 lg:col-span-4">
              Vandaag nog open: {a.vandaagOpen}. Dat is geen overtreding. {(a.herhaling || []).length ? a.herhaling.join(" · ") : "Geen herhaald te late dagen in dit venster."}
            </p>
          </>
        ) : (
          <p className="text-sm">{a.tekst}</p>
        )}
      </CardContent>
    </Card>
  );
}

function Meeting({ data, week, onSaved }: { data: Bundle; week: string; onSaved: () => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {(data.meeting?.rijen || []).map((r: Bundle) => (
        <TargetForm key={r.adviseurId} row={r} week={week} onSaved={onSaved} disabled={!data.storage?.ok} />
      ))}
    </div>
  );
}

function TargetForm({ row, week, onSaved, disabled }: { row: Bundle; week: string; onSaved: () => void; disabled: boolean }) {
  const t = row.target || {};
  const [gelopen, setGelopen] = useState(t.gelopen_target ?? "");
  const [deals, setDeals] = useState(t.deals_target ?? "");
  const [conversie, setConversie] = useState(t.conversie_target ?? "");
  const [tekst, setTekst] = useState(t.verbeterafspraak ?? "");
  const [msg, setMsg] = useState<string | null>(row.waarschuwing);
  async function save() {
    setMsg(null);
    const res = await fetch("/api/sales-cockpit/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adviseurId: row.adviseurId,
        weekKey: week,
        gelopen,
        deals,
        conversie,
        verbeterafspraak: tekst,
        expectedVersion: t.version || 0,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "Opslaan mislukt");
      return;
    }
    onSaved();
  }
  const verwacht = gelopen !== "" && conversie !== "" ? Math.round((Number(gelopen) * Number(conversie)) / 100) : null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback className="bg-green-soft text-green-deeper">{initials(row.naam)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle>{row.naam}</CardTitle>
            <CardDescription>
              Ingepland {row.gepland} · volgende week {row.volgende ?? "—"} · daarna {row.daarna ?? "—"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-muted">Gelopen doel<input className={inputCls} value={gelopen} onChange={(e) => setGelopen(e.target.value)} /></label>
        <label className="text-xs text-muted">Dealdoel<input className={inputCls} value={deals} onChange={(e) => setDeals(e.target.value)} /></label>
        <label className="text-xs text-muted">Conversiedoel %<input className={inputCls} value={conversie} onChange={(e) => setConversie(e.target.value)} /></label>
        <label className="text-xs text-muted sm:col-span-3">Verbeterafspraak<textarea className={`${inputCls} h-20 py-2`} value={tekst} onChange={(e) => setTekst(e.target.value)} /></label>
        {verwacht != null && String(verwacht) !== String(deals) && deals !== "" ? (
          <p className="text-xs text-charcoal sm:col-span-3">{gelopen} bij {conversie}% wijst op {verwacht} deals. Niet automatisch aangepast.</p>
        ) : null}
        {msg ? <p className="text-xs text-muted sm:col-span-3">{msg}</p> : null}
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="button" size="sm" disabled={disabled} onClick={() => void save()}>Bewaar doel</Button>
          <p className="text-xs text-muted">{(row.historie || []).length} versies bewaard</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AdviseurDetail({ row, data, onOpen }: { row: Bundle; data: Bundle; onOpen: (d: { kind: string; title: string }) => void }) {
  const teamK = (data.adviseurs || []).reduce((s: number, a: Bundle) => s + (a.toegewezen || 0), 0);
  const teamD = (data.adviseurs || []).reduce((s: number, a: Bundle) => s + (a.conversieTeller || 0), 0);
  const zonderK = teamK - (row.toegewezen || 0);
  const zonderD = teamD - (row.conversieTeller || 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar className="size-11">
            <AvatarFallback className="bg-green-deeper text-sm text-white">{initials(row.naam)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle>{row.naam}</CardTitle>
            <CardDescription>{row.fase}. {row.faseBasis}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Gelopen" value={row.gelopen == null ? "—" : `${row.gelopenVerkocht ?? 0}/${row.gelopenNoemer ?? row.gelopen}`} />
        <Stat label="Conversie gelopen" value={row.gelopenPct == null ? "—" : pctText(row.gelopenPct)} />
        <Stat label="Conversie toegewezen" value={row.basis === "geen" ? "—" : `${pctText(row.conversiePct)} (${row.conversieTeller}/${row.conversieNoemer})`} />
        <Stat label="Commissie" value={row.commissiePct == null ? "onbekend" : `${row.commissiePct}%`} />
        <p className="text-sm text-muted sm:col-span-3">
          Aandeel toegewezen kansen {teamK ? pctText(Math.round((row.toegewezen / teamK) * 1000) / 10) : "—"}. Team zonder deze adviseur {pctText(zonderK ? Math.round((zonderD / zonderK) * 1000) / 10 : null)}. Marge per afspraak staat er niet: projectkosten en inkoop zijn niet volledig. Signaal: {row.signaal}.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => onOpen({ kind: "toegewezen", title: `Kansen ${row.naam}` })}>
          Dossiers
        </Button>
      </CardContent>
    </Card>
  );
}

function ActieLijst({ acties }: { acties: Bundle[] }) {
  if (!acties.length) return <p className="text-sm text-muted">Nog geen vastgelegde managementacties.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {acties.slice(0, 8).map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg bg-wash px-3 py-2">
          <span>
            {a.titel}
            {a.uitgesteld_tot ? <span className="text-muted"> · tot {String(a.uitgesteld_tot).slice(0, 10)}</span> : null}
          </span>
          <Badge>{a.status}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Dossiers({ week, adv, kind, title, onClose }: { week: string; adv: string; kind: string; title: string; onClose: () => void }) {
  const [rows, setRows] = useState<Bundle[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ week, kind, adv });
    void fetch(`/api/sales-cockpit/dossiers?${q}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Mislukt");
        setRows(j.rows || []);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "Mislukt"));
  }, [week, adv, kind]);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>Zelfde berekening als de kaart.</CardDescription>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Sluit</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {err ? <p className="text-rose-700">{err}</p> : null}
        {(rows || []).map((r) => (
          <a key={r.id} href={r.href} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-green-soft">
            <span>
              <span className="font-medium text-green-deeper">{r.leadNumber || r.id.slice(0, 8)}</span>
              <span className="text-muted"> · {r.naam}{r.plaats ? ` · ${r.plaats}` : ""}</span>
            </span>
            <ArrowUpRight className="size-4 text-muted" />
          </a>
        ))}
        {rows && rows.length === 0 ? <p className="text-muted">Geen dossiers in deze selectie.</p> : null}
      </CardContent>
    </Card>
  );
}

const SETTING_LABELS: [string, string][] = [
  ["convIndicatie", "Conversie, indicatie vanaf"],
  ["convStevig", "Conversie, stevige basis vanaf"],
  ["uitvoeringIndicatie", "Uitvoering, indicatie vanaf"],
  ["uitvoeringStevig", "Uitvoering, stevige basis vanaf"],
  ["dealIndicatie", "Aanbetaling en uitval, indicatie vanaf"],
  ["dealStevig", "Aanbetaling en uitval, stevige basis vanaf"],
  ["niveauWeken", "Niveau, afgeronde weken"],
  ["vergelijkWeken", "Vergelijking, weken ervoor"],
  ["trendWeken", "Trend, maximaal weken"],
  ["conversieTrendPp", "Conversieverandering, procentpunten"],
  ["gesprekAfwijkingPp", "Gespreksafwijking, context"],
  ["gesprekOnderzoekPp", "Gespreksafwijking, onderzoeken"],
  ["afboekHerhaling", "Gemiste afboekdagen voor herhaling"],
  ["afboekVensterWeken", "Afboekvenster, weken"],
  ["uitvalPp", "Uitval boven groep, procentpunten"],
  ["uitvalVensterDagen", "Eerste uitvalvenster, dagen"],
  ["dealsVanafWeek", "Sturen op deals vanaf week"],
  ["dealsPerWeek", "Dealtarget vanaf die week"],
  ["beschikbaarMin", "Minimum blokken"],
  ["aanbetalingDagen", "Aanbetalingstermijn, dagen"],
];

function SettingsForm({ settings, version, missing, onSaved }: { settings: Bundle; version: number; missing: boolean; onSaved: () => void; week: string }) {
  const [waarden, setWaarden] = useState<Bundle>(settings || {});
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    const res = await fetch("/api/sales-cockpit/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waarden, expectedVersion: version }),
    });
    const json = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Instellingen bewaard" : json.error || "Mislukt");
    if (res.ok) onSaved();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyse-instellingen</CardTitle>
        <CardDescription>Praktische startregels, los van de vaste bedrijfsnormen.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETTING_LABELS.map(([key, label]) => (
          <label key={key} className="text-xs text-muted">
            {label}
            <input className={inputCls} value={waarden[key] ?? ""} onChange={(e) => setWaarden({ ...waarden, [key]: e.target.value })} />
          </label>
        ))}
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          <Button type="button" size="sm" disabled={missing} onClick={() => void save()}>Bewaar</Button>
          {missing ? <p className="text-xs text-muted">Opslaan wacht op de cockpit-migratie.</p> : null}
          {msg ? <p className="text-xs text-green-deeper">{msg}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function EvalKnop({ week, evaluaties, onSaved }: { week: string; evaluaties: Bundle[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const laatste = evaluaties[0];
  async function save() {
    const res = await fetch("/api/sales-cockpit/evaluations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekKey: week }),
    });
    const json = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Weekbeeld vastgelegd" : json.error || "Mislukt");
    if (res.ok) onSaved();
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Maandagevaluatie</CardTitle>
        <CardDescription>Legt het toen bekende beeld vast. Het live scherm blijft het bijgewerkte resultaat.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Button type="button" size="sm" onClick={() => void save()}>Leg weekbeeld vast</Button>
        {msg ? <p>{msg}</p> : null}
        {laatste ? (
          <button type="button" className="text-sm text-green-deeper underline" onClick={() => setOpen((v) => !v)}>
            {open ? "Toon bijgewerkt resultaat" : `Toon zoals geëvalueerd op ${new Date(laatste.vastgelegd_at).toLocaleString("nl-NL")}`}
          </button>
        ) : (
          <p className="text-muted">Nog geen evaluatie voor deze week.</p>
        )}
        {open && laatste ? <pre className="max-h-64 overflow-auto rounded-xl bg-wash p-3 text-xs">{JSON.stringify(laatste.beeld?.home || laatste.beeld, null, 2)}</pre> : null}
      </CardContent>
    </Card>
  );
}

function Beperkingen({ items }: { items: string[] }) {
  return (
    <Card className="bg-wash">
      <CardHeader>
        <CardTitle>Wat deze cijfers niet bewijzen</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="list-disc space-y-1 pl-4 text-sm text-muted">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
