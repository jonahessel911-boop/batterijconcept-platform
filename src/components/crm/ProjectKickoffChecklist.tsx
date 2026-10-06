"use client";

import { useState } from "react";
import type { Factuur, Project } from "@/types/database";
import {
  kickoffWarmtefondsBedragen,
  projectKickoffItems,
  showProjectKickoff,
} from "@/lib/project-kickoff";
import {
  FINANCIERINGSMAN_NAAM,
  edwinWarmtefondsWhatsappBericht,
  edwinWhatsappUrl,
} from "@/lib/backoffice-acties";

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.85 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

/**
 * Enige focus tijdens opstart: wat moet er nú gebeuren (parallel).
 */
export function ProjectKickoffChecklist({
  project,
  facturen,
  onFinancieringUpdated,
}: {
  project: Project;
  facturen: Factuur[];
  onFinancieringUpdated?: (project: Project) => void;
}) {
  const [waBusy, setWaBusy] = useState(false);
  const [afvinkBusy, setAfvinkBusy] = useState(false);
  const [edwinGestuurd, setEdwinGestuurd] = useState(false);
  const [waHint, setWaHint] = useState<string | null>(null);

  if (!showProjectKickoff(project, facturen)) return null;

  const items = projectKickoffItems(project, facturen);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  const offerteId = off?.id || project.offerte_id || null;

  async function downloadOffertePdf(): Promise<boolean> {
    if (!offerteId) return false;
    const res = await fetch(`/api/offertes/${offerteId}/pdf`);
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${off?.offerte_nummer || project.project_nummer || "offerte"}-ondertekend.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  }

  /** Stap 1: WhatsApp + PDF — taak blijft open tot je afvinkt. */
  async function stuurNaarEdwin() {
    setWaBusy(true);
    setWaHint(null);
    try {
      const bedragen = kickoffWarmtefondsBedragen(project, facturen);
      const bericht = edwinWarmtefondsWhatsappBericht({
        leadNaam: lead?.naam || project.titel || "Klant",
        telefoon: lead?.telefoon,
        straat: lead?.straat,
        postcode: lead?.postcode,
        huisnummer: lead?.huisnummer,
        toevoeging: lead?.toevoeging,
        plaats: lead?.plaats,
        offerteNummer: off?.offerte_nummer,
        projectNummer: project.project_nummer,
        aanbetalingInc: bedragen.aanbetalingInc,
        warmtefondsInc: bedragen.warmtefondsInc,
      });

      try {
        await navigator.clipboard.writeText(bericht);
      } catch {
        /* ignore */
      }

      const pdfOk = await downloadOffertePdf();
      window.open(edwinWhatsappUrl(bericht), "_blank", "noopener,noreferrer");
      setEdwinGestuurd(true);

      setWaHint(
        pdfOk
          ? `Bericht naar ${FINANCIERINGSMAN_NAAM} klaar · PDF gedownload — voeg die toe in WhatsApp. Vink daarna de taak af.`
          : `Bericht in klembord. Voeg de offerte-PDF handmatig toe in WhatsApp. Vink daarna de taak af.`
      );
    } finally {
      setWaBusy(false);
    }
  }

  /** Stap 2: intake klaar → financiering start. */
  async function afvinkEdwinIntake() {
    setAfvinkBusy(true);
    setWaHint(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: "doorgestuurd_naar_edwin",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWaHint(
          (data as { error?: string }).error ||
            "Afvinken mislukt. Probeer opnieuw."
        );
        return;
      }
      const updated = (data as { project?: Project }).project;
      if (updated) onFinancieringUpdated?.(updated);
      else
        onFinancieringUpdated?.({
          ...project,
          financiering_status: "doorgestuurd_naar_edwin",
        });
    } finally {
      setAfvinkBusy(false);
    }
  }

  return (
    <section className="border border-line bg-white px-4 py-5 sm:px-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        Direct na tekenen
      </p>
      <h2 className="mt-1 text-lg font-semibold text-ink">
        Dit moet nu gebeuren
      </h2>

      {waHint ? (
        <p className="mt-3 border border-[#0D9488]/25 bg-[#F0FDFA] px-3 py-2 text-[12px] text-[#115E59]">
          {waHint}
        </p>
      ) : null}

      {open.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {open.map((item, idx) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 border border-[#FDBA74]/60 bg-[#FFF7ED] px-3.5 py-3 sm:flex-row sm:items-start"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C45A12] text-[11px] font-bold text-white">
                  {idx + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-ink">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {item.detail}
                  </span>
                </span>
              </div>

              {item.id === "wf_afspraak" ? (
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <button
                    type="button"
                    disabled={waBusy}
                    onClick={() => void stuurNaarEdwin()}
                    className="inline-flex items-center gap-1.5 bg-[#25D366] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1ebe57] disabled:opacity-60"
                    title={`WhatsApp naar ${FINANCIERINGSMAN_NAAM}`}
                  >
                    <WhatsAppIcon />
                    {waBusy
                      ? "Bezig…"
                      : edwinGestuurd
                        ? "Opnieuw sturen"
                        : "Stuur naar Edwin"}
                  </button>
                  {edwinGestuurd ? (
                    <button
                      type="button"
                      disabled={afvinkBusy}
                      onClick={() => void afvinkEdwinIntake()}
                      className="inline-flex items-center gap-1.5 border border-[#0D9488] bg-[#F0FDFA] px-3 py-2 text-[12px] font-semibold text-[#115E59] hover:bg-[#CCFBF1] disabled:opacity-60"
                      title="Intake afronden — start fase Financiering"
                    >
                      <svg
                        viewBox="0 0 12 12"
                        className="h-3 w-3"
                        aria-hidden
                      >
                        <path
                          d="M2.5 6.2 4.8 8.5 9.5 3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {afvinkBusy ? "Bezig…" : "Afvinken — intake klaar"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {done.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 px-1 py-1 text-[13px] text-[#0F766E]"
            >
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0D9488] text-white"
                aria-hidden
              >
                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                  <path
                    d="M2.5 6.2 4.8 8.5 9.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="font-medium">{item.label}</span>
              <span className="text-muted">· {item.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
