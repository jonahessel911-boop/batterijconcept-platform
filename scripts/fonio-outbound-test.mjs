/**
 * Test: start 1 outbound call via Fonio.
 *
 * Env (.env.local of export):
 *   FONIO_API_KEY, FONIO_FROM_NUMBER, FONIO_TO_NUMBER
 * Optioneel: FONIO_AGENT_ID (wordt in context meegestuurd)
 *
 * Run:
 *   node --env-file=.env.local scripts/fonio-outbound-test.mjs
 * Alleen key testen:
 *   node --env-file=.env.local scripts/fonio-outbound-test.mjs --test-key
 */

function digitsE164(raw) {
  const s = String(raw || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return `+${s.slice(1).replace(/\D/g, "")}`;
  const d = s.replace(/\D/g, "");
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0")) return `+31${d.slice(1)}`;
  if (d.startsWith("31")) return `+${d}`;
  return `+${d}`;
}

const FONIO_API_KEY = process.env.FONIO_API_KEY;
const FROM = digitsE164(process.env.FONIO_FROM_NUMBER);
const TO = digitsE164(process.env.FONIO_TO_NUMBER || process.env.TO_NUMBER);
const AGENT_ID = process.env.FONIO_AGENT_ID || null;
const onlyKey = process.argv.includes("--test-key");

if (!FONIO_API_KEY) {
  console.error("Mist FONIO_API_KEY in env");
  process.exit(1);
}

async function testKey() {
  const res = await fetch("https://app.fonio.ai/api/public/v1/test-api-key", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: FONIO_API_KEY,
    },
    body: JSON.stringify({ apiKey: FONIO_API_KEY }),
  });
  const data = await res.json().catch(() => ({}));
  console.log("test-api-key:", res.status, JSON.stringify(data, null, 2));
  if (!res.ok) process.exit(1);
}

async function outbound() {
  if (!FROM || !TO || !FROM.startsWith("+") || !TO.startsWith("+")) {
    console.error("Mist geldige FONIO_FROM_NUMBER / FONIO_TO_NUMBER (E.164, bijv. +316…)");
    process.exit(1);
  }

  const body = {
    apiKey: FONIO_API_KEY,
    fromNumber: FROM,
    toNumber: TO,
    context: {
      firstName: "Jona",
      naam: "Jona Hessel",
      lead_id: "test-lead-local",
      plaats: "Utrecht",
      ...(AGENT_ID ? { agentId: AGENT_ID } : {}),
    },
  };

  console.log("Outbound →", { fromNumber: FROM, toNumber: TO });

  const res = await fetch("https://app.fonio.ai/api/public/v1/outbound_call", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: FONIO_API_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  console.log("Status:", res.status);
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exit(1);
  console.log("OK — je telefoon zou nu moeten overgaan.");
}

(async () => {
  await testKey();
  if (!onlyKey) await outbound();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
