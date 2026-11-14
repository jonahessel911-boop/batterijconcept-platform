"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Mail,
  RefreshCw,
  Reply,
  Search,
  User,
} from "lucide-react";
import { formatDateTimeNl } from "@/lib/format";
import {
  fillRecruitmentTemplate,
  RECRUITMENT_INBOX_TEMPLATES,
} from "@/lib/recruitment-inbox-templates";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SolMatch = {
  id: string;
  naam: string;
  email: string | null;
  functie: string | null;
  status: string;
};

type RecMail = {
  id: string;
  fromName: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  receivedAt: string;
  status: string;
  folder?: string;
  threadId?: string | null;
  messageId?: string | null;
  sollicitatie?: SolMatch | null;
  match_reason?: string;
};

type Conversation = {
  key: string;
  messages: RecMail[];
  latest: RecMail;
  replyTarget: RecMail;
  peerName: string;
  peerEmail: string;
  subject: string;
  sollicitatie: SolMatch | null;
  match_reason?: string;
};

const INFO_RE = /@batterijconcept\.nl$/i;

function replySubjectOf(subject: string) {
  const s = (subject || "").trim();
  if (!s) return "Re: BatterijConcept Recruitment";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

function previewText(body: string) {
  return (body || "").replace(/\s+/g, " ").trim().slice(0, 90);
}

function initials(naam: string) {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] || ""}${parts[parts.length - 1]![0] || ""}`.toUpperCase();
}

function shortDate(iso: string) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.toLocaleDateString("nl-NL") === now.toLocaleDateString("nl-NL");
    if (sameDay) {
      return d.toLocaleTimeString("nl-NL", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Amsterdam",
      });
    }
    return d.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      timeZone: "Europe/Amsterdam",
    });
  } catch {
    return "";
  }
}

function normEmail(v: string | null | undefined) {
  return (v || "").trim().toLowerCase();
}

function isOutbound(m: RecMail) {
  if (m.folder === "verzonden") return true;
  return INFO_RE.test(m.fromEmail || "");
}

function peerEmailOf(m: RecMail) {
  return isOutbound(m) ? normEmail(m.toEmail) : normEmail(m.fromEmail);
}

function normSubject(subject: string) {
  return (subject || "")
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .trim()
    .toLowerCase();
}

function mailKeys(m: RecMail): string[] {
  return [m.threadId, m.messageId, m.id].filter(
    (x): x is string => Boolean(x && String(x).trim())
  );
}

/** Groepeer losse mails tot conversaties (thread_id + peer + onderwerp). */
function buildConversations(mails: RecMail[]): Conversation[] {
  if (!mails.length) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) {
      parent.set(x, x);
      return x;
    }
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const m of mails) {
    const keys = mailKeys(m);
    const peer = peerEmailOf(m);
    const subj = normSubject(m.subject);
    const soft = peer ? `peer:${peer}` : `id:${m.id}`;
    const softSubj = peer && subj ? `peer-subj:${peer}::${subj}` : soft;
    const anchor = keys[0] || softSubj;
    for (const k of keys) union(anchor, k);
    union(anchor, soft);
    union(anchor, softSubj);
  }

  const groups = new Map<string, RecMail[]>();
  for (const m of mails) {
    const keys = mailKeys(m);
    const peer = peerEmailOf(m);
    const subj = normSubject(m.subject);
    const soft = peer ? `peer:${peer}` : `id:${m.id}`;
    const softSubj = peer && subj ? `peer-subj:${peer}::${subj}` : soft;
    const root = find(keys[0] || softSubj);
    const list = groups.get(root) || [];
    list.push(m);
    groups.set(root, list);
  }

  const conversations: Conversation[] = [];
  for (const [key, msgs] of groups) {
    const messages = [...msgs].sort(
      (a, b) =>
        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
    );
    const latest = messages[messages.length - 1]!;
    const inbound = [...messages].reverse().find((m) => !isOutbound(m));
    const replyTarget = inbound || latest;
    const peerEmail = peerEmailOf(replyTarget) || peerEmailOf(latest);
    const peerMail =
      messages.find((m) => !isOutbound(m)) ||
      messages.find((m) => peerEmailOf(m) === peerEmail) ||
      latest;
    const sol =
      messages.map((m) => m.sollicitatie).find(Boolean) || null;
    const rootInbound = messages.find((m) => !isOutbound(m));
    conversations.push({
      key,
      messages,
      latest,
      replyTarget,
      peerName:
        sol?.naam ||
        (!isOutbound(peerMail)
          ? peerMail.fromName || peerMail.fromEmail
          : peerEmail) ||
        "Onbekend",
      peerEmail,
      subject:
        rootInbound?.subject ||
        messages[0]?.subject ||
        latest.subject ||
        "(geen onderwerp)",
      sollicitatie: sol,
      match_reason: rootInbound?.match_reason || latest.match_reason,
    });
  }

  return conversations.sort(
    (a, b) =>
      new Date(b.latest.receivedAt).getTime() -
      new Date(a.latest.receivedAt).getTime()
  );
}

function unreadInboundCount(list: RecMail[]) {
  return list.filter((m) => m.status === "nieuw" && !isOutbound(m)).length;
}

export function RecruitmentInboxPanel({
  onOpenKandidaat,
  onUnreadChange,
}: {
  onOpenKandidaat?: (id: string) => void;
  onUnreadChange?: (count: number) => void;
}) {
  const [mails, setMails] = useState<RecMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [q, setQ] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sendBusy, setSendBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/instroom/inbox?limit=200", {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      const list = (data.mails || []) as RecMail[];
      setMails(list);
      setConfigured(data.configured !== false);
      const unread =
        typeof data.unread_count === "number"
          ? data.unread_count
          : unreadInboundCount(list);
      onUnreadChange?.(unread);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await load();
      if (cancelled) return;
      // Stil UNSEEN ophalen (licht); volledige catch-up via Vernieuwen.
      try {
        const res = await fetch("/api/instroom/inbox", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recent: false, max: 25 }),
        });
        if (!cancelled && res.ok) await load();
      } catch {
        /* sync optioneel — load bleef staan */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const conversations = useMemo(() => buildConversations(mails), [mails]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) =>
      [
        c.peerName,
        c.peerEmail,
        c.subject,
        c.sollicitatie?.naam || "",
        ...c.messages.map((m) => `${m.fromName} ${m.bodyText} ${m.subject}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [conversations, q]);

  useEffect(() => {
    if (!filtered.length) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => {
      if (prev && filtered.some((c) => c.key === prev)) return prev;
      return filtered[0]!.key;
    });
  }, [filtered]);

  const selected = filtered.find((c) => c.key === selectedKey) || null;

  useEffect(() => {
    if (!selected) {
      setReplyOpen(false);
      return;
    }
    setReplyTo(
      selected.peerEmail ||
        (isOutbound(selected.replyTarget)
          ? selected.replyTarget.toEmail
          : selected.replyTarget.fromEmail) ||
        ""
    );
    setReplySubject(replySubjectOf(selected.subject));
    setReplyBody("");
    setTemplateId("");
    setReplyOpen(false);

    const unreadIds = selected.messages
      .filter((m) => m.status === "nieuw" && !isOutbound(m))
      .map((m) => m.id);
    if (!unreadIds.length) return;

    setMails((prev) => {
      const next = prev.map((m) =>
        unreadIds.includes(m.id) ? { ...m, status: "gelezen" } : m
      );
      onUnreadChange?.(unreadInboundCount(next));
      return next;
    });
    for (const id of unreadIds) {
      void fetch(`/api/instroom/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "gelezen" }),
      }).catch(() => undefined);
    }
  }, [selected?.key, onUnreadChange]);

  async function sync() {
    setSyncing(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/instroom/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recent: true, max: 40 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync mislukt");
      await load();
      const inserted = Number(data.inserted || 0);
      const fetched = Number(data.fetched || 0);
      const errN = Array.isArray(data.errors) ? data.errors.length : 0;
      const errHint =
        errN > 0 && data.errors?.[0]
          ? ` · ${String(data.errors[0]).slice(0, 80)}`
          : errN
            ? ` · ${errN} sync-fout(en)`
            : "";
      setOkMsg(
        inserted > 0
          ? `${inserted} nieuwe mail${inserted === 1 ? "" : "s"} opgehaald`
          : fetched > 0
            ? `Geen nieuwe mails (${fetched} gecontroleerd)${errHint}`
            : `Mailbox leeg of al synchroon${errHint}`
      );
      if (errN) {
        setError(`${errN} sync-fout(en) — zie serverlog`);
      }
      window.setTimeout(() => setOkMsg(null), 3200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync mislukt");
    } finally {
      setSyncing(false);
    }
  }

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = RECRUITMENT_INBOX_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    const naam =
      selected?.sollicitatie?.naam ||
      selected?.peerName ||
      selected?.replyTarget.fromName ||
      "";
    setReplyBody(fillRecruitmentTemplate(t.body, naam));
    if (t.subject) setReplySubject(t.subject);
    setReplyOpen(true);
  }

  async function sendReply() {
    if (!selected || !replyBody.trim() || sendBusy) return;
    setSendBusy(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(
        `/api/instroom/inbox/${encodeURIComponent(selected.replyTarget.id)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: replyTo.trim(),
            subject: replySubject.trim() || replySubjectOf(selected.subject),
            bodyText: replyBody.trim(),
            sollicitatie_id: selected.sollicitatie?.id || null,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      setOkMsg("Antwoord verstuurd");
      setReplyOpen(false);
      setReplyBody("");
      setTemplateId("");
      window.setTimeout(() => setOkMsg(null), 2800);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setSendBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F5F5F7]">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 bg-white/80 px-3 py-2 backdrop-blur-md sm:px-4">
        <p className="text-[13px] font-semibold tracking-tight text-[#1D1D1F]">
          Inbox
        </p>
        <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#6E6E73]">
          {filtered.length}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[13px]"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              setReplyOpen(true);
              if (!replyBody.trim()) {
                applyTemplate("contact_binnenkort");
              }
            }}
          >
            <Reply className="size-3.5" />
            Beantwoorden
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[13px]"
            disabled={syncing || !configured}
            onClick={() => void sync()}
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
            {syncing ? "Sync…" : "Vernieuwen"}
          </Button>
        </div>
      </div>

      {(error || okMsg) && (
        <div
          className={cn(
            "shrink-0 border-b px-4 py-2 text-[13px]",
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-900"
          )}
        >
          {error || okMsg}
        </div>
      )}

      {!configured ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          IMAP niet geconfigureerd — reacties verschijnen zodra info@-sync
          aanstaat.
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-black/10 bg-white lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-black/5 px-3 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-[#8E8E93]" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Zoek"
                className="h-8 w-full rounded-lg border-0 bg-[#F2F2F7] pr-3 pl-8 text-[13px] text-[#1D1D1F] outline-none placeholder:text-[#8E8E93] focus:ring-2 focus:ring-[#007AFF]/30"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <p className="px-4 py-10 text-center text-[13px] text-[#8E8E93]">
                Laden…
              </p>
            ) : filtered.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <Mail className="mx-auto mb-2 size-7 text-[#C7C7CC]" />
                <p className="text-[13px] text-[#8E8E93]">
                  Geen recruitment-mails
                </p>
              </div>
            ) : (
              <ul>
                {filtered.map((c) => {
                  const active = selectedKey === c.key;
                  const n = c.messages.length;
                  const unread = c.messages.some(
                    (m) => m.status === "nieuw" && !isOutbound(m)
                  );
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => setSelectedKey(c.key)}
                        className={cn(
                          "w-full border-b border-black/[0.04] px-3 py-2.5 text-left transition",
                          active
                            ? "bg-[#007AFF] text-white"
                            : "hover:bg-black/[0.03]"
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={cn(
                              "flex min-w-0 items-center gap-1.5 truncate text-[13px]",
                              unread && !active
                                ? "font-bold text-[#1D1D1F]"
                                : "font-semibold",
                              active ? "text-white" : "text-[#1D1D1F]"
                            )}
                          >
                            {unread && !active ? (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-[#007AFF]"
                                aria-hidden
                              />
                            ) : null}
                            <span className="truncate">{c.peerName}</span>
                            {n > 1 ? (
                              <span
                                className={cn(
                                  "ml-0.5 font-normal",
                                  active ? "text-white/75" : "text-[#8E8E93]"
                                )}
                              >
                                ({n})
                              </span>
                            ) : null}
                          </p>
                          <span
                            className={cn(
                              "shrink-0 text-[11px] tabular-nums",
                              active
                                ? "text-white/80"
                                : unread
                                  ? "font-semibold text-[#007AFF]"
                                  : "text-[#8E8E93]"
                            )}
                          >
                            {shortDate(c.latest.receivedAt)}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-[12.5px]",
                            active
                              ? "font-medium text-white/95"
                              : unread
                                ? "font-semibold text-[#1D1D1F]"
                                : "font-medium text-[#1D1D1F]"
                          )}
                        >
                          {c.subject || "(geen onderwerp)"}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-[12px]",
                            active ? "text-white/70" : "text-[#8E8E93]"
                          )}
                        >
                          {isOutbound(c.latest) ? "Jij: " : ""}
                          {previewText(c.latest.bodyText) || "—"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col bg-white">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#8E8E93]">
              <Mail className="size-10 opacity-40" />
              <p className="text-[14px]">Geen bericht geselecteerd</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-black/5 px-5 py-4">
                <h2 className="font-display text-[22px] font-semibold tracking-tight text-[#1D1D1F]">
                  {selected.subject || "(geen onderwerp)"}
                </h2>
                <p className="mt-1 text-[12px] text-[#8E8E93]">
                  {selected.messages.length} bericht
                  {selected.messages.length === 1 ? "" : "en"} ·{" "}
                  {selected.peerEmail || "onbekend"}
                </p>

                {selected.sollicitatie ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#F2F2F7] px-3 py-2.5">
                    <User className="size-4 text-[#007AFF]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#1D1D1F]">
                        {selected.sollicitatie.naam}
                      </p>
                      <p className="text-[12px] text-[#8E8E93]">
                        {selected.sollicitatie.functie || "Kandidaat"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 border-black/10 bg-white text-[12px]"
                      onClick={() =>
                        onOpenKandidaat?.(selected.sollicitatie!.id)
                      }
                    >
                      Open
                      <ArrowUpRight className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-[12px] text-[#8E8E93]">
                    Geen gekoppelde sollicitatie
                    {selected.match_reason
                      ? ` · match via ${selected.match_reason}`
                      : ""}
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                <div className="mx-auto flex max-w-2xl flex-col gap-4">
                  {selected.messages.map((m, idx) => {
                    const outbound = isOutbound(m);
                    return (
                      <article
                        key={m.id}
                        className={cn(
                          "rounded-2xl border px-4 py-3.5",
                          outbound
                            ? "border-[#007AFF]/15 bg-[#F0F7FF]"
                            : "border-black/8 bg-[#F9F9FB]"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                              outbound
                                ? "bg-[#007AFF] text-white"
                                : "bg-[#E5E5EA] text-[#3A3A3C]"
                            )}
                          >
                            {outbound
                              ? "BC"
                              : initials(m.fromName || m.fromEmail)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                              <p className="text-[13px] font-semibold text-[#1D1D1F]">
                                {outbound
                                  ? "BatterijConcept Recruitment"
                                  : m.fromName || m.fromEmail}
                                {outbound ? (
                                  <span className="ml-1.5 text-[11px] font-medium text-[#007AFF]">
                                    Verzonden
                                  </span>
                                ) : null}
                              </p>
                              <span className="text-[11px] tabular-nums text-[#8E8E93]">
                                {formatDateTimeNl(m.receivedAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-[#8E8E93]">
                              {m.fromEmail}
                              {m.toEmail ? ` → ${m.toEmail}` : ""}
                            </p>
                            {idx === 0 &&
                            normSubject(m.subject) !==
                              normSubject(selected.subject) ? (
                              <p className="mt-1 text-[12px] font-medium text-[#1D1D1F]">
                                {m.subject}
                              </p>
                            ) : null}
                            <div className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[#1D1D1F]">
                              {m.bodyText?.trim() || "(geen tekst)"}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="shrink-0 border-t border-black/10 bg-[#FAFAFA]">
                {!replyOpen ? (
                  <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 gap-1.5 bg-[#007AFF] text-white hover:bg-[#0066D6]"
                      onClick={() => {
                        setReplyOpen(true);
                        if (!replyBody.trim()) {
                          applyTemplate("contact_binnenkort");
                        }
                      }}
                    >
                      <Reply className="size-3.5" />
                      Beantwoorden
                    </Button>
                    <div className="flex flex-wrap gap-1.5">
                      {RECRUITMENT_INBOX_TEMPLATES.slice(0, 3).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => applyTemplate(t.id)}
                          className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.03]"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <div className="overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-black/5 px-3 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                          Aan
                        </span>
                        <input
                          type="email"
                          value={replyTo}
                          onChange={(e) => setReplyTo(e.target.value)}
                          className="min-w-0 w-full border-0 bg-transparent text-[13px] text-[#1D1D1F] outline-none"
                        />
                      </div>
                      <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-black/5 px-3 py-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                          Onderwerp
                        </span>
                        <input
                          type="text"
                          value={replySubject}
                          onChange={(e) => setReplySubject(e.target.value)}
                          className="min-w-0 w-full border-0 bg-transparent text-[13px] text-[#1D1D1F] outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 border-b border-black/5 px-3 py-2">
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                          Template
                        </span>
                        <select
                          value={templateId}
                          onChange={(e) => applyTemplate(e.target.value)}
                          className="min-w-0 flex-1 rounded-md border border-black/10 bg-[#F2F2F7] px-2 py-1.5 text-[12px] text-[#1D1D1F] outline-none"
                        >
                          <option value="">Kies template…</option>
                          {RECRUITMENT_INBOX_TEMPLATES.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        rows={8}
                        placeholder="Schrijf je antwoord…"
                        className="min-h-[140px] w-full resize-y border-0 bg-white px-3 py-3 text-[14px] leading-relaxed text-[#1D1D1F] outline-none"
                      />
                      <div className="flex items-center justify-between gap-2 border-t border-black/5 bg-[#FAFAFA] px-3 py-2">
                        <button
                          type="button"
                          className="text-[13px] font-medium text-[#8E8E93] hover:text-[#1D1D1F]"
                          onClick={() => setReplyOpen(false)}
                        >
                          Annuleren
                        </button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 bg-[#007AFF] px-4 text-white hover:bg-[#0066D6]"
                          disabled={
                            sendBusy || !replyBody.trim() || !replyTo.trim()
                          }
                          onClick={() => void sendReply()}
                        >
                          {sendBusy ? "Versturen…" : "Versturen"}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
