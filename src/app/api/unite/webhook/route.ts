/**
 * GET/POST /api/unite/webhook
 *
 * VOIPZeker Unite call-events webhook.
 * Configureer in Unite App template:
 *   {APP_URL}/api/unite/webhook?callid={calluniqueid}&callfrom={callfrom}&callto={callto}&status={status}&status_desc={status_desc}&direction={direction}&timestamp={timestamp}
 *
 * - RINGING → call_popup (inkomend)
 * - DISCONNECTED → call_popup nagesprek + lead_events / notities
 */

import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import {
  cdrLogToActivity,
  logUniteCallActivity,
  type UniteCallActivityInput,
} from "@/lib/unite-call-activity";
import {
  listUniteCdrLogs,
  parseUniteCalltime,
  uniteConfigured,
} from "@/lib/unite";
import { toE164Nl } from "@/lib/fonio";
import {
  emitCallPopupFromUnite,
  emitEndedPopupFromActivity,
  isUniteDisconnectedStatus,
} from "@/lib/call-popups";

export const runtime = "nodejs";

function pickParam(req: NextRequest, key: string): string | null {
  const sp = req.nextUrl.searchParams;
  const v = sp.get(key)?.trim();
  return v || null;
}

async function handle(req: NextRequest) {
  const secret = process.env.UNITE_WEBHOOK_SECRET?.trim();
  if (secret) {
    const hdr =
      req.headers.get("x-unite-secret")?.trim() ||
      req.nextUrl.searchParams.get("secret")?.trim();
    if (hdr !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        body = (await req.json()) as Record<string, unknown>;
      } else if (ct.includes("form")) {
        const fd = await req.formData();
        for (const [k, v] of fd.entries()) {
          if (typeof v === "string") body[k] = v;
        }
      }
    } catch {
      body = {};
    }
  }

  // Unite stuurt soms alleen `status`, soms `status_desc`
  const statusDesc = (
    pickParam(req, "status_desc") ||
    pickParam(req, "statusDesc") ||
    pickParam(req, "status") ||
    String(body.status_desc || body.statusDesc || body.status || "")
  ).toUpperCase();

  let callid =
    pickParam(req, "callid") ||
    pickParam(req, "calluniqueid") ||
    String(body.callid || body.calluniqueid || "").trim() ||
    null;
  let callfrom =
    pickParam(req, "callfrom") ||
    String(body.callfrom || "").trim() ||
    null;
  let callto =
    pickParam(req, "callto") ||
    String(body.callto || "").trim() ||
    null;
  let direction = (
    pickParam(req, "direction") ||
    String(body.direction || "out")
  ).toLowerCase();
  const tsRaw =
    pickParam(req, "timestamp") ||
    String(body.timestamp || "").trim() ||
    null;

  let durationSeconds: number | null = null;
  let loggedLeadId: string | null = null;
  const disconnected = isUniteDisconnectedStatus(statusDesc);

  try {
    // CDR voor duur + from/to (call_chain) + lead-log bij disconnect
    if (disconnected && uniteConfigured() && callid) {
      const now = new Date();
      const start = new Date(now.getTime() - 6 * 3600_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      const fmt = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

      try {
        const { items } = await listUniteCdrLogs({
          dateStart: fmt(start),
          dateEnd: fmt(now),
          pageLimit: 50,
          page: 1,
        });
        const hit = items.find((i) => i.uniqueid === callid);
        if (hit) {
          const act = cdrLogToActivity(hit);
          if (act) {
            durationSeconds = act.durationSeconds;
            direction = (act.direction || direction).toLowerCase();
            // Webhook mist vaak callfrom/callto — CDR call_chain heeft extensie + extern nr
            callfrom = callfrom || act.fromNumber;
            callto = callto || act.toNumber;
            const res = await logUniteCallActivity(act);
            loggedLeadId = res.leadId;
          }
        }
      } catch (e) {
        console.warn("Unite webhook CDR lookup:", errMessage(e));
      }
    }

    if (disconnected && !loggedLeadId && (callfrom || callto)) {
      const external =
        direction === "in"
          ? toE164Nl(callfrom)
          : toE164Nl(callto) || toE164Nl(callfrom);
      const internal = direction === "in" ? callto : callfrom;

      let callAt = new Date();
      if (tsRaw) {
        const n = Number(tsRaw);
        if (Number.isFinite(n) && n > 1e11) callAt = new Date(n);
        else if (Number.isFinite(n) && n > 1e9) callAt = new Date(n * 1000);
        else callAt = parseUniteCalltime(tsRaw);
      }

      const act: UniteCallActivityInput = {
        uniqueid: callid || `webhook-${callAt.toISOString()}`,
        callAt,
        direction,
        durationSeconds: durationSeconds || 0,
        fromLabel: direction === "out" ? internal : null,
        fromNumber: callfrom,
        toLabel: direction === "in" ? internal : null,
        toNumber: callto,
        matchPhone: external,
      };
      const res = await logUniteCallActivity(act);
      loggedLeadId = res.leadId;
    }

    const popup = disconnected
      ? await emitEndedPopupFromActivity({
          uniqueid: callid || `webhook-${Date.now()}`,
          callAt: new Date(),
          direction,
          durationSeconds: durationSeconds || 0,
          fromNumber: callfrom,
          toNumber: callto,
        })
      : await emitCallPopupFromUnite({
          statusDesc: statusDesc || "DISCONNECTED",
          direction,
          callUniqueId: callid,
          callfrom,
          callto,
          durationSeconds,
        });

    return NextResponse.json({
      ok: true,
      status_desc: statusDesc || null,
      lead_id: loggedLeadId,
      popup_id: popup?.id || null,
      popup_adviseur_id: popup?.adviseur_id || null,
      matched_from: callfrom,
      matched_to: callto,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Unite webhook mislukt") },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
