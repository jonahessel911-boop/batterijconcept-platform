"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Project, ProjectFoto } from "@/types/database";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";
import { resolveProjectStatusLabel } from "@/lib/labels";
import {
  isFotoBatterij,
  isFotoMeterkast,
  isOpleveringsrapport,
  isSchouwFormulier,
  isVideoInstallatie,
} from "@/lib/project-documenten";
import { medewerkerNaamVanProject } from "@/lib/project-medewerker";
import { AdresSatellietKaart } from "@/components/installatie/AdresSatellietKaart";

type Props = {
  project: Project;
  fotos?: ProjectFoto[];
  authorNaam?: string | null;
  onUpdated: (project: Project) => void;
};

function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      onMouseLeave={() => setHover(null)}
    >
      <button
        type="button"
        disabled={disabled}
        title="0 sterren"
        onClick={() => onChange(0)}
        className={[
          "inline-flex h-9 min-w-9 items-center justify-center border text-sm font-semibold disabled:opacity-50",
          value === 0
            ? "border-line bg-wash text-ink"
            : "border-line bg-white text-muted hover:bg-wash",
        ].join(" ")}
      >
        0
      </button>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = shown != null && shown >= n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            title={`${n} ster${n === 1 ? "" : "ren"}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
            className={[
              "inline-flex h-9 min-w-9 items-center justify-center border text-base leading-none disabled:opacity-50",
              filled
                ? "border-[#D97706] bg-[#FFFBEB] text-[#B45309]"
                : "border-line bg-white text-muted hover:border-[#D97706]/50 hover:text-[#B45309]",
            ].join(" ")}
          >
            ★
          </button>
        );
      })}
      <span className="ml-2 text-sm text-muted">
        {value == null ? "Nog geen score" : `${value} / 5`}
      </span>
    </div>
  );
}

export function ProjectInstallatiesTab({
  project,
  fotos = [],
  authorNaam,
  onUpdated,
}: Props) {
  const medewerker = medewerkerNaamVanProject(project);
  const [sterren, setSterren] = useState<number | null>(
    typeof project.monteur_beoordeling_sterren === "number"
      ? project.monteur_beoordeling_sterren
      : null
  );
  const [notitie, setNotitie] = useState(
    project.monteur_beoordeling_notitie || ""
  );
  const [kvSterren, setKvSterren] = useState<number | null>(
    typeof project.klantvriendelijkheid_sterren === "number"
      ? project.klantvriendelijkheid_sterren
      : null
  );
  const [kvNotitie, setKvNotitie] = useState(
    project.klantvriendelijkheid_notitie || ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    setSterren(
      typeof project.monteur_beoordeling_sterren === "number"
        ? project.monteur_beoordeling_sterren
        : null
    );
    setNotitie(project.monteur_beoordeling_notitie || "");
    setKvSterren(
      typeof project.klantvriendelijkheid_sterren === "number"
        ? project.klantvriendelijkheid_sterren
        : null
    );
    setKvNotitie(project.klantvriendelijkheid_notitie || "");
  }, [
    project.id,
    project.monteur_beoordeling_sterren,
    project.monteur_beoordeling_notitie,
    project.klantvriendelijkheid_sterren,
    project.klantvriendelijkheid_notitie,
  ]);

  const schouwDoc = useMemo(() => {
    const docs = fotos
      .filter((f) => isSchouwFormulier(f.omschrijving) && f.url)
      .sort((a, b) =>
        String(a.created_at || "").localeCompare(String(b.created_at || ""))
      );
    return docs[docs.length - 1] || null;
  }, [fotos]);

  const meterkastFoto = useMemo(() => {
    const docs = fotos.filter((f) => isFotoMeterkast(f.omschrijving) && f.url);
    return docs[docs.length - 1] || null;
  }, [fotos]);

  const opleverDoc = useMemo(() => {
    const docs = fotos
      .filter((f) => isOpleveringsrapport(f.omschrijving) && f.url)
      .sort((a, b) =>
        String(a.created_at || "").localeCompare(String(b.created_at || ""))
      );
    return docs[docs.length - 1] || null;
  }, [fotos]);

  const batterijFoto = useMemo(() => {
    const docs = fotos.filter((f) => isFotoBatterij(f.omschrijving) && f.url);
    return docs[docs.length - 1] || null;
  }, [fotos]);

  const videoInstallatie = useMemo(() => {
    const docs = fotos.filter(
      (f) => isVideoInstallatie(f.omschrijving) && f.url
    );
    return docs[docs.length - 1] || null;
  }, [fotos]);

  const lead = useMemo(() => {
    const l = project.leads;
    return Array.isArray(l) ? l[0] : l;
  }, [project.leads]);

  const dirty =
    sterren !==
      (typeof project.monteur_beoordeling_sterren === "number"
        ? project.monteur_beoordeling_sterren
        : null) ||
    notitie.trim() !== (project.monteur_beoordeling_notitie || "").trim() ||
    kvSterren !==
      (typeof project.klantvriendelijkheid_sterren === "number"
        ? project.klantvriendelijkheid_sterren
        : null) ||
    kvNotitie.trim() !== (project.klantvriendelijkheid_notitie || "").trim();

  async function save() {
    setBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monteur_beoordeling_sterren: sterren,
          monteur_beoordeling_notitie: notitie.trim() || null,
          monteur_beoordeling_door: authorNaam || null,
          klantvriendelijkheid_sterren: kvSterren,
          klantvriendelijkheid_notitie: kvNotitie.trim() || null,
          klantvriendelijkheid_door: authorNaam || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      onUpdated(data.project as Project);
      setOkMsg("Beoordeling opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="border border-line bg-white px-4 py-5 sm:px-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Installatie · medewerker
        </h2>
        <p className="mt-1 text-sm text-muted">
          Wat is er gedaan op deze klus, en hoe beoordeel je de uitvoerende
          monteur.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="border border-line bg-[#FAFBFA] px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Medewerker
            </p>
            <p className="mt-1 font-semibold text-ink">
              {medewerker || "Nog niet gekoppeld"}
            </p>
            {project.installatie_partners ? (
              <p className="mt-0.5 text-sm text-muted">
                {(Array.isArray(project.installatie_partners)
                  ? project.installatie_partners[0]?.naam
                  : project.installatie_partners.naam) || "Partner"}
              </p>
            ) : null}
          </div>
          <div className="border border-line bg-[#FAFBFA] px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Status
            </p>
            <p className="mt-1 font-semibold text-ink">
              {resolveProjectStatusLabel(project.status, project)}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Schouw
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {project.schouw_at
                ? formatDateTimeNl(project.schouw_at)
                : "Nog geen schouwdatum"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Installatie
            </dt>
            <dd className="mt-1 text-sm text-ink">
              {project.installatie_at
                ? formatDateTimeNl(project.installatie_at)
                : "Nog geen installatiedatum"}
              {project.installatie_voltooid_at
                ? ` · voltooid ${formatDateShort(project.installatie_voltooid_at)}`
                : ""}
            </dd>
          </div>
        </dl>

        <div className="mt-4 space-y-3">
          <AdresSatellietKaart adres={lead} />
          {videoInstallatie?.url ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Video installatie
              </p>
              <video
                src={videoInstallatie.url}
                controls
                playsInline
                className="max-h-64 w-full border border-line bg-black"
              />
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {meterkastFoto?.url ? (
              <a
                href={meterkastFoto.url}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white"
              >
                Foto meterkast
              </a>
            ) : (
              <span className="border border-dashed border-line px-3 py-2 text-sm text-muted">
                Geen foto meterkast
              </span>
            )}
            {schouwDoc?.url ? (
              <a
                href={schouwDoc.url}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white"
              >
                Schouwformulier
              </a>
            ) : (
              <span className="border border-dashed border-line px-3 py-2 text-sm text-muted">
                Geen schouwformulier
              </span>
            )}
            {batterijFoto?.url ? (
              <a
                href={batterijFoto.url}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white"
              >
                Foto batterij
              </a>
            ) : (
              <span className="border border-dashed border-line px-3 py-2 text-sm text-muted">
                Geen foto batterij
              </span>
            )}
            {videoInstallatie?.url ? (
              <a
                href={videoInstallatie.url}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white"
              >
                Video installatie
              </a>
            ) : (
              <span className="border border-dashed border-line px-3 py-2 text-sm text-muted">
                Geen installatievideo
              </span>
            )}
            {opleverDoc?.url ? (
              <a
                href={opleverDoc.url}
                target="_blank"
                rel="noreferrer"
                className="border border-line bg-wash px-3 py-2 text-sm font-semibold text-ink hover:bg-white"
              >
                Opleverformulier
              </a>
            ) : (
              <span className="border border-dashed border-line px-3 py-2 text-sm text-muted">
                Geen opleverformulier
              </span>
            )}
          </div>
        </div>

        {(project.schouw_notities?.trim() ||
          project.installatie_notities?.trim()) && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {project.schouw_notities?.trim() ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Schouw-notities
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {project.schouw_notities.trim()}
                </p>
              </div>
            ) : null}
            {project.installatie_notities?.trim() ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Installatie-notities
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                  {project.installatie_notities.trim()}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="border border-line bg-white px-4 py-5 sm:px-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Beoordeling monteur
        </h2>
        <p className="mt-1 text-sm text-muted">
          Interne kwaliteitsscore (0–5) + notitie.
        </p>

        {!medewerker ? (
          <p className="mt-4 border border-[#E8D48B] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
            Koppel eerst een medewerker op het tabblad Medewerkers.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Sterren
              </p>
              <StarPicker
                value={sterren}
                onChange={setSterren}
                disabled={busy}
              />
            </div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Notitie
              <textarea
                value={notitie}
                onChange={(e) => setNotitie(e.target.value)}
                rows={3}
                disabled={busy}
                placeholder="Bijv. netjes gewerkt, aandachtspunt kabelroute…"
                className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
              />
            </label>
            {project.monteur_beoordeling_op ? (
              <p className="text-[11px] text-muted">
                Laatst beoordeeld{" "}
                {formatDateTimeNl(project.monteur_beoordeling_op)}
                {project.monteur_beoordeling_door
                  ? ` · ${project.monteur_beoordeling_door}`
                  : ""}
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section className="border border-line bg-white px-4 py-5 sm:px-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          Klantvriendelijkheid
        </h2>
        <p className="mt-1 text-sm text-muted">
          Score + notitie — zichtbaar voor de installatiepartner.
        </p>

        {!medewerker ? (
          <p className="mt-4 border border-[#E8D48B] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
            Koppel eerst een medewerker op het tabblad Medewerkers.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Sterren
              </p>
              <StarPicker
                value={kvSterren}
                onChange={setKvSterren}
                disabled={busy}
              />
            </div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Notitie
              <textarea
                value={kvNotitie}
                onChange={(e) => setKvNotitie(e.target.value)}
                rows={3}
                disabled={busy}
                placeholder="Hoe was de omgang met de klant?"
                className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-green disabled:opacity-60"
              />
            </label>
            {project.klantvriendelijkheid_op ? (
              <p className="text-[11px] text-muted">
                Laatst beoordeeld{" "}
                {formatDateTimeNl(project.klantvriendelijkheid_op)}
                {project.klantvriendelijkheid_door
                  ? ` · ${project.klantvriendelijkheid_door}`
                  : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  busy ||
                  !dirty ||
                  (sterren === null && kvSterren === null)
                }
                onClick={() => void save()}
                className="bg-green-deeper px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                {busy ? "Opslaan…" : "Beoordelingen opslaan"}
              </button>
              {project.installatie_teamgenoot_id ? (
                <Link
                  href={`/?tab=partners&partners=team&team=monteurs&teamgenoot=${encodeURIComponent(project.installatie_teamgenoot_id)}`}
                  className="border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-wash"
                >
                  Alle klussen van {medewerker}
                </Link>
              ) : null}
            </div>
          </div>
        )}

        {error ? (
          <p className="mt-3 border border-[#C45A12]/25 bg-[#FFF7F0] px-3 py-2 text-sm text-[#9A3412]">
            {error}
          </p>
        ) : null}
        {okMsg ? (
          <p className="mt-3 border border-green/25 bg-green-soft px-3 py-2 text-sm text-green-dark">
            {okMsg}
          </p>
        ) : null}
      </section>
    </div>
  );
}
