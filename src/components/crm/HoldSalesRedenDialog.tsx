"use client";

import { useState } from "react";
import type { Project } from "@/types/database";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

export async function plaatsHoldSalesActie(opts: {
  project: Project;
  reden: string;
  door?: string | null;
}): Promise<Project> {
  const reden = opts.reden.trim();
  if (!reden) throw new Error("Vul in wat sales moet doen.");
  const res = await fetch(`/api/projecten/${opts.project.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "hold_sales_actie",
      backoffice_notitie: reden,
      ...(opts.door?.trim()
        ? { backoffice_notitie_door: opts.door.trim() }
        : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || "HOLD zetten mislukt"
    );
  }
  const updated = (data as { project?: Project }).project;
  if (updated) return updated;
  return {
    ...opts.project,
    status: "hold_sales_actie",
    backoffice_notitie: reden,
    backoffice_notitie_door: opts.door?.trim() || opts.project.backoffice_notitie_door,
  };
}

export function HoldSalesRedenDialog({
  open,
  project,
  door,
  onOpenChange,
  onPlaced,
}: {
  open: boolean;
  project: Project | null;
  door?: string | null;
  onOpenChange: (open: boolean) => void;
  onPlaced?: (project: Project) => void;
}) {
  const [reden, setReden] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bevestigen() {
    if (!project) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await plaatsHoldSalesActie({
        project,
        reden,
        door,
      });
      setReden("");
      onOpenChange(false);
      onPlaced?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "HOLD zetten mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setReden("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>HOLD sales actie</DialogTitle>
          <DialogDescription>
            De order gaat terug naar de verkoper (Offertes). Sales ziet deze
            reden en heeft 4 dagen om het op te lossen.
          </DialogDescription>
        </DialogHeader>
        <label className="block text-[12px] font-semibold text-ink">
          Wat moet sales doen?
          <Textarea
            value={reden}
            onChange={(e) => setReden(e.target.value)}
            rows={4}
            placeholder="Bijv. verkeerde financiering, ontbrekende gegevens, klant twijfelt…"
            className="mt-1.5 min-h-24"
            autoFocus
          />
        </label>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Annuleren
          </Button>
          <Button
            type="button"
            disabled={busy || !reden.trim()}
            onClick={() => void bevestigen()}
          >
            {busy ? "Bezig…" : "Terug naar verkoper"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
