/** Splits nieuw bericht van geciteerde thread. */
export function splitMailBody(raw: string): {
  main: string;
  quoted: string | null;
} {
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
  if (cut < 0) {
    const lines = text.split("\n");
    const qi = lines.findIndex(
      (l, i) =>
        i > 0 &&
        /^>/.test(l.trim()) &&
        lines
          .slice(i, i + 3)
          .every(
            (x) => !x.trim() || /^>/.test(x.trim()) || /schrijft?:/i.test(x)
          )
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
