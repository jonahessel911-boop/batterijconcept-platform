"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { InstallatiePartner, ServiceVerzoek } from "@/types/database";
import { adresRegel, formatDateTimeNl, formatTimeNl } from "@/lib/format";
import { projectStatusLabel } from "@/lib/labels";
import {
  monteurNotities,
  partnerNaam,
  SERVICE_TICKET_STATUS_CLASS,
  SERVICE_TICKET_STATUS_LABEL,
  serviceTicketDisplayStatus,
  toDatetimeLocalValue,
} from "@/lib/service-verzoek-ui";
import { backofficeHref } from "@/lib/bo-view";
import {
  Breadcrumb,
  DetailShell,
  NotFoundState,
  TerugButton,
} from "./DetailChrome";

const SERVICE_LIST_HREF = backofficeHref("service");

export function ServiceVerzoekPage() {
  const { id } = useParams<{ id: string }>();
  const [verzoek, setVerzoek] = useState<ServiceVerzoek | null>(null);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planAt, setPlanAt] = useState("");
  const [planPartnerId, setPlanPartnerId] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [afhandelNotitie, setAfhandelNotitie] = useState("");
  const [showReplan, setShowReplan] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const [vRes, pRes] = await Promise.all([
        fetch(`/api/service-verzoeken/${id}`),
        fetch("/api/installatie-partners"),
      ]);
      const vData = await vRes.json().catch(() => ({}));
      const pData = await pRes.json().catch(() => ({}));
      if (vRes.status === 404) {
        setNotFound(true);
        setVerzoek(null);
        return;
      }
      if (!vRes.ok) throw new Error(vData.error || "Laden mislukt");
      const v = vData.verzoek as ServiceVerzoek;
      setVerzoek(v);
      setPartners(
        ((pData.partners as InstallatiePartner[]) || []).filter(
          (p) => p.actief !== false
        )
      );

      const existingAt = v.projecten?.service_at;
      if (existingAt) {
        setPlanAt(toDatetimeLocalValue(new Date(existingAt)));
        setShowReplan(false);
      } else {
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
        setPlanAt(toDatetimeLocalValue(d));
        setShowReplan(true);
      }
      setPlanPartnerId(v.projecten?.installatie_partner_id || "");
      setPlanNotes(
        v.projecten?.service_notities?.trim() || v.onderwerp || ""
      );
      setAfhandelNotitie(v.interne_notitie || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setVerzoek(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  async function submitPlan() {
    if (!verzoek) return;
    if (!planAt.trim()) {
      setError("Kies datum + tijd");
      return;
    }
    if (!planPartnerId) {
      setError("Kies een installatiepartner");
      return;
    }
    if (!planNotes.trim()) {
      setError(
        "Notitie is verplicht bij inplannen — de installateur ziet dit op de afspraak"
      );
      return;
    }
    const parsed = new Date(planAt);
    if (Number.isNaN(parsed.getTime())) {
      setError("Ongeldige datum");
      return;
    }
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${verzoek.project_id}/service`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_at: parsed.toISOString(),
          installatie_partner_id: planPartnerId,
          service_notities: planNotes.trim(),
          service_verzoek_id: verzoek.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Inplannen mislukt");
      setOkMsg(
        `Ingepland · ${formatDateTimeNl(parsed.toISOString())} · zichtbaar op Planbord`
      );
      setShowReplan(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inplannen mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function afhandelen() {
    if (!verzoek) return;
    const note = afhandelNotitie.trim();
    if (!note) {
      setError("Notitie is verplicht bij afhandelen");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-verzoeken/${verzoek.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "afgehandeld",
          interne_notitie: note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afhandelen mislukt");
      setOkMsg("Ticket afgehandeld.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afhandelen mislukt");
    } finally {
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <NotFoundState
        title="Service-ticket niet gevonden"
        backHref={SERVICE_LIST_HREF}
        backLabel="Terug naar Service"
        activeTab="projecten"
      />
    );
  }

  const display = verzoek ? serviceTicketDisplayStatus(verzoek) : null;
  const gepland = Boolean(verzoek?.projecten?.service_at);
  const monteur = verzoek ? monteurNotities(verzoek) : null;
  const heeftMonteurNote = Boolean(monteur?.service || monteur?.algemeen);
  const isOpen = verzoek?.status === "open";
  const canClose = afhandelNotitie.trim().length > 0;

  return (
    <DetailShell
      activeTab="projecten"
      loading={loading}
      onRefresh={() => void load()}
    >
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb
            items={[
              { label: "Service", href: SERVICE_LIST_HREF },
              {
                label: verzoek?.onderwerp || "Ticket",
              },
            ]}
          />
          <TerugButton fallbackHref={SERVICE_LIST_HREF} label="Terug naar Service" />
        </div>

        {loading && !verzoek ? (
          <p className="py-16 text-center text-sm text-muted">Laden…</p>
        ) : !verzoek ? (
          <p className="py-16 text-center text-sm text-muted">
            {error || "Kon ticket niet laden."}
          </p>
        ) : (
          <>
            <header className="border border-line bg-white px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    Service-ticket
                  </p>
                  <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
                    {verzoek.onderwerp}
                  </h1>
                  <p className="mt-1 text-sm text-muted">
                    {verzoek.leads?.naam || "Klant"}
                    {verzoek.projecten?.project_nummer
                      ? ` · ${verzoek.projecten.project_nummer}`
                      : ""}
                  </p>
                </div>
                {display ? (
                  <span
                    className={[
                      "shrink-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                      SERVICE_TICKET_STATUS_CLASS[display],
                    ].join(" ")}
                  >
                    {SERVICE_TICKET_STATUS_LABEL[display]}
                  </span>
                ) : null}
              </div>
            </header>

            {error ? (
              <p className="border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            ) : null}
            {okMsg ? (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
                {okMsg}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-line bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Klant
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {verzoek.leads?.naam || "—"}
                </p>
                {verzoek.leads && adresRegel(verzoek.leads) !== "—" ? (
                  <p className="mt-0.5 text-xs leading-snug text-muted">
                    {adresRegel(verzoek.leads)}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {verzoek.leads?.telefoon ? (
                    <a
                      href={`tel:${verzoek.leads.telefoon}`}
                      className="bg-[#0D9488] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
                    >
                      Bel
                    </a>
                  ) : null}
                  {(verzoek.leads?.email || verzoek.klant_email) && (
                    <a
                      href={`mailto:${verzoek.leads?.email || verzoek.klant_email}`}
                      className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                    >
                      Mail
                    </a>
                  )}
                  <Link
                    href={`/projecten/${verzoek.project_id}?from=orders`}
                    className="border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    Project
                  </Link>
                </div>
              </div>
              <div className="border border-line bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Project
                </p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {verzoek.projecten?.project_nummer || "—"}
                </p>
                {verzoek.projecten?.status ? (
                  <p className="mt-0.5 text-xs text-muted">
                    {projectStatusLabel[verzoek.projecten.status] ||
                      verzoek.projecten.status}
                  </p>
                ) : null}
                {partnerNaam(verzoek.projecten) ? (
                  <p className="mt-0.5 text-xs text-muted">
                    Partner · {partnerNaam(verzoek.projecten)}
                  </p>
                ) : null}
                {gepland && verzoek.projecten?.service_at ? (
                  <p className="mt-2 text-xs font-semibold text-[#C45A12]">
                    Service · {formatDateTimeNl(verzoek.projecten.service_at)}
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">Nog niet ingepland</p>
                )}
              </div>
            </div>

            {verzoek.omschrijving ? (
              <section className="border border-line bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Melding van de klant
                </p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {verzoek.omschrijving}
                </p>
              </section>
            ) : null}

            <section
              className={[
                "border bg-white px-4 py-4",
                heeftMonteurNote
                  ? "border-[#B7D9C4]"
                  : "border-dashed border-line",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                  Notitie van de installateur
                </p>
                {heeftMonteurNote ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[#0D5C32]">
                    Ontvangen
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Nog leeg
                  </span>
                )}
              </div>
              {monteur?.service ? (
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {monteur.service}
                </p>
              ) : null}
              {monteur?.algemeen && monteur.algemeen !== monteur.service ? (
                <div className="mt-2 border-t border-[#B7D9C4]/60 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Installateursnotitie
                    {monteur.door ? ` · ${monteur.door}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {monteur.algemeen}
                  </p>
                </div>
              ) : null}
              {!heeftMonteurNote ? (
                <p className="mt-2 text-sm text-muted">
                  Na de service vinkt de monteur af op het Planbord — dan
                  verschijnt hier de notitie.
                </p>
              ) : null}
            </section>

            {isOpen ? (
              <section className="border border-line bg-white px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                      Inplannen op planbord
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Verschijnt als service-blok op het planbord
                    </p>
                  </div>
                  {gepland && !showReplan ? (
                    <button
                      type="button"
                      onClick={() => setShowReplan(true)}
                      className="text-xs font-semibold text-[#C45A12] hover:underline"
                    >
                      Herplannen
                    </button>
                  ) : null}
                </div>

                {gepland && !showReplan ? (
                  <div className="mt-3 border border-[#FDBA74]/50 bg-[#FFF7ED] px-3 py-2.5">
                    <p className="text-sm font-semibold text-[#9A4510]">
                      {formatDateTimeNl(verzoek.projecten!.service_at!)}
                    </p>
                    <p className="mt-0.5 text-xs text-[#9A4510]/90">
                      {partnerNaam(verzoek.projecten) || "Partner"}
                      {verzoek.projecten?.service_notities
                        ? ` · ${verzoek.projecten.service_notities}`
                        : ""}
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Datum + tijd
                        </span>
                        <input
                          type="datetime-local"
                          value={planAt}
                          onChange={(e) => setPlanAt(e.target.value)}
                          className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Installatiepartner
                        </span>
                        <select
                          value={planPartnerId}
                          onChange={(e) => setPlanPartnerId(e.target.value)}
                          className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                        >
                          <option value="">Kies partner…</option>
                          {partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.naam}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Notitie voor installateur *
                      </span>
                      <textarea
                        value={planNotes}
                        onChange={(e) => setPlanNotes(e.target.value)}
                        rows={3}
                        required
                        placeholder="Wat moet de monteur doen / weten bij deze service…"
                        className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          busy ||
                          !planAt ||
                          !planPartnerId ||
                          !planNotes.trim()
                        }
                        onClick={() => void submitPlan()}
                        className="bg-[#C45A12] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
                      >
                        {busy
                          ? "Bezig…"
                          : planAt
                            ? `${gepland ? "Herplan" : "Plan in"} · ${formatTimeNl(new Date(planAt).toISOString())}`
                            : "Plan in"}
                      </button>
                      {gepland && showReplan ? (
                        <button
                          type="button"
                          onClick={() => setShowReplan(false)}
                          className="border border-line px-3 py-2.5 text-sm font-semibold text-muted hover:bg-wash"
                        >
                          Annuleer
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </section>
            ) : null}

            <section className="border border-line bg-white px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                {isOpen ? "Afhandelen" : "Afgehandeld"}
              </p>
              {isOpen ? (
                <>
                  <label className="mt-2 block">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Interne notitie *
                    </span>
                    <textarea
                      value={afhandelNotitie}
                      onChange={(e) => setAfhandelNotitie(e.target.value)}
                      rows={3}
                      placeholder={
                        heeftMonteurNote
                          ? "Bevestig of vul aan wat er gedaan is…"
                          : "Wat is gedaan / bevindingen…"
                      }
                      className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !canClose}
                    onClick={() => void afhandelen()}
                    className="mt-3 bg-[#0D5C32] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0a4727] disabled:opacity-50"
                  >
                    {busy ? "Bezig…" : "Markeer afgehandeld"}
                  </button>
                </>
              ) : (
                <div className="mt-2">
                  <p className="text-xs font-semibold text-[#0D5C32]">
                    Afgehandeld
                    {verzoek.afgehandeld_op
                      ? ` · ${formatDateTimeNl(verzoek.afgehandeld_op)}`
                      : ""}
                  </p>
                  {verzoek.interne_notitie ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {verzoek.interne_notitie}
                    </p>
                  ) : null}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </DetailShell>
  );
}
