# Batterijconcept.nl CRM

Salesforce-achtige CRM voor leads, offertes, projecten en facturen — alles gekoppeld via één **lead ID**.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Supabase (Postgres + Storage voor ondertekende PDF’s)
- jsPDF + Signature Pad voor online ondertekenen

## Snel starten

```bash
cp .env.example .env.local
# Vul Supabase-keys in
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase database

Voer in de Supabase SQL Editor, in deze volgorde:

1. `supabase/schema.sql` — tabellen, sequences, RLS, storage bucket
2. `supabase/seed.sql` — productcatalogus (optioneel)

### Datamodel

| Tabel | Koppeling | Nummer |
|-------|-----------|--------|
| `leads` | centraal | `BC-YYYYMMDD-XXXX` |
| `offertes` | `lead_id` | `OFF-YYYY-0001` |
| `offerte_regels` | `offerte_id` | — |
| `projecten` | `lead_id` (+ optioneel `offerte_id`) | `PRJ-YYYY-0001` |
| `facturen` | `lead_id` (+ project/offerte) | `FAC-YYYY-0001` |
| `producten` | catalogus | SKU |

## Webhook: leads ontvangen

`POST /api/webhook/leads`

Body:

```json
{
  "naam": "Jan Jansen",
  "email": "jan@example.com",
  "telefoon": "0612345678",
  "postcode": "1234 AB",
  "huisnummer": "12",
  "adres": "Voorbeeldstraat",
  "woonplaats": "Amsterdam",
  "notities": "Heeft zonnepanelen, wil 10 kWh batterij",
  "utm_source": "google"
}
```

Het systeem zet automatisch:
- `lead_number` (bijv. `BC-20260813-A1B2`)
- `created_at` (aanmaakdatum)

Aliases: `straat` = `adres`, `plaats` = `woonplaats`, `notities` = `notes` / `opmerkingen` / `bericht` / `message`.

Response `201`:

```json
{
  "ok": true,
  "lead_id": "uuid…",
  "lead_number": "BC-20260813-A1B2",
  "created_at": "2026-08-13T11:00:00.000Z"
}
```

Voorbeeld curl:

```bash
curl -X POST https://batterijconcept-platform.vercel.app/api/webhook/leads \
  -H "Content-Type: application/json" \
  -d '{
    "naam":"Jan Jansen",
    "email":"jan@example.com",
    "telefoon":"0612345678",
    "postcode":"1234 AB",
    "huisnummer":"12",
    "adres":"Voorbeeldstraat",
    "woonplaats":"Amsterdam",
    "notities":"Heeft zonnepanelen, wil 10 kWh batterij",
    "utm_source":"google"
  }'
```

## Webhook: afspraak inplannen

`POST /api/webhook/afspraken`

Plant een afspraak via dezelfde flow als de CRM (overlap-check, leadstatus, bevestigingsmail bij huisbezoek).

Optioneel: header `x-webhook-secret` als `AFSPRAAK_WEBHOOK_SECRET` is gezet.

Body:

```json
{
  "lead_number": "BC-20260916-A1B2",
  "adviseur_email": "huub@batterijconcept.nl",
  "start_at": "2026-09-20T13:00",
  "soort": "nieuw",
  "partner_aanwezig": true,
  "andere_offertes_gehad": false,
  "notities": "Via website planner"
}
```

| Veld | Verplicht | Notes |
|------|-----------|--------|
| `lead_id` of `lead_number` | ja | Lead in CRM |
| `start_at` | ja | ISO UTC **of** Amsterdam-lokaal `YYYY-MM-DDTHH:mm` |
| `adviseur_id` of `adviseur_email` | nee | Anders lead.adviseur_id / eerste actieve adviseur |
| `soort` | nee | Default `nieuw`. Ook: `bel`, `warme_bel`, `vervolg_fysiek`, `vervolg_tel`, `vervolg_punt` |
| `partner_aanwezig` | bij `nieuw` | Default `true` |
| `andere_offertes_gehad` | bij `nieuw` | Default `false` |
| `notities` | nee | |

Response `201`: `{ ok, afspraak_id, lead_id, start_at, manage_url, bevestiging_direct }`.

CRM (ingelogd): zelfde logica via `POST /api/afspraken`.

## REST API v1 (read + write)

Centrale API achter één key: `API_V1_KEY`.

```bash
# Auth (beide werken)
Authorization: Bearer <API_V1_KEY>
# of
x-api-key: <API_V1_KEY>
```

**Volledige parameterlijst (machine-readable):** `GET /api/v1`  
Die response bevat per endpoint `method`, `path`, `params[]` (`name`, `in`, `type`, `required`, `description`, `example`) en vaak `example_body`.

### Facturen

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/facturen` | **query:** `project_id`, `lead_id`, `status` (concept\|verzonden\|betaald\|deels_betaald\|vervallen), `openstaand=1`, `limit` |
| POST | `/api/v1/facturen` | **body:** `project_id`*, `bedrag_inc_btw`*, `omschrijving`, `betaaltermijn_dagen` (default 3), `adres_gegevens_op_factuur` |
| GET | `/api/v1/facturen/:id` | **path:** `id`* |
| PATCH | `/api/v1/facturen/:id` | **path:** `id`* · **body:** `bedrag_inc_btw` / `omschrijving` / `betaaltermijn_dagen` (alleen concept), `status`, `betaald_op` |
| DELETE | `/api/v1/facturen/:id` | **path:** `id`* |

### Projecten

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/projecten` | **query:** `status`, `lead_id`, `q`, `include=facturen`, `limit` |
| GET | `/api/v1/projecten/:id` | **path:** `id`* → detail + `facturen_samenvatting` |
| PATCH | `/api/v1/projecten/:id` | **body:** `status`, `titel`, `notities`, `schouw_notities`, `installatie_notities`, `bel_schouw_aanbetaling_at`, `financiering_geschakeld_at` |
| GET | `/api/v1/projecten/:id/facturen` | Alle facturen van het project |
| GET | `/api/v1/projecten/:id/openstaand` | `openstaand_bedrag`, `overdue_*`, openstaande facturen |

### Agenda (schouw / installatie)

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/agenda` | **query:** `from`, `to`, `type` (1\|2\|3), `project_id`, `limit` |
| GET | `/api/v1/agenda/types` | Geen params — codes + voorbeelden |
| POST | `/api/v1/agenda` | **body:** `type`* (1\|2\|3), `project_id`* · type1: `schouw_jaar`*, `schouw_week`* · type2: `schouw_at`* of `start_at`* · type3: `installatie_at`* of `start_at`*, `installatie_partner_id`, `notities` |

| type | Betekenis |
|------|-----------|
| `1` | Schouwweek |
| `2` | Schouwdag + tijd |
| `3` | Installatie |

### Sales-afspraken / slots (Retell)

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/slots` | **query:** `lead_id`* (beste momenten + reistijd), of legacy `adviseur_id`; `days`, `limit` |
| GET | `/api/v1/afspraken` | **query:** `lead_id`, `adviseur_id`, `from`, `to`, `limit` |
| POST | `/api/v1/afspraken` | **body:** `lead_id`* + `slot_id`* (uit slots), of legacy `adviseur_id`* + `start_at`*; `soort`, `partner_aanwezig`, `notities` |

Met `lead_id` kiest de API de beste tijden over alle adviseurs (route-fit). De agent biedt alleen `label_nl` / `slots_tekst` aan; bij boeken stuurt die `slot_id` mee — adviseur wordt automatisch gekoppeld.

### Leads

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/leads` | **query:** `status`, `adviseur_id`, `q`, `limit` |
| GET | `/api/v1/leads/:id` | Lead + projecten + facturen + afspraken |

### Rapportage / sales

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/rapportage` | **query:** `adviseur_id`, `financial_range` (bijv. `last_30_days`) |
| GET | `/api/v1/sales` | **query:** `period`, `custom_start`, `custom_end`, `adviseur_id`, `leadbron`, `campaign`, `regio`, `order_status`, `installateur_id`, `product`, `lookback` (30\|60\|90) |

### Backoffice / taken

| Method | Path | Parameters |
|--------|------|------------|
| GET | `/api/v1/backoffice` | **query:** `view=acties\|rapportage`, `period` (bij rapportage) |
| GET | `/api/v1/taken` | **query:** `project_id`, `open` (default 1) |
| POST | `/api/v1/taken` | **body:** `project_id`*, `titel`*, `afdeling`* (Backoffice\|Planning\|Installatie\|Facturatie\|Verkoop), `verantwoordelijke_id`*, `due_at` of `due_in_days`, `notities` |
| PATCH | `/api/v1/taken/:id` | **body:** `titel`, `status` (todo\|doing\|done), `afdeling`, `verantwoordelijke_id`, `due_at`, `notities` |
| DELETE | `/api/v1/taken/:id` | **path:** `id`* |

`*` = verplicht.

```bash
# Alle parameters ophalen
curl https://batterijconcept-platform.vercel.app/api/v1 \
  -H "Authorization: Bearer $API_V1_KEY"

# Voorbeeld agenda
curl -X POST https://batterijconcept-platform.vercel.app/api/v1/agenda \
  -H "Authorization: Bearer $API_V1_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":2,"project_id":"<uuid>","schouw_at":"2026-09-18T10:00"}'
```

Zet `API_V1_KEY` in `.env.local` / Vercel env vars.

## Offerte aanmaken + ondertekenen

`POST /api/offertes`

```json
{
  "lead_id": "<uuid>",
  "titel": "Offerte Smile5",
  "regels": [
    { "omschrijving": "Alpha ESS Smile5", "aantal": 1, "prijs_ex_btw": 3495 },
    { "omschrijving": "Standaard installatie", "aantal": 1, "prijs_ex_btw": 995 }
  ]
}
```

Response bevat `sign_url` → open die link.

### Ondertekenflow (klant)

1. **Pagina 1** — logo + bedrijfswaarden + naam + handtekening + datum  
2. **Pagina 2** — offerte met producten + handtekening + Ondertekenen  
3. PDF download + opslag in bucket `offertes-signed`

## Merk & UI

- Groen `#1A8A3E` · donkergroen `#0D5C32` · soft `#E8F6EC` · oranje `#F37021`
- Typografie: Outfit (titels) + DM Sans (body)
- Horizontale tabs: Leads · Offertes · Projecten · Facturen

## Env-vars

| Variabele | Doel |
|-----------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (CRM browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (webhook, sign, PDF) |
