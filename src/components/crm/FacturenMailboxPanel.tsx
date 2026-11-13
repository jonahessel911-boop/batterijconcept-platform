"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDateTimeNl } from "@/lib/format";
import type { InboxMail } from "@/lib/inbox";
import { cn } from "@/lib/utils";

export function FacturenMailboxPanel() {
  const [mails, setMails] = useState<InboxMail[]>([]);
  const [email, setEmail] = useState("facturen@batterijconcept.nl");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = mails.find((m) => m.id === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/facturen-mailbox?limit=200");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setMails((data.mails as InboxMail[]) || []);
      if (data.email) setEmail(String(data.email));
      setConfigured(Boolean(data.configured));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sync(recent = false) {
    setSyncing(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/facturen-mailbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recent, max: recent ? 60 : 40 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync mislukt");
      setMsg(
        `Sync: ${data.fetched || 0} opgehaald · ${data.inserted || 0} nieuw · ${data.skipped || 0} overgeslagen`
      );
      if (Array.isArray(data.errors) && data.errors.length) {
        setError(data.errors.slice(0, 3).join(" · "));
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync mislukt");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            Facturen-mailbox
          </h2>
          <p className="text-sm text-muted">
            {email} · centrale inkomende + BCC van uitgaande creditfacturen
            {!configured ? " · IMAP nog niet geconfigureerd" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncing || !configured}
            onClick={() => void sync(false)}
            className="rounded border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-wash disabled:opacity-50"
          >
            {syncing ? "Sync…" : "Sync nieuw"}
          </button>
          <button
            type="button"
            disabled={syncing || !configured}
            onClick={() => void sync(true)}
            className="rounded border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-wash disabled:opacity-50"
          >
            Sync recent
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      {msg ? (
        <p className="border border-green/30 bg-green-soft/40 px-3 py-2 text-xs text-green-deeper">
          {msg}
        </p>
      ) : null}
      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="overflow-hidden border border-line bg-white">
          <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {mails.length} mails
          </div>
          {loading && !mails.length ? (
            <p className="p-4 text-sm text-muted">Laden…</p>
          ) : mails.length === 0 ? (
            <p className="p-4 text-sm text-muted">
              Nog geen mails. Sync IMAP of wacht tot creditfacturen als BCC
              binnenkomen.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {mails.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "w-full px-3 py-2.5 text-left hover:bg-wash/60",
                      selectedId === m.id && "bg-wash"
                    )}
                  >
                    <div className="truncate text-sm font-medium text-ink">
                      {m.fromName || m.fromEmail}
                    </div>
                    <div className="truncate text-xs text-ink">{m.subject}</div>
                    <div className="mt-0.5 text-[11px] text-muted">
                      {formatDateTimeNl(m.receivedAt)}
                      {m.attachments?.length
                        ? ` · ${m.attachments.length} bijlage(n)`
                        : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overflow-hidden border border-line bg-white">
          {!selected ? (
            <p className="p-6 text-sm text-muted">Selecteer een mail.</p>
          ) : (
            <div className="flex h-full max-h-[70vh] flex-col">
              <div className="border-b border-line px-4 py-3">
                <h3 className="text-base font-semibold text-ink">
                  {selected.subject}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  Van {selected.fromName} &lt;{selected.fromEmail}&gt; ·{" "}
                  {formatDateTimeNl(selected.receivedAt)}
                </p>
              </div>
              {selected.attachments && selected.attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2 border-b border-line px-4 py-2">
                  {selected.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={`/api/inbox/${encodeURIComponent(selected.id)}/attachments/${encodeURIComponent(a.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border border-line px-2 py-1 text-xs font-medium text-green-deeper hover:bg-wash"
                    >
                      {a.filename}
                    </a>
                  ))}
                </div>
              ) : null}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {selected.bodyHtml ? (
                  <div
                    className="prose prose-sm max-w-none text-ink"
                    dangerouslySetInnerHTML={{ __html: selected.bodyHtml }}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-sm text-ink">
                    {selected.bodyText || "(geen inhoud)"}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
