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
import {
  formatSollicitatieAdres,
  pickAdresFromPayload,
  resolveSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
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

function coerceNoteText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => coerceNoteText(v))
      .filter((v): v is string => Boolean(v));
    return parts.length ? parts.join("\n") : null;
  }
  return null;
}

/** Haal interne notitie uit webhook-payload (veel voorkomende veldnamen). */
function pickNotitieFromBody(body: Record<string, unknown>): string | null {
  const keys = [
    "notitie",
    "notities",
    "notes",
    "note",
    "opmerking",
    "opmerkingen",
    "message",
    "bericht",
    "motivatie",
    "motivation",
    "cover_letter",
    "coverLetter",
    "comment",
    "comments",
    "description",
  ] as const;

  for (const key of keys) {
    const text = coerceNoteText(body[key]);
    if (text) return text;
  }
  return null;
}

function buildNotitie(
  body: Record<string, unknown>,
  files: File[]
): string | null {
  const base = pickNotitieFromBody(body);
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
  const adres = await resolveSollicitatieAdres(pickAdresFromPayload(body));

  try {
    const sb = getSupabaseAdmin();
    const insertRow: Record<string, unknown> = {
      naam,
      email: pickStr(body.email, body.mail),
      telefoon: pickStr(body.telefoon, body.phone, body.mobiel),
      functie: pickStr(
        body.functie,
        body.function,
        body.role,
        body.vacature,
        body.job
      ),
      status,
      notitie,
      bron: pickStr(body.bron, body.source) || "webhook",
      postcode: adres.postcode,
      huisnummer: adres.huisnummer,
      toevoeging: adres.toevoeging,
      straat: adres.straat,
      plaats: adres.plaats,
      raw_payload: sanitizeSollicitatiePayload({
        ...body,
        _bestanden: uploadFiles.map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type,
        })),
      }),
    };

    let { data, error } = await sb
      .from("sollicitaties")
      .insert(insertRow)
      .select(
        "id, naam, email, status, notitie, postcode, huisnummer, toevoeging, straat, plaats, created_at"
      )
      .single();

    // Migratie nog niet gedraaid → opnieuw zonder adreskolommen
    if (
      error &&
      (error.message?.includes("postcode") ||
        error.message?.includes("huisnummer") ||
        error.message?.includes("straat") ||
        error.message?.includes("plaats") ||
        error.code === "42703")
    ) {
      const {
        postcode: _pc,
        huisnummer: _hn,
        toevoeging: _tv,
        straat: _st,
        plaats: _pl,
        ...withoutAdres
      } = insertRow;
      const retry = await sb
        .from("sollicitaties")
        .insert(withoutAdres)
        .select("id, naam, email, status, notitie, created_at")
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

    if (error) throw error;
    if (!data) throw new Error("Opslaan mislukt");

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
      const notitieHtml = (data.notitie || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br />");
      const detailBlok = [
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Naam</strong><br />${data.naam}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${data.email || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Telefoon</strong><br />${pickStr(body.telefoon, body.phone, body.mobiel) || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Functie</strong><br />${pickStr(body.functie, body.function, body.role, body.vacature, body.job) || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${formatSollicitatieAdres(adres) || "-"}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Status</strong><br />${status}</p>`,
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Notitie</strong><br />${notitieHtml || "-"}</p>`,
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
        preheader: "Er is een nieuwe kandidaat binnengekomen in Recruitment.",
        bodyHtml: [
          emailH1("Nieuwe sollicitatie"),
          emailP("Er is een nieuwe sollicitatie binnengekomen in de Recruitment-tab."),
          emailBox(detailBlok),
          emailMuted("Dit is een interne melding van het Batterijconcept CRM."),
        ].join(""),
      });

      await sendEmail({
        to: "jona@batterijconcept.nl, jonahessel911@gmail.com",
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
        functie: "Adviseur",
        postcode: "1234AB",
        huisnummer: "12",
        toevoeging: "",
        status: "nieuw",
        notitie: "Beschikbaar vanaf september",
        bron: "werkenbij-formulier",
        file_url: "https://… (optioneel)",
        file_base64: "… (optioneel)",
      },
      multipart: {
        fields: [
          "naam*",
          "email",
          "telefoon",
          "functie",
          "postcode",
          "huisnummer",
          "toevoeging",
          "straat",
          "plaats",
          "status",
          "notitie|notities|notes|opmerking|bericht|motivatie",
          "bron",
        ],
        fileField: "willekeurige veldnaam — alle File-uploads worden meegenomen",
      },
      note_aliases: [
        "notitie",
        "notities",
        "notes",
        "note",
        "opmerking",
        "opmerkingen",
        "message",
        "bericht",
        "motivatie",
        "motivation",
        "cover_letter",
        "comment",
        "description",
      ],
    },
  });
}
