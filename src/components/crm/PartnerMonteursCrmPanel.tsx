"use client";

import { useCallback, useEffect, useState } from "react";
import type { InstallatiePartnerTeamgenoot } from "@/types/database";

type DocKey = "kvk_uitreksel" | "certificaten" | "foto" | "cv";

const DOC_FIELDS: {
  key: DocKey;
  label: string;
  required: boolean;
  accept: string;
}[] = [
  {
    key: "kvk_uitreksel",
    label: "KvK-uittreksel",
    required: true,
    accept: ".pdf,image/*",
  },
  {
    key: "certificaten",
    label: "Certificeringen",
    required: true,
    accept: ".pdf,image/*",
  },
  {
    key: "foto",
    label: "Foto",
    required: true,
    accept: "image/*",
  },
  {
    key: "cv",
    label: "CV",
    required: false,
    accept: ".pdf,image/*",
  },
];

export function PartnerMonteursCrmPanel({
  partnerId,
  partnerNaam,
}: {
  partnerId: string;
  partnerNaam: string;
}) {
  const [items, setItems] = useState<InstallatiePartnerTeamgenoot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [openAdd, setOpenAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [naam, setNaam] = useState("");
  const [email, setEmail] = useState("");
  const [telefoon, setTelefoon] = useState("");
  const [files, setFiles] = useState<Partial<Record<DocKey, File | null>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerId)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]);
      setHint(data.hint || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMonteur(e: React.FormEvent) {
    e.preventDefault();
    if (!naam.trim() || !files.kvk_uitreksel || !files.certificaten || !files.foto)
      return;
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const fd = new FormData();
      fd.append("partner_id", partnerId);
      fd.append("naam", naam.trim());
      if (email.trim()) fd.append("email", email.trim());
      if (telefoon.trim()) fd.append("telefoon", telefoon.trim());
      for (const doc of DOC_FIELDS) {
        const f = files[doc.key];
        if (f) fd.append(doc.key, f);
      }
      const res = await fetch("/api/installatie-partners/teamgenoten", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toevoegen mislukt");
      setNaam("");
      setEmail("");
      setTelefoon("");
      setFiles({});
      setOpenAdd(false);
      setOkMsg(`${data.teamgenoot.naam} toegevoegd`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDoc(id: string, type: DocKey, file: File) {
    setError(null);
    try {
      const fd = new FormData();
      fd.append("id", id);
      fd.append("partner_id", partnerId);
      fd.append("type", type);
      fd.append("file", file);
      const res = await fetch("/api/installatie-partners/teamgenoten", {
        method: "PATCH",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      const updated = data.teamgenoot as InstallatiePartnerTeamgenoot;
      setItems((list) => list.map((t) => (t.id === id ? updated : t)));
      setOkMsg("Document geüpload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload mislukt");
    }
  }

  async function setActief(id: string, actief: boolean) {
    try {
      const res = await fetch("/api/installatie-partners/teamgenoten", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, partner_id: partnerId, actief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bijwerken mislukt");
      setItems((list) =>
        list.map((t) => (t.id === id ? { ...t, actief } : t))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bijwerken mislukt");
    }
  }

  const compleet = items.filter((t) => t.actief && t.dossier_compleet).length;
  const incompleet = items.filter((t) => t.actief && !t.dossier_compleet).length;

  return (
    <div className="border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Monteurs · {partnerNaam}
          </p>
          <p className="mt-1 text-sm text-muted">
            {compleet} inzetbaar
            {incompleet > 0 ? ` · ${incompleet} dossier incompleet` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpenAdd((v) => !v)}
          className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
        >
          {openAdd ? "Sluiten" : "+ Monteur"}
        </button>
      </div>

      {hint ? (
        <p className="mt-3 border border-[#E8D48B] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-[#C45A12]">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="mt-3 text-sm text-green-dark">{okMsg}</p>
      ) : null}

      {openAdd ? (
        <form
          onSubmit={(e) => void addMonteur(e)}
          className="mt-3 grid gap-2 border border-line bg-wash p-3 sm:grid-cols-2"
        >
          <input
            required
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="Naam *"
            className="border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green sm:col-span-2"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
            className="border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          <input
            value={telefoon}
            onChange={(e) => setTelefoon(e.target.value)}
            placeholder="Telefoon"
            className="border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          {DOC_FIELDS.map((doc) => (
            <label
              key={doc.key}
              className="block text-[10px] font-semibold uppercase tracking-wide text-muted"
            >
              {doc.label}
              {doc.required ? " *" : ""}
              <input
                type="file"
                accept={doc.accept}
                required={doc.required}
                onChange={(e) =>
                  setFiles((p) => ({
                    ...p,
                    [doc.key]: e.target.files?.[0] || null,
                  }))
                }
                className="mt-1 block w-full text-xs"
              />
            </label>
          ))}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </form>
      ) : null}

      {loading ? (
        <p className="mt-3 text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Nog geen monteurs. Partner kan ze ook zelf toevoegen in het portaal.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line border border-line bg-white">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p
                  className={[
                    "text-sm font-semibold",
                    t.actief === false
                      ? "text-muted line-through"
                      : "text-ink",
                  ].join(" ")}
                >
                  {t.naam}
                </p>
                <p className="text-[11px] text-muted">
                  {t.dossier_compleet ? (
                    <span className="font-semibold text-green-dark">
                      Compleet
                    </span>
                  ) : (
                    <span className="font-semibold text-[#C45A12]">
                      Incompleet
                    </span>
                  )}
                  {t.email ? ` · ${t.email}` : ""}
                </p>
                {!t.dossier_compleet && t.actief !== false ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {DOC_FIELDS.filter((doc) => {
                      if (doc.key === "kvk_uitreksel")
                        return !t.kvk_uitreksel_storage_path;
                      if (doc.key === "certificaten")
                        return !t.certificaten_storage_path;
                      if (doc.key === "foto") return !t.foto_storage_path;
                      return !t.cv_storage_path && !doc.required;
                    }).map((doc) => (
                      <label
                        key={doc.key}
                        className="cursor-pointer border border-line bg-wash px-2 py-0.5 text-[10px] font-semibold"
                      >
                        + {doc.label}
                        <input
                          type="file"
                          accept={doc.accept}
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadDoc(t.id, doc.key, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  void setActief(t.id, t.actief === false)
                }
                className="border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-muted hover:bg-wash"
              >
                {t.actief === false ? "Activeren" : "Deactiveren"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
