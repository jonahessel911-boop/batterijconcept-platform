"use client";

import type { AanbetalingModus } from "@/lib/aanbetaling";
import { AanbetalingInstelling } from "./AanbetalingInstelling";

export type BackofficeActieFormValues = {
  aanbetalingModus: AanbetalingModus;
  aanbetalingHandmatig: string;
  backofficeNotitie: string;
  installateurNotitie: string;
};

type Props = {
  subtotaalExBtw: number;
  btwBedrag: number;
  totaalIncBtw: number;
  financieringVoorbehoud: boolean;
  adviseurNaam?: string | null;
  sessionNaam?: string | null;
  values: BackofficeActieFormValues;
  onChange: (patch: Partial<BackofficeActieFormValues>) => void;
  disabled?: boolean;
  /** Compact: geen aparte kop (voor inbedding in andere card) */
  compact?: boolean;
  showFotoHint?: boolean;
};

export function BackofficeActieForm({
  subtotaalExBtw,
  btwBedrag,
  totaalIncBtw,
  financieringVoorbehoud,
  adviseurNaam,
  sessionNaam,
  values,
  onChange,
  disabled = false,
  compact = false,
  showFotoHint = true,
}: Props) {
  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
            Actie vereist
          </p>
          <h3 className="mt-1 text-lg font-semibold text-ink">
            Backoffice invullen
          </h3>
          <p className="mt-1 text-xs text-muted">
            Betaalroute:{" "}
            <span className="font-semibold text-ink">
              {financieringVoorbehoud ? "Warmtefonds" : "Eigen middelen"}
            </span>
          </p>
        </div>
      )}

      {(adviseurNaam || sessionNaam) && (
        <div className="rounded-xl border border-line bg-wash px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Adviseur van dit project
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {adviseurNaam || "Nog niet toegewezen"}
          </p>
          {sessionNaam ? (
            <p className="mt-1 text-xs text-muted">
              Notities worden opgeslagen als {sessionNaam}
            </p>
          ) : null}
        </div>
      )}

      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <AanbetalingInstelling
          modus={values.aanbetalingModus}
          onModusChange={(m) => onChange({ aanbetalingModus: m })}
          handmatig={values.aanbetalingHandmatig}
          onHandmatigChange={(v) => onChange({ aanbetalingHandmatig: v })}
          subtotaalExBtw={subtotaalExBtw}
          btwBedrag={btwBedrag}
          totaalIncBtw={totaalIncBtw}
          financieringVoorbehoud={financieringVoorbehoud}
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Notitie voor backoffice
          <textarea
            value={values.backofficeNotitie}
            onChange={(e) => onChange({ backofficeNotitie: e.target.value })}
            rows={3}
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Notitie voor installateur
          <textarea
            value={values.installateurNotitie}
            onChange={(e) => onChange({ installateurNotitie: e.target.value })}
            rows={3}
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>

        {showFotoHint && (
          <div>
            <p className="inline-flex items-center border border-line bg-white px-3 py-2 text-xs font-semibold text-muted">
              Foto&apos;s uploaden
            </p>
            <p className="mt-1 text-xs text-muted">
              Foto&apos;s kun je uploaden nadat je de actie afrondt (dan komt het
              project in de backoffice).
            </p>
          </div>
        )}
      </fieldset>
    </div>
  );
}
