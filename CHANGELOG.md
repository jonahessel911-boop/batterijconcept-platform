# Changelog

Alle noemenswaardige wijzigingen in dit project, per review-item.

## 2026-11-16

### Marcel Klaasman: eigen inplantijden
- Alleen voor Marcel Klaasman: vaste slots **10:00 / 12:00 / 14:00 / 16:00** (i.p.v. 10/13/16/19).
- Geldt in agenda, bel-plannen, capaciteit en afblokkingen; overige adviseurs ongewijzigd.

### Financieel: Aanbetaling bewerken
- Knop **Aanbetaling bewerken** op projecttab Financieel → popup met vorige + nieuwe aanbetaling.
- Opslaan werkt concept-aanbetalingsfactuur bij (handmatig bedrag).
- Bij **€0**: conceptfactuur weg, project naar **Opstarten WF** (`schouwweek_inplannen`), BTW-factuur-actie/taak verdwijnt via taken-sync.

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

### Fix: ontbrekende Radix-deps sales-cockpit
- Lokaal `npm install` voor `@radix-ui/react-avatar` (+ progress/separator/tooltip/slot/tabs) na sales-cockpit merge — module-not-found opgelost.

### Facturen Inbox: auto-sync elke 10 min
- IMAP-mailbox sync automatisch elke 10 minuten zolang de tab open is.
- Sync-knop synct meteen en reset de 10-min timer.

### Recruitment Kaart weer in menu
- Tab **Kaart** terug in Recruitment (HQ · adviseurs · monteurs · kandidaten).
- Gebruikt bestaande `RecruitmentKaartView` + `/api/instroom/kaart`.

### Rapportage leads-kaart weer laden
- Lichte `/api/rapportage/geo` i.p.v. volle rapportage-API (was te zwaar → kaart bleef hangen).
- GeoJSON wordt expliciet geladen met foutmelding.
- Backoffice ziet ook tab **Rapportage** (voor Kaart: leads per provincie).

### Facturen Inbox: sync + PDF-velden rechts
- Lege inbox synct automatisch via IMAP bij openen (facturen@).
- PDF-bijlagen worden uitgelezen → bedrijfsnaam, factuurnr, IBAN, bedragen, data rechts.
- Heuristiek: geen subtotaal-als-totaal, nette NL-IBAN, factuurnr zonder trailing punt.
- IBAN in PDF-footer (geen tekstlaag): OCR-fallback via screenshot + tesseract (bijv. Finc Accountants).

### Doorzetten BO: Frank of Next Energy verplicht
- Bij Actie afronden / sale doorzetten: verplicht vinkje **Frank Energie** of **Next Energy**.
- Opgeslagen op offerte + project; zichtbaar voor backoffice.
- Migratie: `supabase/migrate-energie-overstap-leverancier.sql`.
