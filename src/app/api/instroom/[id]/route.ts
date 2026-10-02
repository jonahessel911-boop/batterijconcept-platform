import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { sendEmail } from "@/lib/email/postmark";
import { sollicitatieTrainingBevestigingEmail } from "@/lib/email/templates";
import {
  parseSollicitatieStatus,
  SOLLICITATIE_STATUS_MET_TRAINING,
  SOLLICITATIE_STATUS_MET_VERVOLG,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import type { SollicitatieStatus } from "@/types/database";

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
    } = {};

    if ("naam" in body) patch.naam = pickStr(body.naam);
    if ("email" in body) patch.email = pickStr(body.email);
    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);
    if ("functie" in body) patch.functie = pickStr(body.functie);
    if ("notitie" in body) patch.notitie = pickStr(body.notitie);
    if ("training_moment_id" in body) {
      patch.training_moment_id = pickStr(body.training_moment_id);
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
      .select("status, notitie, email, naam, functie, training_moment_id")
      .eq("id", id)
      .single();
    if (curErr) throw curErr;

    if (patch.status === SOLLICITATIE_STATUS_MET_VERVOLG) {
      const wasAlready =
        parseSollicitatieStatus(current?.status) ===
        SOLLICITATIE_STATUS_MET_VERVOLG;

      if (!wasAlready) {
        if (!notitieAppend) {
          return NextResponse.json(
            { error: "Notitie is verplicht bij beoordeling" },
            { status: 400 }
          );
        }
        if (!vervolgTitel || !vervolgDue) {
          return NextResponse.json(
            { error: "Vervolgtaak met deadline is verplicht bij beoordeling" },
            { status: 400 }
          );
        }
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

    const { data, error } = await sb
      .from("sollicitaties")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

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

    const enteringTraining =
      patch.status === SOLLICITATIE_STATUS_MET_TRAINING &&
      parseSollicitatieStatus(current?.status) !==
        SOLLICITATIE_STATUS_MET_TRAINING;
    const trainingChanged =
      patch.training_moment_id &&
      patch.training_moment_id !== current?.training_moment_id;
    const shouldMailTraining = enteringTraining || Boolean(trainingChanged);

    if (shouldMailTraining && data?.training_moment_id) {
      const to = (data.email as string | null)?.trim() || null;
      if (!to) {
        mailSkipped = true;
      } else {
        const { data: training, error: tErr } = await sb
          .from("training_momenten")
          .select("*, dagen:training_moment_dagen(*)")
          .eq("id", data.training_moment_id)
          .maybeSingle();
        if (tErr || !training) {
          mailError = tErr?.message || "Training niet gevonden";
        } else {
          const dagen = [...((training.dagen as unknown[]) || [])]
            .map((d) => d as {
              dag_nummer: number;
              datum: string;
              start_tijd: string;
              eind_tijd: string;
              planning: string;
            })
            .sort((a, b) => a.dag_nummer - b.dag_nummer);
          try {
            const html = sollicitatieTrainingBevestigingEmail({
              naam: data.naam as string,
              trainingNaam: training.naam as string,
              adres: training.adres as string,
              inhoud: training.inhoud as string,
              functie: (data.functie as string | null) || null,
              dagen,
            });
            await sendEmail({
              to,
              subject: `Je training: ${training.naam}`,
              html,
              tag: "sollicitatie-training-bevestiging",
            });
            mailSent = true;
          } catch (e) {
            mailError = errMessage(e, "Mail versturen mislukt");
          }
        }
      }
    }

    return NextResponse.json({
      sollicitatie: data,
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
