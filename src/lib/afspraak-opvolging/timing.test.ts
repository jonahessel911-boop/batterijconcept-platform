import assert from "node:assert/strict";
import {
  sameAmsterdamDay,
  shouldSendAvondSmsNow,
  shouldSendReminder48uNow,
  shouldSendSocialProofNow,
} from "./timing";

const HOUR = 60 * 60 * 1000;

{
  const a = new Date("2026-11-23T08:00:00+01:00");
  const b = new Date("2026-11-23T22:00:00+01:00");
  assert.equal(sameAmsterdamDay(a, b), true);
}

{
  const a = new Date("2026-11-23T23:30:00+01:00");
  const b = new Date("2026-11-24T00:30:00+01:00");
  assert.equal(sameAmsterdamDay(a, b), false);
}

{
  const createdAt = new Date("2026-11-23T10:00:00+01:00");
  const now = new Date("2026-11-23T15:00:00+01:00");
  const startAt = new Date(now.getTime() + 48 * HOUR);
  assert.equal(
    shouldSendReminder48uNow({
      now,
      startAt,
      createdAt,
      bevestigingSent: true,
      alreadySent: false,
    }),
    false,
    "geen 48u op bevestigingsdag"
  );
}

{
  const createdAt = new Date("2026-11-20T10:00:00+01:00");
  const now = new Date("2026-11-23T12:00:00+01:00");
  const startAt = new Date(now.getTime() + 48 * HOUR);
  assert.equal(
    shouldSendReminder48uNow({
      now,
      startAt,
      createdAt,
      bevestigingSent: true,
      alreadySent: false,
    }),
    true,
    "48u wel op latere dag"
  );
}

{
  const createdAt = new Date("2026-11-23T11:00:00+01:00");
  const now = new Date("2026-11-23T18:30:00+01:00");
  const startAt = new Date("2026-11-24T14:00:00+01:00");
  assert.equal(
    shouldSendAvondSmsNow({
      now,
      startAt,
      createdAt,
      alreadySent: false,
    }),
    false,
    "geen avond-SMS als vandaag bevestigd"
  );
}

{
  const createdAt = new Date("2026-11-20T11:00:00+01:00");
  const now = new Date("2026-11-23T18:30:00+01:00");
  const startAt = new Date("2026-11-24T14:00:00+01:00");
  assert.equal(
    shouldSendAvondSmsNow({
      now,
      startAt,
      createdAt,
      alreadySent: false,
    }),
    true,
    "avond-SMS wel als eerder bevestigd"
  );
}

{
  const createdAt = new Date("2026-11-23T10:00:00+01:00");
  const now = new Date("2026-11-23T20:00:00+01:00");
  const startAt = new Date("2026-12-01T14:00:00+01:00");
  assert.equal(
    shouldSendSocialProofNow({
      now,
      createdAt,
      startAt,
      bevestigingSent: true,
      alreadySent: false,
    }),
    false
  );
}

console.log("timing.test.ts: ok");
