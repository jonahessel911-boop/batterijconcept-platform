import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-require-admin";
import {
  OPVOLGING_BERICHT_STEPS,
  type OpvolgingBerichtChannel,
  type OpvolgingBerichtStatus,
  type OpvolgingBerichtStep,
} from "@/lib/afspraak-opvolging/log-bericht";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHANNELS = new Set<OpvolgingBerichtChannel>(["email", "sms"]);
const STATUSES = new Set<OpvolgingBerichtStatus>([
  "sent",
  "failed",
  "skipped",
]);
const FLOWS = new Set(["legacy", "intensief", "rustig"]);
const STEPS = new Set<string>(OPVOLGING_BERICHT_STEPS);

function escapeIlike(q: string): string {
  return q.replace(/[%_\\]/g, "\\$&");
}

/**
 * GET /api/opvolging-ab/berichten
 * Filters: q (klant/email/tel), channel, step, flow, status, from, to, limit, offset
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim() || "";
    const channel = sp.get("channel")?.trim() || "";
    const step = sp.get("step")?.trim() || "";
    const flow = sp.get("flow")?.trim() || "";
    const status = sp.get("status")?.trim() || "";
    const from = sp.get("from")?.trim() || "";
    const to = sp.get("to")?.trim() || "";
    const limitRaw = Number(sp.get("limit") || "50");
    const offsetRaw = Number(sp.get("offset") || "0");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), 200)
      : 50;
    const offset = Number.isFinite(offsetRaw)
      ? Math.max(Math.floor(offsetRaw), 0)
      : 0;

    if (channel && !CHANNELS.has(channel as OpvolgingBerichtChannel)) {
      return NextResponse.json({ error: "Ongeldig channel" }, { status: 400 });
    }
    if (step && !STEPS.has(step)) {
      return NextResponse.json({ error: "Ongeldige step" }, { status: 400 });
    }
    if (flow && !FLOWS.has(flow)) {
      return NextResponse.json({ error: "Ongeldige flow" }, { status: 400 });
    }
    if (status && !STATUSES.has(status as OpvolgingBerichtStatus)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    let query = sb
      .from("afspraak_opvolging_berichten")
      .select(
        "id, created_at, afspraak_id, lead_id, opvolging_flow, step, channel, status, klant_naam, to_email, to_phone, subject, body_preview, provider, provider_message_id, tag, error",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (channel) query = query.eq("channel", channel);
    if (step) query = query.eq("step", step as OpvolgingBerichtStep);
    if (flow) query = query.eq("opvolging_flow", flow);
    if (status) query = query.eq("status", status);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    if (q) {
      const pattern = `%${escapeIlike(q)}%`;
      query = query.or(
        [
          `klant_naam.ilike.${pattern}`,
          `to_email.ilike.${pattern}`,
          `to_phone.ilike.${pattern}`,
          `subject.ilike.${pattern}`,
        ].join(",")
      );
    }

    const { data, error, count } = await query;
    if (error) {
      if (
        error.message?.includes("afspraak_opvolging_berichten") ||
        error.code === "42P01" ||
        error.code === "PGRST204"
      ) {
        return NextResponse.json({
          items: [],
          total: 0,
          limit,
          offset,
          missing_table: true,
        });
      }
      throw new Error(error.message);
    }

    return NextResponse.json({
      items: data || [],
      total: count ?? (data?.length ?? 0),
      limit,
      offset,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
