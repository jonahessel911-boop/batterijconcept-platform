"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  OPVOLGING_BERICHT_STEP_LABELS,
  OPVOLGING_BERICHT_STEPS,
  type OpvolgingBerichtStep,
} from "@/lib/afspraak-opvolging/log-bericht";
import { formatDateTimeNl } from "@/lib/format";
import { cn } from "cn";

type BerichtRow = {
  id: string;
  created_at: string;
  afspraak_id: string | null;
  lead_id: string | null;
  opvolging_flow: string | null;
  step: OpvolgingBerichtStep | string;
  channel: "email" | "sms" | string;
  status: "sent" | "failed" | "skipped" | string;
  klant_naam: string | null;
  to_email: string | null;
  to_phone: string | null;
  subject: string | null;
  body_preview: string | null;
  provider: string | null;
  provider_message_id: string | null;
  tag: string | null;
  error: string | null;
};

type ApiResponse = {
  items: BerichtRow[];
  total: number;
  limit: number;
  offset: number;
  missing_table?: boolean;
  error?: string;
};

const ALL = "__all__";

function statusBadge(status: string) {
  if (status === "sent") {
    return (
      <Badge className="bg-green-soft text-green-deeper hover:bg-green-soft">
        Verstuurd
      </Badge>
    );
  }
  if (status === "failed") {
    return <Badge variant="destructive">Mislukt</Badge>;
  }
  if (status === "skipped") {
    return <Badge variant="secondary">Overgeslagen</Badge>;
  }
  return <Badge variant="outline">{status}</Badge>;
}

function stepLabel(step: string): string {
  if (step in OPVOLGING_BERICHT_STEP_LABELS) {
    return OPVOLGING_BERICHT_STEP_LABELS[step as OpvolgingBerichtStep];
  }
  return step;
}

export function OpvolgingBerichtenPanel() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [channel, setChannel] = useState(ALL);
  const [step, setStep] = useState(ALL);
  const [flow, setFlow] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const limit = 50;

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setOffset(0);
  }, [qDebounced, channel, step, flow, status, from, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("limit", String(limit));
      sp.set("offset", String(offset));
      if (qDebounced) sp.set("q", qDebounced);
      if (channel !== ALL) sp.set("channel", channel);
      if (step !== ALL) sp.set("step", step);
      if (flow !== ALL) sp.set("flow", flow);
      if (status !== ALL) sp.set("status", status);
      if (from) sp.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) sp.set("to", new Date(`${to}T23:59:59.999`).toISOString());

      const res = await fetch(`/api/opvolging-ab/berichten?${sp}`);
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [qDebounced, channel, step, flow, status, from, to, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageEnd = Math.min(offset + limit, total);
  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-background/95 shadow-sm">
        <CardHeader className="border-b border-border/50 [.border-b]:pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-lg">Berichtenlog</CardTitle>
              <CardDescription>
                Alle verstuurde (en mislukte) mails en SMS uit de
                opvolgingsflow. Filter op klant, kanaal, stap of periode.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
              className="gap-1.5"
            >
              {loading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Vernieuwen
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
              <Label htmlFor="berichten-q">Klant</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="berichten-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Naam, e-mail of telefoon…"
                  className="pl-8"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Kanaal</Label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v ?? ALL)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Alles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alles</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Stap</Label>
              <Select value={step} onValueChange={(v) => setStep(v ?? ALL)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Alles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alles</SelectItem>
                  {OPVOLGING_BERICHT_STEPS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {OPVOLGING_BERICHT_STEP_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Flow</Label>
              <Select value={flow} onValueChange={(v) => setFlow(v ?? ALL)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Alles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alles</SelectItem>
                  <SelectItem value="intensief">Intensief</SelectItem>
                  <SelectItem value="rustig">Rustig</SelectItem>
                  <SelectItem value="legacy">Legacy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v ?? ALL)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Alles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Alles</SelectItem>
                  <SelectItem value="sent">Verstuurd</SelectItem>
                  <SelectItem value="failed">Mislukt</SelectItem>
                  <SelectItem value="skipped">Overgeslagen</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="berichten-from">Van</Label>
              <Input
                id="berichten-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="berichten-to">Tot</Label>
              <Input
                id="berichten-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>

          {data?.missing_table ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Tabel nog niet aangemaakt. Draai{" "}
              <code className="text-xs">
                migrate-afspraak-opvolging-berichten.sql
              </code>{" "}
              in Supabase.
            </p>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {loading && !data
                ? "Laden…"
                : total === 0
                  ? "Geen berichten"
                  : `${offset + 1}–${pageEnd} van ${total}`}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canPrev || loading}
                onClick={() => setOffset((o) => Math.max(0, o - limit))}
              >
                Vorige
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canNext || loading}
                onClick={() => setOffset((o) => o + limit)}
              >
                Volgende
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border/70">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-wash/80 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5">Tijd</th>
                  <th className="px-3 py-2.5">Klant</th>
                  <th className="px-3 py-2.5">Kanaal</th>
                  <th className="px-3 py-2.5">Stap</th>
                  <th className="px-3 py-2.5">Flow</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Onderwerp / inhoud</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td colSpan={7} className="px-3 py-2">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : items.length === 0 ? (
                  <tr className="border-t border-border/50">
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Geen berichten gevonden voor deze filters.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr
                      key={row.id}
                      className={cn(
                        "border-t border-border/50 align-top",
                        row.status === "failed" && "bg-destructive/5"
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">
                        {formatDateTimeNl(row.created_at)}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-green-deeper">
                          {row.klant_naam || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.channel === "sms"
                            ? row.to_phone || "—"
                            : row.to_email || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 text-xs font-medium">
                          {row.channel === "sms" ? (
                            <MessageSquare className="size-3.5" />
                          ) : (
                            <Mail className="size-3.5" />
                          )}
                          {row.channel === "sms" ? "SMS" : "E-mail"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{stepLabel(row.step)}</td>
                      <td className="px-3 py-2.5 capitalize">
                        {row.opvolging_flow || "—"}
                      </td>
                      <td className="px-3 py-2.5">{statusBadge(row.status)}</td>
                      <td className="max-w-[28rem] px-3 py-2.5">
                        <p className="truncate font-medium">
                          {row.subject || row.body_preview || "—"}
                        </p>
                        {row.error ? (
                          <p className="mt-0.5 text-xs text-destructive">
                            {row.error}
                          </p>
                        ) : row.subject && row.body_preview ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {row.body_preview}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
