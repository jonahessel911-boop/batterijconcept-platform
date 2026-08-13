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

Headers:

```
Authorization: Bearer <WEBHOOK_SECRET>
Content-Type: application/json
```

Body:

```json
{
  "naam": "Jan de Vries",
  "email": "jan@example.nl",
  "telefoon": "06 12345678",
  "postcode": "1234 AB",
  "huisnummer": "12",
  "toevoeging": "A",
  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "thuisbatterij-scan"
}
```

Response `201`:

```json
{
  "ok": true,
  "lead_id": "uuid…",
  "lead_number": "BC-20260813-A1B2001",
  "created_at": "…"
}
```

Voorbeeld curl:

```bash
curl -X POST http://localhost:3000/api/webhook/leads \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"naam":"Test Lead","email":"test@example.nl","postcode":"1234 AB","huisnummer":"1","utm_source":"google"}'
```

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
| `WEBHOOK_SECRET` | Bearer-token voor lead-webhook |
