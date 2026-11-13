"use client";

import type { Sollicitatie, SollicitatieStatus } from "@/types/database";
import {
  normalizeSollicitatieStatus,
  SOLLICITATIE_STATUS_LABEL,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";
import {
  extractAdresFromNotitie,
  mergeSollicitatieAdres,
} from "@/lib/sollicitatie-adres";
import { provincieVanPostcode } from "@/lib/postcode-provincie";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

function adresVoorLijst(s: Sollicitatie) {
  return mergeSollicitatieAdres(
    {
      postcode: s.postcode || null,
      huisnummer: s.huisnummer || null,
      toevoeging: s.toevoeging || null,
      straat: s.straat || null,
      plaats: s.plaats || null,
    },
    extractAdresFromNotitie(s.notitie)
  );
}

function provincieVoorLijst(s: Sollicitatie): string {
  const a = adresVoorLijst(s);
  if (!a.postcode) return "";
  const p = provincieVanPostcode(a.postcode);
  return !p || p === "(onbekend)" ? "" : p;
}

const STATUS_PILL: Record<SollicitatieStatus, string> = {
  nieuw: "border-transparent bg-[#E8F0F6] text-[#1A4A6E]",
  geen_contact: "border-transparent bg-[#F3F4F6] text-[#4B5563]",
  definitief_geen_contact: "border-transparent bg-[#CFD8DC] text-[#263238]",
  diskwalificatie: "border-transparent bg-[#FCEAEA] text-[#9B2C2C]",
  gesprek_gepland: "border-transparent bg-[#FEF7E6] text-[#854D0E]",
  gesprek_gehad: "border-transparent bg-[#FFF4ED] text-[#9A3412]",
  gesprek_gehad_diskwalificatie:
    "border-transparent bg-[#FCEAEA] text-[#9B2C2C]",
  aangenomen_training_gepland:
    "border-transparent bg-[#E6F7F5] text-[#0F766E]",
  aangenomen_actief: "border-transparent bg-[#DCFCE7] text-[#14532D]",
};

function StatusSelect({
  status,
  disabled,
  onChange,
}: {
  status: SollicitatieStatus;
  disabled?: boolean;
  onChange: (next: SollicitatieStatus) => void;
}) {
  return (
    <NativeSelect
      value={status}
      disabled={disabled}
      size="sm"
      aria-label="Status wijzigen"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        const next = e.target.value as SollicitatieStatus;
        if (next === status) return;
        onChange(next);
      }}
      className={cn(
        "min-w-[10.5rem] font-semibold [&_select]:font-semibold",
        STATUS_PILL[status]
      )}
    >
      {SOLLICITATIE_STATUSES.map((st) => (
        <NativeSelectOption key={st} value={st}>
          {SOLLICITATIE_STATUS_LABEL[st]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function RecruitmentAanmeldingenTable({
  items,
  statusFilter,
  onStatusFilterChange,
  onStatusChange,
  saving,
  onOpen,
}: {
  items: Sollicitatie[];
  statusFilter: "" | SollicitatieStatus;
  onStatusFilterChange: (v: "" | SollicitatieStatus) => void;
  onStatusChange: (id: string, status: SollicitatieStatus) => void;
  saving?: boolean;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white px-6 py-14">
        <Empty className="border-0 p-0">
          <EmptyHeader>
            <EmptyTitle>Geen aanmeldingen</EmptyTitle>
            <EmptyDescription>
              {statusFilter
                ? `Geen kandidaten met status “${SOLLICITATIE_STATUS_LABEL[statusFilter]}”.`
                : "Nieuwe sollicitaties verschijnen hier."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="crm-card-list flex md:hidden">
        {items.map((s) => {
          const status = normalizeSollicitatieStatus(s.status);
          return (
            <article key={s.id} className="crm-card">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpen(s.id)}
                >
                  <p className="font-medium text-ink">{s.naam}</p>
                  <p className="mt-0.5 text-xs text-green-deeper">
                    {s.functie || "Geen functie"}
                  </p>
                </button>
                <StatusSelect
                  status={status}
                  disabled={saving}
                  onChange={(next) => onStatusChange(s.id, next)}
                />
              </div>
              <button
                type="button"
                className="mt-2 w-full text-left"
                onClick={() => onOpen(s.id)}
              >
                <p className="text-xs text-muted">
                  {[provincieVoorLijst(s) || null, s.telefoon]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
                <p className="mt-1 text-[11px] text-muted">
                  {formatDateShort(s.created_at)}
                </p>
              </button>
            </article>
          );
        })}
      </div>

      <div className="hidden overflow-hidden rounded-xl border border-line bg-white md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Naam</TableHead>
              <TableHead>Functie</TableHead>
              <TableHead>
                <NativeSelect
                  value={statusFilter}
                  onChange={(e) =>
                    onStatusFilterChange(
                      e.target.value as "" | SollicitatieStatus
                    )
                  }
                  size="sm"
                  aria-label="Filter op status"
                  onClick={(e) => e.stopPropagation()}
                  className="min-w-[9rem]"
                >
                  <NativeSelectOption value="">Status</NativeSelectOption>
                  {SOLLICITATIE_STATUSES.map((st) => (
                    <NativeSelectOption key={st} value={st}>
                      {SOLLICITATIE_STATUS_LABEL[st]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </TableHead>
              <TableHead>Provincie</TableHead>
              <TableHead>Telefoon</TableHead>
              <TableHead>Binnengekomen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => {
              const status = normalizeSollicitatieStatus(s.status);
              return (
                <TableRow
                  key={s.id}
                  className="cursor-pointer"
                  onClick={() => onOpen(s.id)}
                >
                  <TableCell className="font-medium whitespace-nowrap text-ink">
                    {s.naam}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {s.functie || "—"}
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <StatusSelect
                      status={status}
                      disabled={saving}
                      onChange={(next) => onStatusChange(s.id, next)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted">
                    {provincieVoorLijst(s) || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted">
                    {s.telefoon || "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted">
                    {formatDateTimeNl(s.created_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
