import assert from "node:assert/strict";
import {
  beginWaMessageLogScope,
  consumeWaOutboundIfLogged,
  endWaMessageLogScope,
  getWaMessageLogScope,
  noteWaLogInserted,
  recordWaOutboundSent,
  shouldSkipDuplicateWaLog,
  waOutboundLogMatches,
  withWaMessageLogScope,
} from "@/lib/wa-message-log-context";

assert.equal(waOutboundLogMatches("שלום", "שלום"), true);
assert.equal(waOutboundLogMatches("  שלום  \nעולם ", "שלום עולם"), true);
assert.equal(
  waOutboundLogMatches(
    "אין בעיה בכלל! אם משהו ישתנה בעתיד, אנחנו כאן 🙂",
    "אין בעיה בכלל! אם משהו ישתנה בעתיד, אנחנו כאן 🙂\n\n_לביטול קבלת הודעות שלח *הסר*_"
  ),
  true
);
assert.equal(
  waOutboundLogMatches(
    "נשמח לשמוע ממך בהמשך לגבי האימון",
    "נשמח לשמוע ממך בהמשך לגבי האימון\n\n[כפתור: לאתר → https://example.com]"
  ),
  true
);
assert.equal(
  waOutboundLogMatches(
    "שאלה 1/3 - איזה חלק בתרגול הכי מושך אותך?\n\nניתן לכתוב שאלה שאינה מופיעה",
    "שאלה 1/3 - איזה חלק בתרגול הכי מושך אותך?\n\n[כפתורים: נשימה, רגיעה ושקט | תנועה וזרימה | שילוב של שניהם]\n\nניתן לכתוב שאלה שאינה מופיעה"
  ),
  true,
  "menu body+footer must match dashboard log with buttons"
);
assert.equal(waOutboundLogMatches("כן", "לא"), false);
assert.equal(waOutboundLogMatches("קיצור", "הודעה אחרת לגמרי בלי קשר"), false);

beginWaMessageLogScope({ businessSlug: "limitless", sessionId: "wa_1_97250" });
recordWaOutboundSent("תשובת זואי הראשונה כאן");
assert.equal(shouldSkipDuplicateWaLog("assistant", "תשובת זואי הראשונה כאן"), false);
noteWaLogInserted("assistant", "תשובת זואי הראשונה כאן");
consumeWaOutboundIfLogged("תשובת זואי הראשונה כאן");
assert.equal(shouldSkipDuplicateWaLog("assistant", "תשובת זואי הראשונה כאן"), true);

noteWaLogInserted("user", "היי");
assert.equal(shouldSkipDuplicateWaLog("user", "היי"), true);
assert.equal(shouldSkipDuplicateWaLog("user", "מתי השיעור?"), false);

async function main() {
  await endWaMessageLogScope();

  await Promise.all([
    withWaMessageLogScope({ businessSlug: "sanga", sessionId: "wa_sanga" }, async () => {
      recordWaOutboundSent("שאלה 1/3 יוגה לסאנגה");
      await new Promise((r) => setTimeout(r, 40));
      const scope = getWaMessageLogScope();
      assert.equal(scope?.sessionId, "wa_sanga");
      assert.deepEqual(scope?.pendingOutbound, ["שאלה 1/3 יוגה לסאנגה"]);
      consumeWaOutboundIfLogged("שאלה 1/3 יוגה לסאנגה");
    }),
    withWaMessageLogScope({ businessSlug: "limitless", sessionId: "wa_limitless" }, async () => {
      await new Promise((r) => setTimeout(r, 10));
      const scope = getWaMessageLogScope();
      assert.equal(scope?.sessionId, "wa_limitless");
      assert.deepEqual(scope?.pendingOutbound, []);
    }),
  ]);

  console.log("wa-message-log-context tests passed");
}

void main();
