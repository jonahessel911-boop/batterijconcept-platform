export type DriveMap = {
  id: string;
  parent_id: string | null;
  naam: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DriveBestand = {
  id: string;
  map_id: string | null;
  naam: string;
  storage_path: string;
  bestandsnaam: string | null;
  mime_type: string | null;
  grootte_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  url?: string | null;
};

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 1024 / 102.4) / 10} MB`;
}
