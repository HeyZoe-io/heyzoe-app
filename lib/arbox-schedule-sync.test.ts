import assert from "node:assert/strict";
import {
  addDaysYmd,
  arboxClassMatchKey,
  catalogFromBoxCategoryRows,
  findWeeklyClassForStamp,
  hebrewDayLetterFromYmd,
  indexWeeklyClassesByMatchKey,
  mergeServiceDescriptionPatch,
  normalizeHhmm,
  normalizeTimetableToWeeklyClasses,
  parseArboxClassStamp,
  parseServiceDescriptionObject,
  shouldNotifyRemovedClass,
  weeklySlotsFromOccurrences,
} from "@/lib/arbox-schedule-sync";

assert.equal(normalizeHhmm("19:00:00"), "19:00");
assert.equal(normalizeHhmm("7:05"), "07:05");
assert.equal(normalizeHhmm("bad"), "");

assert.equal(addDaysYmd("2026-08-23", 14), "2026-09-06");
assert.equal(addDaysYmd("2026-08-24", 6), "2026-08-30"); // rolling week, next Monday not included
assert.equal(hebrewDayLetterFromYmd("2026-08-23"), "א"); // Sunday
assert.equal(hebrewDayLetterFromYmd("2026-08-27"), "ה"); // Thursday

{
  const slots = weeklySlotsFromOccurrences([
    { date: "2026-08-23", start_time: "18:00" },
    { date: "2026-08-30", start_time: "18:00" },
    { date: "2026-08-23", start_time: "18:00:00" },
    { date: "2026-08-27", start_time: "19:00" },
  ]);
  assert.deepEqual(slots, [
    { day: "א", time: "18:00" },
    { day: "ה", time: "19:00" },
  ]);
}

{
  const catalog = catalogFromBoxCategoryRows([
    { box_category_id: 53273, name: "Handstand (Beginner)" },
    { box_category_id: 58510, name: "Open Jam" },
  ]);
  const { classes, unmatchedSessionNames } = normalizeTimetableToWeeklyClasses(
    [
      {
        session_name: "Handstand (Beginner)",
        date: "2026-08-23",
        start_time: "18:00",
        is_transparent: 0,
      },
      {
        session_name: "Handstand (Beginner)",
        date: "2026-08-30",
        start_time: "18:00",
        is_transparent: 0,
      },
      {
        session_name: "Ghost Class",
        date: "2026-08-24",
        start_time: "10:00",
        is_transparent: 0,
      },
      {
        session_name: "Open Jam",
        date: "2026-08-26",
        start_time: "22:00",
        is_transparent: 1,
      },
    ],
    catalog
  );
  assert.equal(unmatchedSessionNames.includes("Ghost Class"), true);
  const hs = classes.find((c) => c.session_name === "Handstand (Beginner)");
  assert.equal(hs?.box_category_id, 53273);
  assert.deepEqual(hs?.slots, [{ day: "א", time: "18:00" }]);
  assert.equal(classes.some((c) => c.session_name === "Open Jam"), false);
}

{
  assert.equal(
    arboxClassMatchKey({ arbox_box_category_id: 53273, arbox_class_name: "renamed" }),
    "id:53273"
  );
  assert.equal(
    arboxClassMatchKey({ box_category_id: null, session_name: "Ghost Class" }),
    "name:Ghost Class"
  );
  assert.equal(arboxClassMatchKey({ session_name: "  " }), null);
}

{
  const catalog = catalogFromBoxCategoryRows([
    { box_category_id: 53273, name: "Handstand (Beginner)" },
  ]);
  assert.equal(
    shouldNotifyRemovedClass({
      stamp: {
        arbox_box_category_id: 53273,
        arbox_class_name: "Handstand (Beginner)",
        schedule_removed_notice: null,
      },
      catalog,
    }),
    false
  );
  assert.equal(
    shouldNotifyRemovedClass({
      stamp: {
        arbox_box_category_id: 99999,
        arbox_class_name: "Deleted",
        schedule_removed_notice: null,
      },
      catalog,
    }),
    true
  );
  assert.equal(
    shouldNotifyRemovedClass({
      stamp: {
        arbox_box_category_id: 53273,
        arbox_class_name: "Handstand (Beginner)",
        schedule_removed_notice: null,
      },
      catalog: { ...catalog, fetchFailed: true },
    }),
    false
  );
  assert.equal(
    shouldNotifyRemovedClass({
      stamp: {
        arbox_box_category_id: null,
        arbox_class_name: "Ghost Class",
        schedule_removed_notice: null,
      },
      catalog,
    }),
    true
  );
}

{
  const merged = mergeServiceDescriptionPatch(
    JSON.stringify({
      description_text: "keep me",
      price_text: "80",
      mystery_key: 1,
      schedule_slots: [{ id: "old", day: "ב", time: "09:00" }],
    }),
    { schedule_slots: [{ id: "new", day: "א", time: "18:00" }], schedule_removed_notice: null }
  );
  const obj = parseServiceDescriptionObject(merged);
  assert.equal(obj.description_text, "keep me");
  assert.equal(obj.price_text, "80");
  assert.equal(obj.mystery_key, 1);
  assert.deepEqual(obj.schedule_slots, [{ id: "new", day: "א", time: "18:00" }]);
  assert.equal(obj.schedule_removed_notice, null);
  const stamp = parseArboxClassStamp({
    arbox_box_category_id: 53273,
    arbox_class_name: "Handstand (Beginner)",
  });
  assert.equal(stamp.arbox_box_category_id, 53273);
}

{
  const classes = [
    { session_name: "Ghost Class", box_category_id: 999, slots: [{ day: "א", time: "10:00" }] },
  ];
  const indexed = indexWeeklyClassesByMatchKey(classes);
  const hit = findWeeklyClassForStamp(indexed, {
    arbox_box_category_id: null,
    arbox_class_name: "Ghost Class",
  });
  assert.equal(hit?.box_category_id, 999);
  const miss = findWeeklyClassForStamp(indexed, {
    arbox_box_category_id: 1,
    arbox_class_name: "Other",
  });
  assert.equal(miss, undefined);
}

console.log("arbox-schedule-sync.test.ts: ok");
