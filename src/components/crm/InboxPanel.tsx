"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTimeNl } from "@/lib/format";
import {
  INBOX_FOLDERS,
  applyInboxBooking,
  createDemoInboxMails,
  mailInFolder,
  templatesForFolder,
  unreadCount,
  type InboxFolderId,
  type InboxMail,
  type InboxReplyTemplate,
} from "@/lib/inbox";

const STORAGE_KEY = "bc_inbox_demo_v3";

function loadMails(): InboxMail[] {
  if (typeof window === "undefined") return createDemoInboxMails();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as InboxMail[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    /* ignore */
  }
  return createDemoInboxMails();
}

function persistMails(mails: InboxMail[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mails));
  } catch {
    /* ignore */
  }
}

export function InboxPanel() {
  const [mails, setMails] = useState<InboxMail[]>(() => loadMails());
  const [folder, setFolder] = useState<InboxFolderId>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [imapHint] = useState(true);
  const [classifyBusyId, setClassifyBusyId] = useState<string | null>(null);
  const [classifyAllBusy, setClassifyAllBusy] = useState(false);

  const selected = useMemo(
    () => mails.find((m) => m.id === selectedId) || null,
    [mails, selectedId]
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return mails
      .filter((m) => mailInFolder(m, folder))
      .filter((m) => {
        if (!needle) return true;
        const hay = [m.fromName, m.fromEmail, m.subject, m.bodyText]
          .join(" ")
          .toLowerCase();
        return hay.includes(needle);
      })
      .sort(
        (a, b) =>
          new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      );
  }, [mails, folder, q]);

  const folderCounts = useMemo(() => {
    const map = {} as Record<InboxFolderId, number>;
    for (const f of INBOX_FOLDERS) {
      map[f.id] = unreadCount(mails, f.id);
    }
    return map;
  }, [mails]);

  function updateMails(next: InboxMail[]) {
    setMails(next);
    persistMails(next);
  }

  const bookMail = useCallback(
    async (mail: InboxMail, opts?: { silent?: boolean }) => {
      if (mail.aiClassifiedAt) return mail;
      setClassifyBusyId(mail.id);
      if (!opts?.silent) setActionMsg(null);
      try {
        const res = await fetch("/api/inbox/classify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: mail.subject,
            bodyText: mail.bodyText,
            fromName: mail.fromName,
            fromEmail: mail.fromEmail,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          folder?: InboxFolderId;
          functionName?: string;
          summary?: string;
          confidence?: number;
          effects?: InboxMail["aiEffects"];
          source?: string;
        };
        if (!res.ok) throw new Error(data.error || "Boeken mislukt");
        if (!data.folder) throw new Error("Geen map teruggekregen");

        const booked = applyInboxBooking(mail, {
          folder: data.folder as
            | "algemeen"
            | "service"
            | "inkoop"
            | "lead_antwoorden",
          summary: data.summary || "",
          confidence: data.confidence ?? 0.5,
          functionName: data.functionName,
          effects: data.effects || undefined,
        });

        setMails((prev) => {
          const next = prev.map((m) => (m.id === mail.id ? booked : m));
          persistMails(next);
          return next;
        });

        if (!opts?.silent) {
          const folderLabel =
            INBOX_FOLDERS.find((f) => f.id === booked.folder)?.label ||
            booked.folder;
          setActionMsg(
            `Geboekt → ${folderLabel} (${data.functionName || "book"})${
              data.source === "heuristic" ? " · fallback" : ""
            }`
          );
        }
        return booked;
      } catch (e) {
        if (!opts?.silent) {
          setActionMsg(e instanceof Error ? e.message : "Boeken mislukt");
        }
        return null;
      } finally {
        setClassifyBusyId(null);
      }
    },
    []
  );

  const autoBookRan = useRef(false);
  useEffect(() => {
    if (autoBookRan.current) return;
    autoBookRan.current = true;
    const targets = mails.filter(
      (m) =>
        m.folder !== "verzonden" &&
        m.folder !== "archief" &&
        !m.aiClassifiedAt
    );
    if (targets.length === 0) return;
    setClassifyAllBusy(true);
    void (async () => {
      let ok = 0;
      for (const mail of targets) {
        const r = await bookMail(mail, { silent: true });
        if (r) ok += 1;
      }
      setActionMsg(
        ok > 0
          ? `${ok} nieuwe mail${ok === 1 ? "" : "s"} automatisch geboekt.`
          : null
      );
      setClassifyAllBusy(false);
    })();
  }, [mails, bookMail]);

  function selectMail(mail: InboxMail) {
    setSelectedId(mail.id);
    setComposeOpen(false);
    setActionMsg(null);
    if (mail.status === "nieuw") {
      updateMails(
        mails.map((m) =>
          m.id === mail.id ? { ...m, status: "gelezen" as const } : m
        )
      );
    }
  }

  function moveToFolder(mailId: string, nextFolder: InboxFolderId) {
    updateMails(
      mails.map((m) =>
        m.id === mailId
          ? {
              ...m,
              folder: nextFolder,
              status:
                nextFolder === "archief"
                  ? ("gearchiveerd" as const)
                  : m.status,
            }
          : m
      )
    );
    setActionMsg(`Verplaatst naar ${INBOX_FOLDERS.find((f) => f.id === nextFolder)?.label || nextFolder}`);
  }

  function startReply(mail: InboxMail, template?: InboxReplyTemplate) {
    setComposeOpen(true);
    if (template) {
      setTemplateId(template.id);
      setReplySubject(template.subject(mail));
      setReplyBody(template.body(mail));
    } else {
      setTemplateId("");
      setReplySubject(`Re: ${mail.subject.replace(/^Re:\s*/i, "")}`);
      setReplyBody(
        `\n\n---\nVan: ${mail.fromName} <${mail.fromEmail}>\n\n${mail.bodyText}`
      );
    }
  }

  function applyTemplate(id: string) {
    if (!selected) return;
    const t = templatesForFolder(selected.folder).find((x) => x.id === id);
    setTemplateId(id);
    if (!t) return;
    setReplySubject(t.subject(selected));
    setReplyBody(t.body(selected));
  }

  function sendReply() {
    if (!selected) return;
    if (!replySubject.trim() || !replyBody.trim()) {
      setActionMsg("Vul onderwerp en bericht in.");
      return;
    }
    const reply = {
      id: `reply-${Date.now()}`,
      at: new Date().toISOString(),
      subject: replySubject.trim(),
      bodyText: replyBody.trim(),
      templateId: templateId || null,
    };
    const sentCopy: InboxMail = {
      id: `sent-${Date.now()}`,
      folder: "verzonden",
      status: "afgehandeld",
      fromName: "BatterijConcept",
      fromEmail: "info@batterijconcept.nl",
      toEmail: selected.fromEmail,
      subject: reply.subject,
      bodyText: reply.bodyText,
      receivedAt: reply.at,
      suggestedActions: [],
      threadId: selected.threadId || selected.id,
      replies: [],
    };
    updateMails(
      mails
        .map((m) =>
          m.id === selected.id
            ? {
                ...m,
                status: "afgehandeld" as const,
                replies: [...(m.replies || []), reply],
              }
            : m
        )
        .concat(sentCopy)
    );
    setComposeOpen(false);
    setActionMsg(
      "Antwoord opgeslagen in Verzonden (SMTP volgt — nog niet echt verstuurd)."
    );
  }

  function resetDemo() {
    autoBookRan.current = false;
    const fresh = createDemoInboxMails();
    updateMails(fresh);
    setSelectedId(null);
    setComposeOpen(false);
    setActionMsg("Demo-mails hersteld — AI boekt ze opnieuw.");
  }

  const templates = selected
    ? templatesForFolder(selected.folder)
    : templatesForFolder(folder);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col gap-3">
      {imapHint ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-[#FFF8F3] px-4 py-2.5 text-xs text-[#C45A12]">
          <p>
            <span className="font-semibold">Demo-modus.</span> Nieuwe mails
            worden automatisch geboekt (service / inkoop / algemeen / lead) ·
            IMAP volgt.
            {classifyAllBusy ? " · AI bezig…" : ""}
          </p>
          <button
            type="button"
            onClick={resetDemo}
            className="font-semibold underline hover:no-underline"
          >
            Reset demo-mails
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border border-line bg-white lg:grid-cols-[220px_minmax(280px,1fr)_minmax(360px,1.3fr)]">
        {/* Folders */}
        <aside className="border-b border-line lg:border-b-0 lg:border-r">
          <div className="border-b border-line px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              info@batterijconcept.nl
            </p>
            <p className="mt-0.5 text-sm font-semibold text-ink">Inbox</p>
          </div>
          <nav className="p-2">
            {INBOX_FOLDERS.map((f) => {
              const active = folder === f.id;
              const n = folderCounts[f.id];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setFolder(f.id);
                    setSelectedId(null);
                    setComposeOpen(false);
                  }}
                  className={[
                    "mb-0.5 flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                    active
                      ? "bg-green-soft font-semibold text-green-dark"
                      : "text-ink hover:bg-wash",
                  ].join(" ")}
                  title={f.hint}
                >
                  <span className="truncate">{f.label}</span>
                  {n > 0 ? (
                    <span
                      className={[
                        "inline-flex min-w-[1.25rem] justify-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                        active ? "bg-green text-white" : "bg-[#eef1ef] text-muted",
                      ].join(" ")}
                    >
                      {n}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* List */}
        <section className="flex min-h-[280px] flex-col border-b border-line lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="border-b border-line px-3 py-2.5">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek in map…"
              className="w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                Geen mails in deze map.
              </p>
            ) : (
              list.map((m) => {
                const active = m.id === selectedId;
                const unread = m.status === "nieuw";
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectMail(m)}
                    className={[
                      "block w-full border-b border-line/70 px-3 py-3 text-left",
                      active ? "bg-wash" : "hover:bg-[#FAFBFA]",
                    ].join(" ")}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={[
                          "truncate text-sm",
                          unread
                            ? "font-semibold text-ink"
                            : "font-medium text-ink",
                        ].join(" ")}
                      >
                        {m.fromName}
                      </p>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted">
                        {formatDateTimeNl(m.receivedAt)}
                      </span>
                    </div>
                    <p
                      className={[
                        "mt-0.5 truncate text-sm",
                        unread ? "font-medium text-ink" : "text-muted",
                      ].join(" ")}
                    >
                      {m.subject}
                    </p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                      {m.aiSummary ||
                        m.bodyText.replace(/\s+/g, " ").trim()}
                    </p>
                    {m.aiClassifiedAt ? (
                      <span className="mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide text-green-dark">
                        AI ·{" "}
                        {INBOX_FOLDERS.find((f) => f.id === m.folder)?.label ||
                          m.folder}
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Detail */}
        <section className="flex min-h-[360px] flex-col lg:min-h-0">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted">
              Selecteer een mail om te lezen of te beantwoorden.
            </div>
          ) : (
            <>
              <header className="border-b border-line px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-ink">
                      {selected.subject}
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      <span className="font-medium text-ink">
                        {selected.fromName}
                      </span>{" "}
                      &lt;{selected.fromEmail}&gt;
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      Aan {selected.toEmail} ·{" "}
                      {formatDateTimeNl(selected.receivedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={classifyBusyId === selected.id}
                      onClick={() => {
                        // Force herboeken
                        setMails((prev) => {
                          const next = prev.map((m) =>
                            m.id === selected.id
                              ? { ...m, aiClassifiedAt: null }
                              : m
                          );
                          persistMails(next);
                          return next;
                        });
                        void bookMail(
                          { ...selected, aiClassifiedAt: null },
                          { silent: false }
                        );
                      }}
                      className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                    >
                      {classifyBusyId === selected.id ? "Boeken…" : "Opnieuw boeken"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startReply(selected)}
                      className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
                    >
                      Beantwoorden
                    </button>
                    <button
                      type="button"
                      onClick={() => moveToFolder(selected.id, "archief")}
                      className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
                    >
                      Archiveren
                    </button>
                  </div>
                </div>

                {selected.aiSummary ? (
                  <div className="mt-3 border border-green/20 bg-green-soft/40 px-3 py-2 text-xs text-ink">
                    <p>
                      <span className="font-semibold text-green-dark">
                        Geboekt:{" "}
                      </span>
                      {selected.aiSummary}
                      {selected.aiConfidence != null ? (
                        <span className="text-muted">
                          {" "}
                          · {Math.round(selected.aiConfidence * 100)}%
                        </span>
                      ) : null}
                    </p>
                    {selected.aiReason ? (
                      <p className="mt-0.5 text-muted">{selected.aiReason}</p>
                    ) : null}
                    {selected.aiEffects ? (
                      <p className="mt-1 text-muted">
                        {[
                          selected.aiEffects.createServiceVerzoek
                            ? "→ serviceverzoek"
                            : null,
                          selected.aiEffects.cancelAfspraak
                            ? "→ afspraak annuleren"
                            : null,
                          selected.aiEffects.leadGeenContact
                            ? "→ lead geen contact"
                            : null,
                          selected.aiEffects.leadGeenInteresse
                            ? "→ lead geen interesse"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Geen extra effect"}
                      </p>
                    ) : null}
                  </div>
                ) : classifyBusyId === selected.id ? (
                  <p className="mt-3 text-xs text-muted">AI boekt deze mail…</p>
                ) : null}

                {(selected.leadNaam ||
                  selected.projectNummer ||
                  selected.folder) && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                    {selected.leadNaam ? (
                      <span className="border border-line bg-wash px-2 py-1 text-muted">
                        Lead:{" "}
                        <span className="font-semibold text-ink">
                          {selected.leadNaam}
                        </span>
                      </span>
                    ) : null}
                    {selected.projectNummer ? (
                      <span className="border border-line bg-wash px-2 py-1 text-muted">
                        Project:{" "}
                        <span className="font-semibold text-ink">
                          {selected.projectNummer}
                        </span>
                      </span>
                    ) : null}
                    <span className="border border-[#C45A12]/30 bg-[#FFF0E6] px-2 py-1 font-semibold text-[#C45A12]">
                      Map:{" "}
                      {INBOX_FOLDERS.find((f) => f.id === selected.folder)
                        ?.label || selected.folder}
                    </span>
                  </div>
                )}
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
                  {selected.bodyText}
                </pre>

                {selected.replies && selected.replies.length > 0 ? (
                  <div className="mt-6 space-y-3 border-t border-line pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Jouw antwoorden
                    </p>
                    {selected.replies.map((r) => (
                      <div
                        key={r.id}
                        className="border border-line bg-wash/50 px-3 py-3"
                      >
                        <p className="text-xs text-muted">
                          {formatDateTimeNl(r.at)} · {r.subject}
                        </p>
                        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-ink">
                          {r.bodyText}
                        </pre>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="mt-6 space-y-3 border-t border-line pt-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Handmatig verplaatsen
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {INBOX_FOLDERS.filter(
                      (f) =>
                        f.id !== "inbox" &&
                        f.id !== "verzonden" &&
                        f.id !== selected.folder
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => moveToFolder(selected.id, f.id)}
                        className="inline-flex h-8 items-center border border-line px-2.5 text-[11px] font-semibold text-ink hover:bg-wash"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {selected.leadId ? (
                    <Link
                      href={`/leads/${selected.leadId}`}
                      className="inline-flex text-xs font-semibold text-green-dark hover:underline"
                    >
                      Open gekoppelde lead →
                    </Link>
                  ) : null}
                </div>

                {actionMsg ? (
                  <p className="mt-4 border border-line bg-wash px-3 py-2 text-xs text-muted">
                    {actionMsg}
                  </p>
                ) : null}
              </div>

              {/* Compose */}
              {composeOpen ? (
                <div className="border-t border-line bg-[#FAFBFA] px-4 py-3 sm:px-5">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Beantwoorden
                    </p>
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="border border-line bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-green"
                    >
                      <option value="">Template kiezen…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    className="mb-2 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                    placeholder="Onderwerp"
                  />
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    rows={7}
                    className="w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                    placeholder="Bericht…"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={sendReply}
                      className="inline-flex h-9 items-center bg-green px-4 text-xs font-semibold text-white hover:bg-green-dark"
                    >
                      Versturen (lokaal tot SMTP)
                    </button>
                    <button
                      type="button"
                      onClick={() => setComposeOpen(false)}
                      className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-muted hover:bg-white"
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
