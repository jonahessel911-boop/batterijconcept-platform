import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  collectFormFiles,
  filesFromJsonPayload,
  uploadSollicitatieBestand,
} from "@/lib/sollicitatie-bestanden";
import {
  parseSollicitatieStatus,
  sanitizeSollicitatiePayload,
} from "@/lib/sollicitatie";
import { sendEmail } from "@/lib/email/postmark";
import { emailBox, emailH1, emailLayout, emailMuted, emailP } from "@/lib/email/layout";

export const runtime = "nodejs";

function pickStr(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function withWebhookAuth(req: NextRequest) {
  const expected = process.env.SOLLICITATIE_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
  const provided = req.headers.get("x-webhook-secret")?.trim();
  return Boolean(provided && provided === expected);
}

function buildNotitie(
  body: Record<string, unknown>,
  files: File[]
): string | null {
  const base = pickStr(
    body.notitie,
    body.notes,
    body.opmerking,
    body.message,
    body.bericht
  );
  // Alleen bestandsnaam in notitie zetten als die er nog niet in staat
  if (!files.length) return base;
  const names = files.map((f) => f.name).filter(Boolean);
  if (!names.length) return base;
  if (base && names.every((n) => base.includes(n))) return base;
  const suffix = `Bestand: ${names.join(", ")}`;
  return base ? `${base}\n${suffix}` : suffix;
}

export async function POST(req: NextRequest) {
  if (!withWebhookAuth(req)) {
    return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  let uploadFiles: File[] = [];
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      body = Object.fromEntries(
        [...form.entries()].filter(([, v]) => typeof v === "string")
      ) as Record<string, unknown>;
      uploadFiles = collectFormFiles(form);
    } else {
      body = (await req.json()) as Record<string, unknown>;
      uploadFiles = await filesFromJsonPayload(body);
    }
  } catch {
    return NextResponse.json(
      { error: "Ongeldige payload. Gebruik JSON of multipart/form-data." },
      { status: 400 }
    );
  }

  const naam = pickStr(body.naam, body.name, body.full_name);
  if (!naam) {
    return NextResponse.json({ error: "Veld 'naam' is verplicht" }, { status: 400 });
  }

  const status = parseSollicitatieStatus(body.status);
  const notitie = buildNotitie(body, uploadFiles);

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitaties")
      .insert({
        naam,
        email: pickStr(body.email, body.mail),
        telefoon: pickStr(body.telefoon, body.phone, body.mobiel),
        status,
        notitie,
        bron: pickStr(body.bron, body.source) || "webhook",
        raw_payload: sanitizeSollicitatiePayload({
          ...body,
          _bestanden: uploadFiles.map((f) => ({
            name: f.name,
            size: f.size,
            type: f.type,
          })),
        }),
      })
      .select("id, naam, email, status, created_at")
      .single();

    if (error) throw error;

    const bestanden = [];
    const uploadErrors: string[] = [];
    for (const file of uploadFiles) {
      const uploaded = await uploadSollicitatieBestand(sb, data.id, file);
      if ("error" in uploaded) {
        uploadErrors.push(
          `${file.name}: ${uploaded.detail || uploaded.error}`
        );
        console.error("Sollicitatie bestand upload fout:", uploaded);
        continue;
      }
      bestanden.push(uploaded.bestand);
    }

    try {
      const detailBlok = [
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Naam</strong><br />${data.naam}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${data.email || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Telefoon</strong><br />${pickStr(body.telefoon, body.phone, body.mobiel) || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Status</strong><br />${status}</p>`,
        `<p style="margin:0;font-size:15px;"><strong>Bestanden</strong><br />${
          bestanden.length
            ? bestanden.map((b) => b.bestandsnaam).join(", ")
            : uploadFiles.length
              ? `Upload mislukt (${uploadErrors.join("; ") || "onbekend"})`
              : "Geen bestand meegestuurd"
        }</p>`,
      ].join("");

      const html = emailLayout({
        title: `Nieuwe sollicitatie: ${data.naam}`,
        preheader: "Er is een nieuwe kandidaat binnengekomen in Instroom.",
        bodyHtml: [
          emailH1("Nieuwe sollicitatie"),
          emailP("Er is een nieuwe sollicitatie binnengekomen in de Instroom-tab."),
          emailBox(detailBlok),
          emailMuted("Dit is een interne melding van het Batterijconcept CRM."),
        ].join(""),
      });

      await sendEmail({
        to: "jona@batterijconcept.nl",
        subject: `Nieuwe sollicitatie: ${data.naam}`,
        html,
        tag: "sollicitatie-intern",
      });
    } catch (mailErr) {
      console.error("Sollicitatie notificatie mail fout:", mailErr);
    }

    if (uploadFiles.length > 0 && bestanden.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          sollicitatie: data,
          bestanden,
          warning: "Sollicitatie opgeslagen, maar bestand(en) upload mislukt",
          upload_errors: uploadErrors,
        },
        { status: 207 }
      );
    }

    return NextResponse.json(
      { ok: true, sollicitatie: data, bestanden, bestand: bestanden[0] || null },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/sollicitaties",
    method: "POST",
    auth: "Header x-webhook-secret (alleen als SOLLICITATIE_WEBHOOK_SECRET is gezet)",
    accepts: {
      json: {
        naam: "Jona Candidate",
        email: "jona@example.com",
        telefoon: "0612345678",
        status: "nieuw",
        notitie: "Beschikbaar vanaf september",
        bron: "werkenbij-formulier",
        file_url: "https://… (optioneel)",
        file_base64: "… (optioneel)",
      },
      multipart: {
        fields: ["naam*", "email", "telefoon", "status", "notitie", "bron"],
        fileField: "willekeurige veldnaam — alle File-uploads worden meegenomen",
      },
    },
  });
}
