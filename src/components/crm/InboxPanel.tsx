"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Mail,
  MailOpen,
  Phone,
  RefreshCw,
  Reply,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { useCrmSession } from "@/hooks/useCrmSession";
import { Button } from "@/components/ui/button";
import { formatDateTimeNl } from "@/lib/format";
import { afspraakStatusLabel, leadStatusLabel } from "@/lib/labels";
import {
  afspraakSoortLabel,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import { normalizeReplySubject } from "@/lib/inbox-ai";
import {
  INBOX_ACTION_LABEL,
  INBOX_FOLDERS,
  extractImageUrlsFromHtml,
  extractInboxFacts,
  type InboxExtract,
  isInboxImageAttachment,
  mailInFolder,
  mailSuggestsGeenContact,
  mailSuggestsGeenInteresse,
  templatesForMail,
  unreadCount,
  unreadInboundCount,
  type InboxFolderId,
  type InboxMail,
} from "@/lib/inbox";
import {
  datetimeLocalToIso,
  inboxTerugbelMoment,
  isoToDatetimeLocal,
} from "@/lib/inbox-terugbel";
import { isSimonBeller } from "@/lib/ops-namen";
import { normalizeRol } from "@/lib/rollen";
import {
  buildMailConversations,
  isOutboundMail,
  normMailSubject,
  previewMailText,
  shortMailDate,
} from "@/lib/mail-conversations";
import { cn } from "@/lib/utils";
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

function mailAsksAfspraakWijziging(mail: InboxMail | null): boolean {
  if (!mail) return false;
  if (mail.folder === "afzegging_afspraak") return true;
  if (mail.aiEffects?.cancelAfspraak) return true;
  const t = `${mail.subject}\n${mail.bodyText}\n${mail.aiSummary || ""}`.toLowerCase();
  return (
    /(afspraak|bezoek|huisbezoek).{0,80}(cancel|annul|afzeg|verzet|verplaats|anders)/.test(
      t
    ) ||
    /\b(annuleren|afzeggen|verzetten|verplaatsen)\b/.test(t)
  );
}

/** Splits nieuw bericht van geciteerde thread — makkelijker lezen. */
function splitMailBody(raw: string): { main: string; quoted: string | null } {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return { main: "(geen tekst)", quoted: null };
  const patterns = [
    /\nOn .+ wrote:\s*\n/i,
    /\nOp .+ schreef .+:\s*\n/i,
    /\nFrom:\s+.+\nSent:\s+/i,
    /\nVan:\s+.+\nVerzonden:\s+/i,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}\s*\n/,
  ];
  let cut = -1;
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && (cut < 0 || m.index < cut)) cut = m.index;
  }
  // Geciteerde regels vanaf eerste block met > 
  if (cut < 0) {
    const lines = text.split("\n");
    const qi = lines.findIndex(
      (l, i) => i > 0 && /^>/.test(l.trim()) && lines.slice(i, i + 3).every((x) => !x.trim() || /^>/.test(x.trim()) || /schrijft?:/i.test(x))
    );
    if (qi > 2) cut = lines.slice(0, qi).join("\n").length;
  }
  if (cut <= 0 || cut >= text.length - 20) {
    return { main: text, quoted: null };
  }
  const main = text.slice(0, cut).trim();
  const quoted = text.slice(cut).trim();
  if (main.length < 8) return { main: text, quoted: null };
  return { main, quoted: quoted || null };
}

function softenLongUrls(text: string) {
  return text.replace(/https?:\/\/[^\s]+/g, (url) => {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 24 ? `${u.pathname.slice(0, 22)}…` : u.pathname;
      return `${u.host}${path}`;
    } catch {
      return url.length > 48 ? `${url.slice(0, 46)}…` : url;
    }
  });
}

function MailBodyReadable({ text }: { text: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { main, quoted } = useMemo(() => splitMailBody(text), [text]);
  return (
    <div className="mt-3">
      <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.55] text-[#1D1D1F]">
        {softenLongUrls(main)}
      </div>
      {quoted ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowQuoted((v) => !v)}
            className="text-[12px] font-semibold text-[#007AFF] hover:underline"
          >
            {showQuoted ? "Verberg eerdere berichten" : "Toon eerdere berichten"}
          </button>
          {showQuoted ? (
            <div className="mt-2 whitespace-pre-wrap break-words border-l-2 border-black/10 pl-3 text-[13px] leading-relaxed text-[#6E6E73]">
              {softenLongUrls(quoted)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
  const open =
    afspraak.status !== "geannuleerd" && afspraak.status !== "voltooid";
  const soort =
    afspraakSoortLabel[normalizeAfspraakSoort(afspraak.soort)] || "Afspraak";
  const status =
    afspraakStatusLabel[afspraak.status as AfspraakStatus] || afspraak.status;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2",
        cancelled
          ? "border-[#FF3B30]/20 bg-[#FFF5F5]"
          : canCancel
            ? "border-[#FF9500]/25 bg-[#FFF9F0]"
            : "border-black/8 bg-[#F2F2F7]"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[#1D1D1F]">
          {wanneer.datum}{" "}
          <span className="tabular-nums text-[#007AFF]">{wanneer.tijd}</span>
          <span
            className={cn(
              "ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold",
              cancelled
                ? "bg-[#FF3B30]/15 text-[#C62828]"
                : "bg-[#34C759]/15 text-[#1B7A3D]"
            )}
          >
            {status}
          </span>
        </p>
        <p className="truncate text-[12px] text-[#6E6E73]">
          {soort}
          {afspraak.adviseurNaam ? ` · ${afspraak.adviseurNaam}` : ""}
        </p>
      </div>
      {canCancel && open ? (
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded-lg bg-[#FF9500] px-3 text-[12px] font-semibold text-white hover:bg-[#E68600] disabled:opacity-50"
        >
          {busy ? "Bezig…" : "Afzeggen"}
        </button>
      ) : null}
      {cancelled && leadId ? (
        <Link
          href={`/leads/${leadId}?plan=huisbezoek`}
          className="inline-flex h-8 items-center rounded-lg bg-[#007AFF] px-3 text-[12px] font-semibold text-white hover:bg-[#0066D6]"
        >
          Opnieuw inplannen
        </Link>
      ) : null}
      <Link
        href={`/?tab=agenda&afspraak=${afspraak.id}`}
        className="inline-flex h-8 items-center rounded-lg border border-black/10 bg-white px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/[0.03]"
      >
        Agenda
      </Link>
    </div>
  );
}

export function InboxPanel({
  onUnreadChange,
}: {
  onUnreadChange?: (n: number) => void;
}) {
  const { session } = useCrmSession();
  const [mails, setMails] = useState<InboxMail[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncBusy, setSyncBusy] = useState(false);
  const [folder, setFolder] = useState<InboxFolderId>("inbox");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [listPage, setListPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const replyToTouched = useRef(false);
  const replyBodyRef = useRef<HTMLTextAreaElement>(null);
  const [templateId, setTemplateId] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
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
  const [terugbelGezetVoor, setTerugbelGezetVoor] = useState<string | null>(
    null
  );
  const [terugbelAt, setTerugbelAt] = useState("");
  const [terugbelAdviseurId, setTerugbelAdviseurId] = useState("");
  const [terugbelAdviseurs, setTerugbelAdviseurs] = useState<
    Array<{ id: string; naam: string; rol?: string | null }>
  >([]);
  const skipAutoReadForKey = useRef<string | null>(null);

  const loadInbox = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const res = await fetch("/api/inbox?limit=200");
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mails?: InboxMail[];
      };
      if (!res.ok) throw new Error(data.error || "Inbox laden mislukt");
      const next = Array.isArray(data.mails) ? data.mails : [];
      setMails(next);
      onUnreadChange?.(unreadInboundCount(next));
    } catch (e) {
      if (!opts?.silent) {
        setActionMsg(e instanceof Error ? e.message : "Inbox laden mislukt");
      }
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  const conversations = useMemo(
    () => buildMailConversations(mails),
    [mails]
  );

  const listMailIds = useMemo(() => {
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

    if (needle) {
      return new Set(mails.filter(matchQ).map((m) => m.id));
    }

    const repliedThreads = new Set(
      mails
        .filter((m) => m.folder === "verzonden")
        .flatMap((m) =>
          [m.threadId, m.messageId].filter(
            (x): x is string => Boolean(x && String(x).trim())
          )
        )
    );
    return new Set(
      mails
        .filter((m) => mailInFolder(m, folder))
        .filter((m) => {
          if (folder === "archief" || folder === "verzonden") return true;
          const tid = m.threadId || m.messageId || m.id;
          if (tid && repliedThreads.has(tid)) return false;
          return true;
        })
        .map((m) => m.id)
    );
  }, [mails, folder, q]);

  const filteredConversations = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!c.messages.some((m) => listMailIds.has(m.id))) return false;
      if (
        unreadOnly &&
        folder !== "archief" &&
        folder !== "verzonden" &&
        c.key !== selectedKey &&
        !c.messages.some((m) => m.status === "nieuw" && !isOutboundMail(m))
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        c.peerName,
        c.peerEmail,
        c.subject,
        ...c.messages.map(
          (m) => `${m.fromName} ${m.bodyText} ${m.subject} ${m.aiSummary || ""}`
        ),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [conversations, listMailIds, q, unreadOnly, folder, selectedKey]);

  const LIST_PAGE_SIZE = 10;
  const listPageCount = Math.max(
    1,
    Math.ceil(filteredConversations.length / LIST_PAGE_SIZE)
  );
  const pagedConversations = useMemo(() => {
    const start = listPage * LIST_PAGE_SIZE;
    return filteredConversations.slice(start, start + LIST_PAGE_SIZE);
  }, [filteredConversations, listPage]);

  useEffect(() => {
    setListPage(0);
  }, [folder, q, unreadOnly]);

  useEffect(() => {
    setListPage((p) => Math.min(p, listPageCount - 1));
  }, [listPageCount]);

  useEffect(() => {
    if (!filteredConversations.length) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((prev) => {
      if (prev && filteredConversations.some((c) => c.key === prev)) return prev;
      return null;
    });
  }, [filteredConversations]);

  const selectedConversation =
    filteredConversations.find((c) => c.key === selectedKey) || null;

  const selected = selectedConversation?.replyTarget || null;

  const extracted = useMemo(
    () => (selected ? extractInboxFacts(selected) : null),
    [selected]
  );

  const terugbelSuggestie = useMemo(
    () => (selected ? inboxTerugbelMoment(selected) : null),
    [selected]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/adviseurs");
        const data = (await res.json().catch(() => ({}))) as {
          adviseurs?: Array<{ id: string; naam: string; rol?: string | null }>;
        };
        if (cancelled || !Array.isArray(data.adviseurs)) return;
        const rows = data.adviseurs.filter((a) => a.id && a.naam);
        setTerugbelAdviseurs(rows);
      } catch {
        /* bel-lijst optioneel */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!terugbelSuggestie) return;
    setTerugbelAt(isoToDatetimeLocal(terugbelSuggestie.startAt));
  }, [selected?.id, terugbelSuggestie?.startAt]);

  useEffect(() => {
    if (terugbelAdviseurId || terugbelAdviseurs.length === 0) return;
    const simon =
      terugbelAdviseurs.find(
        (a) => isSimonBeller(a) && normalizeRol(a.rol) === "beller"
      ) ||
      terugbelAdviseurs.find((a) => isSimonBeller(a)) ||
      terugbelAdviseurs.find((a) => normalizeRol(a.rol) === "beller") ||
      terugbelAdviseurs.find((a) => a.id === session?.id) ||
      terugbelAdviseurs[0];
    if (simon?.id) setTerugbelAdviseurId(simon.id);
  }, [terugbelAdviseurs, terugbelAdviseurId, session?.id]);

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

  function selectConversation(key: string) {
    setSelectedKey(key);
    setActionMsg(null);
    setComposeOpen(true);
  }

  function prepareReply(mail: InboxMail) {
    const agent = session?.naam || "BatterijConcept";
    const klant =
      matchedLead?.naam || mail.leadNaam || mail.fromName || "klant";
    setComposeOpen(true);
    setTemplateId("");
    replyToTouched.current = false;
    setReplyToEmail(
      (matchedLead?.email || mail.fromEmail || "").trim()
    );
    setReplySubject(normalizeReplySubject(mail.subject));
    setReplyBody(defaultReplyBody(klant, agent));
    window.requestAnimationFrame(() => replyBodyRef.current?.focus());
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
      setSelectedKey(null);
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

  async function createTerugbelFromMail() {
    if (!selected) return;
    if (!matchedLead?.id) {
      setActionMsg("Koppel eerst een lead, daarna kun je het terugbelverzoek zetten.");
      return;
    }
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch("/api/inbox/terugbel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: matchedLead.id,
          start_at: datetimeLocalToIso(terugbelAt) || terugbelSuggestie?.startAt || null,
          adviseur_id: terugbelAdviseurId || null,
          notitie:
            selected.aiSummary?.trim() ||
            displayBodyText(selected).split("\n").filter(Boolean).slice(0, 4).join(" ").slice(0, 280),
          subject: selected.subject,
          body_text: selected.bodyText,
          ai_summary: selected.aiSummary,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        beller?: { naam?: string };
        label?: string | null;
        start_at?: string;
      };
      if (!res.ok) throw new Error(data.error || "Terugbelverzoek mislukt");
      setTerugbelGezetVoor(selected.id);
      const when = data.label || terugbelSuggestie?.label || "ingepland";
      const wie = data.beller?.naam || "Simon";
      setActionMsg(`Terugbelverzoek gezet voor ${wie} · ${when}.`);
    } catch (e) {
      setActionMsg(
        e instanceof Error ? e.message : "Terugbelverzoek mislukt"
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
    if (selected?.id === mailId) {
      setSelectedKey(null);
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

  async function markConversationUnread() {
    if (!selectedConversation) return;
    const ids = selectedConversation.messages
      .filter((m) => !isOutboundMail(m) && m.status !== "nieuw")
      .map((m) => m.id);
    if (!ids.length) return;
    skipAutoReadForKey.current = selectedConversation.key;
    setMails((prev) => {
      const next = prev.map((m) =>
        ids.includes(m.id) ? { ...m, status: "nieuw" as const } : m
      );
      onUnreadChange?.(unreadInboundCount(next));
      return next;
    });
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/inbox/${encodeURIComponent(id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "nieuw" }),
          })
        )
      );
    } catch {
      /* lokaal al unread; sync volgt bij vernieuwen */
    }
  }

  function applyTemplate(id: string) {
    if (!selected) return;
    const t = templatesForMail(selected).find((x) => x.id === id);
    setTemplateId(id);
    if (!t) return;
    setComposeOpen(true);
    setReplySubject(t.subject(selected));
    setReplyBody(t.body(selected));
  }

  // Markeer ongelezen + zet antwoord klaar (altijd open composer)
  useEffect(() => {
    if (!selectedConversation) {
      setComposeOpen(false);
      return;
    }
    const mail = selectedConversation.replyTarget;
    const agent = session?.naam || "BatterijConcept";
    const klant =
      matchedLead?.naam || mail.leadNaam || mail.fromName || "klant";
    replyToTouched.current = false;
    setReplyToEmail(
      (
        matchedLead?.email ||
        (!isOutboundMail(mail) ? mail.fromEmail : selectedConversation.peerEmail) ||
        mail.fromEmail ||
        ""
      ).trim()
    );
    setReplySubject(normalizeReplySubject(selectedConversation.subject));
    setReplyBody(defaultReplyBody(klant, agent));
    setTemplateId("");
    setComposeOpen(true);

    if (skipAutoReadForKey.current === selectedConversation.key) {
      return;
    }
    skipAutoReadForKey.current = null;

    const unreadIds = selectedConversation.messages
      .filter((m) => m.status === "nieuw" && !isOutboundMail(m))
      .map((m) => m.id);
    if (!unreadIds.length) return;
    setMails((prev) => {
      const next = prev.map((m) =>
        unreadIds.includes(m.id) ? { ...m, status: "gelezen" as const } : m
      );
      onUnreadChange?.(unreadInboundCount(next));
      return next;
    });
    for (const id of unreadIds) {
      void fetch(`/api/inbox/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "gelezen" }),
      }).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen bij wissel conversatie
  }, [selectedConversation?.key]);

  async function draftReply(mail: InboxMail) {
    setComposeOpen(true);
    // Re: meteen zichtbaar terwijl AI schrijft
    setReplySubject(normalizeReplySubject(mail.subject));
    setDraftBusy(true);
    setActionMsg(null);
    try {
      const threadMails =
        selectedConversation?.messages?.length
          ? selectedConversation.messages
          : [mail];
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
          thread: threadMails.slice(-12).map((m) => ({
            fromUs: isOutboundMail(m),
            fromName: m.fromName,
            at: m.receivedAt,
            subject: m.subject,
            body: displayBodyText(m),
          })),
          context: {
            folder: mail.suggestedFolder || mail.folder,
            aiSummary: mail.aiSummary || null,
            cancelAfspraak: Boolean(
              mail.aiEffects?.cancelAfspraak || extracted?.afspraakAfzeggen
            ),
            leadGeenContact: Boolean(mail.aiEffects?.leadGeenContact),
            leadGeenInteresse: Boolean(mail.aiEffects?.leadGeenInteresse),
            createServiceVerzoek: Boolean(
              mail.aiEffects?.createServiceVerzoek
            ),
            leadNaam: matchedLead?.naam || mail.leadNaam || null,
            leadStatus: matchedLead?.status || null,
            leadPlaats: matchedLead?.plaats || null,
            leadNumber: matchedLead?.lead_number || null,
            projectNummer:
              linkedProject?.project_nummer || mail.projectNummer || null,
            projectStatus: linkedProject?.status || null,
            afspraak: linkedAfspraak
              ? {
                  startAt: linkedAfspraak.start_at,
                  status: linkedAfspraak.status,
                  soort: linkedAfspraak.soort || null,
                  adviseurNaam: linkedAfspraak.adviseurNaam || null,
                }
              : null,
          },
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
      setSelectedKey(null);
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

  const threadMessages = selectedConversation?.messages || [];
  const templates = selected
    ? templatesForMail(
      extracted?.afspraakAfzeggen ||
      selected.folder === "afzegging_afspraak" ||
      selected.aiEffects?.cancelAfspraak
        ? { ...selected, folder: "afzegging_afspraak" }
        : selected
      )
    : [];
  const inboxUnread = unreadInboundCount(mails);
  const canMarkUnread = Boolean(
    selectedConversation?.messages.some(
      (m) => !isOutboundMail(m) && m.status !== "nieuw"
    )
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#F5F5F7]">
      <div className="flex shrink-0 items-center gap-2 border-b border-black/10 bg-white/80 px-3 py-2 backdrop-blur-md sm:px-4">
        <p className="text-[13px] font-semibold tracking-tight text-[#1D1D1F]">
          Inbox
        </p>
        {inboxUnread > 0 ? (
          <span
            className="rounded-full bg-[#007AFF] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white"
            aria-label={`${inboxUnread} ongelezen`}
          >
            {inboxUnread > 99 ? "99+" : inboxUnread}
          </span>
        ) : (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#6E6E73]">
            {filteredConversations.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[13px]"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              prepareReply(selected);
              replyBodyRef.current?.focus();
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
            disabled={loading || syncBusy}
            onClick={() => void loadInbox()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Vernieuwen
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-[13px]"
            disabled={loading || syncBusy}
            onClick={() => void syncImap()}
          >
            <RefreshCw className={cn("size-3.5", syncBusy && "animate-spin")} />
            {syncBusy ? "Sync…" : "Sync IMAP"}
          </Button>
        </div>
      </div>

      {actionMsg ? (
        <div className="shrink-0 border-b border-black/5 bg-white px-4 py-2 text-[13px] text-[#1D1D1F]">
          {actionMsg}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <aside
          className={cn(
            "min-h-0 flex-col border-b border-black/10 bg-white lg:border-b-0 lg:border-r",
            selected ? "hidden lg:flex" : "flex"
          )}
        >
          <div className="shrink-0 space-y-2 border-b border-black/5 px-3 py-2">
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
            {folder !== "archief" && folder !== "verzonden" ? (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setUnreadOnly(true)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    unreadOnly
                      ? "bg-[#1D1D1F] text-white"
                      : "bg-[#F2F2F7] text-[#6E6E73] hover:text-[#1D1D1F]"
                  )}
                >
                  Ongelezen
                </button>
                <button
                  type="button"
                  onClick={() => setUnreadOnly(false)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    !unreadOnly
                      ? "bg-[#1D1D1F] text-white"
                      : "bg-[#F2F2F7] text-[#6E6E73] hover:text-[#1D1D1F]"
                  )}
                >
                  Alle
                </button>
              </div>
            ) : null}
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {INBOX_FOLDERS.map((f) => {
                const active = folder === f.id;
                const n = folderCounts[f.id];
                return (
                  <button
                    key={f.id}
                    type="button"
                    title={f.hint}
                    onClick={() => {
                      setFolder(f.id);
                      if (f.id === "archief" || f.id === "verzonden") {
                        setUnreadOnly(false);
                      }
                    }}
                    className={cn(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                      active
                        ? "bg-[#007AFF] text-white"
                        : "bg-[#F2F2F7] text-[#6E6E73] hover:text-[#1D1D1F]"
                    )}
                  >
                    {f.label}
                    {n > 0 ? ` · ${n}` : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {loading && filteredConversations.length === 0 ? (
              <p className="px-4 py-10 text-center text-[13px] text-[#8E8E93]">
                Laden…
              </p>
            ) : filteredConversations.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <Mail className="mx-auto mb-2 size-7 text-[#C7C7CC]" />
                <p className="text-[13px] text-[#8E8E93]">
                  {q.trim()
                    ? "Geen mails gevonden"
                    : unreadOnly
                      ? "Geen ongelezen mails"
                      : "Geen mails in deze map"}
                </p>
                {unreadOnly && !q.trim() ? (
                  <button
                    type="button"
                    onClick={() => setUnreadOnly(false)}
                    className="mt-2 text-[12px] font-semibold text-[#007AFF] hover:underline"
                  >
                    Toon alle mails
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="h-full overflow-hidden">
                {pagedConversations.map((c) => {
                  const active = selectedKey === c.key;
                  const n = c.messages.length;
                  const unread = c.messages.some(
                    (m) => m.status === "nieuw" && !isOutboundMail(m)
                  );
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => selectConversation(c.key)}
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
                            <span className="truncate">
                              {c.replyTarget.leadNaam || c.peerName}
                            </span>
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
                            {shortMailDate(c.latest.receivedAt)}
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
                          {isOutboundMail(c.latest) ? "Jij: " : ""}
                          {previewMailText(
                            c.latest.aiSummary || c.latest.bodyText
                          ) || "—"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {filteredConversations.length > 0 ? (
            <div className="flex shrink-0 items-center justify-between border-t border-black/5 px-3 py-2">
              <p className="text-[11px] tabular-nums text-[#8E8E93]">
                {filteredConversations.length === 0
                  ? "0"
                  : `${listPage * LIST_PAGE_SIZE + 1}–${Math.min(
                      (listPage + 1) * LIST_PAGE_SIZE,
                      filteredConversations.length
                    )}`}
                {" van "}
                {filteredConversations.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={listPage <= 0}
                  aria-label="Vorige pagina"
                  onClick={() => setListPage((p) => Math.max(0, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-[3.5rem] text-center text-[11px] font-medium tabular-nums text-[#6E6E73]">
                  {listPage + 1}/{listPageCount}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={listPage >= listPageCount - 1}
                  aria-label="Volgende pagina"
                  onClick={() =>
                    setListPage((p) => Math.min(listPageCount - 1, p + 1))
                  }
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
          {!selected || !selectedConversation ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[#8E8E93]">
              <Mail className="size-10 opacity-40" />
              <p className="text-[14px]">Geen bericht geselecteerd</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-black/5 px-4 py-2.5 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mb-1 h-7 px-2 text-[12px] lg:hidden"
                      onClick={() => setSelectedKey(null)}
                    >
                      <ArrowLeft className="size-3.5" />
                      Inbox
                    </Button>
                    <h2 className="truncate text-[16px] font-semibold tracking-tight text-[#1D1D1F]">
                      {selectedConversation.subject || "(geen onderwerp)"}
                    </h2>
                    <p className="mt-0.5 truncate text-[12px] text-[#8E8E93]">
                      {selectedConversation.peerEmail || "onbekend"}
                      {selected.aiSummary ? ` · ${selected.aiSummary}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-[12px] text-[#8E8E93]"
                      disabled={!canMarkUnread}
                      onClick={() => void markConversationUnread()}
                    >
                      <MailOpen className="size-3.5" />
                      Unread
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1.5 text-[12px] text-[#8E8E93]"
                      onClick={() => void deleteMail(selected.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Verwijderen
                    </Button>
                  </div>
                </div>

                {matchedLead ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <User className="size-3.5 text-[#007AFF]" />
                    <span className="truncate text-[13px] font-medium text-[#1D1D1F]">
                      {matchedLead.naam}
                    </span>
                    <span className="truncate text-[12px] text-[#8E8E93]">
                      {[
                        matchedLead.lead_number,
                        matchedLead.plaats,
                        matchedLead.status
                          ? leadStatusLabel[matchedLead.status as LeadStatus] ||
                            matchedLead.status
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <Link
                      href={`/leads/${matchedLead.id}`}
                      className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.03]"
                    >
                      Lead
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                    {linkedProject?.id ? (
                      <Link
                        href={`/projecten/${linkedProject.id}`}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.03]"
                      >
                        Project
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                ) : leadLookupBusy || contextBusy ? (
                  <p className="mt-2 text-[12px] text-[#8E8E93]">Klant zoeken…</p>
                ) : leadCandidates.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {leadCandidates.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => chooseLead(lead)}
                        className="rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[12px] font-medium hover:bg-black/[0.03]"
                      >
                        {lead.naam}
                        {lead.plaats ? ` · ${lead.plaats}` : ""}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 space-y-1.5">
                  {linkedAfspraak ? (
                    <AfspraakActieKaart
                      afspraak={linkedAfspraak}
                      leadId={matchedLead?.id}
                      canCancel={
                        Boolean(extracted?.afspraakAfzeggen) ||
                        mailAsksAfspraakWijziging(selected)
                      }
                      busy={actionBusy}
                      onCancel={() => void cancelLinkedAfspraak()}
                    />
                  ) : null}

                  {matchedLead ? (
                    <div className="rounded-xl border border-[#34C759]/25 bg-[#F1FBF4] px-3 py-2.5">
                      <p className="text-[13px] font-medium text-[#1D1D1F]">
                        Terugbelverzoek
                      </p>
                      <p className="mt-0.5 text-[12px] text-[#6E6E73]">
                        {terugbelSuggestie?.hint &&
                        terugbelSuggestie.hint !== "terugbellen"
                          ? `Uit de mail: ${terugbelSuggestie.hint} · ${terugbelSuggestie.label}`
                          : "Lead herkend — kies datum, tijd en medewerker"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <label className="min-w-[11.5rem] flex-1">
                          <span className="mb-1 block text-[11px] font-medium text-[#6E6E73]">
                            Datum en tijd
                          </span>
                          <input
                            type="datetime-local"
                            value={terugbelAt}
                            onChange={(e) => setTerugbelAt(e.target.value)}
                            className="h-8 w-full rounded-lg border border-black/10 bg-white px-2 text-[12px] text-[#1D1D1F] outline-none focus:border-[#34C759]"
                          />
                        </label>
                        <label className="min-w-[10rem] flex-1">
                          <span className="mb-1 block text-[11px] font-medium text-[#6E6E73]">
                            Medewerker
                          </span>
                          <select
                            value={terugbelAdviseurId}
                            onChange={(e) =>
                              setTerugbelAdviseurId(e.target.value)
                            }
                            className="h-8 w-full rounded-lg border border-black/10 bg-white px-2 text-[12px] text-[#1D1D1F] outline-none focus:border-[#34C759]"
                          >
                            {terugbelAdviseurs.length === 0 ? (
                              <option value="">Laden…</option>
                            ) : null}
                            {terugbelAdviseurs.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.naam}
                                {normalizeRol(a.rol) === "beller"
                                  ? " · beller"
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          disabled={
                            actionBusy ||
                            terugbelGezetVoor === selected.id ||
                            !terugbelAt ||
                            !terugbelAdviseurId
                          }
                          onClick={() => void createTerugbelFromMail()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#34C759] px-3 text-[12px] font-semibold text-white hover:bg-[#2FB350] disabled:opacity-50"
                        >
                          <Phone className="size-3.5" />
                          {terugbelGezetVoor === selected.id
                            ? "Gezet"
                            : INBOX_ACTION_LABEL.maak_terugbel}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {selected.folder === "service" ||
                  selected.aiEffects?.createServiceVerzoek ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#007AFF]/20 bg-[#F0F7FF] px-3 py-2">
                      <p className="min-w-0 flex-1 text-[13px] font-medium text-[#1D1D1F]">
                        Serviceverzoek aanmaken
                      </p>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void createServiceFromMail()}
                        className="inline-flex h-8 items-center rounded-lg bg-[#007AFF] px-3 text-[12px] font-semibold text-white hover:bg-[#0066D6] disabled:opacity-50"
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
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#FF9500]/25 bg-[#FFF9F0] px-3 py-2">
                      <p className="min-w-0 flex-1 text-[13px] font-medium text-[#1D1D1F]">
                        Klant lijkt geen interesse te hebben
                      </p>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void markLeadStatus("geen_interesse")}
                        className="inline-flex h-8 items-center rounded-lg bg-[#FF9500] px-3 text-[12px] font-semibold text-white hover:bg-[#E68600] disabled:opacity-50"
                      >
                        {INBOX_ACTION_LABEL.mark_geen_interesse}
                      </button>
                    </div>
                  ) : null}

                  {matchedLead &&
                  mailSuggestsGeenContact(selected) &&
                  matchedLead.status !== "geen_contact" &&
                  matchedLead.status !== "geen_interesse" ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 bg-[#F2F2F7] px-3 py-2">
                      <p className="min-w-0 flex-1 text-[13px] font-medium text-[#1D1D1F]">
                        Geen contact meer gewenst
                      </p>
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={() => void markLeadStatus("geen_contact")}
                        className="inline-flex h-8 items-center rounded-lg border border-black/10 bg-white px-3 text-[12px] font-semibold text-[#1D1D1F] hover:bg-black/[0.03] disabled:opacity-50"
                      >
                        {INBOX_ACTION_LABEL.mark_geen_contact}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto bg-[#FAFAFA] px-4 py-3 sm:px-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                  {threadMessages.length === 0 ? (
                    <p className="py-10 text-center text-[13px] text-[#8E8E93]">
                      Geen berichten in deze conversatie.
                    </p>
                  ) : null}
                  {threadMessages.map((m, idx) => {
                    const outbound = isOutboundMail(m);
                    const msgPhotos = collectMailPhotos(m);
                    const msgFileAtts = (m.attachments || []).filter(
                      (a) => !isInboxImageAttachment(a)
                    );
                    return (
                      <article
                        key={m.id}
                        className={cn(
                          "rounded-2xl border px-4 py-4 shadow-sm sm:px-5",
                          outbound
                            ? "border-[#007AFF]/20 bg-[#F0F7FF]"
                            : "border-black/10 bg-white"
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
                              <p className="text-[14px] font-semibold text-[#1D1D1F]">
                                {outbound
                                  ? "BatterijConcept"
                                  : m.fromName || m.fromEmail}
                                {outbound ? (
                                  <span className="ml-1.5 text-[11px] font-medium text-[#007AFF]">
                                    Verzonden
                                  </span>
                                ) : null}
                              </p>
                              <span className="text-[12px] tabular-nums text-[#8E8E93]">
                                {formatDateTimeNl(m.receivedAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[12px] text-[#8E8E93]">
                              {m.fromEmail}
                              {m.toEmail ? ` → ${m.toEmail}` : ""}
                            </p>
                            {idx === 0 &&
                            normMailSubject(m.subject) !==
                              normMailSubject(
                                selectedConversation.subject
                              ) ? (
                              <p className="mt-1 text-[13px] font-medium text-[#1D1D1F]">
                                {m.subject}
                              </p>
                            ) : null}
                            {msgPhotos.length > 0 ? (
                              <div className="mt-3">
                                <MailPhotoGallery
                                  photos={msgPhotos}
                                  mailId={m.id}
                                />
                              </div>
                            ) : null}
                            <MailBodyReadable text={displayBodyText(m)} />
                            {msgFileAtts.length > 0 ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {msgFileAtts.map((a) => (
                                  <a
                                    key={a.id}
                                    href={`/api/inbox/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}`}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-[#1D1D1F] hover:bg-black/[0.03]"
                                  >
                                    {a.filename}
                                    {a.size ? (
                                      <span className="text-[#8E8E93]">
                                        {formatBytes(a.size)}
                                      </span>
                                    ) : null}
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              <div className="shrink-0 border-t border-black/10 bg-white">
                <div className="px-4 py-2.5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {templates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t.id)}
                        className={cn(
                          "rounded-full border px-3 py-1 text-[12px] font-medium transition",
                          templateId === t.id
                            ? "border-[#007AFF] bg-[#007AFF]/10 text-[#007AFF]"
                            : "border-black/10 bg-[#F5F5F7] text-[#1D1D1F] hover:bg-black/[0.03]"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      title="AI-concept"
                      disabled={draftBusy}
                      onClick={() => void draftReply(selected)}
                      className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold text-[#007AFF] hover:bg-[#007AFF]/10 disabled:opacity-40"
                    >
                      <AiMark className="h-4 w-4" />
                      {draftBusy ? "Schrijven…" : "AI"}
                    </button>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-black/10 bg-white">
                    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 border-b border-black/5 px-3 py-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#8E8E93]">
                        Aan
                      </span>
                      <input
                        type="email"
                        value={replyToEmail}
                        onChange={(e) => {
                          replyToTouched.current = true;
                          setReplyToEmail(e.target.value);
                        }}
                        className="min-w-0 w-full border-0 bg-transparent text-[13px] text-[#1D1D1F] outline-none"
                        placeholder="klant@email.nl"
                      />
                    </div>
                    <textarea
                      ref={replyBodyRef}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={8}
                      placeholder="Typ hier je antwoord…"
                      className="min-h-[180px] max-h-[38vh] w-full resize-none border-0 bg-white px-4 py-3 text-[15px] leading-relaxed text-[#1D1D1F] outline-none"
                    />
                    <div className="flex items-center justify-between gap-2 border-t border-black/5 bg-[#FAFAFA] px-3 py-2">
                      <input
                        type="text"
                        value={replySubject}
                        onChange={(e) => setReplySubject(e.target.value)}
                        className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-[#8E8E93] outline-none"
                        placeholder="Onderwerp"
                      />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 bg-[#007AFF] px-4 text-[13px] text-white hover:bg-[#0066D6]"
                        disabled={
                          sendBusy ||
                          !replyBody.trim() ||
                          !replyToEmail.trim()
                        }
                        onClick={() => void sendReply()}
                      >
                        <Reply className="size-3.5" />
                        {sendBusy ? "Versturen…" : "Versturen"}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
