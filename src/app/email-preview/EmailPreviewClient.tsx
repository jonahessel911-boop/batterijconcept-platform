"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Code2,
  FlaskConical,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Monitor,
  Play,
  RefreshCw,
  Smartphone,
  Sparkles,
  Square,
  Tablet,
  XCircle,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "cn";
import {
  TEST_FLOW_STEPS,
  type TestFlowId,
  type TestFlowStepId,
} from "@/lib/afspraak-opvolging/test-flow-defs";

type SmsPreview = {
  label: string;
  body: string;
};

type SendRule = {
  leadtime: string;
  action: string;
};

type SendExample = {
  leadtime: string;
  send: string;
};

type MailPreview = {
  id: string;
  label: string;
  when: string;
  timing?: string;
  subject?: string;
  html?: string;
  sms?: SmsPreview;
  smsOnly?: boolean;
  rules?: SendRule[];
  examples?: SendExample[];
};

type ViewMode = "mail" | "html";
type PageMode = "ab" | "legacy";
type FlowKey = "intensief" | "rustig" | "legacy";

type FlowMetrics = {
  flow: "intensief" | "rustig";
  label: string;
  ingepland: number;
  openstaand: number;
  geannuleerd: number;
  doorgegaan: number;
  mails_verstuurd: number;
  sms_verstuurd: number;
};

type AbApiResponse = {
  settings: {
    enabled: boolean;
    started_at: string | null;
    updated_at: string | null;
  };
  metrics: {
    intensief: FlowMetrics;
    rustig: FlowMetrics;
    since: string | null;
  };
  sms_configured: boolean;
  error?: string;
};

export function EmailPreviewClient({
  intensiefMails,
  rustigMails,
  legacyMails,
}: {
  intensiefMails: MailPreview[];
  rustigMails: MailPreview[];
  legacyMails: MailPreview[];
}) {
  const [pageMode, setPageMode] = useState<PageMode>("ab");
  const [view, setView] = useState<ViewMode>("mail");
  const [detail, setDetail] = useState<{ flow: FlowKey; id: string } | null>(
    null
  );

  const [ab, setAb] = useState<AbApiResponse | null>(null);
  const [abLoading, setAbLoading] = useState(true);
  const [abBusy, setAbBusy] = useState(false);
  const [abError, setAbError] = useState<string | null>(null);

  const loadAb = useCallback(async () => {
    setAbLoading(true);
    setAbError(null);
    try {
      const res = await fetch("/api/opvolging-ab");
      const json = (await res.json()) as AbApiResponse;
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setAb(json);
    } catch (e) {
      setAbError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setAbLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAb();
  }, [loadAb]);

  async function toggleAb(enabled: boolean) {
    setAbBusy(true);
    setAbError(null);
    try {
      const res = await fetch("/api/opvolging-ab", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const json = (await res.json()) as AbApiResponse;
      if (!res.ok) throw new Error(json.error || "Opslaan mislukt");
      setAb(json);
    } catch (e) {
      setAbError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setAbBusy(false);
    }
  }

  const detailMail = useMemo(() => {
    if (!detail) return null;
    const list =
      detail.flow === "intensief"
        ? intensiefMails
        : detail.flow === "rustig"
          ? rustigMails
          : legacyMails;
    return list.find((m) => m.id === detail.id) ?? null;
  }, [detail, intensiefMails, rustigMails, legacyMails]);

  const enabled = ab?.settings.enabled ?? false;

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-wash text-foreground">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_at_top,_var(--green-soft)_0%,_transparent_65%)]" />

      <header className="relative border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-5 sm:py-5 lg:px-8">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  <FlaskConical data-icon="inline-start" />
                  Admin
                </Badge>
                <Badge variant="outline">A/B opvolging</Badge>
              </div>
              <h1 className="font-display text-xl font-semibold tracking-tight text-green-deeper sm:text-2xl lg:text-3xl">
                Opvolgingsflow
              </h1>
              <p className="max-w-2xl text-sm text-muted-foreground sm:text-[15px]">
                Intensief en rustig naast elkaar. Zelfde trigger als productie:
                direct bij inplannen, follow-ups via de uurlijkse cron.
              </p>
            </div>
            <a
              href="/"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "shrink-0 self-start gap-1.5"
              )}
            >
              <ArrowLeft className="size-3.5" />
              <span className="sm:hidden">CRM</span>
              <span className="hidden sm:inline">Terug naar CRM</span>
            </a>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <Tabs
              value={pageMode}
              onValueChange={(v) => {
                setPageMode(v as PageMode);
                setDetail(null);
              }}
              className="w-full min-w-0 sm:w-auto"
            >
              <TabsList className="h-10 w-full rounded-xl bg-background p-1 ring-1 ring-border/80 sm:w-auto">
                <TabsTrigger
                  value="ab"
                  className="h-8 flex-1 gap-1.5 rounded-lg px-2.5 sm:flex-none sm:px-3 data-active:bg-green-soft data-active:text-green-deeper"
                >
                  <Sparkles className="size-3.5 shrink-0" />
                  <span className="truncate">A/B flows</span>
                </TabsTrigger>
                <TabsTrigger
                  value="legacy"
                  className="h-8 flex-1 gap-1.5 rounded-lg px-2.5 sm:flex-none sm:px-3 data-active:bg-green-soft data-active:text-green-deeper"
                >
                  <History className="size-3.5 shrink-0" />
                  <span className="truncate">Legacy v1</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {detailMail?.html ? (
              <Tabs
                value={view}
                onValueChange={(v) => setView(v as ViewMode)}
                className="w-full min-w-0 sm:w-auto"
              >
                <TabsList className="h-9 w-full rounded-xl sm:w-auto">
                  <TabsTrigger value="mail" className="flex-1 gap-1.5 px-3 sm:flex-none">
                    <Mail className="size-3.5" />
                    Mail
                  </TabsTrigger>
                  <TabsTrigger value="html" className="flex-1 gap-1.5 px-3 sm:flex-none">
                    <Code2 className="size-3.5" />
                    HTML
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            ) : null}
          </div>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-[100rem] px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
        {pageMode === "ab" ? (
          <div className="space-y-4 sm:space-y-6">
            <AbControlCard
              enabled={enabled}
              loading={abLoading}
              busy={abBusy}
              error={abError}
              smsConfigured={ab?.sms_configured}
              startedAt={ab?.settings.started_at}
              onToggle={toggleAb}
              onRefresh={loadAb}
            />

            <FlowTestRunner smsConfigured={ab?.sms_configured} />

            <div
              className={cn(
                "grid w-full min-w-0 gap-4 sm:gap-5",
                detailMail &&
                  "lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]"
              )}
            >
              <div
                className={cn(
                  "grid min-w-0 gap-4 sm:grid-cols-2 sm:gap-5",
                  detailMail && "max-lg:order-2 lg:grid-cols-1 xl:contents"
                )}
              >
                <FlowColumn
                  accent="intensief"
                  title="Intensief"
                  subtitle="Bevestiging · social proof · 48u · avond mail+SMS"
                  icon={<Zap className="size-4" />}
                  mails={intensiefMails}
                  metrics={ab?.metrics.intensief}
                  metricsLoading={abLoading}
                  selectedId={
                    detail?.flow === "intensief" ? detail.id : null
                  }
                  onOpen={(id) => setDetail({ flow: "intensief", id })}
                />
                <FlowColumn
                  accent="rustig"
                  title="Rustig"
                  subtitle="Alleen bevestiging + avond SMS"
                  icon={<CalendarClock className="size-4" />}
                  mails={rustigMails}
                  metrics={ab?.metrics.rustig}
                  metricsLoading={abLoading}
                  selectedId={detail?.flow === "rustig" ? detail.id : null}
                  onOpen={(id) => setDetail({ flow: "rustig", id })}
                />
              </div>
              {detailMail ? (
                <DetailPane
                  badge={
                    detail?.flow === "rustig" ? "Rustig" : "Intensief"
                  }
                  mail={detailMail}
                  view={view}
                  onClose={() => setDetail(null)}
                  className="min-w-0 max-lg:order-1"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "grid w-full min-w-0 gap-4 sm:gap-5",
              detailMail && detail?.flow === "legacy"
                ? "lg:grid-cols-[minmax(0,min(100%,22rem))_minmax(0,1fr)]"
                : "mx-auto max-w-xl"
            )}
          >
            <FlowColumn
              accent="legacy"
              title="Legacy v1"
              subtitle="Productie tot A/B aan staat"
              icon={<History className="size-4" />}
              mails={legacyMails}
              selectedId={detail?.flow === "legacy" ? detail.id : null}
              onOpen={(id) => setDetail({ flow: "legacy", id })}
              className={cn(
                "min-w-0",
                detailMail && detail?.flow === "legacy" && "max-lg:order-2"
              )}
            />
            {detailMail && detail?.flow === "legacy" ? (
              <DetailPane
                badge="Legacy"
                mail={detailMail}
                view={view}
                onClose={() => setDetail(null)}
                className="min-w-0 max-lg:order-1"
              />
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

type TestLogLine = {
  id: string;
  stepId: TestFlowStepId;
  label: string;
  status: "pending" | "sending" | "ok" | "error" | "skipped";
  detail?: string;
};

function FlowTestRunner({ smsConfigured }: { smsConfigured?: boolean }) {
  const [flow, setFlow] = useState<TestFlowId>("intensief");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [voornaam, setVoornaam] = useState("");
  const [intervalSec, setIntervalSec] = useState(15);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<TestLogLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const steps = TEST_FLOW_STEPS[flow];

  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const started = Date.now();
      const tick = () => {
        if (cancelRef.current || Date.now() - started >= ms) {
          resolve();
          return;
        }
        window.setTimeout(tick, 200);
      };
      window.setTimeout(tick, Math.min(200, ms));
    });
  }

  async function runFlow() {
    setError(null);
    cancelRef.current = false;
    setRunning(true);

    const initial: TestLogLine[] = steps.map((s) => ({
      id: `${s.id}-${Date.now()}`,
      stepId: s.id,
      label: s.label,
      status: "pending",
    }));
    setLog(initial);

    try {
      for (let i = 0; i < steps.length; i++) {
        if (cancelRef.current) break;
        const step = steps[i];

        setLog((prev) =>
          prev.map((line, idx) =>
            idx === i ? { ...line, status: "sending" } : line
          )
        );

        const res = await fetch("/api/opvolging-ab/test-flow-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            flow,
            stepId: step.id,
            email: email.trim() || undefined,
            telefoon: telefoon.trim() || undefined,
            voornaam: voornaam.trim() || undefined,
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          label?: string;
          mailOk?: boolean | null;
          smsOk?: boolean | null;
          mailError?: string | null;
          smsError?: string | null;
          error?: string;
        };

        if (cancelRef.current) break;

        if (!res.ok) {
          setLog((prev) =>
            prev.map((line, idx) =>
              idx === i
                ? {
                    ...line,
                    status: "error",
                    detail: json.error || "Stap mislukt",
                  }
                : line
            )
          );
          setError(json.error || "Test gestopt na fout");
          break;
        }

        const parts: string[] = [];
        if (json.mailOk === true) parts.push("mail ok");
        if (json.mailOk === false) parts.push(`mail: ${json.mailError || "fout"}`);
        if (json.smsOk === true) parts.push("sms ok");
        if (json.smsOk === false) parts.push(`sms: ${json.smsError || "fout"}`);

        setLog((prev) =>
          prev.map((line, idx) =>
            idx === i
              ? {
                  ...line,
                  status: json.ok ? "ok" : "error",
                  detail: parts.join(" · ") || undefined,
                }
              : line
          )
        );

        if (!json.ok) {
          setError("Stap deels mislukt — flow gestopt");
          break;
        }

        if (i < steps.length - 1 && !cancelRef.current) {
          await sleep(intervalSec * 1000);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test mislukt");
    } finally {
      setRunning(false);
    }
  }

  function stopFlow() {
    cancelRef.current = true;
    setRunning(false);
  }

  return (
    <Card className="w-full min-w-0 border-border/60 bg-background/95 shadow-sm">
      <CardHeader className="border-b border-border/50 [.border-b]:pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-8 items-center justify-center rounded-lg bg-orange/15 text-orange">
            <Play className="size-4" />
          </span>
          Testflow versturen
        </CardTitle>
        <CardDescription>
          Vul e-mail en/of telefoon in. Alle stappen van de gekozen flow gaan
          achter elkaar met {intervalSec}s pauze. Onderwerp krijgt prefix
          `[TEST …]`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="test-flow">Flow</Label>
            <select
              id="test-flow"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={flow}
              disabled={running}
              onChange={(e) => setFlow(e.target.value as TestFlowId)}
            >
              <option value="intensief">
                Intensief ({TEST_FLOW_STEPS.intensief.length} stappen)
              </option>
              <option value="rustig">
                Rustig ({TEST_FLOW_STEPS.rustig.length} stappen)
              </option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="test-interval">Interval</Label>
            <select
              id="test-interval"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={intervalSec}
              disabled={running}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
            >
              {[10, 15, 20, 30].map((s) => (
                <option key={s} value={s}>
                  {s} seconden
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="test-voornaam">Voornaam (optioneel)</Label>
            <Input
              id="test-voornaam"
              value={voornaam}
              disabled={running}
              placeholder="Jan"
              onChange={(e) => setVoornaam(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <Label htmlFor="test-email">E-mail</Label>
            <Input
              id="test-email"
              type="email"
              value={email}
              disabled={running}
              placeholder="jij@batterijconcept.nl"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-2">
            <Label htmlFor="test-tel">Telefoon</Label>
            <Input
              id="test-tel"
              type="tel"
              value={telefoon}
              disabled={running}
              placeholder="06 12345678"
              onChange={(e) => setTelefoon(e.target.value)}
            />
          </div>
        </div>

        {!smsConfigured ? (
          <Alert>
            <MessageSquare />
            <AlertTitle>SMS mogelijk overgeslagen</AlertTitle>
            <AlertDescription>
              Bird lijkt niet geconfigureerd in deze omgeving. Mails gaan wel;
              SMS faalt tot env vars live zijn.
            </AlertDescription>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Testfout</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {log.length > 0 ? (
          <ol className="space-y-2 rounded-xl border border-border/70 bg-wash/40 p-3">
            {log.map((line, idx) => (
              <li
                key={line.id}
                className="flex min-w-0 items-start gap-2 text-sm"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-[11px] font-semibold ring-1 ring-border">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{line.label}</span>
                    <Badge
                      variant={
                        line.status === "ok"
                          ? "default"
                          : line.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {line.status === "sending"
                        ? "bezig…"
                        : line.status === "pending"
                          ? "wacht"
                          : line.status === "ok"
                            ? "ok"
                            : line.status === "error"
                              ? "fout"
                              : line.status}
                    </Badge>
                  </div>
                  {line.detail ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {line.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {running ? (
          <Button variant="destructive" onClick={stopFlow}>
            <Square className="size-3.5" />
            Stoppen
          </Button>
        ) : (
          <Button
            onClick={() => void runFlow()}
            disabled={!email.trim() || !telefoon.trim()}
          >
            <Play className="size-3.5" />
            Start {flow} test
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          E-mail + telefoon verplicht · {steps.length} stappen · ca.{" "}
          {Math.max(0, (steps.length - 1) * intervalSec)}s wachttijd
        </p>
      </CardFooter>
    </Card>
  );
}

function AbControlCard({
  enabled,
  loading,
  busy,
  error,
  smsConfigured,
  startedAt,
  onToggle,
  onRefresh,
}: {
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  smsConfigured?: boolean;
  startedAt?: string | null;
  onToggle: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <Card className="w-full min-w-0 border-border/60 bg-background/90 shadow-sm ring-1 ring-border/50">
      <CardHeader className="gap-3 border-b border-border/60 [.border-b]:pb-4 sm:gap-1">
        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-green-soft text-green-deeper">
            <FlaskConical className="size-4" />
          </span>
          Feature flag
        </CardTitle>
        <CardDescription className="min-w-0">
          {loading
            ? "Status laden…"
            : enabled
              ? "A/B actief — 50/50 op nieuwe huisbezoeken"
              : "A/B uit — nieuwe afspraken krijgen legacy v1"}
        </CardDescription>
        <CardAction className="col-span-full row-auto mt-1 justify-self-stretch sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || loading}
              onClick={() => onRefresh()}
            >
              {busy || loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Vernieuwen
            </Button>
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-wash/60 px-3 py-1.5">
              <Label
                htmlFor="ab-toggle"
                className="cursor-pointer text-xs text-muted-foreground"
              >
                {enabled ? "Aan" : "Uit"}
              </Label>
              <Switch
                id="ab-toggle"
                checked={enabled}
                disabled={busy || loading}
                onCheckedChange={(checked) => onToggle(Boolean(checked))}
              />
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3 pt-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={enabled ? "default" : "secondary"}>
            {enabled ? (
              <>
                <CheckCircle2 data-icon="inline-start" />
                Live A/B
              </>
            ) : (
              <>
                <XCircle data-icon="inline-start" />
                Niet actief
              </>
            )}
          </Badge>
          <Badge variant={smsConfigured ? "outline" : "destructive"}>
            <MessageSquare data-icon="inline-start" />
            {smsConfigured ? "Bird SMS klaar" : "Bird SMS ontbreekt"}
          </Badge>
          {startedAt ? (
            <Badge variant="outline" className="max-w-full truncate">
              Gestart{" "}
              {new Date(startedAt).toLocaleString("nl-NL", {
                timeZone: "Europe/Amsterdam",
              })}
            </Badge>
          ) : null}
        </div>
        <p className="break-words text-sm text-muted-foreground">
          Trigger blijft `planAfspraak` (direct) + cron
          `/api/cron/afspraak-herinneringen` voor follow-ups. Mails gaan ook
          zonder Bird; SMS wacht op configuratie.
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Fout</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {!loading && !smsConfigured ? (
          <Alert>
            <MessageSquare />
            <AlertTitle>SMS nog niet live</AlertTitle>
            <AlertDescription>
              Zet `BIRD_API_KEY` en `BIRD_SMS_FROM` (en eventueel
              channel/workspace) in Vercel. Tot die tijd tellen SMS-flags als
              nog niet verstuurd.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MetricsGrid({
  metrics,
  loading,
}: {
  metrics?: FlowMetrics;
  loading?: boolean;
}) {
  if (loading && !metrics) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }
  if (!metrics) return null;

  const cells = [
    { label: "Ingepland", value: metrics.ingepland },
    { label: "Open", value: metrics.openstaand },
    { label: "Doorgegaan", value: metrics.doorgegaan },
    { label: "Geannuleerd", value: metrics.geannuleerd },
    { label: "Mails", value: metrics.mails_verstuurd },
    { label: "SMS", value: metrics.sms_verstuurd },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {cells.map((c) => (
        <div
          key={c.label}
          className="min-w-0 rounded-lg border border-border/70 bg-wash/70 px-1.5 py-2 text-center sm:px-2"
        >
          <p className="text-base font-semibold tabular-nums tracking-tight text-green-deeper sm:text-lg">
            {c.value}
          </p>
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {c.label}
          </p>
        </div>
      ))}
    </div>
  );
}

function FlowColumn({
  accent,
  title,
  subtitle,
  icon,
  mails,
  metrics,
  metricsLoading,
  selectedId,
  onOpen,
  className,
}: {
  accent: FlowKey;
  title: string;
  subtitle: string;
  icon: ReactNode;
  mails: MailPreview[];
  metrics?: FlowMetrics;
  metricsLoading?: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
  className?: string;
}) {
  const accentClass =
    accent === "intensief"
      ? "bg-orange/15 text-orange"
      : accent === "rustig"
        ? "bg-green-soft text-green-deeper"
        : "bg-wash text-muted-foreground";

  return (
    <Card
      className={cn(
        "h-full min-w-0 border-border/60 bg-background/95 shadow-sm",
        className
      )}
    >
      <CardHeader className="border-b border-border/50 [.border-b]:pb-4">
        <CardTitle className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              accentClass
            )}
          >
            {icon}
          </span>
          <span className="truncate">{title}</span>
        </CardTitle>
        <CardDescription className="line-clamp-2">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 pt-4">
        {accent !== "legacy" ? (
          <MetricsGrid metrics={metrics} loading={metricsLoading} />
        ) : null}

        <ol className="relative space-y-3">
          {mails.map((mail, index) => {
            const channels = channelLabels(mail);
            const selected = mail.id === selectedId;
            const isLast = index === mails.length - 1;
            return (
              <li key={mail.id} className="relative flex min-w-0 gap-2 sm:gap-3">
                {!isLast ? (
                  <div
                    className="absolute bottom-0 left-[13px] top-9 w-px bg-border sm:left-[15px]"
                    aria-hidden
                  />
                ) : null}
                <div
                  className={cn(
                    "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors sm:size-8",
                    selected
                      ? "border-green-deeper bg-green-deeper text-white"
                      : "border-green-deeper/40 bg-background text-green-deeper"
                  )}
                >
                  {index + 1}
                </div>
                <button
                  type="button"
                  onClick={() => onOpen(mail.id)}
                  className={cn(
                    "min-w-0 flex-1 rounded-xl border bg-card p-2.5 text-left transition-all sm:p-3",
                    selected
                      ? "border-green-deeper/40 shadow-sm ring-2 ring-green-soft"
                      : "border-border/70 hover:border-green-deeper/30 hover:bg-wash/40"
                  )}
                >
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-orange">
                        {mail.timing ?? mail.when}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                        {mail.label}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {channels.map((ch) => (
                        <Badge
                          key={ch}
                          variant={ch === "SMS" ? "secondary" : "outline"}
                          className={
                            ch === "SMS"
                              ? "bg-orange/15 text-orange hover:bg-orange/20"
                              : undefined
                          }
                        >
                          {ch === "SMS" ? (
                            <MessageSquare data-icon="inline-start" />
                          ) : (
                            <Mail data-icon="inline-start" />
                          )}
                          {ch}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {mail.when}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
      </CardContent>
      <CardFooter className="justify-between gap-2 text-xs text-muted-foreground">
        <span className="shrink-0">
          {mails.length} stap{mails.length === 1 ? "" : "pen"}
        </span>
        <span className="truncate">Klik voor detail</span>
      </CardFooter>
    </Card>
  );
}

const PREVIEW_DEVICES = [
  { id: "desktop", label: "Desktop", width: 600, icon: Monitor },
  { id: "tablet", label: "Tablet", width: 768, icon: Tablet },
  { id: "phone", label: "Telefoon", width: 390, icon: Smartphone },
  { id: "small", label: "Klein", width: 320, icon: Smartphone },
] as const;

type PreviewDeviceId = (typeof PREVIEW_DEVICES)[number]["id"];

function DetailPane({
  badge,
  mail,
  view,
  onClose,
  className,
}: {
  badge: string;
  mail: MailPreview;
  view: ViewMode;
  onClose: () => void;
  className?: string;
}) {
  const [device, setDevice] = useState<PreviewDeviceId>("desktop");
  const previewHtml = mail.html
    ? rewritePreviewCalendarLinks(mail.html)
    : undefined;
  const deviceMeta =
    PREVIEW_DEVICES.find((d) => d.id === device) ?? PREVIEW_DEVICES[0];
  // Frame-breedte = device; iframe 100% daarbinnen triggert @media op echte breedte
  const frameWidth =
    device === "tablet" || device === "desktop" ? 600 : deviceMeta.width;

  return (
    <Card
      className={cn(
        "min-w-0 border-border/60 bg-background shadow-md lg:sticky lg:top-4 lg:self-start",
        className
      )}
    >
      <CardHeader className="gap-2 border-b border-border/50 [.border-b]:pb-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 pr-16 sm:pr-0">
          <Badge className="shrink-0">{badge}</Badge>
          <CardTitle className="min-w-0 truncate text-base">
            {mail.label}
          </CardTitle>
        </div>
        <CardDescription className="line-clamp-3 sm:line-clamp-none">
          {mail.when}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Sluiten
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3 pt-4">
        {mail.subject ? (
          <div className="rounded-lg border border-border/70 bg-wash/50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Onderwerp
            </p>
            <p className="mt-0.5 break-words text-sm font-medium">
              {mail.subject}
            </p>
          </div>
        ) : null}

        {mail.rules?.length ? (
          <div className="rounded-lg border border-border/70 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-green-deeper">
              Verzendregels
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {mail.rules.map((r) => (
                <li key={r.leadtime} className="break-words">
                  <span className="font-medium text-foreground">
                    {r.leadtime}:
                  </span>{" "}
                  {r.action}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mail.sms ? (
          <SmsCard sms={mail.sms} simultaneous={!mail.smsOnly} />
        ) : null}

        {previewHtml ? (
          <>
            <Separator />
            {view === "mail" ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Schermformaat
                  </p>
                  <div
                    className="inline-flex w-full flex-wrap gap-1 rounded-lg border border-border/70 bg-wash/60 p-1 sm:w-auto"
                    role="group"
                    aria-label="Preview breedte"
                  >
                    {PREVIEW_DEVICES.map((d) => {
                      const Icon = d.icon;
                      const active = device === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDevice(d.id)}
                          className={cn(
                            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:flex-none",
                            active
                              ? "bg-background text-green-deeper shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Icon className="size-3.5 shrink-0" />
                          <span>{d.label}</span>
                          <span className="tabular-nums opacity-60">
                            {d.width}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="w-full min-w-0 overflow-x-auto rounded-xl border border-border/80 bg-[#e8e4de] p-3 sm:p-4">
                  <div
                    className="mx-auto overflow-hidden rounded-lg border border-border/60 bg-[#f2ede8] shadow-sm transition-[width] duration-200"
                    style={{ width: `min(100%, ${frameWidth}px)` }}
                  >
                    <div className="flex items-center justify-between border-b border-border/50 bg-background/80 px-3 py-1.5">
                      <p className="text-[11px] font-medium text-muted-foreground">
                        {deviceMeta.label} · {frameWidth}px
                      </p>
                    </div>
                    <iframe
                      key={`${mail.id}-${device}-${frameWidth}`}
                      title={`${badge}: ${mail.subject ?? mail.label}`}
                      sandbox="allow-popups allow-popups-to-escape-sandbox allow-downloads"
                      srcDoc={previewHtml}
                      className="block h-[min(65vh,720px)] w-full border-0 bg-[#f2ede8] sm:h-[min(70vh,820px)]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
                <pre className="h-[min(65vh,720px)] max-w-full overflow-auto bg-charcoal p-3 text-[11px] leading-5 text-green-soft sm:h-[min(70vh,820px)] sm:p-4 sm:text-[12px]">
                  <code className="break-all whitespace-pre-wrap">
                    {previewHtml}
                  </code>
                </pre>
              </div>
            )}
          </>
        ) : mail.smsOnly ? (
          <div className="rounded-xl border border-dashed border-border bg-wash/40 px-4 py-8 text-center text-sm text-muted-foreground">
            Geen mail bij deze stap — alleen SMS.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SmsCard({
  sms,
  simultaneous,
}: {
  sms: SmsPreview;
  simultaneous?: boolean;
}) {
  const calendarHref = previewCalendarHref();
  const lines = sms.body.split("\n").map((line) =>
    line.includes("/calendar") || line.includes("/agenda")
      ? calendarHref
      : line
  );
  const charCount = sms.body.replace(/\n/g, "").length;

  return (
    <div className="min-w-0 rounded-xl border border-orange/25 bg-orange/[0.04] p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge className="bg-orange text-white hover:bg-orange/90">
          <MessageSquare data-icon="inline-start" />
          SMS
        </Badge>
        <span className="min-w-0 truncate text-sm font-medium">{sms.label}</span>
      </div>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-orange">
        {simultaneous
          ? "Versturen tegelijk met de mail"
          : "Alleen SMS · geen mail"}
      </p>
      <div className="mt-3 w-full max-w-full rounded-2xl rounded-bl-md bg-green-soft/80 px-3 py-3 text-sm leading-6 text-green-deeper shadow-sm sm:max-w-[22rem] sm:px-4 sm:text-[15px]">
        {lines.map((line, i) =>
          line === "" ? (
            <div key={`gap-${i}`} className="h-1" aria-hidden />
          ) : (
            <p key={`${i}-${line.slice(0, 24)}`} className="break-all">
              {line}
            </p>
          )
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {charCount} tekens
      </p>
    </div>
  );
}

function channelLabels(mail: MailPreview) {
  if (mail.smsOnly) return ["SMS"];
  if (mail.sms && mail.html) return ["Mail", "SMS"];
  if (mail.html) return ["Mail"];
  if (mail.sms) return ["SMS"];
  return [];
}

function previewCalendarHref(): string {
  if (typeof window === "undefined") return "/email-preview/agenda";
  return `${window.location.origin}/email-preview/agenda`;
}

function rewritePreviewCalendarLinks(html: string): string {
  const href = previewCalendarHref();
  return html.replace(
    /href="[^"]*(?:\/calendar|\/agenda)[^"]*"/gi,
    `href="${href}" target="_blank" rel="noopener noreferrer"`
  );
}
