import assert from "node:assert/strict";
import {
  beginWaMessageLogScope,
  consumeWaOutboundIfLogged,
  endWaMessageLogScope,
  noteWaLogInserted,
  recordWaOutboundSent,
  shouldSkipDuplicateWaLog,
  waOutboundLogMatches,
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
void endWaMessageLogScope();

console.log("wa-message-log-context tests passed");
