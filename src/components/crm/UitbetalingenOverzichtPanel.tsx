"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { formatEuro } from "@/lib/format";
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
import { cn } from "@/lib/utils";

type UitbetalingProgressPersoon = {
  id: string;
  naam: string;
  rol: string;
  groep: "adviseur" | "backoffice";
  orders: number;
  totaal: number;
  groen: number;
  oranje: number;
  blauw: number;
};

type Payload = {
  ok?: boolean;
  error?: string;
  personen?: UitbetalingProgressPersoon[];
  totals?: {
    totaal: number;
    groen: number;
    oranje: number;
    blauw: number;
  };
};

function pct(part: number, totaal: number): number {
  if (!(totaal > 0) || !(part > 0)) return 0;
  return Math.max(0, Math.min(100, (part / totaal) * 100));
}

function StackedBar({
  groen,
  oranje,
  blauw,
  totaal,
}: {
  groen: number;
  oranje: number;
  blauw: number;
  totaal: number;
}) {
  const g = pct(groen, totaal);
  const o = pct(oranje, totaal);
  const b = pct(blauw, totaal);
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${formatEuro(groen)} uitbetaald van ${formatEuro(totaal)}`}
    >
      {g > 0 ? (
        <div className="h-full bg-emerald-600" style={{ width: `${g}%` }} />
      ) : null}
      {o > 0 ? (
        <div className="h-full bg-orange-500" style={{ width: `${o}%` }} />
      ) : null}
      {b > 0 ? (
        <div className="h-full bg-sky-500" style={{ width: `${b}%` }} />
      ) : null}
    </div>
  );
}

function PersonRow({ p }: { p: UitbetalingProgressPersoon }) {
  const open = p.oranje + p.blauw;
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate font-display text-sm font-semibold text-ink">
            {p.naam}
          </p>
          <Badge variant="outline" className="font-normal text-muted">
            {p.groep === "backoffice" ? "Backoffice" : "Adviseur"}
          </Badge>
        </div>
        <p className="text-sm tabular-nums text-ink">
          <span className="font-semibold">{formatEuro(p.groen)}</span>
          <span className="text-muted"> / {formatEuro(p.totaal)}</span>
        </p>
      </div>
      <div className="mt-2">
        <StackedBar
          groen={p.groen}
          oranje={p.oranje}
          blauw={p.blauw}
          totaal={p.totaal}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums text-muted">
        <span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-600 align-middle" />{" "}
          Uitbetaald {formatEuro(p.groen)}
        </span>
        <span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500 align-middle" />{" "}
          Nog uit te betalen {formatEuro(p.oranje)}
        </span>
        <span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500 align-middle" />{" "}
          Rest na installatie {formatEuro(p.blauw)}
        </span>
        <span className="ml-auto">
          {p.orders} {p.orders === 1 ? "order" : "orders"}
          {open > 0 ? ` · ${formatEuro(open)} open` : ""}
        </span>
      </div>
    </div>
  );
}

export function UitbetalingenOverzichtPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/uitbetalingen-overzicht");
      const body = (await res.json()) as Payload;
      if (!res.ok || body.error) {
        throw new Error(body.error || "Laden mislukt");
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const adviseurs = (data?.personen || []).filter((p) => p.groep === "adviseur");
  const backoffice = (data?.personen || []).filter(
    (p) => p.groep === "backoffice"
  );
  const totals = data?.totals;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-600" /> Groen =
            uitbetaald
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-500" /> Oranje =
            getriggerd, nog uit te betalen
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-sky-500" /> Blauw =
            restcommissie (wacht op installatie)
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Vernieuwen
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {totals ? (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardTitle>Totaal</CardTitle>
            <CardDescription>
              {formatEuro(totals.groen)} uitbetaald van {formatEuro(totals.totaal)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <StackedBar
              groen={totals.groen}
              oranje={totals.oranje}
              blauw={totals.blauw}
              totaal={totals.totaal}
            />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="font-semibold tabular-nums text-emerald-700">
                  {formatEuro(totals.groen)}
                </p>
                <p className="text-muted">Uitbetaald</p>
              </div>
              <div>
                <p className="font-semibold tabular-nums text-orange-600">
                  {formatEuro(totals.oranje)}
                </p>
                <p className="text-muted">Nog te betalen</p>
              </div>
              <div>
                <p className="font-semibold tabular-nums text-sky-600">
                  {formatEuro(totals.blauw)}
                </p>
                <p className="text-muted">Na installatie</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : null}

      {adviseurs.length > 0 ? (
        <Card className="mb-4 overflow-hidden py-0">
          <CardHeader className="border-b border-line py-3">
            <CardTitle>Adviseurs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {adviseurs.map((p) => (
              <PersonRow key={p.id} p={p} />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {backoffice.length > 0 ? (
        <Card className="overflow-hidden py-0">
          <CardHeader className="border-b border-line py-3">
            <CardTitle>Backoffice</CardTitle>
            <CardDescription>
              Alleen salescommissie op hun naam; ops-weekvergoeding zit in de
              bestaande Uitbetalingen-lijst onder Business.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {backoffice.map((p) => (
              <PersonRow key={p.id} p={p} />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
