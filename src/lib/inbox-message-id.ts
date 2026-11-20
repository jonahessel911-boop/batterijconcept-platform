/** RFC Message-ID / Postmark MessageID → vergelijkbare vormen. */
export function bareMessageId(raw: string | null | undefined): string {
  return (raw || "").trim().replace(/^<|>$/g, "").trim();
}

export function messageIdVariants(raw: string | null | undefined): string[] {
  const bare = bareMessageId(raw);
  if (!bare) return [];
  const noAt = bare.includes("@") ? bare.slice(0, bare.indexOf("@")) : bare;
  const set = new Set<string>([bare, `<${bare}>`, noAt, `<${noAt}>`]);
  if (!bare.includes("@")) {
    set.add(`${bare}@mtasv.net`);
    set.add(`<${bare}@mtasv.net>`);
  }
  return [...set];
}

/** Opslagvorm die IMAP In-Reply-To van Postmark-mails kan matchen. */
export function storePostmarkMessageId(
  raw: string | null | undefined
): string | null {
  const bare = bareMessageId(raw);
  if (!bare) return null;
  if (bare.includes("@")) return bare;
  if (/^[0-9a-f-]{20,}$/i.test(bare)) return `${bare}@mtasv.net`;
  return bare;
}
