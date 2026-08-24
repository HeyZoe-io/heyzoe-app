import assert from "node:assert/strict";
import { parseSmbMessageEchoes } from "@/lib/whatsapp";
import {
  formatAppEchoPauseRemaining,
  isAppEchoAutoPause,
  isRecentWaBusinessAppEcho,
  nextPausedUntilForAppEcho,
  WA_BUSINESS_APP_PAUSE_MS,
} from "@/lib/wa-app-echo-pause";

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "smb_message_echoes",
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "1234567890", display_phone_number: "972501111111" },
            message_echoes: [
              {
                from: "972501111111",
                to: "972502222222",
                id: "wamid.ECHO1",
                timestamp: "1710000000",
                type: "text",
                text: { body: "היי, נחזור אליך לגבי השיעור" },
              },
              {
                from: "972501111111",
                to: "972502222222",
                id: "wamid.REACT",
                type: "reaction",
                reaction: { emoji: "👍" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const echoes = parseSmbMessageEchoes(payload);
assert.equal(echoes.length, 1);
assert.equal(echoes[0].phoneNumberId, "1234567890");
assert.equal(echoes[0].leadPhone, "+972502222222");
assert.equal(echoes[0].text, "היי, נחזור אליך לגבי השיעור");
assert.equal(parseSmbMessageEchoes({ object: "whatsapp_business_account", entry: [] }).length, 0);

const now = new Date("2026-08-16T10:00:00.000Z");
const autoUntil = new Date(now.getTime() + WA_BUSINESS_APP_PAUSE_MS).toISOString();
assert.equal(nextPausedUntilForAppEcho(null, now), autoUntil);
assert.equal(nextPausedUntilForAppEcho(new Date(now.getTime() + 60 * 60 * 1000).toISOString(), now), autoUntil);

const manual = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365 * 50).toISOString();
assert.equal(nextPausedUntilForAppEcho(manual, now), manual);

assert.equal(isAppEchoAutoPause(autoUntil, now), true);
assert.equal(isAppEchoAutoPause(manual, now), false);
assert.equal(isAppEchoAutoPause(null, now), false);
assert.equal(formatAppEchoPauseRemaining(autoUntil, "he", now), "עוד 24 שע׳");
assert.equal(formatAppEchoPauseRemaining(autoUntil, "en", now), "24h left");

const trainerSentAt = "2026-08-23T07:06:06.000Z";
const eveningThanks = new Date("2026-08-23T15:27:00.000Z");
assert.equal(isRecentWaBusinessAppEcho(trainerSentAt, eveningThanks), true);
assert.equal(isRecentWaBusinessAppEcho(trainerSentAt, new Date("2026-08-24T08:00:00.000Z")), false);

console.log("wa-app-echo-pause.test.ts: ok");
