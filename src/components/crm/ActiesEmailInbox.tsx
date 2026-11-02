"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatDateTimeNl } from "@/lib/format";
import type { InboxMail } from "@/lib/inbox";

export function ActiesEmailInbox({
  email,
  leadId,
  leadNaam,
}: {
  email: string | null | undefined;
  leadId?: string | null;
  leadNaam?: string | null;
}) {
  const [apiMails, setApiMails] = useState<InboxMail[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const normalizedEmail = (email || "").trim().toLowerCase();

  useEffect(() => {
    if (!normalizedEmail && !leadId) {
      setApiMails([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (normalizedEmail) params.set("email", normalizedEmail);
    if (leadId) params.set("lead_id", leadId);
    void fetch(`/api/inbox?${params.toString()}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) {
          setApiMails((data.mails as InboxMail[]) || []);
        } else {
          setApiMails([]);
        }
      })
      .catch(() => {
        if (!cancelled) setApiMails([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedEmail, leadId]);

  const mails = useMemo(
    () =>
      [...apiMails].sort(
        (a, b) =>
          new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      ),
    [apiMails]
  );

  if (!normalizedEmail) {
    return (
      <div className="border border-line bg-white px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Email Inbox
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Geen e-mailadres bekend voor deze klant.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-line bg-white">
      <div className="flex items-start justify-between gap-2 border-b border-line px-2.5 py-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Email Inbox
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted" title={normalizedEmail}>
            {leadNaam ? `${leadNaam} · ` : ""}
            {normalizedEmail}
          </p>
        </div>
        <Link
          href="/?tab=inbox"
          className="shrink-0 text-[11px] font-semibold text-green-dark hover:underline"
        >
          Open inbox →
        </Link>
      </div>

      {loading && mails.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] text-muted">Mails laden…</p>
      ) : mails.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] text-muted">
          Geen berichten voor dit e-mailadres.
        </p>
      ) : (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto">
          {mails.map((m) => {
            const open = openId === m.id;
            const unread = m.status === "nieuw";
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : m.id)}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-wash"
                >
                  <span
                    className={[
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      unread ? "bg-orange" : "bg-line",
                    ].join(" ")}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={[
                          "truncate text-[12px]",
                          unread
                            ? "font-semibold text-ink"
                            : "font-medium text-ink",
                        ].join(" ")}
                      >
                        {m.subject || "(geen onderwerp)"}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted">
                        {formatDateTimeNl(m.receivedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {m.fromName || m.fromEmail}
                      {m.aiSummary ? ` · ${m.aiSummary}` : ""}
                    </span>
                    {open ? (
                      <span className="mt-1.5 block whitespace-pre-wrap text-[12px] leading-relaxed text-ink">
                        {m.bodyText || "—"}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
