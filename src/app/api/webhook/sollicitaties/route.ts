import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { uploadSollicitatieBestand } from "@/lib/sollicitatie-bestanden";
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

export async function POST(req: NextRequest) {
  if (!withWebhookAuth(req)) {
    return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  let uploadFile: File | null = null;
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      body = Object.fromEntries(form.entries()) as Record<string, unknown>;
      const maybeFile = form.get("file") ?? form.get("cv") ?? form.get("resume");
      uploadFile = maybeFile instanceof File ? maybeFile : null;
    } else {
      body = (await req.json()) as Record<string, unknown>;
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

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitaties")
      .insert({
        naam,
        email: pickStr(body.email, body.mail),
        telefoon: pickStr(body.telefoon, body.phone, body.mobiel),
        status,
        notitie: pickStr(body.notitie, body.notes, body.opmerking, body.message),
        bron: pickStr(body.bron, body.source) || "webhook",
        raw_payload: sanitizeSollicitatiePayload(body),
      })
      .select("id, naam, email, status, created_at")
      .single();

    if (error) throw error;

    let bestand = null;
    if (uploadFile && uploadFile.size > 0) {
      const uploaded = await uploadSollicitatieBestand(sb, data.id, uploadFile);
      if ("error" in uploaded) {
        return NextResponse.json(
          {
            error: "Sollicitatie opgeslagen, maar bestand upload mislukt",
            detail: uploaded.error,
            sollicitatie: data,
          },
          { status: 207 }
        );
      }
      bestand = uploaded.bestand;
    }

    try {
      const detailBlok = [
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Naam</strong><br />${data.naam}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${data.email || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Telefoon</strong><br />${pickStr(body.telefoon, body.phone, body.mobiel) || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Status</strong><br />${status}</p>`,
        `<p style="margin:0;font-size:15px;"><strong>Bestand</strong><br />${bestand?.bestandsnaam || "Geen bestand meegestuurd"}</p>`,
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

    return NextResponse.json(
      { ok: true, sollicitatie: data, bestand },
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
      },
      multipart: {
        fields: ["naam*", "email", "telefoon", "status", "notitie", "bron"],
        fileField: "file (of cv / resume)",
      },
    },
  });
}
