import assert from "node:assert/strict";
import {
  awaitOutboundWamid,
  describeGraphBody,
  isMissingWamidColumn,
  noteOutboundSend,
  OUTBOUND_WAMID_TTL_MS,
  resetOutboundWamidRegistry,
  takeOutboundWamid,
  wamidFromGraphResponse,
} from "@/lib/wa-outbound-wamid";
import { postWhatsAppGraphMessage } from "@/lib/notifications/graph-whatsapp-send";

const PID = "1111111111";
const OTHER_PID = "2222222222";
const LEAD = "972501234567";
const SESSION = `wa_${PID}_${LEAD}`;
const T0 = 1_800_000_000_000;

function text(wamid: string, body: string, pid = PID, to = LEAD) {
  return { phoneNumberId: pid, to, wamid, text: body, templateParams: [], isTemplate: false };
}

async function main() {
  // Graph shapes
  assert.equal(wamidFromGraphResponse({ messages: [{ id: "wamid.A" }] }), "wamid.A");
  assert.equal(wamidFromGraphResponse({}), "");
  assert.deepEqual(describeGraphBody({ type: "text", text: { body: "\u2067שלום\u2069" } }), {
    text: "שלום",
    templateParams: [],
    isTemplate: false,
  });
  assert.equal(describeGraphBody({ type: "interactive", interactive: { body: { text: "בחרי" } } }).text, "בחרי");
  assert.equal(describeGraphBody({ type: "image", image: { link: "x", caption: "כיתוב" } }).text, "כיתוב");
  assert.deepEqual(
    describeGraphBody({
      type: "template",
      template: { name: "t", components: [{ type: "body", parameters: [{ text: "דנה" }, { text: "18:00" }] }] },
    }),
    { text: "", templateParams: ["דנה", "18:00"], isTemplate: true }
  );

  // Send then log: content match picks the right wamid, in any order.
  resetOutboundWamidRegistry();
  noteOutboundSend(text("wamid.1", "היי, מה שלומך היום? רציתי לשאול משהו"), T0);
  noteOutboundSend(text("wamid.2", "מה הצעד הבא?"), T0 + 1);
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "מה הצעד הבא?\n\n[כפתורים: הרשמה | שאלה]" }, T0 + 2), "wamid.2");
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "היי, מה שלומך היום? רציתי לשאול משהו" }, T0 + 3), "wamid.1");
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "עוד הודעה" }, T0 + 4), null);

  // A single unmatched candidate is still taken (the log text was reworded).
  noteOutboundSend(text("wamid.3", "גוף ששונה בדרך"), T0);
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "לגמרי אחר" }, T0 + 5), "wamid.3");

  // Two unmatched candidates: ambiguous, nothing is taken.
  noteOutboundSend(text("wamid.4", "אחת"), T0);
  noteOutboundSend(text("wamid.5", "שתיים"), T0);
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "שלוש" }, T0 + 6), null);
  resetOutboundWamidRegistry();

  // Templates match on body params.
  noteOutboundSend({ phoneNumberId: PID, to: LEAD, wamid: "wamid.T", text: "", templateParams: ["דנה", "יום שלישי"], isTemplate: true }, T0);
  noteOutboundSend(text("wamid.X", "טקסט אחר לגמרי שלא קשור"), T0);
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "היי דנה, נתראה ביום שלישי" }, T0 + 1), "wamid.T");
  resetOutboundWamidRegistry();

  // Another recipient never takes this wamid. Same phone, other line: allowed (ZoeMaster vs marketing).
  noteOutboundSend(text("wamid.6", "שלום לך"), T0);
  assert.equal(takeOutboundWamid({ sessionId: `wa_${PID}_972509999999`, content: "שלום לך" }, T0 + 1), null);
  assert.equal(takeOutboundWamid({ sessionId: `wa_${OTHER_PID}_${LEAD}`, content: "שלום לך" }, T0 + 1), "wamid.6");

  // Expired entries are ignored.
  noteOutboundSend(text("wamid.7", "ישן"), T0);
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "ישן" }, T0 + OUTBOUND_WAMID_TTL_MS + 1), null);

  // Log then send: the send returns the row to stamp, only on a content match.
  resetOutboundWamidRegistry();
  awaitOutboundWamid({ sessionId: SESSION, content: "תודה, נרשמת בהצלחה לשיעור", rowId: "row-1" }, T0);
  assert.equal(noteOutboundSend(text("wamid.8", "משהו אחר"), T0 + 1), null);
  assert.equal(noteOutboundSend(text("wamid.9", "תודה, נרשמת בהצלחה לשיעור"), T0 + 2), "row-1");
  assert.equal(takeOutboundWamid({ sessionId: SESSION, content: "משהו אחר" }, T0 + 3), "wamid.8");

  // Missing column, as PostgREST reports it on insert and on select.
  assert.equal(isMissingWamidColumn("Could not find the 'wamid' column of 'messages' in the schema cache"), true);
  assert.equal(isMissingWamidColumn("column messages.wamid does not exist"), true);
  assert.equal(isMissingWamidColumn("duplicate key value violates unique constraint"), false);

  // postWhatsAppGraphMessage hands the wamid over, and the caller can still read the body.
  resetOutboundWamidRegistry();
  const previousEnv = process.env.VERCEL_ENV;
  const originalFetch = globalThis.fetch;
  delete process.env.VERCEL_ENV;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.G" }] }), { status: 200 })) as typeof fetch;
  try {
    const res = await postWhatsAppGraphMessage({
      phoneNumberId: PID,
      to: "972508318162",
      token: "t",
      body: { messaging_product: "whatsapp", type: "text", text: { body: "בדיקה של זואי" } },
    });
    assert.equal(wamidFromGraphResponse(await res.json()), "wamid.G");
    assert.equal(takeOutboundWamid({ sessionId: `wa_${PID}_972508318162`, content: "בדיקה של זואי" }), "wamid.G");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnv;
  }

  console.log("wa-outbound-wamid tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
