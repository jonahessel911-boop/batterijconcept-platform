import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  pickAdresFromPayload,
  resolveSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import {
  decodeMultiAnswers,
  formOrDefault,
  formatFormAnswersNotitie,
  type RecruitmentAnswerRow,
} from "@/lib/recruitment-form";
import type { RecruitmentVacature } from "@/types/database";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function pickAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) {
      out[k] = v.trim();
      continue;
    }
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean);
      if (parts.length) out[k] = parts.join(" · ");
    }
  }
  return out;
}

function pickAnswerRows(raw: unknown): RecruitmentAnswerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RecruitmentAnswerRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const vraag = typeof o.vraag === "string" ? o.vraag.trim() : "";
    let antwoord = "";
    if (typeof o.antwoord === "string") antwoord = o.antwoord.trim();
    else if (Array.isArray(o.antwoord)) {
      antwoord = o.antwoord
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter(Boolean)
        .join(" · ");
    }
    if (!vraag || !antwoord) continue;
    const type =
      o.type === "buttons" ||
      o.type === "text" ||
      o.type === "checkboxes" ||
      o.type === "contact"
        ? o.type
        : undefined;
    out.push({
      step_id: typeof o.step_id === "string" ? o.step_id : undefined,
      vraag,
      antwoord,
      type,
    });
  }
  return out;
}

/** Publiek sollicitatieformulier vanaf /werkenbij. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const naam = pickStr(body.naam);
    const email = pickStr(body.email);
    const telefoon = pickStr(body.telefoon);
    const motivatie = pickStr(body.motivatie);
    const vacatureId = pickStr(body.vacature_id);
    const answers = pickAnswers(body.answers);
    const answerRows = pickAnswerRows(body.answer_rows);

    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    if (!email && !telefoon) {
      return NextResponse.json(
        { error: "E-mail of telefoon is verplicht" },
        { status: 400 }
      );
    }
    if (!vacatureId) {
      return NextResponse.json(
        { error: "Vacature ontbreekt" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: vac, error: vacErr } = await sb
      .from("recruitment_vacatures")
      .select("*")
      .eq("id", vacatureId)
      .maybeSingle();

    if (vacErr) {
      if (vacErr.code === "42P01") {
        return NextResponse.json(
          { error: "Vacatures nog niet geconfigureerd" },
          { status: 400 }
        );
      }
      throw vacErr;
    }

    const vacature = vac as RecruitmentVacature | null;
    if (!vacature || vacature.status !== "open") {
      return NextResponse.json(
        { error: "Deze vacature is niet (meer) open" },
        { status: 400 }
      );
    }

    const form = formOrDefault(vacature.form, vacature.rol);
    const answersNote = formatFormAnswersNotitie(form, answers, answerRows);
    const notitie = [answersNote, motivatie].filter(Boolean).join("\n\n") || null;

    const answersStructured: Record<string, string | string[]> = {};
    if (answerRows.length) {
      for (const row of answerRows) {
        if (row.type === "contact") continue;
        const key = row.step_id || row.vraag;
        if (row.type === "checkboxes") {
          const parts = decodeMultiAnswers(row.antwoord);
          answersStructured[key] = parts;
          answersStructured[row.vraag] = parts;
        } else {
          answersStructured[key] = row.antwoord;
          answersStructured[row.vraag] = row.antwoord;
        }
      }
    } else {
      for (const step of form.steps) {
        const val = answers[step.id];
        if (!val) continue;
        if (step.type === "checkboxes") {
          answersStructured[step.id] = decodeMultiAnswers(val);
          answersStructured[step.vraag] = decodeMultiAnswers(val);
        } else if (step.type !== "contact") {
          answersStructured[step.id] = val;
          answersStructured[step.vraag] = val;
        }
      }
    }

    const adres = await resolveSollicitatieAdres(pickAdresFromPayload(body));
    const insertRow: Record<string, unknown> = {
      naam,
      email,
      telefoon,
      functie: vacature.titel,
      vacature_id: vacature.id,
      bron: "werkenbij",
      status: "nieuw",
      notitie,
      postcode: adres.postcode,
      huisnummer: adres.huisnummer,
      toevoeging: adres.toevoeging,
      straat: adres.straat,
      plaats: adres.plaats,
      raw_payload: {
        source: "werkenbij",
        vacature_id: vacature.id,
        vacature_titel: vacature.titel,
        answers,
        answer_rows: answerRows,
        answers_structured: answersStructured,
      },
    };

    let { data, error } = await sb
      .from("sollicitaties")
      .insert(insertRow)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("vacature_id") || error.code === "42703")
    ) {
      delete insertRow.vacature_id;
      ({ data, error } = await sb
        .from("sollicitaties")
        .insert(insertRow)
        .select("*")
        .single());
    }

    if (
      error &&
      (error.message?.includes("postcode") ||
        error.message?.includes("huisnummer") ||
        error.code === "42703")
    ) {
      delete insertRow.postcode;
      delete insertRow.huisnummer;
      delete insertRow.toevoeging;
      delete insertRow.straat;
      delete insertRow.plaats;
      ({ data, error } = await sb
        .from("sollicitaties")
        .insert(insertRow)
        .select("*")
        .single());
    }

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { error: "Sollicitaties-tabel ontbreekt" },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, sollicitatie: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Sollicitatie mislukt") },
      { status: 500 }
    );
  }
}
