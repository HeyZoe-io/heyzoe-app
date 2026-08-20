import assert from "node:assert/strict";
import { canUseArboxScheduleLookup } from "@/lib/crm/types";
import { normalizeIsraeliPhoneTail } from "@/lib/phone-normalize";
import { isScheduleInquiryIntent, matchesBookingLookupPhrase } from "@/lib/wa-booking-lookup";
import { isScheduleIntent } from "@/lib/wa-schedule-intent";
import {
  bookingMatchesPhoneTail,
  buildScheduleLookupMultipleReply,
  buildScheduleLookupNoBookingsReply,
  buildScheduleLookupPhoneNotFoundReply,
  buildScheduleLookupRetryHandoffReply,
  buildScheduleLookupSingleReply,
  formatScheduleLookupDate,
  formatScheduleLookupTime,
  hebrewDayFromYmd,
  mapBookingsForMember,
  mapScheduleLookupReply,
  SCHEDULE_LOOKUP_MULTIPLE_MODEL,
  SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL,
  SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL,
  SCHEDULE_LOOKUP_RETRY_HANDOFF_MODEL,
  SCHEDULE_LOOKUP_SINGLE_MODEL,
  scheduleLookupWindow,
  shouldTreatInboundAsScheduleLookupRetry,
  type ScheduleLookupBooking,
} from "@/lib/wa-schedule-lookup";
import type { ArboxBookingReportRow } from "@/lib/leads/arbox-trial-attended";

/** normalizeIsraeliPhoneTail: prefix/format cases + garbage. */
{
  assert.equal(normalizeIsraeliPhoneTail("972523993005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("0523993005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("+972523993005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("+972 52-399-3005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("052-399-3005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("  052 399 3005  "), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("523993005"), "523993005");
  assert.equal(normalizeIsraeliPhoneTail("abc"), null);
  assert.equal(normalizeIsraeliPhoneTail("12345"), null);
  assert.equal(normalizeIsraeliPhoneTail(""), null);
  assert.equal(normalizeIsraeliPhoneTail("+++---"), null);
}

/** CRM gate: Arbox only; Boostapp / no-CRM cannot enter lookup (never 4d). */
{
  assert.equal(canUseArboxScheduleLookup({ crm_type: "arbox", crm_api_key: "k", crm_box_id: "1" }), true);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "arbox", crm_api_key: "k", crm_box_id: "" }), false);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "boostapp", crm_api_key: "k", crm_box_id: "1" }), false);
  assert.equal(canUseArboxScheduleLookup({ crm_type: "", crm_api_key: "", crm_box_id: "" }), false);
  assert.equal(canUseArboxScheduleLookup(null), false);
}

/** Intent: trigger phrases are schedule_inquiry; general timetable is not. */
{
  const phrases = [
    "מתי קבענו",
    "למתי קבענו ליומן",
    "מתי האימון שלי",
    "מתי השיעור הבא שלי",
    "לאיזה שיעור נרשמתי",
    "מתי אני רשומה",
    "אפשר לבדוק לי למתי אני רשומ/ה",
    "אפשר לבדוק לי למתי אני רשום",
    "תזכיר לי מתי אני מגיע",
    "מתי אני מגיעה",
    "באיזה שיעור אני רשום",
    "שכחתי מתי האימון",
    "תזכירי לי מתי אני מגיעה",
    "יש לי אימון השבוע",
  ];
  for (const p of phrases) {
    assert.equal(isScheduleInquiryIntent(p), true, p);
  }
  assert.equal(matchesBookingLookupPhrase("מתי האימון שלי"), true);
  assert.equal(isScheduleInquiryIntent("מתי יש אימון"), false);
  assert.equal(isScheduleIntent("מתי יש אימון"), true);
  assert.equal(isScheduleInquiryIntent("מתי אפשר לבוא לאימון ניסיון"), false);
  assert.equal(isScheduleInquiryIntent("כמה עולה השיעור?"), false);
  assert.equal(isScheduleInquiryIntent(""), false);
}

/** Date/time display: Hebrew day + DD.M, time HH:MM. Use - not —. */
{
  assert.equal(formatScheduleLookupDate("2026-08-25"), "25.8");
  assert.equal(formatScheduleLookupDate("2026-08-03"), "3.8");
  assert.equal(formatScheduleLookupTime("09:00:00"), "09:00");
  assert.equal(formatScheduleLookupTime("9:00"), "09:00");
  assert.equal(formatScheduleLookupTime(""), null);
  assert.equal(hebrewDayFromYmd("2026-08-25"), "שלישי");
}

/** Phone-tail match on Arbox booking rows. */
{
  const tail = "523993005";
  const row: ArboxBookingReportRow = {
    user_id: 1,
    phone: "052-399-3005",
    class_name: "יוגה",
    date: "2026-08-25",
    time: "09:00:00",
  };
  assert.equal(bookingMatchesPhoneTail(row, tail), true);
  assert.equal(bookingMatchesPhoneTail({ ...row, phone: "972523993005" }, tail), true);
  assert.equal(bookingMatchesPhoneTail({ ...row, phone: "0500000000" }, tail), false);
}

/** Map + sort bookings; 0 / 1 / many replies. */
{
  const rows: ArboxBookingReportRow[] = [
    { user_id: 1, phone: "0523993005", class_name: "HIIT", date: "2026-08-26", time: "18:00" },
    { user_id: 1, phone: "0523993005", class_name: "יוגה", date: "2026-08-25", time: "09:00:00" },
    { user_id: 2, phone: "0501111111", class_name: "אחר", date: "2026-08-25", time: "10:00" },
  ];
  const mapped = mapBookingsForMember(rows, { phoneTail: "523993005" });
  assert.equal(mapped.length, 2);
  assert.equal(mapped[0]!.className, "יוגה");
  assert.equal(mapped[1]!.className, "HIIT");

  const single: ScheduleLookupBooking = mapped[0]!;
  const one = mapScheduleLookupReply({
    bookings: [single],
    memberMatched: true,
    isRetry: false,
    customerServicePhone: "03-1234567",
  });
  assert.equal(one.kind, "single");
  assert.equal(one.modelUsed, SCHEDULE_LOOKUP_SINGLE_MODEL);
  assert.equal(one.notifyHumanRequested, false);
  assert.match(one.text, /מצאתי! 💜 אני רואה רישום ל-יוגה ביום שלישי 25\.8 בשעה 09:00/);
  assert.equal(one.text, buildScheduleLookupSingleReply(single));
  assert.equal(one.text.includes("—"), false);

  const many = mapScheduleLookupReply({
    bookings: mapped,
    memberMatched: true,
    isRetry: false,
    customerServicePhone: "03-1234567",
  });
  assert.equal(many.kind, "multiple");
  assert.equal(many.modelUsed, SCHEDULE_LOOKUP_MULTIPLE_MODEL);
  assert.match(many.text, /^מצאתי כמה שיבוצים קרובים 💜/);
  assert.match(many.text, /🗓️ יוגה - שלישי 25\.8, 09:00/);
  assert.match(many.text, /🗓️ HIIT - רביעי 26\.8, 18:00/);
  assert.equal(many.text.includes("איזה"), false);
  assert.equal(many.text, buildScheduleLookupMultipleReply(mapped));

  const none = mapScheduleLookupReply({
    bookings: [],
    memberMatched: true,
    isRetry: false,
    customerServicePhone: "03-1234567",
  });
  assert.equal(none.kind, "no_bookings");
  assert.equal(none.modelUsed, SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL);
  assert.equal(none.text, buildScheduleLookupNoBookingsReply("03-1234567"));
  assert.match(none.text, /בשבועיים הקרובים/);
  assert.match(none.text, /03-1234567/);

  const notFound = mapScheduleLookupReply({
    bookings: [],
    memberMatched: false,
    isRetry: false,
    customerServicePhone: "03-1234567",
  });
  assert.equal(notFound.kind, "phone_not_found");
  assert.equal(notFound.modelUsed, SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL);
  assert.equal(notFound.text, buildScheduleLookupPhoneNotFoundReply());
  assert.match(notFound.text, /אפשר לכתוב לי אותו/);
  assert.equal(notFound.text.includes("תכתבי"), false);

  const retryFail = mapScheduleLookupReply({
    bookings: [],
    memberMatched: false,
    isRetry: true,
    customerServicePhone: "03-1234567",
  });
  assert.equal(retryFail.kind, "retry_handoff");
  assert.equal(retryFail.modelUsed, SCHEDULE_LOOKUP_RETRY_HANDOFF_MODEL);
  assert.equal(retryFail.notifyHumanRequested, true);
  assert.equal(retryFail.text, buildScheduleLookupRetryHandoffReply("03-1234567"));
}

/** One-retry inference: 4d → phone inbound → second lookup; 4d → non-phone → no loop. */
{
  const fourD = buildScheduleLookupPhoneNotFoundReply();
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL,
      lastAssistantContent: fourD,
      inboundText: "0501234567",
    }),
    true
  );
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: null,
      lastAssistantContent: fourD,
      inboundText: "+972 50-123-4567",
    }),
    true
  );
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: SCHEDULE_LOOKUP_PHONE_NOT_FOUND_MODEL,
      lastAssistantContent: fourD,
      inboundText: "שכחתי, תודה",
    }),
    false
  );
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: SCHEDULE_LOOKUP_SINGLE_MODEL,
      lastAssistantContent: "מצאתי! 💜",
      inboundText: "0501234567",
    }),
    false
  );
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: SCHEDULE_LOOKUP_NO_BOOKINGS_MODEL,
      lastAssistantContent: buildScheduleLookupNoBookingsReply("03-1234567"),
      inboundText: "+972548305644",
    }),
    true
  );
  assert.equal(
    shouldTreatInboundAsScheduleLookupRetry({
      lastModelUsed: "sales_flow_cs_redirect_service_pick",
      lastAssistantContent: "איזה אימון הכי קורץ לך?",
      inboundText: "+972548305644",
    }),
    false
  );
}

/** Window is today → today+14 (Israel YMD). */
{
  const w = scheduleLookupWindow(new Date("2026-08-20T10:00:00+03:00"));
  assert.equal(w.fromDate, "2026-08-20");
  assert.equal(w.toDate, "2026-09-03");
}

console.log("wa-schedule-lookup.test.ts: ok");
