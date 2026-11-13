/** Categorieën voor Taken-agenda / projecttaken (Notion-achtige list). */

export const TAAK_CATEGORIEEN = [
  "project",
  "facturatie",
  "bellen",
  "email",
  "kantoor",
  "overig",
] as const;

export type TaakCategorie = (typeof TAAK_CATEGORIEEN)[number];

export const TAAK_CATEGORIE_LABEL: Record<TaakCategorie, string> = {
  project: "Project",
  facturatie: "Facturatie",
  bellen: "Bellen",
  email: "Email",
  kantoor: "Kantoor",
  overig: "Overig",
};

/** Pill-kleuren (Notion-achtig). */
export const TAAK_CATEGORIE_PILL: Record<
  TaakCategorie,
  { bg: string; text: string }
> = {
  project: { bg: "#E8F0F6", text: "#1A4A6E" },
  facturatie: { bg: "#FFF0E6", text: "#C45A12" },
  bellen: { bg: "#E8F6EC", text: "#0D5C32" },
  email: { bg: "#EEF0FF", text: "#3730A3" },
  kantoor: { bg: "#FFF8D6", text: "#92400E" },
  overig: { bg: "#F1F3F1", text: "#5A6B5E" },
};

export function isTaakCategorie(v: unknown): v is TaakCategorie {
  return (
    typeof v === "string" &&
    (TAAK_CATEGORIEEN as readonly string[]).includes(v)
  );
}

export function normalizeTaakCategorie(
  raw: unknown,
  fallback: TaakCategorie = "overig"
): TaakCategorie {
  if (isTaakCategorie(raw)) return raw;
  return fallback;
}

/** Default: project als er een projectkoppeling is. */
export function defaultTaakCategorie(opts: {
  hasProject?: boolean;
  categorie?: unknown;
}): TaakCategorie {
  if (isTaakCategorie(opts.categorie)) return opts.categorie;
  return opts.hasProject ? "project" : "overig";
}
