"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function initials(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

type Profile = {
  id: string;
  naam: string;
  email: string | null;
  profielfoto_url: string | null;
  commissie_pct?: number | null;
  migration_needed?: boolean;
};

export function AdviseurInstellingenPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/adviseurs/profielfoto");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Laden mislukt"
        );
      }
      setProfile(json as Profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    setOkMsg(null);
    try {
      const fd = new FormData();
      fd.set("foto", file);
      const res = await fetch("/api/adviseurs/profielfoto", {
        method: "POST",
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Upload mislukt"
        );
      }
      const url = (json as { profielfoto_url?: string }).profielfoto_url || null;
      setProfile((p) => (p ? { ...p, profielfoto_url: url } : p));
      setOkMsg("Profielfoto opgeslagen");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload mislukt");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeFoto() {
    setUploading(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/adviseurs/profielfoto", {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (json as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      setProfile((p) => (p ? { ...p, profielfoto_url: null } : p));
      setOkMsg("Profielfoto verwijderd");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setUploading(false);
    }
  }

  if (loading && !profile) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted sm:px-5">
        Laden…
      </p>
    );
  }

  const naam = profile?.naam || "Jij";
  const foto = profile?.profielfoto_url;
  const commissiePct =
    profile?.commissie_pct != null &&
    Number.isFinite(Number(profile.commissie_pct))
      ? Number(profile.commissie_pct)
      : null;

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="font-display text-base font-semibold text-ink">
            Instellingen
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Profielfoto voor weekmeeting en teamweergaves
          </p>
        </div>

        <div className="px-4 py-5 sm:px-5">
          {profile?.migration_needed ? (
            <p className="mb-4 rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              Database-migratie nodig: migrate-adviseur-profielfoto.sql
            </p>
          ) : null}

          {error ? (
            <p className="mb-4 rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}
            </p>
          ) : null}
          {okMsg ? (
            <p className="mb-4 rounded-xl border border-green/25 bg-green-soft px-3 py-2 text-xs text-green-dark">
              {okMsg}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-5">
            <div
              className={[
                "relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl ring-1 ring-line",
                foto ? "bg-wash" : "bg-[#0a4727]",
              ].join(" ")}
            >
              {foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={foto}
                  alt={naam}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
                  {initials(naam)}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <p className="font-semibold text-ink">{naam}</p>
              {profile?.email ? (
                <p className="text-sm text-muted">{profile.email}</p>
              ) : null}
              {commissiePct != null && commissiePct > 0 ? (
                <p className="text-sm text-ink">
                  Commissie{" "}
                  <span className="font-semibold tabular-nums">
                    {commissiePct.toLocaleString("nl-NL", {
                      maximumFractionDigits: 2,
                    })}
                    %
                  </span>
                  <span className="text-muted"> · van omzet excl. btw</span>
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-1">
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                  className="rounded-xl bg-green px-3.5 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {uploading
                    ? "Bezig…"
                    : foto
                      ? "Foto wijzigen"
                      : "Foto uploaden"}
                </button>
                {foto ? (
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => void removeFoto()}
                    className="rounded-xl border border-line bg-white px-3.5 py-2 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                  >
                    Verwijderen
                  </button>
                ) : null}
              </div>
              <p className="text-[11px] text-muted">
                JPG of PNG · max. 5 MB · zichtbaar in weekmeeting
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
