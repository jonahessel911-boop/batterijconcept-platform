"use client";

import { INSTALLATIE_MERKEN } from "@/lib/installatie-merken";
import { NL_PROVINCIES } from "@/lib/postcode-provincie";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

export type MonteurProfielDraft = {
  rol: "beheerder" | "monteur";
  kan_schouw: boolean;
  kan_installatie: boolean;
  leeftijd: string;
  merken: string[];
  regios: string[];
};

export function emptyMonteurProfielDraft(): MonteurProfielDraft {
  return {
    rol: "monteur",
    kan_schouw: false,
    kan_installatie: true,
    leeftijd: "",
    merken: [],
    regios: [],
  };
}

/** Partner/CRM: alleen rol + inzet. Leeftijd/merken vult het teamlid zelf in. */
export function MonteurProfielFields({
  value,
  onChange,
  disabled,
  mode = "partner",
}: {
  value: MonteurProfielDraft;
  onChange: (next: MonteurProfielDraft) => void;
  disabled?: boolean;
  mode?: "partner" | "self" | "full";
}) {
  function toggleMerk(merk: string) {
    const has = value.merken.includes(merk);
    onChange({
      ...value,
      merken: has
        ? value.merken.filter((m) => m !== merk)
        : [...value.merken, merk],
    });
  }

  function toggleRegio(regio: string) {
    const has = value.regios.includes(regio);
    onChange({
      ...value,
      regios: has
        ? value.regios.filter((r) => r !== regio)
        : [...value.regios, regio],
    });
  }

  const showPartner = mode === "partner" || mode === "full";
  const showSelf = mode === "self" || mode === "full";

  return (
    <div className="space-y-4">
      {showPartner ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mp-rol">Rol</Label>
            <NativeSelect
              id="mp-rol"
              disabled={disabled}
              value={value.rol}
              onChange={(e) =>
                onChange({
                  ...value,
                  rol: e.target.value === "beheerder" ? "beheerder" : "monteur",
                })
              }
            >
              <NativeSelectOption value="monteur">Monteur</NativeSelectOption>
              <NativeSelectOption value="beheerder">Beheerder</NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="space-y-2">
            <Label>Inzetbaar voor</Label>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  disabled={disabled}
                  checked={value.kan_schouw}
                  onCheckedChange={(v) =>
                    onChange({ ...value, kan_schouw: v === true })
                  }
                />
                Schouw
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-ink">
                <Checkbox
                  disabled={disabled}
                  checked={value.kan_installatie}
                  onCheckedChange={(v) =>
                    onChange({ ...value, kan_installatie: v === true })
                  }
                />
                Installatie
              </label>
            </div>
            <p className="text-[11px] text-muted">
              Standaard alleen installatie — vink schouw aan indien van
              toepassing.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Regio’s</Label>
            <p className="text-[11px] text-muted">
              Waar deze monteur installaties kan doen (voor Forecast-capaciteit).
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {NL_PROVINCIES.map((regio) => (
                <label
                  key={regio}
                  className="inline-flex items-center gap-2 text-sm text-ink"
                >
                  <Checkbox
                    disabled={disabled}
                    checked={value.regios.includes(regio)}
                    onCheckedChange={() => toggleRegio(regio)}
                  />
                  {regio}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {showSelf ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="mp-leeftijd">Leeftijd</Label>
            <Input
              id="mp-leeftijd"
              type="number"
              min={16}
              max={99}
              disabled={disabled}
              value={value.leeftijd}
              onChange={(e) => onChange({ ...value, leeftijd: e.target.value })}
              placeholder="Bijv. 32"
            />
          </div>

          <div className="space-y-2">
            <Label>Ervaring per merk</Label>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {INSTALLATIE_MERKEN.map((merk) => (
                <label
                  key={merk}
                  className="inline-flex items-center gap-2 text-sm text-ink"
                >
                  <Checkbox
                    disabled={disabled}
                    checked={value.merken.includes(merk)}
                    onCheckedChange={() => toggleMerk(merk)}
                  />
                  {merk}
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
