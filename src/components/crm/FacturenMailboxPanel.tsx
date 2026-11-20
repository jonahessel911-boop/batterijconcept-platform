"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import type { FactuurExtract } from "@/lib/facturen-inbox-parse";
import type { FacturenInboxItem } from "@/lib/facturen-inbox";
import type { InboxMail } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type Entry = {
  mail: InboxMail;
  item: FacturenInboxItem | null;
  extract: FactuurExtract;
  pdfAttachments: NonNullable<InboxMail["attachments"]>;
};

type DraftFields = {
  factuur_nummer: string;
  bedrijfsnaam: string;
  iban: string;
  bedrag_ex_btw: string;
  bedrag_inc_btw: string;
  btw_bedrag: string;
  vervaldatum: string;
  factuurdatum: string;
  referentie: string;
};

function fieldsFromEntry(e: Entry | null): DraftFields {
  const item = e?.item;
  const ex = e?.extract;
  const n = (v: number | null | undefined) =>
    v != null && Number.isFinite(v) ? String(v) : "";
  return {
    factuur_nummer: item?.factuur_nummer || ex?.factuur_nummer || "",
    bedrijfsnaam: item?.bedrijfsnaam || ex?.bedrijfsnaam || "",
    iban: item?.iban || ex?.iban || "",
    bedrag_ex_btw: n(item?.bedrag_ex_btw ?? ex?.bedrag_ex_btw),
    bedrag_inc_btw: n(item?.bedrag_inc_btw ?? ex?.bedrag_inc_btw),
    btw_bedrag: n(item?.btw_bedrag ?? ex?.btw_bedrag),
    vervaldatum: item?.vervaldatum || ex?.vervaldatum || "",
    factuurdatum: item?.factuurdatum || ex?.factuurdatum || "",
    referentie: item?.referentie || ex?.referentie || "",
  };
}

function parseAmount(s: string): number | null {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function statusLabel(status: string | null | undefined) {
  if (status === "goedgekeurd") return "Goedgekeurd";
  if (status === "betaald") return "BETAALD";
  if (status === "afgewezen") return "Afgewezen";
  return "Te goedkeuren";
}

function Field({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#E5E5EA] bg-white px-3 py-2 text-[14px] text-[#1C1C1E] outline-none focus:border-[#007AFF] disabled:bg-[#F2F2F7] disabled:text-[#8E8E93]"
      />
    </label>
  );
}

const AUTO_SYNC_MS = 10 * 60 * 1000;

export function FacturenMailboxPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [email, setEmail] = useState("facturen@batterijconcept.nl");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftFields>(fieldsFromEntry(null));
  const [filter, setFilter] = useState<"open" | "all" | "goedgekeurd">("open");
  /** Reset auto-sync timer na handmatige sync. */
  const [syncEpoch, setSyncEpoch] = useState(0);
  const syncingRef = useRef(false);

  const selected = useMemo(
    () => entries.find((e) => e.mail.id === selectedId) || null,
    [entries, selectedId]
  );

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "goedgekeurd") {
      return entries.filter(
        (e) =>
          e.item?.status === "goedgekeurd" || e.item?.status === "betaald"
      );
    }
    return entries.filter(
      (e) => !e.item || e.item.status === "te_goedkeuren"
    );
  }, [entries, filter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/facturen-inbox?limit=200", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = (data.entries as Entry[]) || [];
      setEntries(list);
      if (data.email) setEmail(String(data.email));
      setConfigured(Boolean(data.configured));
      setHint(typeof data.hint === "string" ? data.hint : null);
      const auto = data.autoSync as
        | { inserted?: number; errors?: string[] }
        | undefined;
      if (auto && Number(auto.inserted) > 0) {
        setMsg(`IMAP: ${auto.inserted} nieuwe factuurmail(s) opgehaald`);
      }
      if (Array.isArray(auto?.errors) && auto.errors.length) {
        setError(auto.errors.slice(0, 3).join(" · "));
      }
      setSelectedId((prev) => {
        if (prev && list.some((e) => e.mail.id === prev)) return prev;
        return list[0]?.mail.id || null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = useCallback(
    async (opts?: { recent?: boolean; quiet?: boolean }) => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      if (!opts?.quiet) {
        setMsg(null);
        setError(null);
      }
      try {
        const recent = Boolean(opts?.recent);
        const res = await fetch("/api/facturen-inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recent, max: recent ? 60 : 40 }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Sync mislukt");
        const summary = `Sync: ${data.fetched || 0} opgehaald · ${data.inserted || 0} nieuw · ${data.skipped || 0} overgeslagen`;
        if (!opts?.quiet || Number(data.inserted) > 0) {
          setMsg(summary);
        }
        if (Array.isArray(data.errors) && data.errors.length) {
          setError(data.errors.slice(0, 3).join(" · "));
        }
        if (Array.isArray(data.entries)) {
          const list = data.entries as Entry[];
          setEntries(list);
          setSelectedId((prev) => {
            if (prev && list.some((e) => e.mail.id === prev)) return prev;
            return prev || list[0]?.mail.id || null;
          });
        } else {
          await load();
        }
        if (typeof data.hint === "string") setHint(data.hint);
        if (typeof data.configured === "boolean") {
          setConfigured(data.configured);
        }
      } catch (e) {
        if (!opts?.quiet) {
          setError(e instanceof Error ? e.message : "Sync mislukt");
        }
      } finally {
        syncingRef.current = false;
        setSyncing(false);
        setSyncEpoch((n) => n + 1);
      }
    },
    [load]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // IMAP auto-sync elke 10 min; Sync-knop reset de timer (syncEpoch).
  useEffect(() => {
    if (!configured) return;
    const id = window.setInterval(() => {
      void sync({ recent: true, quiet: true });
    }, AUTO_SYNC_MS);
    return () => window.clearInterval(id);
  }, [configured, sync, syncEpoch]);

  // Eerste sync zodra IMAP geconfigureerd is (na initial load).
  // Quiet=false als inbox leeg is, zodat sync-fouten zichtbaar zijn.
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (!configured || initialSyncDone.current || loading) return;
    initialSyncDone.current = true;
    void sync({ recent: true, quiet: entries.length > 0 });
  }, [configured, sync, loading, entries.length]);

  useEffect(() => {
    setDraft(fieldsFromEntry(selected));
  }, [selected?.mail.id, selected?.item?.updated_at, selected?.extract]);

  async function savePatch(
    extra?: { status?: FacturenInboxItem["status"] },
    opts?: { silent?: boolean }
  ) {
    if (!selected) return;
    setSaving(true);
    setError(null);
    if (!opts?.silent) setMsg(null);
    try {
      const res = await fetch("/api/facturen-inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: selected.item?.id,
          inbox_mail_id: selected.mail.id,
          status: extra?.status,
          factuur_nummer: draft.factuur_nummer.trim() || null,
          bedrijfsnaam: draft.bedrijfsnaam.trim() || null,
          iban: draft.iban.replace(/\s+/g, "").toUpperCase() || null,
          bedrag_ex_btw: parseAmount(draft.bedrag_ex_btw),
          bedrag_inc_btw: parseAmount(draft.bedrag_inc_btw),
          btw_bedrag: parseAmount(draft.btw_bedrag),
          vervaldatum: draft.vervaldatum.trim() || null,
          factuurdatum: draft.factuurdatum.trim() || null,
          referentie: draft.referentie.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const item = data.item as FacturenInboxItem;
      setEntries((prev) =>
        prev.map((e) =>
          e.mail.id === selected.mail.id ? { ...e, item } : e
        )
      );
      if (extra?.status === "goedgekeurd") {
        setMsg(
          `Goedgekeurd — meegenomen in uitbetaling wo ${item.betaal_woensdag || "…"}`
        );
      } else if (extra?.status === "betaald") {
        setMsg("BETAALD — staat in Uitbetalingen onder Betaald");
      } else if (extra?.status === "afgewezen") {
        setMsg("Factuur afgewezen");
      } else if (!opts?.silent) {
        setMsg("Opgeslagen");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  const locked =
    selected?.item?.status === "goedgekeurd" ||
    selected?.item?.status === "betaald";

  const primaryPdf = selected?.pdfAttachments[0] || null;
  const pdfUrl = primaryPdf
    ? `/api/inbox/${encodeURIComponent(selected!.mail.id)}/attachments/${encodeURIComponent(primaryPdf.id)}`
    : null;

  return (
    <div className="flex h-full min-h-[70vh] flex-col bg-[#F5F5F7]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#E5E5EA] bg-white/90 px-4 py-2.5 backdrop-blur">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#1C1C1E]">
            Facturen Inbox
          </h2>
          <p className="truncate text-[12px] text-[#8E8E93]">
            {email}
            {!configured
              ? " · IMAP nog niet geconfigureerd"
              : " · auto-sync elke 10 min"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["open", "Open"],
              ["goedgekeurd", "Goedgekeurd"],
              ["all", "Alles"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full px-2.5 py-1 text-[12px] font-semibold transition",
                filter === key
                  ? "bg-[#007AFF] text-white"
                  : "bg-[#F2F2F7] text-[#3A3A3C] hover:bg-[#E5E5EA]"
              )}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            disabled={syncing || !configured}
            onClick={() => void sync({ recent: false, quiet: false })}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#007AFF] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
          >
            {syncing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Sync
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded-lg bg-[#F2F2F7] px-3 py-1.5 text-[12px] font-semibold text-[#3A3A3C]"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      {msg ? (
        <p className="shrink-0 border-b border-green/20 bg-green-soft/50 px-4 py-2 text-[12px] text-green-deeper">
          {msg}
        </p>
      ) : null}
      {error ? (
        <p className="shrink-0 border-b border-[#FF3B30]/20 bg-[#FFEBEE] px-4 py-2 text-[12px] text-[#C62828]">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="shrink-0 border-b border-[#FF9500]/25 bg-[#FFF4E5] px-4 py-2 text-[12px] text-[#9A5B00]">
          {hint}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(17rem,22rem)]">
        {/* Lijst — Apple Mail style */}
        <div className="flex min-h-0 flex-col border-r border-[#E5E5EA] bg-white">
          <div className="shrink-0 border-b border-[#E5E5EA] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
            {filtered.length} facturen
          </div>
          {loading && !entries.length ? (
            <p className="p-4 text-sm text-[#8E8E93]">Laden…</p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <Inbox className="size-8 text-[#C7C7CC]" />
              <p className="text-sm text-[#8E8E93]">
                Geen facturen. Sync IMAP of wacht op inkomende mail.
              </p>
            </div>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {filtered.map((e) => {
                const active = e.mail.id === selectedId;
                const st = e.item?.status || "te_goedkeuren";
                const bedrag =
                  e.item?.bedrag_inc_btw ??
                  e.extract.bedrag_inc_btw ??
                  e.item?.bedrag_ex_btw ??
                  e.extract.bedrag_ex_btw;
                return (
                  <li key={e.mail.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.mail.id)}
                      className={cn(
                        "w-full border-b border-[#F2F2F7] px-3 py-2.5 text-left transition",
                        active
                          ? "bg-[#007AFF] text-white"
                          : "hover:bg-[#F2F2F7]"
                      )}
                    >
                      <div
                        className={cn(
                          "truncate text-[13px] font-semibold",
                          active ? "text-white" : "text-[#1C1C1E]"
                        )}
                      >
                        {e.item?.bedrijfsnaam ||
                          e.extract.bedrijfsnaam ||
                          e.mail.fromName ||
                          e.mail.fromEmail}
                      </div>
                      <div
                        className={cn(
                          "truncate text-[12px]",
                          active ? "text-white/85" : "text-[#3A3A3C]"
                        )}
                      >
                        {e.item?.factuur_nummer ||
                          e.extract.factuur_nummer ||
                          e.mail.subject}
                      </div>
                      <div
                        className={cn(
                          "mt-0.5 flex items-center justify-between gap-2 text-[11px]",
                          active ? "text-white/70" : "text-[#8E8E93]"
                        )}
                      >
                        <span className="truncate">
                          {formatDateTimeNl(e.mail.receivedAt)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 font-medium",
                            st === "betaald" &&
                              !active &&
                              "font-extrabold uppercase tracking-wide text-[#248A3D]",
                            st === "betaald" && active && "font-extrabold"
                          )}
                        >
                          {st === "betaald"
                            ? "BETAALD"
                            : bedrag != null
                              ? formatEuro(bedrag)
                              : statusLabel(st)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Midden: PDF / mail */}
        <div className="flex min-h-0 flex-col border-r border-[#E5E5EA] bg-[#EFEFF4]">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <FileText className="size-10 text-[#C7C7CC]" />
              <p className="text-sm text-[#8E8E93]">Selecteer een factuur</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-[#E5E5EA] bg-white px-4 py-3">
                <h3 className="text-[15px] font-semibold text-[#1C1C1E]">
                  {selected.mail.subject || "(geen onderwerp)"}
                </h3>
                <p className="mt-0.5 text-[12px] text-[#8E8E93]">
                  {selected.mail.fromName} &lt;{selected.mail.fromEmail}&gt; ·{" "}
                  {formatDateTimeNl(selected.mail.receivedAt)}
                </p>
                {selected.mail.attachments &&
                selected.mail.attachments.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.mail.attachments.map((a) => {
                      const base = `/api/inbox/${encodeURIComponent(selected.mail.id)}/attachments/${encodeURIComponent(a.id)}`;
                      return (
                        <span
                          key={a.id}
                          className="inline-flex items-center gap-1 rounded-md border border-[#E5E5EA] bg-[#F2F2F7] px-2 py-1 text-[11px] font-medium text-[#3A3A3C]"
                        >
                          <FileText className="size-3 shrink-0" />
                          <span className="max-w-[12rem] truncate">
                            {a.filename}
                          </span>
                          <a
                            href={`${base}?download=1`}
                            className="ml-0.5 inline-flex text-[#007AFF] hover:opacity-80"
                            title="Downloaden"
                            aria-label={`${a.filename} downloaden`}
                          >
                            <Download className="size-3" />
                          </a>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {pdfUrl ? (
                  <iframe
                    title="Factuur PDF"
                    src={pdfUrl}
                    className="h-full w-full border-0 bg-white"
                  />
                ) : selected.mail.bodyHtml ? (
                  <div className="h-full overflow-y-auto bg-white p-4">
                    <div
                      className="prose prose-sm max-w-none text-[#1C1C1E]"
                      dangerouslySetInnerHTML={{
                        __html: selected.mail.bodyHtml,
                      }}
                    />
                  </div>
                ) : (
                  <pre className="h-full overflow-y-auto whitespace-pre-wrap bg-white p-4 font-sans text-sm text-[#1C1C1E]">
                    {selected.mail.bodyText || "(geen inhoud / geen PDF)"}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>

        {/* Rechts: betaling uitlezen + goedkeuren */}
        <div className="flex min-h-0 flex-col bg-white">
          {!selected ? (
            <p className="p-6 text-sm text-[#8E8E93]">Geen selectie</p>
          ) : (
            <>
              <div className="shrink-0 border-b border-[#E5E5EA] px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[14px] font-semibold text-[#1C1C1E]">
                    Betaling
                  </h3>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      selected.item?.status === "betaald"
                        ? "bg-[#34C759]/20 text-[13px] font-extrabold uppercase tracking-wide text-[#248A3D]"
                        : locked
                          ? "bg-[#34C759]/15 text-[#248A3D]"
                          : selected.item?.status === "afgewezen"
                            ? "bg-[#FF3B30]/12 text-[#C62828]"
                            : "bg-[#FF9500]/15 text-[#9A5B00]"
                    )}
                  >
                    {statusLabel(selected.item?.status)}
                  </span>
                </div>
                {selected.item?.betaal_woensdag ? (
                  <p className="mt-1 text-[12px] text-[#8E8E93]">
                    Uitbetaling wo{" "}
                    <span className="font-medium text-[#1C1C1E]">
                      {selected.item.betaal_woensdag}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] text-[#8E8E93]">
                    Na goedkeuren → dichtstbijzijnde woensdag in Uitbetalingen
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
                <Field
                  label="Bedrijfsnaam"
                  value={draft.bedrijfsnaam}
                  onChange={(v) => setDraft((d) => ({ ...d, bedrijfsnaam: v }))}
                  disabled={locked || saving}
                />
                <Field
                  label="Factuurnummer"
                  value={draft.factuur_nummer}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, factuur_nummer: v }))
                  }
                  disabled={locked || saving}
                />
                <Field
                  label="IBAN"
                  value={draft.iban}
                  onChange={(v) => setDraft((d) => ({ ...d, iban: v }))}
                  disabled={locked || saving}
                  placeholder="NL00BANK0123456789"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="Ex btw"
                    value={draft.bedrag_ex_btw}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, bedrag_ex_btw: v }))
                    }
                    disabled={locked || saving}
                  />
                  <Field
                    label="Inc btw"
                    value={draft.bedrag_inc_btw}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, bedrag_inc_btw: v }))
                    }
                    disabled={locked || saving}
                  />
                </div>
                <Field
                  label="BTW-bedrag"
                  value={draft.btw_bedrag}
                  onChange={(v) => setDraft((d) => ({ ...d, btw_bedrag: v }))}
                  disabled={locked || saving}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Field
                    label="Factuurdatum"
                    value={draft.factuurdatum}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, factuurdatum: v }))
                    }
                    disabled={locked || saving}
                    placeholder="yyyy-mm-dd"
                  />
                  <Field
                    label="Vervaldatum"
                    value={draft.vervaldatum}
                    onChange={(v) =>
                      setDraft((d) => ({ ...d, vervaldatum: v }))
                    }
                    disabled={locked || saving}
                    placeholder="yyyy-mm-dd"
                  />
                </div>
                <Field
                  label="Referentie / kenmerk"
                  value={draft.referentie}
                  onChange={(v) => setDraft((d) => ({ ...d, referentie: v }))}
                  disabled={locked || saving}
                />
              </div>

              <div className="shrink-0 space-y-2 border-t border-[#E5E5EA] p-4">
                {!locked ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void savePatch({ status: "goedgekeurd" })}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#34C759] px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Goedkeuren → Uit te betalen
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void savePatch({ status: "betaald" })}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#248A3D] bg-[#E8F8EE] px-4 py-2.5 text-[14px] font-extrabold uppercase tracking-wide text-[#248A3D] disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4 stroke-[3]" />
                      )}
                      BETAALD
                    </button>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void savePatch()}
                        className="flex-1 rounded-xl bg-[#F2F2F7] px-3 py-2 text-[13px] font-semibold text-[#1C1C1E] disabled:opacity-50"
                      >
                        Opslaan
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void savePatch({ status: "afgewezen" })}
                        className="inline-flex items-center justify-center gap-1 rounded-xl bg-[#FF3B30]/10 px-3 py-2 text-[13px] font-semibold text-[#C62828] disabled:opacity-50"
                      >
                        <X className="size-3.5" />
                        Afwijzen
                      </button>
                    </div>
                  </>
                ) : (
                  <p
                    className={cn(
                      "rounded-xl px-3 py-2.5 text-center text-[13px]",
                      selected.item?.status === "betaald"
                        ? "bg-[#E8F8EE] text-[15px] font-extrabold uppercase tracking-wide text-[#248A3D]"
                        : "bg-[#F2F2F7] text-[#3A3A3C]"
                    )}
                  >
                    {selected.item?.status === "betaald"
                      ? "BETAALD · Uitbetalingen → Betaald"
                      : `Staat in Uit te betalen${
                          selected.item?.betaal_woensdag
                            ? ` · wo ${selected.item.betaal_woensdag}`
                            : ""
                        }`}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
