"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PartnerUitbetalingenBlock } from "./PartnerUitbetalingenBlock";

export type OnboardingFields = {
  iban?: string | null;
  contract_storage_path?: string | null;
  contract_bestandsnaam?: string | null;
  contract_uploaded_at?: string | null;
  contract_sign_status?: string | null;
  contract_signed_at?: string | null;
  kvk_uitreksel_storage_path?: string | null;
  kvk_uitreksel_bestandsnaam?: string | null;
  kvk_uitreksel_uploaded_at?: string | null;
  certificaten_storage_path?: string | null;
  certificaten_bestandsnaam?: string | null;
  certificaten_uploaded_at?: string | null;
};

type CheckId = "certificaten" | "kvk_uitreksel" | "contract" | "iban";

type CheckItem = {
  id: CheckId;
  label: string;
  done: boolean;
  detail: string | null;
  /** Bestand uploaden of IBAN-hint */
  action: "upload" | "iban" | "contract";
  docType?: "kvk_uitreksel" | "certificaten";
};

type TimelineEvent = {
  id: string;
  titel: string;
  detail: string | null;
  created_at: string;
};

function hasIban(v: string | null | undefined): boolean {
  return Boolean(v?.replace(/\s+/g, "").trim());
}

function hasContract(f: OnboardingFields): boolean {
  if (f.contract_sign_status === "ondertekend" || f.contract_signed_at) {
    return true;
  }
  return Boolean(f.contract_storage_path || f.contract_bestandsnaam);
}

function buildChecks(
  kind: "adviseur" | "partner",
  f: OnboardingFields
): CheckItem[] {
  const items: CheckItem[] = [];
  if (kind === "partner") {
    items.push({
      id: "certificaten",
      label: "Certificaten uploaden",
      done: Boolean(f.certificaten_storage_path || f.certificaten_bestandsnaam),
      detail: f.certificaten_bestandsnaam || null,
      action: "upload",
      docType: "certificaten",
    });
  }
  items.push({
    id: "kvk_uitreksel",
    label: "KvK-uittreksel uploaden",
    done: Boolean(f.kvk_uitreksel_storage_path || f.kvk_uitreksel_bestandsnaam),
    detail: f.kvk_uitreksel_bestandsnaam || null,
    action: "upload",
    docType: "kvk_uitreksel",
  });
  items.push({
    id: "contract",
    label: "Samenwerkingscontract ondertekenen",
    done: hasContract(f),
    detail:
      f.contract_sign_status === "ondertekend" || f.contract_signed_at
        ? "Ondertekend"
        : f.contract_bestandsnaam || null,
    action: "contract",
  });
  items.push({
    id: "iban",
    label: "IBAN",
    done: hasIban(f.iban),
    detail: hasIban(f.iban) ? f.iban!.replace(/\s+/g, " ").trim() : null,
    action: "iban",
  });
  return items;
}

export function TeamRelatieOnboarding({
  kind,
  id,
  naam,
  fields,
  onFieldsPatch,
  onMessage,
  onFocusIban,
  onOpenContract,
}: {
  kind: "adviseur" | "partner";
  id: string;
  naam: string;
  fields: OnboardingFields;
  onFieldsPatch: (patch: Partial<OnboardingFields>) => void;
  onMessage: (msg: string, isError?: boolean) => void;
  /** Scroll/focus naar IBAN-veld in parent formulier */
  onFocusIban?: () => void;
  /** Open bestaande contract-upload UI / ZZP-flow */
  onOpenContract?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingDoc, setPendingDoc] = useState<
    "kvk_uitreksel" | "certificaten" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  const checks = useMemo(() => buildChecks(kind, fields), [kind, fields]);
  const doneCount = checks.filter((c) => c.done).length;

  const loadTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const res = await fetch(`/api/relaties/${kind}/${id}/activiteit`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Tijdlijn laden mislukt");
      setEvents((data.events || []) as TimelineEvent[]);
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Tijdlijn laden mislukt", true);
    } finally {
      setTimelineLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  useEffect(() => {
    void loadTimeline();
  }, [loadTimeline]);

  async function uploadDoc(
    docType: "kvk_uitreksel" | "certificaten",
    file: File
  ) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/relaties/${kind}/${id}/document?type=${docType}`,
        { method: "POST", body: fd }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      if (docType === "kvk_uitreksel") {
        onFieldsPatch({
          kvk_uitreksel_storage_path: data.kvk_uitreksel_storage_path,
          kvk_uitreksel_bestandsnaam: data.kvk_uitreksel_bestandsnaam,
          kvk_uitreksel_uploaded_at: data.kvk_uitreksel_uploaded_at,
        });
        onMessage("KvK-uittreksel geüpload.");
      } else {
        onFieldsPatch({
          certificaten_storage_path: data.certificaten_storage_path,
          certificaten_bestandsnaam: data.certificaten_bestandsnaam,
          certificaten_uploaded_at: data.certificaten_uploaded_at,
        });
        onMessage("Certificaten geüpload.");
      }
      void loadTimeline();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Upload mislukt", true);
    } finally {
      setBusy(false);
      setPendingDoc(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function openDoc(docType: "kvk_uitreksel" | "certificaten") {
    try {
      const res = await fetch(
        `/api/relaties/${kind}/${id}/document?type=${docType}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Openen mislukt");
      if (!data.url) throw new Error("Geen bestand gevonden");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Openen mislukt", true);
    }
  }

  function onCheckClick(item: CheckItem) {
    if (item.action === "iban") {
      onFocusIban?.();
      if (!item.done) {
        onMessage("Vul het IBAN-veld hieronder in en sla op.", false);
      }
      return;
    }
    if (item.action === "contract") {
      onOpenContract?.();
      if (!item.done) {
        onMessage(
          kind === "adviseur"
            ? "Verstuur of upload de samenwerkingsovereenkomst hieronder."
            : "Upload het samenwerkingscontract hieronder.",
          false
        );
      }
      return;
    }
    if (item.action === "upload" && item.docType) {
      if (item.done) {
        void openDoc(item.docType);
        return;
      }
      setPendingDoc(item.docType);
      queueMicrotask(() => fileRef.current?.click());
    }
  }

  return (
    <div className="space-y-4 lg:col-span-2">
      <section className="border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Onboarding
            </p>
            <p className="mt-0.5 text-sm text-ink">
              {doneCount}/{checks.length} afgerond
              {doneCount === checks.length ? " · compleet" : ""}
            </p>
          </div>
          <div className="h-1.5 w-28 overflow-hidden bg-wash sm:w-40">
            <div
              className="h-full bg-green transition-all"
              style={{
                width: `${Math.round((doneCount / Math.max(checks.length, 1)) * 100)}%`,
              }}
            />
          </div>
        </div>

        <ul className="divide-y divide-line">
          {checks.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onCheckClick(item)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-wash disabled:opacity-60"
              >
                <span
                  className={[
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold",
                    item.done
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-transparent",
                  ].join(" ")}
                  aria-hidden
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={[
                      "block text-sm font-semibold",
                      item.done ? "text-ink" : "text-ink",
                    ].join(" ")}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {item.done
                      ? item.detail || "Afgerond — klik om te openen"
                      : item.action === "iban"
                        ? "Klik om IBAN in te vullen"
                        : item.action === "contract"
                          ? "Klik voor overeenkomst"
                          : "Klik om te uploaden"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && pendingDoc) void uploadDoc(pendingDoc, file);
          }}
        />
      </section>

      <section className="border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Activiteiten
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Contract, documenten en overige updates
          </p>
        </div>
        {timelineLoading ? (
          <p className="px-4 py-6 text-sm text-muted">Laden…</p>
        ) : events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            Nog geen activiteiten.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 px-4 py-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-green"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{ev.titel}</p>
                  {ev.detail ? (
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {ev.detail}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                    {new Date(ev.created_at).toLocaleString("nl-NL", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PartnerUitbetalingenBlock
        kind={kind}
        id={id}
        naam={naam}
        onMessage={onMessage}
      />
    </div>
  );
}
