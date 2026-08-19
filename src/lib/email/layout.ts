const GREEN_DARK = "#0D5C32";
const ORANGE = "#F37021";
const INK = "#1A1F1C";
const MUTED = "#5A635C";
const WASH = "#F4F8F5";

export function emailLayout(opts: {
  title: string;
  preheader?: string;
  bodyHtml: string;
}): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${opts.preheader}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Outfit:wght@600;700&display=swap" rel="stylesheet" />
  <title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background:${WASH};color:${INK};font-family:'DM Sans',Arial,Helvetica,sans-serif;">
  ${pre}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${WASH};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #dce6df;">
          <tr>
            <td style="background:${GREEN_DARK};padding:22px 28px;">
              <p style="margin:0;font-family:'Outfit',Arial,sans-serif;font-size:20px;font-weight:700;color:#fff;">
                Batterij<span style="color:${ORANGE};">concept</span>
              </p>
              <p style="margin:6px 0 0;font-size:12px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;">
                Opwekken · Opladen · Opslaan
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:${WASH};padding:18px 28px;border-top:1px solid #e2e8e4;">
              <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.5;">
                BatterijConcept · Alfred Nobellaan 68, 3731DW De Bilt · KVK 42141855<br />
                info@batterijconcept.nl · 085 800 1645<br />
                Gecertificeerde monteurs · Gratis advies aan huis
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function emailButton(label: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
  <tr>
    <td style="background:${ORANGE};">
      <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:'DM Sans',Arial,sans-serif;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}

export function emailH1(text: string): string {
  return `<h1 style="margin:0 0 12px;font-family:'Outfit',Arial,sans-serif;font-size:24px;font-weight:700;color:${GREEN_DARK};line-height:1.25;">${text}</h1>`;
}

export function emailP(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};">${text}</p>`;
}

export function emailMuted(text: string): string {
  return `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:${MUTED};">${text}</p>`;
}

export function emailBox(html: string): string {
  return `<div style="margin:18px 0;padding:16px;background:${WASH};border:1px solid #e2e8e4;">${html}</div>`;
}
