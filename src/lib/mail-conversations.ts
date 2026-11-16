/**
 * Apple Mail-achtige conversatie-groepering (gedeeld sales + recruitment inbox).
 */

export type MailLike = {
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
};

export type MailConversation<T extends MailLike> = {
  key: string;
  messages: T[];
  latest: T;
  replyTarget: T;
  peerName: string;
  peerEmail: string;
  subject: string;
};

const INFO_RE = /@batterijconcept\.nl$/i;

export function isOutboundMail(m: Pick<MailLike, "folder" | "fromEmail">) {
  if (m.folder === "verzonden") return true;
  return INFO_RE.test(m.fromEmail || "");
}

export function peerEmailOf(m: MailLike) {
  return isOutboundMail(m)
    ? (m.toEmail || "").trim().toLowerCase()
    : (m.fromEmail || "").trim().toLowerCase();
}

export function normMailSubject(subject: string) {
  return (subject || "")
    .replace(/^(re|fw|fwd):\s*/gi, "")
    .trim()
    .toLowerCase();
}

export function previewMailText(body: string) {
  return (body || "").replace(/\s+/g, " ").trim().slice(0, 90);
}

export function shortMailDate(iso: string) {
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

function mailKeys(m: MailLike): string[] {
  return [m.threadId, m.messageId, m.id].filter(
    (x): x is string => Boolean(x && String(x).trim())
  );
}

/** Groepeer losse mails tot conversaties (thread_id + peer + onderwerp). */
export function buildMailConversations<T extends MailLike>(
  mails: T[]
): MailConversation<T>[] {
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
    const subj = normMailSubject(m.subject);
    const soft = peer ? `peer:${peer}` : `id:${m.id}`;
    const softSubj = peer && subj ? `peer-subj:${peer}::${subj}` : soft;
    const anchor = keys[0] || softSubj;
    for (const k of keys) union(anchor, k);
    union(anchor, soft);
    union(anchor, softSubj);
  }

  const groups = new Map<string, T[]>();
  for (const m of mails) {
    const keys = mailKeys(m);
    const peer = peerEmailOf(m);
    const subj = normMailSubject(m.subject);
    const soft = peer ? `peer:${peer}` : `id:${m.id}`;
    const softSubj = peer && subj ? `peer-subj:${peer}::${subj}` : soft;
    const root = find(keys[0] || softSubj);
    const list = groups.get(root) || [];
    list.push(m);
    groups.set(root, list);
  }

  const conversations: MailConversation<T>[] = [];
  for (const [key, msgs] of groups) {
    const messages = [...msgs].sort(
      (a, b) =>
        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime()
    );
    const latest = messages[messages.length - 1]!;
    const inbound = [...messages].reverse().find((m) => !isOutboundMail(m));
    const replyTarget = inbound || latest;
    const peerEmail = peerEmailOf(replyTarget) || peerEmailOf(latest);
    const peerMail =
      messages.find((m) => !isOutboundMail(m)) ||
      messages.find((m) => peerEmailOf(m) === peerEmail) ||
      latest;
    const rootInbound = messages.find((m) => !isOutboundMail(m));
    conversations.push({
      key,
      messages,
      latest,
      replyTarget,
      peerName:
        (!isOutboundMail(peerMail)
          ? peerMail.fromName || peerMail.fromEmail
          : peerEmail) || "Onbekend",
      peerEmail,
      subject:
        rootInbound?.subject ||
        messages[0]?.subject ||
        latest.subject ||
        "(geen onderwerp)",
    });
  }

  return conversations.sort(
    (a, b) =>
      new Date(b.latest.receivedAt).getTime() -
      new Date(a.latest.receivedAt).getTime()
  );
}
