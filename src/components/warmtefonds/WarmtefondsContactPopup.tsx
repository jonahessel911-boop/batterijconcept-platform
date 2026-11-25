"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  buildWfWhatsappBericht,
  formatTelefoonPlus31,
  splitWfAfspraakLocal,
  warmtefondsAfspraakWhatsappLabel,
  warmtefondsTelHref,
  warmtefondsWhatsappUrl,
  wfAfspraakIsoVanDatumTijd,
  WF_WHATSAPP_TEMPLATES,
  type WfWhatsappTemplateId,
} from "@/lib/warmtefonds-whatsapp";

function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export function WarmtefondsContactPopup({
  open,
  onOpenChange,
  klantNaam,
  telefoon,
  medewerkerNaam,
  afspraakAt,
  onBel,
  onWhatsapp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  klantNaam: string;
  telefoon: string | null | undefined;
  medewerkerNaam?: string | null;
  afspraakAt?: string | null;
  onBel?: () => void;
  onWhatsapp?: (opts: {
    templateId: WfWhatsappTemplateId;
    afspraakIso: string | null;
  }) => void;
}) {
  const [tpl, setTpl] = useState<WfWhatsappTemplateId | "">(
    "telefonisch_niet_bereikt"
  );
  const init = splitWfAfspraakLocal(afspraakAt);
  const [datum, setDatum] = useState(init.datum);
  const [tijd, setTijd] = useState(init.tijd);

  const nummer = formatTelefoonPlus31(telefoon);
  const telHref = warmtefondsTelHref(telefoon);
  const needsSlot =
    tpl === "afspraak_bevestiging" || tpl === "documenten_nodig";
  const afspraakIso = needsSlot
    ? wfAfspraakIsoVanDatumTijd(datum, tijd)
    : null;

  useEffect(() => {
    if (!open) return;
    const split = splitWfAfspraakLocal(afspraakAt);
    setDatum(split.datum);
    setTijd(split.tijd);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, afspraakAt, onOpenChange]);

  if (!open) return null;

  function bel() {
    onBel?.();
    if (telHref) window.location.href = telHref;
    onOpenChange(false);
  }

  function stuurWhatsapp() {
    if (!tpl) return;
    if (needsSlot && !afspraakIso) return;
    const bericht = buildWfWhatsappBericht({
      templateId: tpl,
      klantNaam,
      medewerkerNaam,
      afspraakIso,
    });
    const url = warmtefondsWhatsappUrl(telefoon, bericht);
    if (!url) return;
    onWhatsapp?.({ templateId: tpl, afspraakIso });
    window.open(url, "_blank", "noopener,noreferrer");
    onOpenChange(false);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex max-w-[100vw] items-end justify-center bg-ink/40 p-3 sm:items-center"
      role="presentation"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-contact-titel"
        className="w-full max-w-md rounded-xl border border-line bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2
              id="wf-contact-titel"
              className="font-display text-lg font-semibold text-ink"
            >
              Contact opnemen
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              Bel {klantNaam} of stuur een WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="shrink-0 border border-line px-2.5 py-1 text-xs font-semibold hover:bg-wash"
          >
            Sluiten
          </button>
        </div>

        {telHref && nummer ? (
          <Button
            type="button"
            className="h-12 w-full justify-start gap-3 bg-green-dark text-base hover:bg-green-deeper"
            onClick={bel}
          >
            <Phone className="size-4 shrink-0" />
            Bel klant {nummer}
          </Button>
        ) : (
          <p className="rounded-lg border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
            Geen geldig telefoonnummer.
          </p>
        )}

        <div className="mt-3 space-y-2 rounded-xl border border-line px-3 py-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <WhatsappIcon className="size-5 text-[#128C7E]" />
            WhatsApp
          </p>
          <NativeSelect
            className="w-full min-w-0"
            value={tpl}
            onChange={(e) =>
              setTpl(e.target.value as WfWhatsappTemplateId | "")
            }
            aria-label="WhatsApp-bericht"
          >
            {WF_WHATSAPP_TEMPLATES.filter(
              (t) => t.id !== "afspraak_bevestiging"
            ).map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {needsSlot ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-semibold text-ink">
                  Datum
                  <input
                    id="wf-wa-datum"
                    type="date"
                    value={datum}
                    onChange={(e) => setDatum(e.target.value)}
                    className="mt-1 h-10 w-full rounded-none border border-line bg-white px-2.5 text-sm font-normal outline-none focus:border-green-dark"
                  />
                </label>
                <label className="block text-xs font-semibold text-ink">
                  Tijd
                  <input
                    id="wf-wa-tijd"
                    type="time"
                    value={tijd}
                    onChange={(e) => setTijd(e.target.value)}
                    className="mt-1 h-10 w-full rounded-none border border-line bg-white px-2.5 text-sm font-normal outline-none focus:border-green-dark"
                  />
                </label>
              </div>
              {afspraakIso ? (
                <p className="text-[12px] text-muted">
                  In het bericht: {warmtefondsAfspraakWhatsappLabel(afspraakIso)}
                </p>
              ) : (
                <p className="text-[12px] text-[#C45A12]">
                  Kies datum en tijd voor de bevestiging.
                </p>
              )}
            </div>
          ) : null}
          <Button
            type="button"
            disabled={!tpl || !nummer || (needsSlot && !afspraakIso)}
            className="h-11 w-full gap-2 bg-[#128C7E] hover:bg-[#0E6F64]"
            onClick={stuurWhatsapp}
          >
            <WhatsappIcon className="size-4" />
            Open WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}
