"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  LogOut,
  Plus,
  Receipt,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";
import type { PartnerCreditFactuur, Project } from "@/types/database";
import { formatDateShort, formatEuro } from "@/lib/format";
import { RELATIE_BTW_PCT } from "@/lib/relatie-btw";
import { Planbord } from "@/components/crm/Planbord";
import { PartnerTeamgenotenPanel } from "@/components/installatie/PartnerTeamgenotenPanel";
import { PartnerInstallatiesPanel } from "@/components/installatie/PartnerInstallatiesPanel";
import { MonteurEigenProfielPanel } from "@/components/installatie/MonteurEigenProfielPanel";
import { PartnerVerwachtingPanel } from "@/components/installatie/PartnerVerwachtingPanel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type OrderRow = Project & {
  leads?: Project["leads"];
};

type PortalTab =
  | "agenda"
  | "facturen"
  | "team"
  | "profiel"
  | "verwachting"
  | "installaties";
type PortalRole = "partner" | "teamgenoot";

type FactuurRow = Pick<
  PartnerCreditFactuur,
  | "id"
  | "factuur_nummer"
  | "status"
  | "week_jaar"
  | "week_nummer"
  | "periode_van"
  | "periode_tot"
  | "omschrijving"
  | "offerte_nummer"
  | "project_nummer"
  | "bedrag_ex_btw"
  | "btw_bedrag"
  | "bedrag_inc_btw"
  | "factuurdatum"
  | "betaald_op"
  | "goedgekeurd_op"
>;

type DraftRegel = { omschrijving: string; bedrag: string };

const ALL_NAV: { id: PortalTab; label: string; icon: LucideIcon }[] = [
  { id: "agenda", label: "Agenda", icon: CalendarDays },
  { id: "verwachting", label: "Pipeline", icon: TrendingUp },
  { id: "installaties", label: "Installaties", icon: ClipboardList },
  { id: "team", label: "Team", icon: Users },
  { id: "facturen", label: "Facturen", icon: Receipt },
  { id: "profiel", label: "Profiel", icon: UserRound },
];

function factuurStatusLabel(f: FactuurRow): {
  label: string;
  tone: "ok" | "wait" | "muted";
} {
  if (f.status === "betaald") return { label: "Betaald", tone: "ok" };
  if (f.status === "goedgekeurd") return { label: "Ingediend · te betalen", tone: "ok" };
  if (f.status === "verzonden") return { label: "Te goedkeuren", tone: "wait" };
  if (f.status === "concept") return { label: "Concept", tone: "muted" };
  return { label: f.status, tone: "muted" };
}

function emptyRegel(): DraftRegel {
  return { omschrijving: "", bedrag: "" };
}

export function InstallatieOrdersPage({
  apiToken: apiTokenProp,
}: {
  /** "session" voor cookie-login, of legacy URL-token. */
  apiToken?: string;
} = {}) {
  const params = useParams<{ token?: string }>();
  const router = useRouter();
  const urlToken = params?.token;
  const [apiToken, setApiToken] = useState(
    () => apiTokenProp || urlToken || "session"
  );

  const [tab, setTab] = useState<PortalTab>(() => {
    if (typeof window === "undefined") return "agenda";
    const q = new URLSearchParams(window.location.search).get("tab");
    return q === "team" ||
      q === "facturen" ||
      q === "agenda" ||
      q === "profiel" ||
      q === "verwachting" ||
      q === "installaties"
      ? q
      : "agenda";
  });
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [partnerNaam, setPartnerNaam] = useState("");
  const [portalRole, setPortalRole] = useState<PortalRole>("partner");
  const [viewerNaam, setViewerNaam] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [allowedTabs, setAllowedTabs] = useState<PortalTab[]>(["agenda"]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [facturen, setFacturen] = useState<FactuurRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [facturenLoading, setFacturenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [regels, setRegels] = useState<DraftRegel[]>([emptyRegel()]);
  const [projectNummer, setProjectNummer] = useState("");
  const [creating, setCreating] = useState(false);
  const [heeftKvk, setHeeftKvk] = useState(true);

  const nav = useMemo(
    () =>
      sessionReady
        ? ALL_NAV.filter((item) => allowedTabs.includes(item.id))
        : [],
    [allowedTabs, sessionReady]
  );

  const draftTotals = useMemo(() => {
    const ex = regels.reduce((s, r) => {
      const n = Number(String(r.bedrag).replace(",", "."));
      return s + (Number.isFinite(n) && n > 0 ? n : 0);
    }, 0);
    const btw = Math.round(ex * RELATIE_BTW_PCT * 100) / 100;
    const inc = Math.round((ex + btw) * 100) / 100;
    return { ex, btw, inc };
  }, [regels]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/installatie/${encodeURIComponent(apiToken)}`);
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        partner?: { id?: string; naam?: string };
        api_token?: string;
        role?: string;
        teamgenoot?: { naam?: string };
        viewer_naam?: string;
        tabs?: unknown;
        orders?: OrderRow[];
      } | null;
      if (!data || typeof data !== "object") {
        throw new Error(
          res.ok
            ? "Portaal-antwoord ongeldig"
            : `Portaal laden mislukt (${res.status})`
        );
      }
      if (res.status === 401 || res.status === 404) {
        setSessionReady(false);
        setAllowedTabs(["agenda"]);
        // Alleen cookie-sessie → login; token-URL blijft token-gebaseerd
        if (apiToken === "session") {
          router.replace("/installatie/login");
          return;
        }
        setError(data.error || "Portaal niet gevonden");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Niet gevonden");
      setPartnerId(data.partner?.id || null);
      setPartnerNaam(data.partner?.naam || "");
      if (
        typeof data.api_token === "string" &&
        data.api_token.length >= 16 &&
        data.api_token !== apiToken
      ) {
        setApiToken(data.api_token);
      }
      const role: PortalRole =
        data.role === "teamgenoot" ? "teamgenoot" : "partner";
      setPortalRole(role);
      setViewerNaam(
        (typeof data.teamgenoot?.naam === "string" &&
        data.teamgenoot.naam.trim()
          ? data.teamgenoot.naam.trim()
          : null) ||
          (typeof data.viewer_naam === "string" && data.viewer_naam.trim()
            ? data.viewer_naam.trim()
            : null) ||
          null
      );
      const tabs = Array.isArray(data.tabs)
        ? (data.tabs as PortalTab[]).filter(
            (t): t is PortalTab =>
              t === "agenda" ||
              t === "team" ||
              t === "facturen" ||
              t === "profiel" ||
              t === "verwachting" ||
              t === "installaties"
          )
        : role === "teamgenoot"
          ? (["agenda", "profiel"] as PortalTab[])
          : ([
              "agenda",
              "verwachting",
              "installaties",
              "team",
              "facturen",
            ] as PortalTab[]);
      setAllowedTabs(tabs);
      setOrders(data.orders || []);
      setSessionReady(true);
    } catch (e) {
      setSessionReady(false);
      setAllowedTabs(["agenda"]);
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
    }
  }, [apiToken, router]);

  const loadFacturen = useCallback(async () => {
    setFacturenLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(apiToken)}/facturen`
      );
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        partner?: { naam?: string; heeft_kvk?: boolean };
        facturen?: FactuurRow[];
      } | null;
      if (!data || typeof data !== "object") {
        throw new Error(
          res.ok
            ? "Facturen-antwoord ongeldig"
            : `Facturen laden mislukt (${res.status})`
        );
      }
      if (!res.ok) throw new Error(data.error || "Facturen laden mislukt");
      if (data.partner?.naam) setPartnerNaam(data.partner.naam);
      setFacturen((data.facturen || []) as FactuurRow[]);
      if (typeof data.partner?.heeft_kvk === "boolean") {
        setHeeftKvk(data.partner.heeft_kvk);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setFacturenLoading(false);
    }
  }, [apiToken]);

  async function logout() {
    await fetch("/api/installatie/auth/login", { method: "DELETE" });
    router.replace("/installatie/login");
  }

  useEffect(() => {
    const id = requestAnimationFrame(() => void loadOrders());
    return () => cancelAnimationFrame(id);
  }, [loadOrders]);

  useEffect(() => {
    if (tab === "facturen" && portalRole === "partner") void loadFacturen();
  }, [tab, loadFacturen, portalRole]);

  useEffect(() => {
    if (!allowedTabs.includes(tab)) setTab("agenda");
  }, [allowedTabs, tab]);

  async function downloadPdf(id: string, nummer: string) {
    setPdfBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(apiToken)}/facturen/${id}/pdf`
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error || "PDF download mislukt"
        );
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${nummer}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download mislukt");
    } finally {
      setPdfBusy(null);
    }
  }

  async function goedkeuren(id: string) {
    setApproveBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(apiToken)}/facturen/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "goedkeuren" }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Goedkeuren mislukt");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Goedkeuren mislukt");
    } finally {
      setApproveBusy(null);
    }
  }

  async function verstuurConcept(id: string) {
    setApproveBusy(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(apiToken)}/facturen/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "versturen" }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setApproveBusy(null);
    }
  }

  async function createFactuur(verstuur: boolean) {
    setCreating(true);
    setError(null);
    try {
      const payloadRegels = regels
        .map((r) => ({
          omschrijving: r.omschrijving.trim(),
          bedrag_ex_btw: Number(String(r.bedrag).replace(",", ".")),
          project_nummer: projectNummer.trim() || null,
        }))
        .filter(
          (r) =>
            r.omschrijving &&
            Number.isFinite(r.bedrag_ex_btw) &&
            r.bedrag_ex_btw > 0
        );
      if (payloadRegels.length === 0) {
        throw new Error(
          "Voeg minstens één regel toe met omschrijving en bedrag."
        );
      }
      const res = await fetch(
        `/api/installatie/${encodeURIComponent(apiToken)}/facturen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            regels: payloadRegels,
            project_nummer: projectNummer.trim() || undefined,
            verstuur,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Aanmaken mislukt");
      setShowCreate(false);
      setRegels([emptyRegel()]);
      setProjectNummer("");
      await loadFacturen();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  const projectOptions = useMemo(() => {
    const nums = new Set<string>();
    for (const o of orders) {
      if (o.project_nummer) nums.add(o.project_nummer);
    }
    return [...nums].sort();
  }, [orders]);

  return (
    <div className="min-h-screen bg-wash">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-[12px] font-semibold tracking-[0.06em] text-green-deeper">
                Batterij<span className="text-orange">concept</span>
              </p>
              <h1 className="mt-1 font-display text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                {viewerNaam
                  ? `Welkom, ${viewerNaam.split(/\s+/)[0]}`
                  : "Welkom"}
              </h1>
            </div>
            {sessionReady ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => void logout()}
              >
                <LogOut data-icon="inline-start" />
                Uitloggen
              </Button>
            ) : null}
          </div>

          {sessionReady && nav.length > 0 ? (
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as PortalTab)}
              className="pb-3"
            >
              <div className="-mx-4 overflow-x-auto px-4 sm:-mx-0 sm:px-0">
                <TabsList
                  variant="default"
                  className="h-11 w-max min-w-full justify-start gap-1 rounded-xl bg-[#F3F5F4] p-1 sm:w-auto sm:min-w-0"
                >
                  {nav.map((item) => {
                    const Icon = item.icon;
                    return (
                      <TabsTrigger
                        key={item.id}
                        value={item.id}
                        className={cn(
                          "h-9 gap-2 rounded-lg px-3.5 text-[13px] font-semibold",
                          "data-active:bg-white data-active:text-green-deeper data-active:shadow-sm",
                          "text-muted hover:text-ink"
                        )}
                      >
                        <Icon className="size-3.5 opacity-70" aria-hidden />
                        {item.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
            </Tabs>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <Alert variant="destructive" className="mb-5">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {tab === "team" && portalRole === "partner" ? (
          <PartnerTeamgenotenPanel portalToken={apiToken} />
        ) : tab === "installaties" && portalRole === "partner" ? (
          <PartnerInstallatiesPanel
            portalToken={apiToken}
            authorNaam={viewerNaam || partnerNaam}
          />
        ) : tab === "verwachting" && portalRole === "partner" ? (
          <PartnerVerwachtingPanel portalToken={apiToken} />
        ) : tab === "profiel" ? (
          <MonteurEigenProfielPanel portalToken={apiToken} />
        ) : tab === "agenda" ? (
          loading ? (
            <p className="py-20 text-center text-sm text-muted">
              Agenda laden…
            </p>
          ) : (
            <Planbord
              projecten={orders}
              variant="portal"
              portalToken={apiToken}
              title={
                portalRole === "teamgenoot" ? "Mijn agenda" : "Agenda"
              }
              afblokPartnerId={partnerId}
              showTeamAgendaFilters={portalRole === "partner"}
              projectHref={(id) =>
                apiToken === "session" || apiTokenProp === "session"
                  ? `/installatie/orders/${id}`
                  : `/installatie/${encodeURIComponent(apiToken)}/orders/${id}`
              }
            />
          )
        ) : portalRole !== "partner" ? (
          <p className="py-20 text-center text-sm text-muted">
            Geen toegang tot facturen.
          </p>
        ) : facturenLoading ? (
          <p className="py-20 text-center text-sm text-muted">
            Facturen laden…
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  Facturen
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  Selfbilling met 21% btw · dien zelf regels in of keur
                  weekfacturen goed
                </p>
              </div>
              <Button
                type="button"
                variant={showCreate ? "outline" : "default"}
                onClick={() => setShowCreate((v) => !v)}
              >
                {showCreate ? null : <Plus data-icon="inline-start" />}
                {showCreate ? "Sluiten" : "Nieuwe factuur"}
              </Button>
            </div>

            {showCreate ? (
              <Card className="shadow-xs">
                <CardHeader className="border-b [.border-b]:pb-3">
                  <CardTitle className="text-base">Nieuwe factuur</CardTitle>
                  <CardDescription>
                    Voeg vrije regels toe (meterkast, materiaal, meerwerk, …).
                    Bedragen excl. btw — er komt 21% btw overheen.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  {!heeftKvk ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        Vul eerst bedrijfsnaam, KvK en IBAN in via Team /
                        Batterijconcept voordat je kunt factureren.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                  <div className="space-y-1.5">
                    <Label htmlFor="factuur-project">Project (optioneel)</Label>
                    <NativeSelect
                      id="factuur-project"
                      value={projectNummer}
                      onChange={(e) => setProjectNummer(e.target.value)}
                      className="max-w-md"
                    >
                      <NativeSelectOption value="">
                        Geen projectkoppeling
                      </NativeSelectOption>
                      {projectOptions.map((n) => (
                        <NativeSelectOption key={n} value={n}>
                          {n}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-2">
                    {regels.map((r, idx) => (
                      <div
                        key={idx}
                        className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
                      >
                        <Input
                          type="text"
                          placeholder="Omschrijving (bijv. Meterkast)"
                          value={r.omschrijving}
                          onChange={(e) =>
                            setRegels((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, omschrijving: e.target.value }
                                  : x
                              )
                            )
                          }
                        />
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="€ excl."
                          value={r.bedrag}
                          onChange={(e) =>
                            setRegels((prev) =>
                              prev.map((x, i) =>
                                i === idx
                                  ? { ...x, bedrag: e.target.value }
                                  : x
                              )
                            )
                          }
                          className="tabular-nums"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={regels.length <= 1}
                          onClick={() =>
                            setRegels((prev) =>
                              prev.filter((_, i) => i !== idx)
                            )
                          }
                        >
                          Weg
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto px-0"
                      onClick={() =>
                        setRegels((prev) => [...prev, emptyRegel()])
                      }
                    >
                      + Regel toevoegen
                    </Button>
                  </div>
                  <div className="rounded-lg border border-line bg-wash px-4 py-3 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">Excl. btw</span>
                      <span className="font-semibold tabular-nums">
                        {formatEuro(draftTotals.ex)}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-muted">BTW 21%</span>
                      <span className="tabular-nums">
                        {formatEuro(draftTotals.btw)}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1">
                      <span className="font-medium text-ink">Incl. btw</span>
                      <span className="font-semibold tabular-nums text-green-deeper">
                        {formatEuro(draftTotals.inc)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={creating || !heeftKvk}
                      onClick={() => void createFactuur(false)}
                    >
                      {creating ? "Bezig…" : "Opslaan als concept"}
                    </Button>
                    <Button
                      type="button"
                      disabled={creating || !heeftKvk}
                      onClick={() => void createFactuur(true)}
                    >
                      {creating ? "Bezig…" : "Versturen naar Batterijconcept"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {facturen.length === 0 ? (
              <Card className="shadow-xs">
                <CardContent className="px-6 py-16 text-center">
                  <p className="font-display text-lg font-semibold text-ink">
                    Nog geen facturen
                  </p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                    Maak een selfbilling-factuur met vrije regels, of wacht op
                    weekfacturen van Batterijconcept.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-xs overflow-hidden p-0">
                <ul className="divide-y divide-line">
                  {facturen.map((f) => {
                    const st = factuurStatusLabel(f);
                    const omschrijving =
                      [
                        f.omschrijving ||
                          (f.week_nummer != null
                            ? `Week ${f.week_nummer}`
                            : null),
                        f.project_nummer ? f.project_nummer : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—";
                    return (
                      <li
                        key={f.id}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="text-sm font-semibold tabular-nums text-ink">
                              {f.factuur_nummer}
                            </p>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "rounded-full text-[11px] font-semibold",
                                st.tone === "ok" &&
                                  "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
                                st.tone === "wait" &&
                                  "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
                                st.tone === "muted" &&
                                  "border border-line bg-wash text-muted"
                              )}
                            >
                              {st.label}
                              {f.goedgekeurd_op
                                ? ` · ${formatDateShort(f.goedgekeurd_op)}`
                                : ""}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-[12px] leading-snug text-muted">
                            {formatDateShort(f.factuurdatum)} · {omschrijving}
                            {f.btw_bedrag != null
                              ? ` · btw ${formatEuro(f.btw_bedrag)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <p className="text-sm font-semibold tabular-nums text-ink">
                            {formatEuro(f.bedrag_inc_btw)}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled={pdfBusy === f.id}
                            onClick={() =>
                              void downloadPdf(f.id, f.factuur_nummer)
                            }
                          >
                            {pdfBusy === f.id ? "…" : "PDF"}
                          </Button>
                          {f.status === "concept" ? (
                            <Button
                              type="button"
                              size="xs"
                              disabled={approveBusy === f.id}
                              onClick={() => void verstuurConcept(f.id)}
                            >
                              {approveBusy === f.id ? "…" : "Versturen"}
                            </Button>
                          ) : null}
                          {f.status === "verzonden" ? (
                            <Button
                              type="button"
                              size="xs"
                              disabled={approveBusy === f.id}
                              onClick={() => void goedkeuren(f.id)}
                            >
                              {approveBusy === f.id ? "…" : "Goedkeuren"}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
