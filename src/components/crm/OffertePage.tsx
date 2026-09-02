"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import type {
  Factuur,
  Offerte,
  OfferteRegel,
  Project,
  ProjectFoto,
} from "@/types/database";
import { getSupabaseBrowser, hasSupabaseConfig } from "@/lib/supabase";
import {
  formatDateNl,
  formatDateShort,
  formatDateTimeNl,
  formatEuro,
} from "@/lib/format";
import { isKortingRegel, kortingIncVanRegels } from "@/lib/offerte-regels";
import {
  aanbetalingVanOrder,
  normalizeAanbetalingModus,
  parseEuroInput,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import {
  BackofficeActieForm,
  type BackofficeActieFormValues,
} from "./BackofficeActieForm";
import { StatusBadge } from "./StatusBadge";
import {
  BackLink,
  Breadcrumb,
  DetailShell,
  HeroCard,
  InfoTile,
  NotFoundState,
  Panel,
} from "./DetailChrome";

export function OffertePage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [offerte, setOfferte] = useState<Offerte | null>(null);
  const [regels, setRegels] = useState<OfferteRegel[]>([]);
  const [projecten, setProjecten] = useState<Project[]>([]);
  const [facturen, setFacturen] = useState<Factuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [verstuurBusy, setVerstuurBusy] = useState(false);
  const [verstuurMsg, setVerstuurMsg] = useState<string | null>(null);
  const [actieOpen, setActieOpen] = useState(false);
  const [aanbetalingModus, setAanbetalingModus] =
    useState<AanbetalingModus>("restant");
  const [aanbetalingHandmatig, setAanbetalingHandmatig] = useState("");
  const [backofficeNotitie, setBackofficeNotitie] = useState("");
  const [installateurNotitie, setInstallateurNotitie] = useState("");
  const [sessionNaam, setSessionNaam] = useState<string | null>(null);
  const [actieSaving, setActieSaving] = useState(false);
  const [actieMsg, setActieMsg] = useState<string | null>(null);
  const [projectFotos, setProjectFotos] = useState<ProjectFoto[]>([]);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const openBackofficeFromUrl = searchParams.get("backoffice") === "1";

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);

    if (!hasSupabaseConfig()) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      const sb = getSupabaseBrowser();
      const [o, p, f] = await Promise.all([
        sb
          .from("offertes")
          .select(
            "*, leads(naam, email, lead_number, postcode, huisnummer, plaats, adviseur_id, adviseurs(id, naam)), offerte_regels(*), installatie_partners(id, naam, email, telefoon)"
          )
          .eq("id", id)
          .single(),
        sb
          .from("projecten")
          .select("*, leads(naam, lead_number)")
          .eq("offerte_id", id),
        sb
          .from("facturen")
          .select("*, leads(naam, lead_number)")
          .eq("offerte_id", id),
      ]);

      if (o.error || !o.data) {
        setNotFound(true);
      } else {
        const data = o.data as Offerte;
        setOfferte(data);
        setAanbetalingModus(normalizeAanbetalingModus(data.aanbetaling_modus));
        setAanbetalingHandmatig(
          data.aanbetaling_bedrag_inc != null
            ? String(data.aanbetaling_bedrag_inc)
            : ""
        );
        setBackofficeNotitie(data.backoffice_notitie || "");
        setInstallateurNotitie(data.installateur_notitie || "");
        setActieOpen(
          data.status === "ondertekend" &&
            Boolean(data.actie_required) &&
            openBackofficeFromUrl
        );
        setRegels(
          ((data.offerte_regels as OfferteRegel[]) || []).sort(
            (a, b) => a.sort_order - b.sort_order
          )
        );
        setProjecten((p.data as Project[]) || []);
        setFacturen((f.data as Factuur[]) || []);
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, openBackofficeFromUrl]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const res = await fetch("/api/auth/login");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.adviseur?.naam) {
          setSessionNaam(data.adviseur.naam as string);
        }
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Project wordt pas aangemaakt bij “Actie afronden” (niet bij openen)
  useEffect(() => {
    if (!offerte || loading) return;
    if (offerte.status !== "ondertekend") return;
    if (facturen.length > 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/offertes/${offerte.id}/factuur`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled || data.skipped) return;
        await load();
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [offerte, facturen.length, loading, load]);

  useEffect(() => {
    const projectId = projecten[0]?.id;
    if (!projectId) {
      setProjectFotos([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projecten/${projectId}/fotos`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        setProjectFotos(data.fotos || []);
      } catch {
        if (!cancelled) setProjectFotos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projecten]);

  async function saveBackofficeActie(markComplete: boolean) {
    if (!offerte) return;
    setActieSaving(true);
    setActieMsg(null);
    try {
      const isWarmtefonds = Boolean(offerte.financiering_voorbehoud);
      const preview = aanbetalingVanOrder({
        subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
        btwBedrag: Number(offerte.btw_bedrag) || 0,
        totaalIncBtw: Number(offerte.totaal_inc_btw) || 0,
        modus: aanbetalingModus,
        handmatigIncBtw: parseEuroInput(aanbetalingHandmatig),
        financieringVoorbehoud: isWarmtefonds,
      });

      const res = await fetch(`/api/offertes/${offerte.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actie_required: !markComplete,
          aanbetaling_modus: isWarmtefonds ? aanbetalingModus : null,
          aanbetaling_bedrag_inc:
            isWarmtefonds && aanbetalingModus === "handmatig"
              ? parseEuroInput(aanbetalingHandmatig)
              : null,
          aanbetaling_te_innen_inc: preview.bedragIncBtw,
          backoffice_notitie: backofficeNotitie || null,
          installateur_notitie: installateurNotitie || null,
          backoffice_notitie_door: backofficeNotitie.trim()
            ? sessionNaam || offerte.backoffice_notitie_door || null
            : null,
          installateur_notitie_door: installateurNotitie.trim()
            ? sessionNaam || offerte.installateur_notitie_door || null
            : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setActieMsg(markComplete ? "Actie afgerond." : "Backoffice opgeslagen.");
      if (markComplete) setActieOpen(false);
      await load();
    } catch (e) {
      setActieMsg(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setActieSaving(false);
    }
  }

  async function uploadInstallateurFotos(files: FileList | File[]) {
    const projectId = projecten[0]?.id;
    const list = Array.from(files);
    if (!projectId || list.length === 0) return;
    setUploadingFoto(true);
    setActieMsg(null);
    setUploadProgress(null);
    try {
      const uploaded: ProjectFoto[] = [];
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        setUploadProgress(`Uploaden ${i + 1}/${list.length}: ${file.name}`);
        const form = new FormData();
        form.append("file", file);
        form.append("omschrijving", "Installateur-notitie");
        const res = await fetch(`/api/projecten/${projectId}/fotos`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Foto upload mislukt");
        uploaded.push(data.foto as ProjectFoto);
      }
      setProjectFotos((prev) => [...prev, ...uploaded]);
      setActieMsg(
        uploaded.length === 1
          ? "1 foto geüpload."
          : `${uploaded.length} foto's geüpload.`
      );
    } catch (e) {
      setActieMsg(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploadingFoto(false);
      setUploadProgress(null);
    }
  }

  async function downloadPdf() {
    if (!offerte) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const res = await fetch(`/api/offertes/${offerte.id}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "PDF downloaden mislukt");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        offerte.status === "ondertekend"
          ? `${offerte.offerte_nummer}-ondertekend.pdf`
          : `${offerte.offerte_nummer}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "PDF mislukt");
    } finally {
      setPdfBusy(false);
    }
  }

  async function verstuurOfferte() {
    if (!offerte) return;
    setVerstuurBusy(true);
    setVerstuurMsg(null);
    setPdfError(null);
    try {
      const res = await fetch(`/api/offertes/${offerte.id}/verstuur`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setVerstuurMsg(
        offerte.leads?.email
          ? `Offerte verstuurd naar ${offerte.leads.email}.`
          : "Offerte verstuurd."
      );
      await load();
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setVerstuurBusy(false);
    }
  }

  if (loading) {
    return (
      <DetailShell activeTab="offertes">
        <p className="py-20 text-center text-sm text-muted">Offerte laden…</p>
      </DetailShell>
    );
  }

  if (notFound || !offerte) {
    return (
      <NotFoundState
        title="Offerte niet gevonden"
        backHref="/?tab=offertes"
        backLabel="Terug naar offertes"
        activeTab="offertes"
      />
    );
  }

  return (
    <DetailShell onRefresh={load} loading={loading} activeTab="offertes">
      <Breadcrumb
        items={[
          { label: "Offertes", href: "/?tab=offertes" },
          { label: offerte.offerte_nummer },
        ]}
      />

      <HeroCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs font-semibold text-green-dark">
              {offerte.offerte_nummer}
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight text-green-deeper sm:text-4xl">
              {offerte.titel || "Offerte"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              Aangemaakt {formatDateTimeNl(offerte.created_at)}
              {offerte.status === "concept"
                ? " · Concept (nog niet verzonden)"
                : ""}
            </p>
          </div>
          <StatusBadge kind="offerte" value={offerte.status} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoTile
            label="Lead"
            value={offerte.leads?.lead_number || offerte.lead_id.slice(0, 8)}
            href={`/leads/${offerte.lead_id}`}
            accent
          />
          <InfoTile label="Klant" value={offerte.leads?.naam} />
          <InfoTile
            label="Installateur (intern)"
            value={offerte.installatie_partners?.naam || "Niet gekoppeld"}
          />
          <InfoTile
            label="Totaal incl. btw"
            value={formatEuro(offerte.totaal_inc_btw)}
          />
          <InfoTile
            label="Geldig tot"
            value={formatDateShort(offerte.geldig_tot)}
          />
          {offerte.status === "ondertekend" && (
            <div className="border border-line bg-wash px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Backoffice
              </p>
              {offerte.actie_required ? (
                <button
                  type="button"
                  onClick={() => setActieOpen(true)}
                  className="mt-1 border border-[#C45A12]/35 bg-[#FFF0E6] px-2 py-1 text-xs font-semibold text-[#C45A12] hover:bg-[#ffe6d4]"
                >
                  ACTIE vereist
                </button>
              ) : (
                <p className="mt-1 text-sm font-medium text-green-dark">
                  Afgerond
                </p>
              )}
            </div>
          )}
        </div>

        {offerte.intro_tekst && (
          <p className="mt-6 border-t border-line pt-6 text-sm leading-relaxed text-ink">
            {offerte.intro_tekst}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={pdfBusy || verstuurBusy}
            onClick={() => void downloadPdf()}
            className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            {pdfBusy ? "PDF laden…" : "PDF downloaden"}
          </button>
          {offerte.status !== "ondertekend" && (
            <button
              type="button"
              disabled={verstuurBusy || pdfBusy || !offerte.leads?.email}
              onClick={() => void verstuurOfferte()}
              className="bg-orange px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50"
              title={
                offerte.leads?.email
                  ? `Mail naar ${offerte.leads.email}`
                  : "Lead heeft geen e-mail"
              }
            >
              {verstuurBusy
                ? "Verzenden…"
                : offerte.status === "concept"
                  ? "Verstuur offerte"
                  : "Opnieuw versturen"}
            </button>
          )}
          {offerte.sign_token && offerte.status !== "ondertekend" && (
              <a
                href={`/offerte/${offerte.sign_token}`}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
              >
                Open ondertekenlink →
              </a>
            )}
          {offerte.status === "ondertekend" && (
            <>
              <span className="border border-green/25 bg-green-soft px-3 py-1.5 text-sm font-medium text-green-dark">
                Ondertekend door {offerte.ondertekend_naam} op{" "}
                {formatDateNl(offerte.ondertekend_op)}
              </span>
              <button
                type="button"
                onClick={() => setActieOpen(true)}
                className={
                  offerte.actie_required
                    ? "border border-[#C45A12]/35 bg-[#FFF0E6] px-4 py-2 text-sm font-semibold text-[#C45A12] hover:bg-[#ffe6d4]"
                    : "border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
                }
              >
                Backoffice
              </button>
            </>
          )}
        </div>
        {verstuurMsg && (
          <p className="mt-3 text-sm font-medium text-green-dark">{verstuurMsg}</p>
        )}
        {pdfError && (
          <p className="mt-3 text-sm text-[#C62828]">{pdfError}</p>
        )}
      </HeroCard>

      {offerte.status === "ondertekend" && actieOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-line bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
                  Actie vereist
                </p>
                <h3 className="mt-1 text-lg font-semibold text-ink">
                  Backoffice invullen
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Betaalroute:{" "}
                  <span className="font-semibold text-ink">
                    {offerte.financiering_voorbehoud
                      ? "Warmtefonds"
                      : "Eigen middelen"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActieOpen(false)}
                className="h-10 w-10 text-xl text-muted hover:bg-wash"
                aria-label="Popup sluiten"
              >
                ×
              </button>
            </div>

            <div className="mt-4">
              <BackofficeActieForm
                compact
                showFotoHint={projecten.length === 0}
                subtotaalExBtw={Number(offerte.subtotaal_ex_btw) || 0}
                btwBedrag={Number(offerte.btw_bedrag) || 0}
                totaalIncBtw={Number(offerte.totaal_inc_btw) || 0}
                financieringVoorbehoud={Boolean(
                  offerte.financiering_voorbehoud
                )}
                adviseurNaam={(() => {
                  const lead = Array.isArray(offerte.leads)
                    ? offerte.leads[0]
                    : offerte.leads;
                  const adv = lead?.adviseurs;
                  const naam = Array.isArray(adv) ? adv[0]?.naam : adv?.naam;
                  return naam || "Nog niet toegewezen";
                })()}
                sessionNaam={sessionNaam}
                values={{
                  aanbetalingModus,
                  aanbetalingHandmatig,
                  backofficeNotitie,
                  installateurNotitie,
                }}
                onChange={(patch: Partial<BackofficeActieFormValues>) => {
                  if (patch.aanbetalingModus != null) {
                    setAanbetalingModus(patch.aanbetalingModus);
                  }
                  if (patch.aanbetalingHandmatig != null) {
                    setAanbetalingHandmatig(patch.aanbetalingHandmatig);
                  }
                  if (patch.backofficeNotitie != null) {
                    setBackofficeNotitie(patch.backofficeNotitie);
                  }
                  if (patch.installateurNotitie != null) {
                    setInstallateurNotitie(patch.installateurNotitie);
                  }
                }}
                disabled={actieSaving}
              />
            </div>
            {projecten.length > 0 && (
              <div className="mt-3">
                <label className="inline-flex cursor-pointer items-center border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash">
                  {uploadingFoto ? "Uploaden…" : "Foto's uploaden"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    disabled={uploadingFoto}
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0)
                        void uploadInstallateurFotos(files);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploadProgress && (
                  <p className="mt-1 text-xs text-muted">{uploadProgress}</p>
                )}
                {projectFotos.length > 0 && (
                  <>
                    <p className="mt-2 text-xs text-muted">
                      {projectFotos.length} foto&apos;s gekoppeld aan project.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {projectFotos.map((foto) => (
                        <a
                          key={foto.id}
                          href={foto.url || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className="group relative block overflow-hidden border border-line bg-wash"
                        >
                          {foto.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={foto.url}
                              alt={foto.bestandsnaam || "Project foto"}
                              className="h-24 w-full object-cover transition group-hover:scale-[1.02]"
                            />
                          ) : (
                            <div className="flex h-24 items-center justify-center text-xs text-muted">
                              Geen preview
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {actieMsg && <p className="mt-3 text-sm text-muted">{actieMsg}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={actieSaving}
                onClick={() => void saveBackofficeActie(true)}
                className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                Actie afronden
              </button>
              <button
                type="button"
                onClick={() => setActieOpen(false)}
                className="border border-line px-4 py-2 text-sm font-semibold text-muted hover:bg-wash"
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      <Panel
        title="Regels"
        subtitle={`${regels.filter((r) => !isKortingRegel(r)).length} producten`}
      >
        {(() => {
          const productRegels = regels.filter((r) => !isKortingRegel(r));
          const kortingInc = kortingIncVanRegels(regels);
          return (
            <>
        {productRegels.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted">
            Geen regels op deze offerte.
          </p>
        ) : (
          <table className="crm-table">
            <thead>
              <tr>
                <th>Omschrijving</th>
                <th>Aantal</th>
                <th>Prijs</th>
                <th>Totaal</th>
              </tr>
            </thead>
            <tbody>
              {productRegels.map((r) => (
                <tr key={r.id}>
                  <td>{r.omschrijving}</td>
                  <td>{r.aantal}</td>
                  <td>{formatEuro(r.prijs_ex_btw)}</td>
                  <td className="font-medium">
                    {formatEuro(r.totaal_ex_btw ?? r.aantal * r.prijs_ex_btw)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="mt-4 space-y-1 border-t border-line px-3 pt-4 text-right text-sm">
          <p className="text-muted">
            Subtotaal excl. btw{" "}
            <span className="ml-4 inline-block w-28 text-ink">
              {formatEuro(offerte.subtotaal_ex_btw)}
            </span>
          </p>
          <p className="text-muted">
            Btw{" "}
            <span className="ml-4 inline-block w-28 text-ink">
              {formatEuro(offerte.btw_bedrag)}
            </span>
          </p>
          {kortingInc < 0 && (
            <p className="font-semibold text-green-deeper">
              Korting{" "}
              <span className="ml-4 inline-block w-28">
                {formatEuro(kortingInc)}
              </span>
            </p>
          )}
          <p className="font-display text-lg font-semibold text-green-deeper">
            Totaal{" "}
            <span className="ml-4 inline-block w-28">
              {formatEuro(offerte.totaal_inc_btw)}
            </span>
          </p>
        </div>
            </>
          );
        })()}
      </Panel>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Panel title="Gekoppelde backoffice" subtitle={`${projecten.length}`}>
          {projecten.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              {offerte.actie_required
                ? "Nog niet in backoffice — rond eerst de actie af."
                : "Geen backoffice items"}
            </p>
          ) : (
            <ul className="space-y-2 px-2">
              {projecten.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/projecten/${p.id}`}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-green-soft"
                  >
                    <span className="font-mono text-xs font-semibold text-green-dark">
                      {p.project_nummer}
                    </span>
                    <StatusBadge kind="project" value={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Gekoppelde facturen" subtitle={`${facturen.length}`}>
          {facturen.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted">
              Geen facturen
            </p>
          ) : (
            <ul className="space-y-2 px-2">
              {facturen.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/facturen/${f.id}`}
                    className="flex items-center justify-between px-3 py-2.5 hover:bg-green-soft"
                  >
                    <span className="font-mono text-xs font-semibold text-green-dark">
                      {f.factuur_nummer}
                    </span>
                    <span className="text-sm font-medium">
                      {formatEuro(f.bedrag_inc_btw)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <BackLink href="/?tab=offertes" label="Alle offertes" />
    </DetailShell>
  );
}
