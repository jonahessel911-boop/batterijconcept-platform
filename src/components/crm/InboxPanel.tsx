"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrmSession } from "@/hooks/useCrmSession";
import { formatDateTimeNl } from "@/lib/format";
import { afspraakStatusLabel, leadStatusLabel, statusTone } from "@/lib/labels";
import {
  afspraakSoortLabel,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { normalizeReplySubject } from "@/lib/inbox-ai";
import {
  INBOX_ACTION_LABEL,
  INBOX_FOLDERS,
  applyInboxBooking,
  extractImageUrlsFromHtml,
  extractInboxFacts,
  type InboxExtract,
  isInboxImageAttachment,
  mailInFolder,
  mailSuggestsGeenContact,
  mailSuggestsGeenInteresse,
  templatesForFolder,
  unreadCount,
  type InboxBookFolder,
  type InboxFolderId,
  type InboxMail,
} from "@/lib/inbox";
import type { AfspraakStatus, LeadStatus } from "@/types/database";

type MatchedLead = {
  id: string;
  naam: string;
  lead_number: string | null;
  email: string | null;
  telefoon: string | null;
  postcode: string | null;
  huisnummer: string | null;
  plaats: string | null;
  status: string | null;
};

type LinkedAfspraak = {
  id: string;
  start_at: string;
  status: string;
  soort?: string | null;
  adviseurNaam?: string | null;
};

const LEAD_NAME_STOP = new Set([
  "van",
  "de",
  "den",
  "der",
  "het",
  "ten",
  "ter",
  "aan",
  "op",
  "en",
  "voor",
]);

/** Zoekwoorden uit mail: e-mail, naamdelen, telefoon in de tekst. */
function mailMatchNeedles(mail: {
  fromName?: string | null;
  fromEmail?: string | null;
  bodyText?: string | null;
}): string[] {
  const out: string[] = [];
  const email = (mail.fromEmail || "").trim().toLowerCase();
  if (email.includes("@")) out.push(email);
  const local = email.split("@")[0] || "";
  for (const part of local.split(/[._+\-]+/)) {
    if (part.length >= 5) out.push(part);
  }
  for (const raw of (mail.fromName || "").split(/\s+/)) {
    const token = raw.replace(/[^a-zA-Zà-ÿ'-]/g, "").toLowerCase();
    if (token.length >= 4 && !LEAD_NAME_STOP.has(token)) out.push(token);
  }
  const facts = extractInboxFacts(mail);
  for (const e of facts.emails) out.push(e);
  for (const p of facts.phones) out.push(p.slice(-9));
  if (facts.postcode) {
    out.push(facts.postcode);
    out.push(facts.postcode.replace(/\s/g, ""));
  }
  if (facts.plaats) out.push(facts.plaats);
  return [...new Set(out)].slice(0, 10);
}

function scoreLeadMatch(
  lead: MatchedLead,
  mail: { fromName?: string | null; fromEmail?: string | null },
  facts?: InboxExtract
): number {
  const fromEmail = (mail.fromEmail || "").trim().toLowerCase();
  const leadEmail = (lead.email || "").trim().toLowerCase();
  const naam = (lead.naam || "").trim().toLowerCase();
  let score = 0;
  if (fromEmail && leadEmail === fromEmail) score += 100;
  if (facts?.emails.some((e) => e === leadEmail)) score += 100;
  const leadPhone = (lead.telefoon || "").replace(/\D/g, "").slice(-9);
  if (
    leadPhone.length >= 9 &&
    facts?.phones.some((p) => p.endsWith(leadPhone))
  ) {
    score += 80;
  }
  const leadPc = (lead.postcode || "").replace(/\s/g, "").toLowerCase();
  const factPc = (facts?.postcode || "").replace(/\s/g, "").toLowerCase();
  if (leadPc && factPc && leadPc === factPc) score += 50;
  const tokens = (mail.fromName || "")
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Zà-ÿ'-]/g, "").toLowerCase())
    .filter((token) => token.length >= 4 && !LEAD_NAME_STOP.has(token));
  for (const token of tokens) {
    const weight = token.length >= 5 ? 40 : 8;
    if (naam.includes(token)) score += weight;
    if (leadEmail.includes(token)) score += weight;
  }
  const local = fromEmail.split("@")[0]?.replace(/[._+\-]/g, "") || "";
  const leadLocal = leadEmail.split("@")[0]?.replace(/[._+\-]/g, "") || "";
  if (local.length >= 6 && leadLocal.length >= 6) {
    if (leadLocal.includes(local) || local.includes(leadLocal)) score += 30;
  }
  return score;
}

type LinkedProject = {
  id: string;
  project_nummer: string | null;
  titel?: string | null;
  status?: string | null;
};

function firstNameOf(naam: string | null | undefined): string {
  const t = (naam || "").trim();
  if (!t) return "klant";
  return t.split(/\s+/)[0] || t;
}

function defaultReplyBody(klantNaam: string, agentNaam: string): string {
  return `Beste ${firstNameOf(klantNaam)},\n\n\nMet vriendelijke groet,\n${agentNaam.trim() || "BatterijConcept"}`;
}

function initials(naam: string | null | undefined): string {
  const parts = (naam || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

function shortWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
}

function Avatar({
  name,
  size = "md",
}: {
  name: string | null | undefined;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-8 w-8 text-[10px]" : size === "lg" ? "h-11 w-11 text-sm" : "h-9 w-9 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-green-soft font-semibold text-green-dark ${dim}`}
    >
      {initials(name)}
    </span>
  );
}

function AiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2.4 13.15 6.7 17.4 7.85 13.15 9 12 13.3 10.85 9 6.6 7.85 10.85 6.7 12 2.4Z"
      />
      <path
        fill="currentColor"
        d="M18.2 13.2 18.85 15.4 21 16.05 18.85 16.7 18.2 18.9 17.55 16.7 15.4 16.05 17.55 15.4 18.2 13.2Z"
      />
    </svg>
  );
}

/** Leesbare platte tekst uit de mail — wat de bo moet zien. */
function displayBodyText(mail: InboxMail): string {
  const text = (mail.bodyText || "").replace(/\r\n/g, "\n").trim();
  if (text) return text;
  const html = (mail.bodyHtml || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return html || "(geen tekst)";
}

function formatBytes(n: number): string {
  if (!n || n < 1024) return `${n || 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type MailPhoto = { key: string; src: string; label: string };

function collectMailPhotos(mail: InboxMail): MailPhoto[] {
  const photos: MailPhoto[] = [];
  const seen = new Set<string>();

  for (const a of mail.attachments || []) {
    if (!isInboxImageAttachment(a)) continue;
    const src = `/api/inbox/${encodeURIComponent(mail.id)}/attachments/${encodeURIComponent(a.id)}`;
    if (seen.has(src)) continue;
    seen.add(src);
    photos.push({ key: a.id, src, label: a.filename || "Foto" });
  }

  const urls = [
    ...(mail.imageUrls || []),
    ...extractImageUrlsFromHtml(mail.bodyHtml),
  ];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    photos.push({
      key: `url-${photos.length}`,
      src: url,
      label: `Afbeelding ${photos.length + 1}`,
    });
  }
  return photos.slice(0, 24);
}

function MailPhotoGallery({
  photos,
  mailId,
}: {
  photos: MailPhoto[];
  mailId: string;
}) {
  const [index, setIndex] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const photoKey = photos.map((p) => p.key).join("|");

  const visible = photos.filter((p) => !broken[p.key]);
  useEffect(() => {
    setIndex(0);
    setBroken({});
  }, [mailId, photoKey]);

  if (visible.length === 0) return null;
  const safeIndex = Math.min(Math.max(index, 0), visible.length - 1);
  const current = visible[safeIndex]!;

  return (
    <div className="mb-5 border border-line bg-wash/40">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Foto&apos;s · {safeIndex + 1} / {visible.length}
        </p>
        {visible.length > 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setIndex((i) => (i - 1 + visible.length) % visible.length)
              }
              className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => setIndex((i) => (i + 1) % visible.length)}
              className="border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink hover:bg-wash"
            >
              →
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-[180px] items-center justify-center bg-[#F4F5F4] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current.key}
          src={current.src}
          alt={current.label}
          className="max-h-[320px] w-full object-contain"
          onError={() =>
            setBroken((prev) => ({ ...prev, [current.key]: true }))
          }
        />
      </div>
      {visible.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-line px-3 py-2">
          {visible.map((p, i) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setIndex(i)}
              className={[
                "h-14 w-14 shrink-0 overflow-hidden border bg-white",
                i === safeIndex ? "border-green ring-1 ring-green" : "border-line",
              ].join(" ")}
              title={p.label}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.src}
                alt=""
                className="h-full w-full object-cover"
                onError={() =>
                  setBroken((prev) => ({ ...prev, [p.key]: true }))
                }
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function afspraakWanneer(iso: string): {
  weekdag: string;
  datum: string;
  tijd: string;
} {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { weekdag: "", datum: "", tijd: "" };
  const zone = { timeZone: "Europe/Amsterdam" } as const;
  return {
    weekdag: d.toLocaleDateString("nl-NL", { weekday: "long", ...zone }),
    datum: d.toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      ...zone,
    }),
    tijd: d.toLocaleTimeString("nl-NL", {
      hour: "2-digit",
      minute: "2-digit",
      ...zone,
    }),
  };
}

function AfspraakActieKaart({
  afspraak,
  leadId,
  canCancel,
  busy,
  onCancel,
}: {
  afspraak: LinkedAfspraak;
  leadId?: string | null;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const wanneer = afspraakWanneer(afspraak.start_at);
  const cancelled = afspraak.status === "geannuleerd";
  const open = afspraak.status !== "geannuleerd" && afspraak.status !== "voltooid";
  const soort =
    afspraakSoortLabel[normalizeAfspraakSoort(afspraak.soort)] || "Afspraak";
  const status =
    afspraakStatusLabel[afspraak.status as AfspraakStatus] || afspraak.status;

  return (
    <div
      className={
        cancelled
          ? "rounded-xl border border-[#C62828]/25 bg-[#FDECEA] p-3"
          : "rounded-xl border border-line bg-white p-3"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {wanneer.weekdag}
          </p>
          <p className="mt-0.5 text-base font-semibold text-ink">
            {wanneer.datum}
          </p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
            {wanneer.tijd}
          </p>
        </div>
        <span
          className={`shrink-0 px-2 py-1 text-[11px] font-semibold ${statusTone("afspraak", afspraak.status)}`}
        >
          {status}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        {soort}
        {afspraak.adviseurNaam ? ` · ${afspraak.adviseurNaam}` : ""}
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {canCancel && open ? (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full bg-[#C45A12] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#a3480e] disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Afspraak afzeggen"}
          </button>
        ) : null}
        {cancelled && leadId ? (
          <Link
            href={`/leads/${leadId}?plan=huisbezoek`}
            className="inline-flex w-full items-center justify-center bg-[#0D5C32] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#0a4626]"
          >
            Opnieuw inplannen
          </Link>
        ) : null}
        <Link
          href={`/?tab=agenda&afspraak=${afspraak.id}`}
          className="inline-flex w-full items-center justify-center border border-line bg-white px-3 py-2.5 text-xs font-semibold text-ink hover:bg-wash"
        >
          Open in agenda
        </Link>
      </div>
    </div>
  );
}

export function InboxPanel() {
  const { session } = useCrmSession();
  const [mails, setMails] = useState<InboxMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [folder, setFolder] = useState<InboxFolderId>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const replyToTouched = useRef(false);
  const [templateId, setTemplateId] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [classifyBusyId, setClassifyBusyId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [matchedLead, setMatchedLead] = useState<MatchedLead | null>(null);
  const [leadCandidates, setLeadCandidates] = useState<MatchedLead[]>([]);
  const [leadLookupBusy, setLeadLookupBusy] = useState(false);
  const [linkedAfspraak, setLinkedAfspraak] = useState<LinkedAfspraak | null>(
    null
  );
  const [linkedProject, setLinkedProject] = useState<LinkedProject | null>(
    null
  );
  const [contextBusy, setContextBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const loadInbox = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/inbox?limit=200");
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mails?: InboxMail[];
      };
      if (!res.ok) throw new Error(data.error || "Inbox laden mislukt");
      setMails(Array.isArray(data.mails) ? data.mails : []);
    } catch (e) {
      if (!opts?.silent) {
        setActionMsg(e instanceof Error ? e.message : "Inbox laden mislukt");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const selected = useMemo(
    () => mails.find((m) => m.id === selectedId) || null,
    [mails, selectedId]
  );
  const extracted = useMemo(
    () => (selected ? extractInboxFacts(selected) : null),
    [selected]
  );

  async function loadLeadContext(
    leadId: string,
    stillCurrent: () => boolean = () => true
  ) {
    const [afRes, prRes] = await Promise.all([
      fetch("/api/afspraken"),
      fetch(`/api/projecten/${encodeURIComponent(leadId)}`),
    ]);
    const afData = (await afRes.json().catch(() => ({}))) as {
      afspraken?: Array<{
        id: string;
        lead_id?: string;
        start_at: string;
        status: string;
        soort?: string | null;
        adviseurs?: { naam?: string | null } | null;
      }>;
    };
    const now = Date.now();
    const mine = (afData.afspraken || [])
      .filter((a) => a.lead_id === leadId)
      .sort(
        (a, b) =>
          new Date(b.start_at).getTime() - new Date(a.start_at).getTime()
      );
    const open = mine.filter(
      (a) => a.status !== "geannuleerd" && a.status !== "voltooid"
    );
    const upcoming =
      open.find((a) => new Date(a.start_at).getTime() >= now) ||
      open[0] ||
      mine.find((a) => a.status === "geannuleerd") ||
      null;
    if (!stillCurrent()) return;
    setLinkedAfspraak(
      upcoming
        ? {
            id: upcoming.id,
            start_at: upcoming.start_at,
            status: upcoming.status,
            soort: upcoming.soort,
            adviseurNaam: upcoming.adviseurs?.naam || null,
          }
        : null
    );
    if (prRes.ok) {
      const prData = (await prRes.json().catch(() => ({}))) as {
        project?: LinkedProject;
      };
      setLinkedProject(prData.project || null);
    } else {
      setLinkedProject(null);
    }
  }

  async function loadKlantOp(needle: string, emailForReply?: string) {
    const q = needle.trim();
    if (!q) return;
    if (emailForReply) {
      replyToTouched.current = true;
      setReplyToEmail(emailForReply);
    }
    setLeadLookupBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/leads?q=${encodeURIComponent(q)}`);
      const data = (await res.json().catch(() => ({}))) as {
        leads?: MatchedLead[];
      };
      const leads = Array.isArray(data.leads) ? data.leads : [];
      if (leads.length === 1) {
        chooseLead(leads[0]);
        setActionMsg(`Klant geladen: ${leads[0].naam}`);
      } else if (leads.length > 1) {
        setMatchedLead(null);
        setLeadCandidates(leads.slice(0, 4));
        setActionMsg("Meerdere klanten. Kies er één.");
      } else {
        setActionMsg(`Geen klant gevonden op ${q}`);
      }
    } finally {
      setLeadLookupBusy(false);
    }
  }

  function zetExtractInAntwoord(line: string, email?: string) {
    if (email) {
      replyToTouched.current = true;
      setReplyToEmail(email);
    }
    setComposeOpen(true);
    setReplyBody((prev) => {
      if (!line || prev.includes(line)) return prev;
      if (/Met vriendelijke groet,/i.test(prev)) {
        return prev.replace(
          /Met vriendelijke groet,/i,
          `${line}\n\nMet vriendelijke groet,`
        );
      }
      return `${prev.trim()}\n\n${line}`.trim();
    });
  }

  function chooseLead(lead: MatchedLead) {
    setMatchedLead(lead);
    setLeadCandidates([]);
    setContextBusy(true);
    void loadLeadContext(lead.id).finally(() => setContextBusy(false));
  }

  // Rechts: klant + gekoppelde afspraak/project
  useEffect(() => {
    if (!selected) {
      setMatchedLead(null);
      setLeadCandidates([]);
      setLinkedAfspraak(null);
      setLinkedProject(null);
      return;
    }
    let cancelled = false;
    setLeadLookupBusy(true);
    setContextBusy(true);
    void (async () => {
      try {
        const facts = extractInboxFacts(selected);
        const needles = mailMatchNeedles(selected);
        if (needles.length === 0 && !selected.leadId) {
          if (!cancelled) {
            setMatchedLead(null);
            setLeadCandidates([]);
            setLinkedAfspraak(null);
            setLinkedProject(null);
          }
          return;
        }
        const batches = await Promise.all(
          needles.map(async (needle) => {
            const res = await fetch(
              `/api/leads?q=${encodeURIComponent(needle)}`
            );
            const data = (await res.json().catch(() => ({}))) as {
              leads?: MatchedLead[];
            };
            return Array.isArray(data.leads) ? data.leads : [];
          })
        );
        if (cancelled) return;
        const byId = new Map<string, MatchedLead>();
        for (const lead of batches.flat()) byId.set(lead.id, lead);
        const ranked = [...byId.values()]
          .map((lead) => ({
            lead,
            score: scoreLeadMatch(lead, selected, facts),
          }))
          .filter((row) => row.score >= 40)
          .sort((a, b) => b.score - a.score);
        const pinned = selected.leadId
          ? byId.get(selected.leadId) || null
          : null;
        const best = ranked[0];
        const second = ranked[1];
        const auto =
          pinned ||
          (best &&
          (!second || best.score >= second.score + 25)
            ? best.lead
            : null);
        setMatchedLead(auto);
        setLeadCandidates(auto ? [] : ranked.slice(0, 4).map((row) => row.lead));

        const leadId = auto?.id || null;
        if (!leadId) {
          setLinkedAfspraak(null);
          setLinkedProject(null);
          return;
        }
        await loadLeadContext(leadId, () => !cancelled);
      } catch {
        if (!cancelled) {
          setMatchedLead(null);
          setLeadCandidates([]);
          setLinkedAfspraak(null);
          setLinkedProject(null);
        }
      } finally {
        if (!cancelled) {
          setLeadLookupBusy(false);
          setContextBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.fromEmail, selected?.fromName, selected?.leadId, selected?.bodyText]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const matchQ = (m: InboxMail) => {
      if (!needle) return true;
      const hay = [
        m.fromName,
        m.fromEmail,
        m.subject,
        m.bodyText,
        m.aiSummary || "",
        m.leadNaam || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    };

    // Zoeken: alle mails (alle mappen, archief, beantwoord, verwijderd)
    if (needle) {
      return mails
        .filter(matchQ)
        .sort(
          (a, b) =>
            new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
        );
    }

    // Threads waar al een uitgaand antwoord op staat → niet in open lijst
    const repliedThreads = new Set(
      mails
        .filter((m) => m.folder === "verzonden")
        .flatMap((m) =>
          [m.threadId, m.messageId].filter(
            (x): x is string => Boolean(x && String(x).trim())
          )
        )
    );
    return mails
      .filter((m) => mailInFolder(m, folder))
      .filter((m) => {
        if (folder === "archief" || folder === "verzonden") return true;
        const tid = m.threadId || m.messageId || m.id;
        if (tid && repliedThreads.has(tid)) return false;
        return true;
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

  async function syncImap() {
    setSyncBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/inbox/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ max: 15, recent: true }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        configured?: boolean;
        fetched?: number;
        inserted?: number;
        skipped?: number;
        errors?: string[];
      };
      if (res.status === 503) {
        setActionMsg(
          data.error ||
            "IMAP niet geconfigureerd (IMAP_HOST / IMAP_USER / IMAP_PASS)."
        );
        return;
      }
      if (!res.ok) throw new Error(data.error || "IMAP sync mislukt");
      await loadInbox({ silent: true });
      const parts = [
        `${data.fetched ?? 0} opgehaald`,
        `${data.inserted ?? 0} nieuw`,
        `${data.skipped ?? 0} overgeslagen`,
      ];
      const errN = data.errors?.length || 0;
      setActionMsg(
        `IMAP sync: ${parts.join(" · ")}${
          errN ? ` · ${errN} fout(en)` : ""
        }`
      );
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "IMAP sync mislukt");
    } finally {
      setSyncBusy(false);
    }
  }

  const bookMail = useCallback(async (mail: InboxMail) => {
    setClassifyBusyId(mail.id);
    setActionMsg(null);
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
        folder: data.folder as InboxBookFolder,
        summary: data.summary || "",
        confidence: data.confidence ?? 0.5,
        functionName: data.functionName,
        effects: data.effects || undefined,
      });

      setMails((prev) => prev.map((m) => (m.id === mail.id ? booked : m)));

      await fetch(`/api/inbox/${encodeURIComponent(mail.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: booked.folder,
          aiSummary: booked.aiSummary,
          aiReason: booked.aiReason,
          aiConfidence: booked.aiConfidence,
          aiClassifiedAt: booked.aiClassifiedAt,
          aiFunction: data.functionName || null,
          aiEffects: booked.aiEffects,
        }),
      }).catch(() => undefined);

      const folderLabel =
        INBOX_FOLDERS.find((f) => f.id === booked.folder)?.label ||
        booked.folder;
      setActionMsg(
        `Geboekt → ${folderLabel}${
          data.source === "heuristic" ? " · fallback" : ""
        }`
      );
      return booked;
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Boeken mislukt");
      return null;
    } finally {
      setClassifyBusyId(null);
    }
  }, []);

  function selectMail(mail: InboxMail) {
    setSelectedId(mail.id);
    setActionMsg(null);
    // Compose altijd klaar (chat-stijl), met standaard Beste… / groet
    const agent = session?.naam || "BatterijConcept";
    const klant = mail.leadNaam || mail.fromName || "klant";
    setComposeOpen(true);
    setTemplateId("");
    replyToTouched.current = false;
    setReplyToEmail((mail.fromEmail || "").trim());
    setReplySubject(normalizeReplySubject(mail.subject));
    setReplyBody(defaultReplyBody(klant, agent));
    if (mail.status === "nieuw") {
      setMails((prev) =>
        prev.map((m) =>
          m.id === mail.id ? { ...m, status: "gelezen" as const } : m
        )
      );
      void fetch(`/api/inbox/${encodeURIComponent(mail.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "gelezen" }),
      }).catch(() => undefined);
    }
  }

  function moveToFolder(mailId: string, nextFolder: InboxFolderId) {
    const nextStatus =
      nextFolder === "archief" ? ("gearchiveerd" as const) : undefined;
    setMails((prev) =>
      prev.map((m) =>
        m.id === mailId
          ? {
              ...m,
              folder: nextFolder,
              status: nextStatus || m.status,
            }
          : m
      )
    );
    if (nextFolder === "archief" && selectedId === mailId) {
      setSelectedId(null);
      setComposeOpen(false);
    }
    setActionMsg(
      `Verplaatst naar ${
        INBOX_FOLDERS.find((f) => f.id === nextFolder)?.label || nextFolder
      }`
    );
    void fetch(`/api/inbox/${encodeURIComponent(mailId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        folder: nextFolder,
        ...(nextStatus ? { status: nextStatus } : {}),
      }),
    }).catch(() => undefined);
  }

  async function cancelLinkedAfspraak() {
    if (!selected || !linkedAfspraak) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const notitie =
        selected.aiSummary?.trim() ||
        `Afzegging via inbox: ${selected.subject}`.slice(0, 200);
      const res = await fetch("/api/afspraken", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: linkedAfspraak.id,
          action: "annuleer",
          notitie: notitie.length >= 3 ? notitie : "Afgezegd via inbox-mail",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Afzeggen mislukt");
      setLinkedAfspraak((a) =>
        a ? { ...a, status: "geannuleerd" } : null
      );
      // Mail uit open inbox (archief, nog vindbaar via zoeken)
      const mailId = selected.id;
      setMails((list) =>
        list.map((m) =>
          m.id === mailId
            ? {
                ...m,
                folder: "archief" as const,
                status: "gearchiveerd" as const,
              }
            : m
        )
      );
      setSelectedId(null);
      setComposeOpen(false);
      void fetch(`/api/inbox/${encodeURIComponent(mailId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: "archief", status: "gearchiveerd" }),
      }).catch(() => undefined);
      setActionMsg("Afspraak definitief afgezegd. Mail naar archief.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Afzeggen mislukt");
    } finally {
      setActionBusy(false);
    }
  }

  async function markLeadStatus(
    status: "geen_interesse" | "geen_contact"
  ) {
    if (!matchedLead?.id) {
      setActionMsg("Geen gekoppelde lead gevonden.");
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(matchedLead.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          status_reden:
            selected?.aiSummary ||
            selected?.subject ||
            "Via inbox-mail",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        lead?: MatchedLead & { status?: string };
      };
      if (!res.ok) throw new Error(data.error || "Status bijwerken mislukt");
      setMatchedLead((prev) =>
        prev
          ? {
              ...prev,
              status: data.lead?.status || status,
            }
          : prev
      );
      setActionMsg(
        status === "geen_interesse"
          ? 'Lead gemarkeerd als "Geen interesse".'
          : 'Lead gemarkeerd als "Geen contact".'
      );
    } catch (e) {
      setActionMsg(
        e instanceof Error ? e.message : "Status bijwerken mislukt"
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function createServiceFromMail() {
    if (!selected) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      const body: Record<string, string> = {
        onderwerp: selected.subject.slice(0, 160) || "Service via inbox",
        omschrijving: displayBodyText(selected).slice(0, 4000),
        email: selected.fromEmail,
      };
      if (linkedProject?.id) body.project_id = linkedProject.id;
      const res = await fetch("/api/service-verzoeken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        verzoek?: { id?: string };
      };
      if (!res.ok) throw new Error(data.error || "Serviceverzoek mislukt");
      setActionMsg(
        data.verzoek?.id
          ? "Serviceverzoek aangemaakt."
          : "Serviceverzoek aangemaakt."
      );
    } catch (e) {
      setActionMsg(
        e instanceof Error ? e.message : "Serviceverzoek mislukt"
      );
    } finally {
      setActionBusy(false);
    }
  }

  async function deleteMail(mailId: string) {
    // Soft-delete → archief, blijft vindbaar via zoeken
    const prev = mails;
    setMails((list) =>
      list.map((m) =>
        m.id === mailId
          ? { ...m, folder: "archief" as const, status: "gearchiveerd" as const }
          : m
      )
    );
    if (selectedId === mailId) {
      setSelectedId(null);
      setComposeOpen(false);
      setReplyBody("");
      setReplySubject("");
    }
    setActionMsg("Mail verwijderd uit de open mailbox (nog vindbaar via zoeken).");
    try {
      const res = await fetch(`/api/inbox/${encodeURIComponent(mailId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: "archief", status: "gearchiveerd" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Verwijderen mislukt");
    } catch (e) {
      setMails(prev);
      setActionMsg(e instanceof Error ? e.message : "Verwijderen mislukt");
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

  async function draftReply(mail: InboxMail) {
    setComposeOpen(true);
    // Re: meteen zichtbaar terwijl AI schrijft
    setReplySubject(normalizeReplySubject(mail.subject));
    setDraftBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/inbox/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: mail.subject,
          bodyText: displayBodyText(mail),
          fromName: matchedLead?.naam || mail.fromName,
          fromEmail: mail.fromEmail,
          klantEmail:
            matchedLead?.email?.trim() ||
            replyToEmail.trim() ||
            mail.fromEmail,
          agentNaam: session?.naam || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        subject?: string;
        body?: string;
      };
      if (!res.ok) throw new Error(data.error || "Concept mislukt");
      setReplySubject(
        data.subject
          ? normalizeReplySubject(data.subject)
          : normalizeReplySubject(mail.subject)
      );
      if (data.body?.trim()) setReplyBody(data.body.trim());
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Concept mislukt");
    } finally {
      setDraftBusy(false);
    }
  }

  async function sendReply() {
    if (!selected) return;
    if (!replySubject.trim() || !replyBody.trim()) {
      setActionMsg("Vul onderwerp en bericht in.");
      return;
    }
    setSendBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(
        `/api/inbox/${encodeURIComponent(selected.id)}/reply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: replySubject.trim(),
            bodyText: replyBody.trim(),
            to: replyToEmail.trim(),
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mail?: InboxMail | null;
      };
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      const reply = {
        id: `reply-${Date.now()}`,
        at: new Date().toISOString(),
        subject: replySubject.trim(),
        bodyText: replyBody.trim(),
        templateId: templateId || null,
      };
      const repliedId = selected.id;
      const threadKey =
        selected.threadId || selected.messageId || selected.id;
      // Direct uit open lijst: deze mail → archief + verzonden-koppeling
      setMails((prev) => {
        const archived = prev.map((m) =>
          m.id === repliedId
            ? {
                ...m,
                status: "gearchiveerd" as const,
                folder: "archief" as const,
                replies: [...(m.replies || []), reply],
              }
            : m
        );
        if (!data.mail) return archived;
        if (archived.some((m) => m.id === data.mail!.id)) return archived;
        return archived.concat({
          ...data.mail,
          folder: "verzonden",
          status: "afgehandeld",
          threadId: data.mail.threadId || threadKey,
        });
      });
      setSelectedId(null);
      setComposeOpen(false);
      setTemplateId("");
      setReplySubject("");
      setReplyBody("");
      setActionMsg("Verstuurd. Mail uit de open inbox gehaald.");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setSendBusy(false);
    }
  }

  const templates = selected
    ? templatesForFolder(selected.folder)
    : templatesForFolder(folder);

  // Als lead binnenkomt na selectie: groet bijwerken als nog standaard leeg
  useEffect(() => {
    if (!selected || !composeOpen || !matchedLead?.naam) return;
    setReplyBody((prev) => {
      if (!/^Beste .+,(\n|$)/.test(prev)) return prev;
      if (!prev.includes("\n\n\nMet vriendelijke groet,")) return prev;
      return defaultReplyBody(
        matchedLead.naam,
        session?.naam || "BatterijConcept"
      );
    });
  }, [matchedLead?.id, matchedLead?.naam, selected?.id, composeOpen, session?.naam]);

  useEffect(() => {
    if (replyToTouched.current) return;
    const crm = matchedLead?.email?.trim();
    if (crm) setReplyToEmail(crm);
  }, [matchedLead?.id, matchedLead?.email, selected?.id]);

  const atts = selected?.attachments || [];
  const fileAtts = atts.filter((a) => !isInboxImageAttachment(a));
  const photos = selected ? collectMailPhotos(selected) : [];

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden border-t border-line bg-white lg:h-[calc(100dvh-3.75rem)]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Inbox</p>
          <p className="truncate text-[11px] text-muted">
            info@ · mails worden automatisch in de juiste map gezet
            {loading ? " · Laden…" : syncBusy ? " · Sync…" : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInbox()}
            disabled={loading || syncBusy}
            className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Vernieuwen
          </button>
          <button
            type="button"
            onClick={() => void syncImap()}
            disabled={loading || syncBusy}
            className="bg-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {syncBusy ? "Sync…" : "Sync IMAP"}
          </button>
        </div>
      </div>
      {actionMsg ? (
        <p className="border-b border-line bg-wash px-4 py-2 text-xs text-ink">
          {actionMsg}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_260px]">
        {/* Conversaties + mappen */}
        <section className="flex min-h-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
          <div className="flex gap-1 overflow-x-auto border-b border-line px-2 py-2">
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
                  title={f.hint}
                  className={[
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    active
                      ? "bg-green text-white"
                      : "bg-wash text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {f.label}
                  {n > 0 ? ` · ${n}` : ""}
                </button>
              );
            })}
          </div>
          <div className="border-b border-line px-3 py-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek alle mails…"
              className="w-full rounded-md border border-line bg-wash px-3 py-2 text-sm text-ink outline-none focus:border-green focus:bg-white"
            />
            {q.trim() ? (
              <p className="mt-1.5 text-[10px] text-muted">
                Zoekt in alle mappen, archief en verwijderd · {list.length} resultaat
                {list.length === 1 ? "" : "en"}
              </p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                {q.trim() ? "Geen mails gevonden." : "Geen mails in deze map."}
              </p>
            ) : (
              list.map((m) => {
                const active = m.id === selectedId;
                const unread = m.status === "nieuw";
                const searching = Boolean(q.trim());
                const folderLabel =
                  INBOX_FOLDERS.find((f) => f.id === m.folder)?.label || m.folder;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectMail(m)}
                    className={[
                      "flex w-full gap-3 border-b border-line/60 px-3 py-3 text-left transition-colors",
                      active ? "bg-green-soft/60" : "hover:bg-wash",
                    ].join(" ")}
                  >
                    <Avatar name={m.fromName || m.fromEmail} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={[
                            "truncate text-sm",
                            unread ? "font-semibold text-ink" : "font-medium text-ink",
                          ].join(" ")}
                        >
                          {m.fromName || m.fromEmail}
                        </p>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted">
                          {shortWhen(m.receivedAt)}
                        </span>
                      </div>
                      <p
                        className={[
                          "mt-0.5 truncate text-[13px]",
                          unread ? "font-medium text-ink" : "text-muted",
                        ].join(" ")}
                      >
                        {m.subject}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                        {searching ? `${folderLabel} · ` : ""}
                        {m.aiSummary ||
                          m.bodyText.replace(/\s+/g, " ").trim() ||
                          "—"}
                      </p>
                    </div>
                    {unread ? (
                      <span className="mt-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green px-1.5 text-[10px] font-semibold text-white">
                        1
                      </span>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Mail + antwoord */}
        <section className="flex min-h-[360px] flex-col border-b border-line lg:min-h-0 lg:border-b-0 lg:border-r">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted">
              Selecteer links een mail.
            </div>
          ) : (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {INBOX_FOLDERS.find((f) => f.id === selected.folder)?.label ||
                      selected.folder}
                    {selected.aiSummary ? ` · ${selected.aiSummary}` : ""}
                    {classifyBusyId === selected.id ? " · boeken…" : ""}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold leading-snug text-ink sm:text-xl">
                    {selected.subject}
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    {selected.fromName || selected.fromEmail}
                    {selected.fromEmail ? ` · ${selected.fromEmail}` : ""}
                    {" · "}
                    {formatDateTimeNl(selected.receivedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  title="Verwijderen uit mailbox"
                  onClick={() => void deleteMail(selected.id)}
                  className="shrink-0 border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                >
                  Verwijderen
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-6">
                {photos.length > 0 ? (
                  <MailPhotoGallery photos={photos} mailId={selected.id} />
                ) : null}

                <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-ink sm:text-base">
                  {displayBodyText(selected)}
                </pre>

                {fileAtts.length > 0 ? (
                  <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <p className="w-full text-xs font-semibold uppercase tracking-wide text-muted">
                      Bijlagen ({fileAtts.length})
                    </p>
                    {fileAtts.map((a) => (
                      <a
                        key={a.id}
                        href={`/api/inbox/${encodeURIComponent(selected.id)}/attachments/${encodeURIComponent(a.id)}`}
                        className="inline-flex items-center gap-2 border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
                      >
                        Download {a.filename}
                        {a.size ? (
                          <span className="font-normal text-muted">
                            {formatBytes(a.size)}
                          </span>
                        ) : null}
                      </a>
                    ))}
                  </div>
                ) : null}

                {(selected.replies || []).length > 0 ? (
                  <div className="mt-8 space-y-3 border-t border-line pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Verzonden antwoorden
                    </p>
                    {selected.replies!.map((r) => (
                      <div key={r.id} className="bg-wash px-3 py-3">
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
              </div>

              <div className="shrink-0 border-t border-line bg-white px-4 py-4 sm:px-6">
                <label className="mb-2 flex items-center gap-2">
                  <span className="w-10 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Aan
                  </span>
                  <input
                    type="email"
                    value={replyToEmail}
                    onChange={(e) => {
                      replyToTouched.current = true;
                      setReplyToEmail(e.target.value);
                    }}
                    className="min-w-0 flex-1 border border-line bg-wash px-3 py-2 text-sm text-ink outline-none focus:border-green focus:bg-white"
                    placeholder="klant@email.nl"
                  />
                </label>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={replySubject}
                    onChange={(e) => setReplySubject(e.target.value)}
                    className="min-w-0 flex-1 border border-line bg-wash px-3 py-2 text-sm text-ink outline-none focus:border-green focus:bg-white"
                    placeholder="Onderwerp"
                  />
                  <select
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className="border border-line bg-white px-2 py-2 text-xs text-ink outline-none focus:border-green"
                  >
                    <option value="">Template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={14}
                  className="min-h-[220px] w-full resize-y border border-line bg-wash px-3 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-green focus:bg-white sm:min-h-[280px]"
                  placeholder={`Beste …,\n\n\nMet vriendelijke groet,\n${session?.naam || "…"}`}
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    title="AI-concept"
                    disabled={draftBusy}
                    onClick={() => void draftReply(selected)}
                    className="inline-flex h-9 w-9 items-center justify-center text-green-dark hover:bg-green-soft disabled:opacity-40"
                  >
                    <AiMark className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    disabled={sendBusy || !replyBody.trim()}
                    onClick={() => void sendReply()}
                    className="inline-flex h-10 items-center bg-green px-5 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    {sendBusy ? "Versturen…" : "Versturen"}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Info + actie rechts */}
        <aside className="hidden min-h-0 flex-col lg:flex">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Info</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!selected ? (
              <p className="text-xs text-muted">Geen gesprek geselecteerd.</p>
            ) : leadLookupBusy || contextBusy ? (
              <p className="text-xs text-muted">Klant zoeken…</p>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center gap-3">
                  <Avatar
                    name={
                      matchedLead?.naam ||
                      selected.fromName ||
                      selected.fromEmail
                    }
                    size="lg"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">
                      {matchedLead?.naam || selected.fromName || "Onbekend"}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {matchedLead?.lead_number ||
                        (matchedLead
                          ? "Lead gevonden"
                          : leadCandidates.length
                            ? "Meerdere mogelijke klanten"
                            : "Geen lead-match")}
                    </p>
                  </div>
                </div>

                {matchedLead?.status ? (
                  <p className="inline-flex rounded-full bg-[#FFF0E6] px-2.5 py-1 text-[11px] font-semibold text-[#C45A12]">
                    {leadStatusLabel[matchedLead.status as LeadStatus] ||
                      matchedLead.status}
                  </p>
                ) : null}

                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Contact
                  </p>
                  <dl className="space-y-2.5 text-xs">
                    <div>
                      <dt className="text-muted">E-mail</dt>
                      <dd className="break-all font-medium text-ink">
                        {matchedLead?.email || selected.fromEmail || "—"}
                      </dd>
                      {matchedLead?.email &&
                      selected.fromEmail &&
                      matchedLead.email.trim().toLowerCase() !==
                        selected.fromEmail.trim().toLowerCase() ? (
                        <p className="mt-0.5 text-[11px] text-muted">
                          Mail kwam van {selected.fromEmail}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <dt className="text-muted">Telefoon</dt>
                      <dd className="font-medium text-ink">
                        {matchedLead?.telefoon || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted">Plaats</dt>
                      <dd className="font-medium text-ink">
                        {[
                          [matchedLead?.postcode, matchedLead?.huisnummer]
                            .filter(Boolean)
                            .join(" "),
                          matchedLead?.plaats,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </dd>
                    </div>
                    {(linkedProject?.project_nummer ||
                      selected.projectNummer) && (
                      <div>
                        <dt className="text-muted">Project</dt>
                        <dd className="font-medium text-ink">
                          {linkedProject?.project_nummer ||
                            selected.projectNummer}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                {extracted &&
                (extracted.emails.length > 0 ||
                  extracted.phones.length > 0 ||
                  extracted.postcode ||
                  extracted.plaats ||
                  extracted.panelen ||
                  extracted.merken.length > 0 ||
                  extracted.huisbezoek ||
                  extracted.afspraakAfzeggen) ? (
                  <div className="border-t border-line pt-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Uit de mail
                    </p>
                    <dl className="space-y-2 text-xs">
                      {extracted.emails.map((email) => (
                        <div key={email} className="flex items-center justify-between gap-2">
                          <div>
                            <dt className="text-muted">E-mail</dt>
                            <dd className="font-medium text-ink">{email}</dd>
                          </div>
                          <button
                            type="button"
                            disabled={leadLookupBusy}
                            onClick={() => void loadKlantOp(email, email)}
                            className="shrink-0 border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Laad
                          </button>
                        </div>
                      ))}
                      {extracted.phones.map((phone) => (
                        <div key={phone} className="flex items-center justify-between gap-2">
                          <div>
                            <dt className="text-muted">Telefoon</dt>
                            <dd className="font-medium text-ink">{phone}</dd>
                          </div>
                          <button
                            type="button"
                            disabled={leadLookupBusy}
                            onClick={() => void loadKlantOp(phone)}
                            className="shrink-0 border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Laad
                          </button>
                        </div>
                      ))}
                      {extracted.postcode ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <dt className="text-muted">Postcode</dt>
                            <dd className="font-medium text-ink">{extracted.postcode}</dd>
                          </div>
                          <button
                            type="button"
                            disabled={leadLookupBusy}
                            onClick={() =>
                              void loadKlantOp(extracted.postcode!.replace(/\s/g, ""))
                            }
                            className="shrink-0 border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Laad
                          </button>
                        </div>
                      ) : null}
                      {extracted.plaats ? (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <dt className="text-muted">Plaats</dt>
                            <dd className="font-medium text-ink">{extracted.plaats}</dd>
                          </div>
                          <button
                            type="button"
                            disabled={leadLookupBusy}
                            onClick={() => void loadKlantOp(extracted.plaats!)}
                            className="shrink-0 border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash disabled:opacity-50"
                          >
                            Laad
                          </button>
                        </div>
                      ) : null}
                      {extracted.panelen ? (
                        <div>
                          <dt className="text-muted">Panelen</dt>
                          <dd className="font-medium text-ink">{extracted.panelen}</dd>
                        </div>
                      ) : null}
                      {extracted.merken.length > 0 ? (
                        <div>
                          <dt className="text-muted">Merk</dt>
                          <dd className="font-medium text-ink">
                            {extracted.merken.join(", ")}
                          </dd>
                        </div>
                      ) : null}
                      {extracted.huisbezoek ? (
                        <div>
                          <dt className="text-muted">Huisbezoek</dt>
                          <dd className="font-medium text-ink">
                            {extracted.huisbezoek === "ja"
                              ? "Wil een huisbezoek"
                              : extracted.huisbezoek === "nee"
                                ? "Wil geen huisbezoek"
                                : "Eerst een indicatie"}
                          </dd>
                        </div>
                      ) : null}
                      {extracted.afspraakAfzeggen ? (
                        <div>
                          <dt className="text-muted">Afspraak</dt>
                          <dd className="font-medium text-ink">Wil afzeggen</dd>
                        </div>
                      ) : null}
                    </dl>
                    {extracted.huisbezoek ? (
                      <button
                        type="button"
                        onClick={() => {
                          const email =
                            replyToEmail.trim() ||
                            extracted.emails[0] ||
                            selected?.fromEmail ||
                            "";
                          const line =
                            extracted.huisbezoek === "ja"
                              ? `We plannen het huisbezoek op ${email}. Antwoord gerust op deze mail, dan komt het binnen op info@batterijconcept.nl.`
                              : extracted.huisbezoek === "nee"
                                ? `We sturen het voorstel naar ${email}, zonder huisbezoek.`
                                : `Je krijgt eerst een indicatie op ${email}. Een huisbezoek plannen we alleen als je dat wilt.`;
                          zetExtractInAntwoord(line, email);
                        }}
                        className="mt-3 w-full bg-green px-3 py-2.5 text-xs font-semibold text-white hover:bg-green-dark"
                      >
                        {extracted.huisbezoek === "ja"
                          ? "Zet huisbezoek in antwoord"
                          : extracted.huisbezoek === "nee"
                            ? "Antwoord zonder huisbezoek"
                            : "Zet indicatie in antwoord"}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Actie bij deze mail */}
                <div className="border-t border-line pt-4">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Actie
                  </p>
                  <p className="mb-3 text-xs text-ink">
                    <span className="font-semibold">
                      {INBOX_FOLDERS.find((f) => f.id === selected.folder)
                        ?.label || selected.folder}
                    </span>
                    {selected.aiSummary ? (
                      <span className="text-muted">
                        {" "}
                        · {selected.aiSummary}
                      </span>
                    ) : null}
                  </p>

                  {linkedAfspraak ? (
                    <AfspraakActieKaart
                      afspraak={linkedAfspraak}
                      leadId={matchedLead?.id}
                      canCancel={
                        selected.folder === "afzegging_afspraak" ||
                        Boolean(selected.aiEffects?.cancelAfspraak) ||
                        Boolean(extracted?.afspraakAfzeggen)
                      }
                      busy={actionBusy}
                      onCancel={() => void cancelLinkedAfspraak()}
                    />
                  ) : selected.folder === "afzegging_afspraak" ||
                    selected.aiEffects?.cancelAfspraak ||
                    extracted?.afspraakAfzeggen ? (
                    <div className="space-y-2 rounded-md border border-line bg-wash/60 p-3">
                      {leadCandidates.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-xs text-ink">
                            Geen exact e-mailadres. Kies de klant:
                          </p>
                          {leadCandidates.map((lead) => (
                            <button
                              key={lead.id}
                              type="button"
                              onClick={() => chooseLead(lead)}
                              className="w-full border border-line bg-white px-3 py-2 text-left text-xs hover:bg-wash"
                            >
                              <span className="block font-semibold text-ink">
                                {lead.naam}
                                {lead.plaats ? ` · ${lead.plaats}` : ""}
                              </span>
                              <span className="block text-muted">
                                {lead.email || lead.telefoon || lead.lead_number}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted">
                          Geen openstaande afspraak gevonden voor deze klant.
                        </p>
                      )}
                    </div>
                  ) : null}

                  {selected.folder === "service" ||
                  selected.aiEffects?.createServiceVerzoek ? (
                    <div className="mt-2 space-y-2">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void createServiceFromMail()}
                        className="w-full bg-green px-3 py-2.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                      >
                        {actionBusy
                          ? "Bezig…"
                          : INBOX_ACTION_LABEL.maak_service_verzoek}
                      </button>
                    </div>
                  ) : null}

                  {matchedLead &&
                  mailSuggestsGeenInteresse(selected) &&
                  matchedLead.status !== "geen_interesse" ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void markLeadStatus("geen_interesse")}
                        className="w-full bg-[#C45A12] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#a3480e] disabled:opacity-50"
                      >
                        {actionBusy
                          ? "Bezig…"
                          : INBOX_ACTION_LABEL.mark_geen_interesse}
                      </button>
                    </div>
                  ) : matchedLead?.status === "geen_interesse" &&
                    mailSuggestsGeenInteresse(selected) ? (
                    <p className="mt-2 text-xs text-muted">
                      Lead staat al op &quot;Geen interesse&quot;.
                    </p>
                  ) : null}

                  {matchedLead &&
                  mailSuggestsGeenContact(selected) &&
                  matchedLead.status !== "geen_contact" &&
                  matchedLead.status !== "geen_interesse" ? (
                    <div className="mt-2">
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void markLeadStatus("geen_contact")}
                        className="w-full border border-line bg-white px-3 py-2.5 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                      >
                        {actionBusy
                          ? "Bezig…"
                          : INBOX_ACTION_LABEL.mark_geen_contact}
                      </button>
                    </div>
                  ) : null}

                  {selected.folder === "annulering_vraag" ? (
                    <p className="mt-2 rounded-md border border-[#C45A12]/25 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                      Dit is een order-/projectannulering — geen
                      afspraak-afzegging. Open het project om verder te gaan.
                    </p>
                  ) : null}

                  {selected.folder === "installatie" ? (
                    <p className="mt-2 text-xs text-muted">
                      Installatievraag — open het project voor planning /
                      status.
                    </p>
                  ) : null}

                  {selected.folder === "ordervraag" ? (
                    <p className="mt-2 text-xs text-muted">
                      Ordervraag — open lead of project om te beantwoorden.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-col gap-2">
                    {matchedLead ? (
                      <Link
                        href={`/leads/${matchedLead.id}`}
                        className="inline-flex w-full items-center justify-center border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
                      >
                        Open lead
                      </Link>
                    ) : null}
                    {linkedProject?.id ? (
                      <Link
                        href={`/projecten/${linkedProject.id}`}
                        className="inline-flex w-full items-center justify-center border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-wash"
                      >
                        Open project
                        {linkedProject.project_nummer
                          ? ` · ${linkedProject.project_nummer}`
                          : ""}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
