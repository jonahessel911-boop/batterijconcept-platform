"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { formatDateShort, formatEuro } from "@/lib/format";

const NIET_GELOPEN_BOETE_EX = 100;
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Item = {
  id: string;
  start_at: string;
  lead_id: string | null;
  klant_naam: string;
  plaats: string | null;
};

type Props = {
  adviseurId: string;
  overeenkomstIngangsdatum?: string | null;
  ingangsdatum: string;
  slotdatum: string;
  onIngangsdatum: (v: string) => void;
  onSlotdatum: (v: string) => void;
  onDownload: () => void;
  downloadBusy: boolean;
  onCount?: (n: number) => void;
};

export function OffboardingDocument({
  adviseurId,
  overeenkomstIngangsdatum,
  ingangsdatum,
  slotdatum,
  onIngangsdatum,
  onSlotdatum,
  onDownload,
  downloadBusy,
  onCount,
}: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/afspraken/niet-gelopen-adviseur?items=1&adviseur_ids=${encodeURIComponent(adviseurId)}`
      );
      const data = (await res.json()) as { items?: Item[]; counts?: Record<string, number> };
      const list = Array.isArray(data.items) ? data.items : [];
      setItems(list);
      onCount?.(list.length);
    } catch {
      setItems([]);
      onCount?.(0);
    } finally {
      setLoading(false);
    }
  }, [adviseurId, onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const n = items.length;
  const boeteTotaal = n * NIET_GELOPEN_BOETE_EX;

  return (
    <Card className="bg-white shadow-none">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          Niet gelopen door adviseur
        </CardTitle>
        <CardDescription>
          Artikel 3.3 · €{NIET_GELOPEN_BOETE_EX} per afspraak. Blijft op dit
          account staan, ook na offboarding.
        </CardDescription>
        <CardAction>
          <Badge variant={n > 0 ? "destructive" : "secondary"}>
            {n} {n === 1 ? "afspraak" : "afspraken"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">Laden…</p>
        ) : n === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Geen markeringen</EmptyTitle>
              <EmptyDescription>
                Nog geen afspraken gemarkeerd als niet gelopen door deze
                adviseur.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Datum</TableHead>
                <TableHead>Klant</TableHead>
                <TableHead>Plaats</TableHead>
                <TableHead className="text-right">Boete ex</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">
                    {formatDateShort(row.start_at)}
                  </TableCell>
                  <TableCell>
                    {row.lead_id ? (
                      <a
                        href={`/leads/${row.lead_id}`}
                        className="font-medium text-ink underline-offset-2 hover:underline"
                      >
                        {row.klant_naam}
                      </a>
                    ) : (
                      row.klant_naam
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.plaats || "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatEuro(NIET_GELOPEN_BOETE_EX)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>Totaal</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatEuro(boeteTotaal)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}

        <Alert>
          <AlertTitle>Artikel 3.3</AlertTitle>
          <AlertDescription>
            Contractuele boete van €{NIET_GELOPEN_BOETE_EX} per uitgevallen
            afspraak bij toerekenbare nalatigheid. Volledige tekst staat in de
            ondertekende overeenkomst (kopie in de PDF).
          </AlertDescription>
        </Alert>

        <Separator />

        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">Offboarding-PDF</p>
          <p className="text-sm text-muted-foreground">
            Beëindiging, netto-orders (uitbetaling na installatie), deze
            afspraken en een kopie van de overeenkomst. Alleen downloaden.
          </p>
          {overeenkomstIngangsdatum ? (
            <p className="text-sm">
              Ingangsdatum overeenkomst:{" "}
              <span className="font-medium">{overeenkomstIngangsdatum}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Geen ingangsdatum gevonden op het ondertekende contract.
            </p>
          )}
          <div className="grid max-w-md gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="offboard-ingang">Ingangsdatum beëindiging</Label>
              <Input
                id="offboard-ingang"
                type="date"
                value={ingangsdatum}
                onChange={(e) => onIngangsdatum(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offboard-slot">Slotdatum</Label>
              <Input
                id="offboard-slot"
                type="date"
                value={slotdatum}
                onChange={(e) => onSlotdatum(e.target.value)}
              />
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          disabled={downloadBusy || !ingangsdatum || !slotdatum}
          onClick={onDownload}
        >
          {downloadBusy ? "PDF maken…" : "Offboarding PDF"}
        </Button>
      </CardFooter>
    </Card>
  );
}
