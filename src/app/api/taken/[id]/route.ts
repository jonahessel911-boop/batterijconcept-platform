import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isProjectAfdeling, PROJECT_AFDELINGEN } from "@/lib/project-afdeling";
import { sendEmail, appBaseUrl } from "@/lib/email/postmark";
import { backofficeActieVoltooidEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

const SELECT =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), aangemaakt_door:adviseurs!aangemaakt_door_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

const SELECT_FALLBACK =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

async function selectTaak(sb: ReturnType<typeof getSupabaseAdmin>, id: string) {
  const withCreator = await sb
    .from("project_taken")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  if (
    !withCreator.error &&
    withCreator.data
  ) {
    return { data: withCreator.data, hasCreatorCol: true as const };
  }
  if (
    withCreator.error &&
    (withCreator.error.message?.includes("aangemaakt_door") ||
      withCreator.error.code === "42703")
  ) {
    const plain = await sb
      .from("project_taken")
      .select(SELECT_FALLBACK)
      .eq("id", id)
      .maybeSingle();
    return { data: plain.data, error: plain.error, hasCreatorCol: false as const };
  }
  return {
    data: withCreator.data,
    error: withCreator.error,
    hasCreatorCol: true as const,
  };
}

/** PATCH /api/taken/[id] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    titel?: string;
    status?: "todo" | "doing" | "done";
    afdeling?: string;
    verantwoordelijke_id?: string | null;
    due_at?: string | null;
    notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.titel !== undefined) {
    const t = body.titel.trim();
    if (!t) {
      return NextResponse.json({ error: "Titel mag niet leeg" }, { status: 400 });
    }
    patch.titel = t;
  }
  if (body.status !== undefined) {
    if (!["todo", "doing", "done"].includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.afdeling !== undefined) {
    if (!isProjectAfdeling(body.afdeling)) {
      return NextResponse.json(
        { error: `Kies een afdeling (${PROJECT_AFDELINGEN.join(", ")})` },
        { status: 400 }
      );
    }
    patch.afdeling = body.afdeling;
  }
  if (body.verantwoordelijke_id !== undefined) {
    patch.verantwoordelijke_id = body.verantwoordelijke_id || null;
  }
  if (body.due_at !== undefined) {
    if (body.due_at === null || body.due_at === "") {
      patch.due_at = null;
    } else {
      const d = new Date(body.due_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige due date" },
          { status: 400 }
        );
      }
      patch.due_at = d.toISOString();
    }
  }
  if (body.notities !== undefined) {
    patch.notities = body.notities?.trim() || null;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const before = await selectTaak(sb, id);
    if (before.error || !before.data) {
      return NextResponse.json(
        { error: "Taak niet gevonden", detail: before.error?.message },
        { status: 404 }
      );
    }

    let updateQ = sb.from("project_taken").update(patch).eq("id", id);
    let { data, error } = await updateQ
      .select(before.hasCreatorCol ? SELECT : SELECT_FALLBACK)
      .single();

    if (
      error &&
      (error.message?.includes("aangemaakt_door") || error.code === "42703")
    ) {
      const retry = await sb
        .from("project_taken")
        .update(patch)
        .eq("id", id)
        .select(SELECT_FALLBACK)
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    const becameDone =
      body.status === "done" &&
      (before.data as { status?: string }).status !== "done";

    let mail: { ok: boolean; skipped?: boolean; error?: string } | undefined;
    if (becameDone && before.hasCreatorCol) {
      mail = await notifyCreatorActieVoltooid(
        sb,
        data as unknown as Record<string, unknown>
      );
    }

    return NextResponse.json({ taak: data, mail });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

async function notifyCreatorActieVoltooid(
  sb: ReturnType<typeof getSupabaseAdmin>,
  taak: Record<string, unknown>
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const creatorId = taak.aangemaakt_door_id as string | null | undefined;
  if (!creatorId) return { ok: false, skipped: true };

  if (taak.completed_notified_at) {
    return { ok: false, skipped: true };
  }

  const creatorJoin = taak.aangemaakt_door as
    | { id: string; naam: string; email: string | null }
    | { id: string; naam: string; email: string | null }[]
    | null;
  let creator = Array.isArray(creatorJoin) ? creatorJoin[0] : creatorJoin;

  if (!creator?.email) {
    const { data: adv } = await sb
      .from("adviseurs")
      .select("id, naam, email")
      .eq("id", creatorId)
      .maybeSingle();
    creator = adv;
  }
  const email = creator?.email?.trim();
  if (!email) return { ok: false, skipped: true, error: "geen_email" };

  const projectJoin = taak.projecten as
    | {
        id: string;
        project_nummer: string | null;
        titel: string | null;
        leads?: { naam?: string | null } | { naam?: string | null }[] | null;
      }
    | {
        id: string;
        project_nummer: string | null;
        titel: string | null;
        leads?: { naam?: string | null } | { naam?: string | null }[] | null;
      }[]
    | null;
  const project = Array.isArray(projectJoin) ? projectJoin[0] : projectJoin;
  const leadJoin = project?.leads;
  const lead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;

  const html = backofficeActieVoltooidEmail({
    adviseurNaam: creator?.naam || "daar",
    titel: String(taak.titel || "Actie"),
    notities: (taak.notities as string | null) || null,
    projectNummer: project?.project_nummer || null,
    klantNaam: lead?.naam || project?.titel || null,
    projectHref: project?.id
      ? `${appBaseUrl()}/projecten/${project.id}`
      : null,
  });

  const sent = await sendEmail({
    to: email,
    subject: `Backoffice-actie voltooid: ${String(taak.titel || "Actie")}`,
    html,
    tag: "backoffice-actie-voltooid",
  });

  if (sent.ok) {
    await sb
      .from("project_taken")
      .update({ completed_notified_at: new Date().toISOString() })
      .eq("id", taak.id as string);
  }

  return sent.ok
    ? { ok: true }
    : { ok: false, error: sent.error || "mail_mislukt" };
}

/** DELETE /api/taken/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("project_taken").delete().eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "Verwijderen mislukt", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
