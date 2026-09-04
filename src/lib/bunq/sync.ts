import { getSupabaseAdmin } from "@/lib/supabase";
import {
  bunqConfigured,
  listIncomingPayments,
  type BunqPayment,
} from "@/lib/bunq/client";
import {
  matchPaymentToFactuur,
  type OpenFactuur,
} from "@/lib/bunq/match";

export type BunqSyncResult = {
  ok: boolean;
  configured: boolean;
  scanned: number;
  matched: number;
  paid: number;
  unmatched: {
    id: number;
    amount: string;
    description: string;
    created: string;
  }[];
  paidFacturen: {
    factuur_id: string;
    factuur_nummer: string;
    bunq_payment_id: number;
    amount: string;
  }[];
  error?: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadOpenFacturen(): Promise<OpenFactuur[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, bedrag_inc_btw, status, bunq_payment_id, offertes(offerte_nummer)"
    )
    .in("status", ["verzonden", "deels_betaald"]);

  if (error) {
    // Fallback zonder bunq_payment_id kolom
    if (
      error.code === "42703" ||
      error.message?.includes("bunq_payment_id")
    ) {
      const retry = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, bedrag_inc_btw, status, offertes(offerte_nummer)"
        )
        .in("status", ["verzonden", "deels_betaald"]);
      if (retry.error) throw retry.error;
      return (retry.data || []).map((f) => {
        const off = f.offertes as { offerte_nummer?: string } | null;
        return {
          id: f.id as string,
          factuur_nummer: f.factuur_nummer as string,
          bedrag_inc_btw: Number(f.bedrag_inc_btw),
          status: f.status as string,
          offerte_nummer: off?.offerte_nummer ?? null,
        };
      });
    }
    throw error;
  }

  return (data || [])
    .filter((f) => !(f as { bunq_payment_id?: number | null }).bunq_payment_id)
    .map((f) => {
      const off = f.offertes as { offerte_nummer?: string } | null;
      return {
        id: f.id as string,
        factuur_nummer: f.factuur_nummer as string,
        bedrag_inc_btw: Number(f.bedrag_inc_btw),
        status: f.status as string,
        offerte_nummer: off?.offerte_nummer ?? null,
      };
    });
}

async function markFactuurPaid(
  factuur: OpenFactuur,
  payment: BunqPayment
): Promise<boolean> {
  const sb = getSupabaseAdmin();
  const betaaldOp = (payment.created || "").slice(0, 10) || todayIsoDate();

  const { data: current } = await sb
    .from("facturen")
    .select("notities")
    .eq("id", factuur.id)
    .maybeSingle();

  const autoNote = [
    `Auto-gematcht via bunq #${payment.id}`,
    payment.counterparty_alias?.display_name
      ? `van ${payment.counterparty_alias.display_name}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const prev = (current?.notities as string | null)?.trim();
  const patch: Record<string, unknown> = {
    status: "betaald",
    betaald_op: betaaldOp,
    bunq_payment_id: payment.id,
    notities: prev ? `${prev}\n${autoNote}` : autoNote,
  };

  let { error } = await sb
    .from("facturen")
    .update(patch)
    .eq("id", factuur.id)
    .in("status", ["verzonden", "deels_betaald"]);

  if (
    error &&
    (error.code === "42703" || error.message?.includes("bunq_payment_id"))
  ) {
    const { bunq_payment_id: _, ...without } = patch;
    void _;
    const retry = await sb
      .from("facturen")
      .update(without)
      .eq("id", factuur.id)
      .in("status", ["verzonden", "deels_betaald"]);
    error = retry.error;
  }

  if (error) {
    console.error("bunq mark paid:", error.message);
    return false;
  }

  // Log (best-effort)
  await sb.from("bunq_payment_log").insert({
    bunq_payment_id: payment.id,
    factuur_id: factuur.id,
    amount: Number(payment.amount.value),
    currency: payment.amount.currency,
    description: payment.description,
    counterparty: payment.counterparty_alias?.display_name || null,
    matched: true,
    raw: payment,
  }).then(({ error: logErr }) => {
    if (logErr && !logErr.message?.includes("bunq_payment_log")) {
      console.error("bunq_payment_log:", logErr.message);
    }
  });

  return true;
}

async function logUnmatched(payment: BunqPayment): Promise<void> {
  const sb = getSupabaseAdmin();
  await sb.from("bunq_payment_log").upsert(
    {
      bunq_payment_id: payment.id,
      factuur_id: null,
      amount: Number(payment.amount.value),
      currency: payment.amount.currency,
      description: payment.description,
      counterparty: payment.counterparty_alias?.display_name || null,
      matched: false,
      raw: payment,
    },
    { onConflict: "bunq_payment_id" }
  ).then(({ error }) => {
    if (error && !error.message?.includes("bunq_payment_log")) {
      console.error("bunq unmatched log:", error.message);
    }
  });
}

/** Haal recente inkomende betalingen op en markeer matchende facturen als betaald. */
export async function syncBunqPayments(options?: {
  pages?: number;
}): Promise<BunqSyncResult> {
  const cfg = bunqConfigured();
  if (!cfg.ok) {
    return {
      ok: false,
      configured: false,
      scanned: 0,
      matched: 0,
      paid: 0,
      unmatched: [],
      paidFacturen: [],
      error: `Ontbrekende env: ${cfg.missing.join(", ")}`,
    };
  }

  try {
    const open = await loadOpenFacturen();
    const pages = options?.pages ?? 3;
    const all: BunqPayment[] = [];
    let olderId: number | undefined;

    for (let i = 0; i < pages; i++) {
      const batch = await listIncomingPayments({
        olderId,
        count: 50,
      });
      if (batch.length === 0) break;
      all.push(...batch);
      olderId = batch[batch.length - 1]?.id;
      if (batch.length < 50) break;
    }

    // Dedup
    const byId = new Map<number, BunqPayment>();
    for (const p of all) byId.set(p.id, p);

    const remaining = [...open];
    const paidFacturen: BunqSyncResult["paidFacturen"] = [];
    const unmatched: BunqSyncResult["unmatched"] = [];
    let matched = 0;
    let paid = 0;

    for (const payment of byId.values()) {
      const factuur = matchPaymentToFactuur(payment, remaining);
      if (!factuur) {
        unmatched.push({
          id: payment.id,
          amount: payment.amount.value,
          description: payment.description,
          created: payment.created,
        });
        await logUnmatched(payment);
        continue;
      }
      matched += 1;
      const ok = await markFactuurPaid(factuur, payment);
      if (ok) {
        paid += 1;
        paidFacturen.push({
          factuur_id: factuur.id,
          factuur_nummer: factuur.factuur_nummer,
          bunq_payment_id: payment.id,
          amount: payment.amount.value,
        });
        const idx = remaining.findIndex((f) => f.id === factuur.id);
        if (idx >= 0) remaining.splice(idx, 1);
      }
    }

    return {
      ok: true,
      configured: true,
      scanned: byId.size,
      matched,
      paid,
      unmatched: unmatched.slice(0, 25),
      paidFacturen,
    };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      scanned: 0,
      matched: 0,
      paid: 0,
      unmatched: [],
      paidFacturen: [],
      error: e instanceof Error ? e.message : "Sync mislukt",
    };
  }
}
