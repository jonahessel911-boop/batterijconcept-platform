"use client";

import { useState } from "react";
import type { Project } from "@/types/database";
import { normalizeProjectStatus } from "@/lib/labels";
import { toOperationalStatus } from "@/lib/project-status-config";
import { formatDateTimeNl } from "@/lib/format";

const SHOW_FROM = new Set([
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

type ItemId =
  | "btw_terugvragen_aangevraagd_at"
  | "overstap_dynamische_leverancier_at"
  | "review_gevraagd_at";

const ITEMS: { id: ItemId; label: string }[] = [
  { id: "btw_terugvragen_aangevraagd_at", label: "BTW terugvragen aangevraagd" },
  {
    id: "overstap_dynamische_leverancier_at",
    label: "Overstap dynamische leverancier",
  },
  { id: "review_gevraagd_at", label: "Review gevraagd" },
];

function isDone(project: Project, id: ItemId): boolean {
  return Boolean(project[id]);
}

function allAfterSaleDone(
  project: Project,
  override?: Partial<Record<ItemId, string | null>>
): boolean {
  const btw =
    override && "btw_terugvragen_aangevraagd_at" in override
      ? override.btw_terugvragen_aangevraagd_at
      : project.btw_terugvragen_aangevraagd_at;
  const overstap =
    override && "overstap_dynamische_leverancier_at" in override
      ? override.overstap_dynamische_leverancier_at
      : project.overstap_dynamische_leverancier_at;
  const review =
    override && "review_gevraagd_at" in override
      ? override.review_gevraagd_at
      : project.review_gevraagd_at;
  return Boolean(btw && overstap && review);
}

export function showProjectAfronding(project: Project): boolean {
  const op = toOperationalStatus(project.status);
  return SHOW_FROM.has(op);
}

export function ProjectAfrondingChecklist({
  project,
  onUpdated,
}: {
  project: Project;
  onUpdated?: (p: Project) => void;
}) {
  const [busy, setBusy] = useState<ItemId | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!showProjectAfronding(project)) return null;

  const status = normalizeProjectStatus(project.status);
  const isAfterSale = status === "afgerond";

  async function toggle(id: ItemId) {
    setBusy(id);
    setError(null);
    const next = isDone(project, id) ? null : new Date().toISOString();
    try {
      const body: Record<string, string | null> = { [id]: next };
      // Pas naar After sale als alle drie klaar zijn
      if (
        next &&
        allAfterSaleDone(project, { [id]: next }) &&
        status !== "afgerond" &&
        status !== "service"
      ) {
        body.status = "afgerond";
      }
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      onUpdated?.(data.project as Project);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border border-line bg-white px-4 py-4 sm:px-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
        Afronding
      </h2>
      <p className="mt-1 text-[11px] text-muted">
        {isAfterSale
          ? "Alle stappen klaar — status Afgerond."
          : "Na oplevering: BTW, overstap en review. Daarna → Afgerond."}
      </p>
      <ul className="mt-3 space-y-2">
        {ITEMS.map((item) => {
          const done = isDone(project, item.id);
          const at = project[item.id];
          return (
            <li key={item.id}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={busy === item.id}
                  onChange={() => void toggle(item.id)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <span
                    className={[
                      "text-sm font-medium",
                      done ? "text-green-dark" : "text-ink",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                  {done && at ? (
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {formatDateTimeNl(at)}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-[#C45A12]">{error}</p> : null}
    </section>
  );
}
