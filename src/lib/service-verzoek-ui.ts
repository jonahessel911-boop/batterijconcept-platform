import type { ServiceVerzoek } from "@/types/database";

export type ServiceTicketDisplayStatus =
  | "nieuw"
  | "ingepland"
  | "urgent"
  | "afgehandeld";

export function dagenOpen(iso: string): number {
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((Date.now() - start) / 86_400_000));
}

export function serviceTicketDisplayStatus(
  v: Pick<ServiceVerzoek, "status" | "created_at"> & {
    projecten?: { service_at?: string | null } | null;
  }
): ServiceTicketDisplayStatus {
  if (v.status === "afgehandeld") return "afgehandeld";
  if (v.projecten?.service_at) return "ingepland";
  if (dagenOpen(v.created_at) >= 3) return "urgent";
  return "nieuw";
}

export const SERVICE_TICKET_STATUS_LABEL: Record<
  ServiceTicketDisplayStatus,
  string
> = {
  nieuw: "Open",
  ingepland: "Ingepland",
  urgent: "Urgent",
  afgehandeld: "Afgehandeld",
};

export const SERVICE_TICKET_STATUS_CLASS: Record<
  ServiceTicketDisplayStatus,
  string
> = {
  nieuw: "border border-line bg-wash text-muted",
  ingepland: "border border-[#FDBA74]/60 bg-[#FFF0E6] text-[#C45A12]",
  urgent: "border border-[#C45A12]/30 bg-[#C45A12] text-white",
  afgehandeld: "border border-[#0D5C32]/25 bg-[#E8F6EC] text-[#0D5C32]",
};

export function partnerNaam(
  p: ServiceVerzoek["projecten"]
): string | null {
  if (!p?.installatie_partners) return null;
  const raw = p.installatie_partners;
  const one = Array.isArray(raw) ? raw[0] : raw;
  return one?.naam || null;
}

export function monteurNotities(v: ServiceVerzoek): {
  service: string | null;
  algemeen: string | null;
  door: string | null;
} {
  const service = v.projecten?.service_notities?.trim() || null;
  const algemeen = v.projecten?.installateur_notitie?.trim() || null;
  const door = v.projecten?.installateur_notitie_door?.trim() || null;
  return { service, algemeen, door };
}

export function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
