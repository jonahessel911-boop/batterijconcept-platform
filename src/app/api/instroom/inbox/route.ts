import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";
import { listInboxMails, rowToInboxMail } from "@/lib/inbox-persist";
import { imapConfigured, syncInboxFromImap } from "@/lib/inbox-imap";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Strikte recruitment-signalen (onderwerp/body). */
const RECRUITMENT_HIT_RE =
  /sollicit|vacature|werkenbij|werken bij|werken als|geprobeerd te bellen|nog interesse in de functie|functie van|BatterijConcept Recruitment|je training:|sollicitatiegesprek|appointment setter|recruitment/i;

/** Lead/sales — nooit in recruitment-inbox. */
const LEAD_SALES_EXCLUDE_RE =
  /batterij zonder|thuisbatterij|interesse in een batterij|interesse in een batterijconcept|vrijblijvende berekening|eigen investering|herplannen van uw afspraak|plugin batterij|salderingsregeling|warmtefonds|thuisbatter/i;

/** Duidelijke non-recruitment (facturen, social, etc.). */
const HARD_EXCLUDE_RE =
  /\bfactuur\b|\binvoice\b|tiktok|offerte|bestelling|newsletter|nieuwsbrief|noreply@|no-reply@|mailer-daemon|undeliverable/i;

const INFO_RE = /@batterijconcept\.nl$/i;
const RECRUIT_TAG_RE =
  /sollicitatie|recruitment-inbox-reply|recruitment/i;

function normEmail(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase();
}

function looksLikeRecruitment(subject: string, bodyText: string): boolean {
  const subjectNorm = subject.trim();
  if (
    /nog interesse in/i.test(subjectNorm) &&
    !LEAD_SALES_EXCLUDE_RE.test(subjectNorm) &&
    !/batterij/i.test(subjectNorm)
  ) {
    return true;
  }
  if (RECRUITMENT_HIT_RE.test(subjectNorm)) return true;
  const bodyHead = bodyText.slice(0, 1200);
  if (RECRUITMENT_HIT_RE.test(bodyHead)) return true;
  return false;
}

function isHardExcluded(
  subject: string,
  bodyText: string,
  fromEmail: string
): boolean {
  if (HARD_EXCLUDE_RE.test(subject)) return true;
  if (HARD_EXCLUDE_RE.test(fromEmail)) return true;
  if (
    LEAD_SALES_EXCLUDE_RE.test(subject) ||
    LEAD_SALES_EXCLUDE_RE.test(bodyText)
  ) {
    return true;
  }
  return false;
}

function isRecruitmentSeed(opts: {
  subject: string;
  bodyText: string;
  fromName: string;
  fromEmail: string;
  folder?: string;
  tag?: string | null;
  isSollicitant: boolean;
}): boolean {
  if (opts.tag && RECRUIT_TAG_RE.test(opts.tag)) return true;
  if (/BatterijConcept Recruitment/i.test(opts.fromName || "")) return true;

  if (isHardExcluded(opts.subject, opts.bodyText, opts.fromEmail)) {
    return false;
  }

  // Bekende sollicitant → inbound altijd (korte replies zonder keywords).
  if (opts.isSollicitant && opts.folder !== "verzonden") return true;

  if (looksLikeRecruitment(opts.subject, opts.bodyText)) return true;

  return false;
}

/**
 * GET /api/instroom/inbox
 * Alleen recruitment-mails (+ thread/follow-ups van die peers/sollicitanten).
 */
export async function GET(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    const limit = Number(req.nextUrl.searchParams.get("limit") || 200) || 200;

    const { data: sols, error: solErr } = await sb
      .from("sollicitaties")
      .select("id, naam, email, functie, status, telefoon")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (solErr) {
      if (solErr.code === "42P01") {
        return NextResponse.json(
          { error: "Sollicitaties-tabel ontbreekt", mails: [] },
          { status: 400 }
        );
      }
      throw solErr;
    }

    const byEmail = new Map<
      string,
      {
        id: string;
        naam: string;
        email: string | null;
        functie: string | null;
        status: string;
      }
    >();
    for (const s of sols || []) {
      const e = normEmail(s.email as string | null);
      if (!e) continue;
      if (!byEmail.has(e)) {
        byEmail.set(e, {
          id: s.id as string,
          naam: s.naam as string,
          email: (s.email as string | null) || null,
          functie: (s.functie as string | null) || null,
          status: s.status as string,
        });
      }
    }

    let rows;
    try {
      rows = await listInboxMails(sb, { limit: Math.max(limit, 400) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/inbox_mails|42P01|does not exist/i.test(msg)) {
        return NextResponse.json({
          mails: [],
          count: 0,
          configured: imapConfigured(),
          hint: "Inbox-tabel ontbreekt of is leeg",
        });
      }
      throw e;
    }

    type MatchedMail = ReturnType<typeof rowToInboxMail> & {
      sollicitatie: {
        id: string;
        naam: string;
        email: string | null;
        functie: string | null;
        status: string;
      } | null;
      match_reason: string;
    };

    const annotated = rows.map((row) => {
      const mail = rowToInboxMail(row);
      const from = normEmail(mail.fromEmail);
      const to = normEmail(mail.toEmail);
      const peer = INFO_RE.test(from) ? to : from;
      const sol = byEmail.get(peer) || byEmail.get(from) || byEmail.get(to) || null;
      const raw = (row.raw_headers || {}) as Record<string, unknown>;
      const tag =
        typeof raw.postmark_tag === "string" ? raw.postmark_tag : null;
      const hardExcluded = isHardExcluded(
        mail.subject || "",
        mail.bodyText || "",
        mail.fromEmail || ""
      );
      const seed = !hardExcluded
        ? isRecruitmentSeed({
            subject: mail.subject || "",
            bodyText: mail.bodyText || "",
            fromName: mail.fromName || "",
            fromEmail: mail.fromEmail || "",
            folder: mail.folder,
            tag,
            isSollicitant: Boolean(sol),
          })
        : false;

      const tagHit = Boolean(tag && RECRUIT_TAG_RE.test(tag));
      const subjectHit = looksLikeRecruitment(
        mail.subject || "",
        mail.bodyText || ""
      );

      return {
        mail: {
          ...mail,
          sollicitatie: sol,
          match_reason: tagHit
            ? "tag"
            : subjectHit
              ? "onderwerp"
              : sol
                ? "sollicitant"
                : "inhoud",
        } as MatchedMail,
        seed,
        hardExcluded,
        peer,
        inReplyTo: row.in_reply_to || null,
      };
    });

    const threadKeys = new Set<string>();
    const peerKeys = new Set<string>();

    // Alle bekende sollicitant-emails als peer (korte replies zonder keywords).
    for (const e of byEmail.keys()) {
      if (e) peerKeys.add(e);
    }

    const addMailKeys = (m: MatchedMail, inReplyTo?: string | null) => {
      if (m.threadId) threadKeys.add(m.threadId);
      if (m.messageId) threadKeys.add(m.messageId);
      threadKeys.add(m.id);
      const parent = (inReplyTo || "").replace(/^<|>$/g, "").trim();
      if (parent) threadKeys.add(parent);
    };

    for (const a of annotated) {
      if (!a.seed) continue;
      addMailKeys(a.mail, a.inReplyTo);
      if (a.peer) peerKeys.add(a.peer);
    }

    let changed = true;
    let guard = 0;
    const matchedMap = new Map<string, MatchedMail>();
    while (changed && guard < 6) {
      changed = false;
      guard += 1;
      for (const a of annotated) {
        if (a.hardExcluded) continue;
        if (matchedMap.has(a.mail.id)) continue;
        const m = a.mail;
        const keys = [m.threadId, m.messageId, m.id]
          .concat(
            a.inReplyTo
              ? [(a.inReplyTo || "").replace(/^<|>$/g, "").trim()]
              : []
          )
          .filter((x): x is string => Boolean(x && String(x).trim()));
        const inThread = keys.some((k) => threadKeys.has(k));
        const samePeer = Boolean(a.peer && peerKeys.has(a.peer));
        // Inbound van sollicitant/peer altijd; outbound alleen recruitment.
        const peerFollowUp =
          samePeer &&
          (m.folder !== "verzonden" ||
            a.seed ||
            /BatterijConcept Recruitment/i.test(m.fromName || ""));

        if (a.seed || inThread || peerFollowUp) {
          matchedMap.set(m.id, m);
          addMailKeys(m, a.inReplyTo);
          if (a.peer) peerKeys.add(a.peer);
          changed = true;
        }
      }
    }

    const matched = Array.from(matchedMap.values()).sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
    );

    const unread_count = matched.filter(
      (m) =>
        m.status === "nieuw" &&
        m.folder !== "verzonden" &&
        !INFO_RE.test(m.fromEmail || "")
    ).length;

    return NextResponse.json({
      mails: matched,
      count: matched.length,
      unread_count,
      configured: imapConfigured(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Recruitment-inbox laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST /api/instroom/inbox — sync IMAP (UNSEEN eerst, dan recent). */
export async function POST(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    if (!imapConfigured()) {
      return NextResponse.json(
        {
          error:
            "IMAP niet geconfigureerd. Zet IMAP_HOST, IMAP_USER en IMAP_PASS.",
          configured: false,
        },
        { status: 503 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as {
      max?: number;
      recent?: boolean;
    };
    const sb = getSupabaseAdmin();
    const max = body.max ?? 40;

    // 1) Ongelezen eerst (nieuwe kandidaten-mails)
    const unseen = await syncInboxFromImap(sb, {
      maxMessages: max,
      recent: false,
      markSeen: false,
    });

    // 2) Optioneel recent catch-up (al gelezen maar nog niet in DB)
    let recent = {
      fetched: 0,
      inserted: 0,
      skipped: 0,
      errors: [] as string[],
    };
    if (body.recent !== false) {
      recent = await syncInboxFromImap(sb, {
        maxMessages: Math.min(max, 30),
        recent: true,
        markSeen: false,
      });
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      fetched: unseen.fetched + recent.fetched,
      inserted: unseen.inserted + recent.inserted,
      skipped: unseen.skipped + recent.skipped,
      errors: [...unseen.errors, ...recent.errors].slice(0, 20),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inbox sync mislukt") },
      { status: 500 }
    );
  }
}
