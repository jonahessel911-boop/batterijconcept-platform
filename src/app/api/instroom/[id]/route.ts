import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { sendEmail } from "@/lib/email/postmark";
import { INFO_REPLY_TO } from "@/lib/email/adviseur-reply-to";
import {
  sollicitatieGesprekDiskwalificatieEmail,
  sollicitatieTrainingBevestigingEmail,
} from "@/lib/email/templates";
import {
  parseSollicitatieStatus,
  SOLLICITATIE_STATUS_MET_TRAINING,
  SOLLICITATIE_STATUS_MET_VERVOLG,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import { resolveSollicitatieAdres } from "@/lib/sollicitatie-adres";
import type { SollicitatieStatus } from "@/types/database";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

const STATUS_GESPREK_DISKWALIFICATIE: SollicitatieStatus =
  "gesprek_gehad_diskwalificatie";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function parseDueAt(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: {
      naam?: string | null;
      email?: string | null;
      telefoon?: string | null;
      functie?: string | null;
      status?: SollicitatieStatus;
      notitie?: string | null;
      training_moment_id?: string | null;
      belpogingen?: number;
      belpogingen_vandaag?: number;
      laatst_gebeld_at?: string | null;
      postcode?: string | null;
      huisnummer?: string | null;
      toevoeging?: string | null;
      straat?: string | null;
      plaats?: string | null;
    } = {};

    if ("naam" in body) patch.naam = pickStr(body.naam);
    if ("email" in body) patch.email = pickStr(body.email);
    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);
    if ("functie" in body) patch.functie = pickStr(body.functie);
    if ("notitie" in body) patch.notitie = pickStr(body.notitie);
    if ("training_moment_id" in body) {
      patch.training_moment_id = pickStr(body.training_moment_id);
    }
    if ("belpogingen" in body) {
      const n = Number(body.belpogingen);
      if (Number.isFinite(n) && n >= 0) patch.belpogingen = Math.floor(n);
    }
    if ("belpogingen_vandaag" in body) {
      const n = Number(body.belpogingen_vandaag);
      if (Number.isFinite(n) && n >= 0) {
        patch.belpogingen_vandaag = Math.floor(n);
      }
    }
    if ("laatst_gebeld_at" in body) {
      if (body.laatst_gebeld_at === null) patch.laatst_gebeld_at = null;
      else if (typeof body.laatst_gebeld_at === "string") {
        const d = new Date(body.laatst_gebeld_at);
        if (!Number.isNaN(d.getTime())) patch.laatst_gebeld_at = d.toISOString();
      }
    }

    if ("status" in body) {
      const status = parseSollicitatieStatus(body.status);
      if (!SOLLICITATIE_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
      }
      patch.status = status;
    }

    const notitieAppend = pickStr(body.notitie_append);
    const vervolgRaw = body.vervolg_taak;
    const vervolg =
      vervolgRaw && typeof vervolgRaw === "object" && !Array.isArray(vervolgRaw)
        ? (vervolgRaw as Record<string, unknown>)
        : null;
    const vervolgTitel = vervolg ? pickStr(vervolg.titel) : null;
    const vervolgDue = vervolg ? parseDueAt(vervolg.due_at) : null;

    const sb = getSupabaseAdmin();

    const { data: current, error: curErr } = await sb
      .from("sollicitaties")
      .select(
        "status, notitie, email, naam, functie, training_moment_id, postcode, huisnummer, toevoeging, straat, plaats"
      )
      .eq("id", id)
      .single();
    if (curErr) {
      if (
        curErr.message?.includes("postcode") ||
        curErr.code === "42703"
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-sollicitatie-adres.sql uit in Supabase.",
            detail: curErr.message,
          },
          { status: 400 }
        );
      }
      throw curErr;
    }

    const adresFieldsTouched =
      "postcode" in body ||
      "huisnummer" in body ||
      "toevoeging" in body ||
      "straat" in body ||
      "plaats" in body;
    if (adresFieldsTouched) {
      const resolved = await resolveSollicitatieAdres({
        postcode:
          "postcode" in body
            ? pickStr(body.postcode)
            : (current?.postcode as string | null) || null,
        huisnummer:
          "huisnummer" in body
            ? pickStr(body.huisnummer)
            : (current?.huisnummer as string | null) || null,
        toevoeging:
          "toevoeging" in body
            ? pickStr(body.toevoeging)
            : (current?.toevoeging as string | null) || null,
        straat:
          "straat" in body
            ? pickStr(body.straat)
            : (current?.straat as string | null) || null,
        plaats:
          "plaats" in body
            ? pickStr(body.plaats)
            : (current?.plaats as string | null) || null,
      });
      patch.postcode = resolved.postcode;
      patch.huisnummer = resolved.huisnummer;
      patch.toevoeging = resolved.toevoeging;
      patch.straat = resolved.straat;
      patch.plaats = resolved.plaats;
    }

    if (patch.status === SOLLICITATIE_STATUS_MET_VERVOLG) {
      const wasAlready =
        parseSollicitatieStatus(current?.status) ===
        SOLLICITATIE_STATUS_MET_VERVOLG;
      if (!wasAlready && !notitieAppend) {
        return NextResponse.json(
          { error: "Notitie is verplicht bij beoordeling" },
          { status: 400 }
        );
      }
    }

    if (patch.status === SOLLICITATIE_STATUS_MET_TRAINING) {
      const wasAlready =
        parseSollicitatieStatus(current?.status) ===
        SOLLICITATIE_STATUS_MET_TRAINING;
      const trainingId =
        patch.training_moment_id ??
        (current?.training_moment_id as string | null) ??
        null;
      if (!wasAlready && !trainingId) {
        return NextResponse.json(
          { error: "Kies een trainingmoment" },
          { status: 400 }
        );
      }
      if (patch.training_moment_id === undefined && trainingId) {
        patch.training_moment_id = trainingId;
      }
    }

    if (notitieAppend) {
      patch.notitie = appendStampedNotitie(
        current?.notitie as string | null,
        notitieAppend
      );
    }

    let { data, error } = await sb
      .from("sollicitaties")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("belpogingen") ||
        error.message?.includes("laatst_gebeld_at") ||
        error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-sollicitatie-belpogingen.sql uit in Supabase.",
          detail: error.message,
        },
        { status: 400 }
      );
    }

    if (
      error &&
      (error.message?.includes("training_moment_id") || error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-training-momenten.sql uit in Supabase.",
          detail: error.message,
        },
        { status: 400 }
      );
    }
    if (error) throw error;

    let taak = null;
    if (vervolgTitel && vervolgDue) {
      const { data: created, error: taakErr } = await sb
        .from("sollicitatie_taken")
        .insert({
          sollicitatie_id: id,
          titel: vervolgTitel,
          status: "todo",
          due_at: vervolgDue,
          notities: notitieAppend,
        })
        .select(
          "*, sollicitaties(id, naam, email, telefoon, functie, status)"
        )
        .single();
      if (taakErr) {
        if (taakErr.code === "42P01") {
          return NextResponse.json(
            {
              error:
                "Voer eerst supabase/migrate-sollicitatie-status-v2.sql uit in Supabase.",
              sollicitatie: data,
            },
            { status: 400 }
          );
        }
        throw taakErr;
      }
      taak = created;
    }

    let mailSent = false;
    let mailSkipped = false;
    let mailError: string | null = null;
    let sollicitatieOut = data;

    const enteringGesprekDiskwalificatie =
      patch.status === STATUS_GESPREK_DISKWALIFICATIE &&
      parseSollicitatieStatus(current?.status) !==
        STATUS_GESPREK_DISKWALIFICATIE;

    if (enteringGesprekDiskwalificatie && data) {
      const to = (data.email as string | null)?.trim() || null;
      const naam = (data.naam as string) || "kandidaat";
      if (!to) {
        mailSkipped = true;
      } else {
        try {
          const subject =
            "Update over je sollicitatie — BatterijConcept";
          const html = sollicitatieGesprekDiskwalificatieEmail({ naam });
          const tag = "sollicitatie-gesprek-diskwalificatie";
          const sent = await sendEmail({
            to,
            subject,
            html,
            tag,
            replyTo: INFO_REPLY_TO,
          });
          if (sent.ok) {
            mailSent = true;
            const fromEmail =
              process.env.POSTMARK_FROM_EMAIL || "info@batterijconcept.nl";
            try {
              await sb.from("inbox_mails").insert({
                folder: "verzonden",
                status: "afgehandeld",
                direction: "outbound",
                message_id: sent.messageId || null,
                thread_id: sent.messageId || `sol-disk-${id}`,
                from_name: "BatterijConcept Recruitment",
                from_email: fromEmail,
                to_email: to,
                subject,
                body_text:
                  "Het is helaas niet geworden om te werken met BatterijConcept.",
                body_html: html,
                received_at: new Date().toISOString(),
                suggested_actions: [],
                raw_headers: { postmark_tag: tag },
              });
            } catch (err) {
              console.error("diskwalificatie inbox_mails insert:", err);
            }
            const note = appendStampedNotitie(
              (sollicitatieOut?.notitie as string | null) ||
                (current?.notitie as string | null),
              `Afwijzingsmail verstuurd → ${to}`
            );
            const { data: withNote, error: noteErr } = await sb
              .from("sollicitaties")
              .update({ notitie: note })
              .eq("id", id)
              .select("*")
              .single();
            if (!noteErr && withNote) sollicitatieOut = withNote;
          } else {
            mailError = sent.error || "Mail versturen mislukt";
          }
        } catch (e) {
          mailError = errMessage(e, "Mail versturen mislukt");
        }
      }
    }

    const enteringTraining =
      patch.status === SOLLICITATIE_STATUS_MET_TRAINING &&
      parseSollicitatieStatus(current?.status) !==
        SOLLICITATIE_STATUS_MET_TRAINING;
    const trainingChanged =
      Boolean(patch.training_moment_id) &&
      patch.training_moment_id !== current?.training_moment_id;
    const shouldNotifyTraining =
      (enteringTraining || Boolean(trainingChanged)) &&
      Boolean(data?.training_moment_id);

    if (shouldNotifyTraining && data?.training_moment_id) {
      const to = (data.email as string | null)?.trim() || null;
      const { data: training, error: tErr } = await sb
        .from("training_momenten")
        .select("*, dagen:training_moment_dagen(*)")
        .eq("id", data.training_moment_id)
        .maybeSingle();

      if (tErr || !training) {
        mailError = tErr?.message || "Training niet gevonden";
      } else {
        type DagRow = {
          dag_nummer: number;
          datum: string;
          start_tijd: string;
          eind_tijd: string;
          planning: string;
        };
        let dagen = [...((training.dagen as unknown[]) || [])]
          .map((d) => d as DagRow)
          .sort((a, b) => a.dag_nummer - b.dag_nummer);

        // Zonder dagen → toch duidelijke datum uit periode tonen
        if (dagen.length === 0) {
          dagen = [
            {
              dag_nummer: 1,
              datum: String(training.periode_van || "").slice(0, 10),
              start_tijd: "09:00",
              eind_tijd: "17:00",
              planning: "",
            },
          ];
        }

        const trainingNaam = String(training.naam || "Training");
        const adres = String(training.adres || "");
        const inhoud = String(training.inhoud || "");

        if (!to) {
          mailSkipped = true;
        } else {
          try {
            const html = sollicitatieTrainingBevestigingEmail({
              naam: data.naam as string,
              trainingNaam,
              adres,
              inhoud,
              functie: (data.functie as string | null) || null,
              dagen,
            });
            const sent = await sendEmail({
              to,
              subject: `Je training: ${trainingNaam}`,
              html,
              tag: "sollicitatie-training-bevestiging",
            });
            if (sent.ok) {
              mailSent = true;
            } else {
              mailError = sent.error || "Mail versturen mislukt";
            }
          } catch (e) {
            mailError = errMessage(e, "Mail versturen mislukt");
          }
        }

        // Zichtbaar in dossier/notitie (kandidaat + recruiter zien de planning)
        const dagenTekst = dagen
          .map((d) => {
            const datum = String(d.datum || "").slice(0, 10);
            const start = String(d.start_tijd || "").slice(0, 5);
            const eind = String(d.eind_tijd || "").slice(0, 5);
            return `Dag ${d.dag_nummer}: ${datum} ${start}–${eind}`;
          })
          .join("\n");
        const mailRegel = mailSent
          ? "Bevestiging gemaild naar kandidaat"
          : mailSkipped
            ? "Geen e-mailadres — niet gemaild"
            : mailError
              ? `Mailfout: ${mailError}`
              : "Nog niet gemaild";
        const trainingNotitie = [
          `— Training gepland: ${trainingNaam} —`,
          dagenTekst,
          adres ? `Adres: ${adres}` : null,
          mailRegel,
        ]
          .filter(Boolean)
          .join("\n");

        const notitieMetTraining = appendStampedNotitie(
          (sollicitatieOut?.notitie as string | null) ||
            (current?.notitie as string | null),
          trainingNotitie
        );
        const { data: withNote, error: noteErr } = await sb
          .from("sollicitaties")
          .update({ notitie: notitieMetTraining })
          .eq("id", id)
          .select("*")
          .single();
        if (!noteErr && withNote) {
          sollicitatieOut = withNote;
        }
      }
    }

    return NextResponse.json({
      sollicitatie: sollicitatieOut,
      taak,
      mail_sent: mailSent,
      mail_skipped: mailSkipped,
      mail_error: mailError,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE /api/instroom/[id] — sollicitant definitief verwijderen. */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: current, error: curErr } = await sb
      .from("sollicitaties")
      .select("id, naam")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      if (curErr.code === "42P01") {
        return NextResponse.json(
          { error: "Sollicitaties-tabel ontbreekt" },
          { status: 400 }
        );
      }
      throw curErr;
    }
    if (!current) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    // Bestanden uit storage (DB-cascade ruimt rijen op).
    try {
      const { data: files } = await sb
        .from("sollicitatie_bestanden")
        .select("storage_path")
        .eq("sollicitatie_id", id);
      const paths = (files || [])
        .map((f) => (f.storage_path as string) || "")
        .filter(Boolean);
      if (paths.length) {
        await sb.storage.from("sollicitaties").remove(paths);
      }
    } catch (err) {
      console.error("sollicitatie delete storage:", err);
    }

    const { error } = await sb.from("sollicitaties").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      id,
      naam: current.naam as string,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
