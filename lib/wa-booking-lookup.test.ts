import assert from "node:assert/strict";
import {
  assistantAskedMembershipOrTrialClarify,
  assistantReplyDumpsAccountAccessToSelfServeCall,
  BOOKING_LOOKUP_CLARIFY_QUESTION,
  buildBookingLookupMembershipHandoffReply,
  matchesBookingLookupPhrase,
  isScheduleInquiryIntent,
} from "@/lib/wa-booking-lookup";
import { classifyRegistrationIntentMembershipReply } from "@/lib/wa-registration-intent";

const liveLead = "היי ממצב? יכולה לשלוח לי למתי קבענו שאכניס לי ליומן";
assert.equal(matchesBookingLookupPhrase(liveLead), true);
assert.equal(matchesBookingLookupPhrase("למתי קבענו?"), true);
assert.equal(matchesBookingLookupPhrase("מתי האימון שלי"), true);
assert.equal(matchesBookingLookupPhrase("תשלחי לי את המועד ליומן"), true);
assert.equal(matchesBookingLookupPhrase("when is my class"), true);
assert.equal(matchesBookingLookupPhrase("send me the time we booked"), true);

assert.equal(matchesBookingLookupPhrase("מתי יש אימון"), false);
assert.equal(matchesBookingLookupPhrase("מתי אפשר לבוא לאימון ניסיון"), false);
assert.equal(matchesBookingLookupPhrase("רוצה להצטרף בשבת לפוואר אנד הייט"), false);
assert.equal(matchesBookingLookupPhrase("כמה עולה השיעור?"), false);
assert.equal(matchesBookingLookupPhrase(""), false);

assert.equal(isScheduleInquiryIntent("לאיזה שיעור נרשמתי"), true);
assert.equal(isScheduleInquiryIntent("מתי השיעור הבא שלי"), true);
assert.equal(isScheduleInquiryIntent("שכחתי מתי האימון"), true);
assert.equal(isScheduleInquiryIntent("תזכירי לי מתי אני מגיעה"), true);
assert.equal(isScheduleInquiryIntent("יש לי אימון השבוע"), true);
assert.equal(isScheduleInquiryIntent("מתי אני רשומה"), true);
assert.equal(isScheduleInquiryIntent("אפשר לבדוק לי למתי אני רשומ/ה"), true);
assert.equal(isScheduleInquiryIntent("אפשר לבדוק לי למתי אני רשום"), true);
assert.equal(isScheduleInquiryIntent("תבדקי לי למתי אני רשומה"), true);
assert.equal(isScheduleInquiryIntent("מתי יש אימון"), false);

assert.equal(classifyRegistrationIntentMembershipReply("מנוי קיים"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("יש לי מנוי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("מנוי"), "yes");
assert.equal(classifyRegistrationIntentMembershipReply("אימון ניסיון"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("מדובר באימון ניסיון"), "no");
assert.equal(classifyRegistrationIntentMembershipReply("ניסיון"), "no");

assert.equal(
  assistantAskedMembershipOrTrialClarify(BOOKING_LOOKUP_CLARIFY_QUESTION),
  true
);
assert.equal(
  assistantAskedMembershipOrTrialClarify(
    "היי! 👋 כדי שאוכל לעזור לך עם זה, אני צריכה קצת יותר פרטים. אתה מתכוון לאימון ניסיון שרשמת עכשיו, או שיש לך כבר מנוי קיים איתנו?"
  ),
  true
);
assert.equal(assistantAskedMembershipOrTrialClarify("יש אצלנו מנוי ואימון ניסיון."), false);

const dumped =
  "תודה על הבהרה! 💜 לצערי, אני לא יכולה לגשת לפרטי המנוי או ללוח האימונים שלך. זה משהו שצריך לברר מול הצוות ישירות. אתה יכול ליצור קשר בטלפון: **0524617053** והם יעזרו לך להוסיף את האימון ליומן.";
assert.equal(assistantReplyDumpsAccountAccessToSelfServeCall(dumped), true);
assert.equal(
  assistantReplyDumpsAccountAccessToSelfServeCall(
    "תודה על הבהרה! 💜 אני מעבירה את הפנייה לצוות ויצרו איתך קשר בקרוב. ביכולתך גם ליצור קשר טלפונית: 0524617053"
  ),
  false
);

assert.equal(
  buildBookingLookupMembershipHandoffReply("0524617053"),
  "תודה על הבהרה! 💜 אני מעבירה את הפנייה לצוות ויצרו איתך קשר בקרוב. ביכולתך גם ליצור קשר טלפונית: 0524617053"
);
assert.equal(
  buildBookingLookupMembershipHandoffReply(""),
  "תודה על הבהרה! 💜 אני מעבירה את הפנייה לצוות ויצרו איתך קשר בקרוב."
);

console.log("wa-booking-lookup.test.ts: ok");
