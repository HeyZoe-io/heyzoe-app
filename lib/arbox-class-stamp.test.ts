import assert from "node:assert/strict";
import { parseArboxClassStamp } from "@/lib/arbox-class-stamp";

{
  const stamp = parseArboxClassStamp({
    arbox_box_category_id: 53273,
    arbox_class_name: "  Handstand (Beginner)  ",
    schedule_removed_notice: { detected_at: "2026-09-28T09:00:00.000Z", dismissed: false },
  });
  assert.equal(stamp.arbox_box_category_id, 53273);
  assert.equal(stamp.arbox_class_name, "Handstand (Beginner)");
  assert.deepEqual(stamp.schedule_removed_notice, {
    detected_at: "2026-09-28T09:00:00.000Z",
    dismissed: false,
  });
}

{
  const stamp = parseArboxClassStamp({});
  assert.equal(stamp.arbox_box_category_id, null);
  assert.equal(stamp.arbox_class_name, "");
  assert.equal(stamp.schedule_removed_notice, null);
}

{
  const stamp = parseArboxClassStamp({
    arbox_box_category_id: "0",
    arbox_class_name: "   ",
    schedule_removed_notice: "{not json",
  });
  assert.equal(stamp.arbox_box_category_id, null);
  assert.equal(stamp.arbox_class_name, "");
  assert.equal(stamp.schedule_removed_notice, null);
}

{
  const present = parseArboxClassStamp({
    arbox_box_category_id: "88",
    schedule_removed_notice: { detected_at: "2026-09-01T00:00:00.000Z", dismissed: true },
  });
  assert.equal(present.arbox_box_category_id, 88);
  assert.deepEqual(present.schedule_removed_notice, {
    detected_at: "2026-09-01T00:00:00.000Z",
    dismissed: true,
  });

  const absent = parseArboxClassStamp({
    schedule_removed_notice: { dismissed: true },
  });
  assert.equal(absent.schedule_removed_notice, null);
}

console.log("arbox-class-stamp.test.ts: ok");
