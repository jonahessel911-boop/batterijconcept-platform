# Changelog

Alle noemenswaardige wijzigingen in dit project, per review-item.

## 2026-11-16

### Facturen Inbox (Business)
- Nieuwe tab **Facturen Inbox** onder Business (`/?tab=partners&partners=facturen_inbox`).
- Apple Mail-layout: lijst · PDF/mail · betalingsvelden rechts.
- IMAP-sync `facturen@` + uitlezen (factuurnr, bedragen ex/inc btw, IBAN, vervaldatum, bedrijfsnaam, referentie).
- PDF downloadbaar; velden bewerkbaar; goedkeuren / afwijzen.
- Na **goedkeuren** → dichtstbijzijnde woensdag → zichtbaar in **Uitbetalingen** (Operations).
- Migratie: `supabase/migrate-facturen-inbox.sql` (mailbox-kolom + `facturen_inbox_items`).

### Bel-conversie: annuleringen per plandag
- Annuleringen in de dag-/weekgrafiek tellen nu op de **cohort van die dag**: huisbezoeken die die dag zijn gezet en (nog) geannuleerd staan.
- Niet meer: alle annuleringen die die kalenderdag binnenkwamen (ongeacht plandatum).
- Tooltip/detail: “% van die dag geplaatst” / “% van in periode geplaatst”.

### HOLD SALES ACTIE terug in Projecten
- Status **HOLD SALES ACTIE** was alleen zichtbaar bij eigen middelen.
- Weer beschikbaar voor **alle** projecten (incl. Warmtefonds) via statusmenu → Annuleringen.

### Recruitment open voor backoffice (tijdelijk)
- Backoffice-accounts zien tab **Recruitment** (`instroom`).
- API-toegang via `magRecruitment` uitgebreid met rol `backoffice` (naast admin + recruiter).
