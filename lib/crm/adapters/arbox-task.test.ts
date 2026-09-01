import assert from "node:assert/strict";
import {
  buildArboxCreateTaskBody,
  formatArboxTaskReminder,
  parseArboxTaskTypes,
  shouldCreateArboxHumanRequestTask,
} from "@/lib/crm/adapters/arbox";

{
  const rows = parseArboxTaskTypes({
    statusCode: 200,
    data: [
      { task_type_id: "12", type: "שיחת מכירה", active: "1" },
      { task_type_id: 7, type: "בקשת נציג", active: "yes" },
      { task_type_id: 3, type: "לא פעיל", active: "0" },
      { task_type_id: 0, type: "חסר" },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.task_type_id),
    [7, 12]
  );
  assert.equal(rows[0]?.task_type_name, "בקשת נציג");
  assert.equal(rows[1]?.task_type_name, "שיחת מכירה");
}

{
  assert.equal(parseArboxTaskTypes(null).length, 0);
  assert.equal(parseArboxTaskTypes({ data: "nope" }).length, 0);
}

{
  const reminder = formatArboxTaskReminder(new Date("2026-09-01T10:30:00.000Z"));
  assert.equal(reminder.date, "2026-09-01");
  assert.equal(reminder.time, "13:30");
}

{
  const reminder = formatArboxTaskReminder(new Date("2026-09-01T22:30:00.000Z"));
  assert.equal(reminder.date, "2026-09-02");
  assert.equal(reminder.time, "01:30");
}

{
  const body = buildArboxCreateTaskBody({
    locationId: 3959,
    taskTypeId: 7,
    userId: 11009462,
    description: "זואי — בקשת נציג\n\n🙋 זואי: הליד ביקש לדבר עם נציג",
    now: new Date("2026-09-01T10:30:00.000Z"),
  });
  assert.deepEqual(body, {
    location_id: 3959,
    task_type_id: 7,
    user_id: 11009462,
    description: "זואי — בקשת נציג\n\n🙋 זואי: הליד ביקש לדבר עם נציג",
    reminder: { date: "2026-09-01", time: "13:30" },
  });
}

{
  assert.equal(shouldCreateArboxHumanRequestTask("human_requested", "7"), true);
  assert.equal(shouldCreateArboxHumanRequestTask("human_requested", " 12 "), true);
  assert.equal(shouldCreateArboxHumanRequestTask("human_requested", ""), false);
  assert.equal(shouldCreateArboxHumanRequestTask("human_requested", null), false);
  assert.equal(shouldCreateArboxHumanRequestTask("trial_registered", "7"), false);
  assert.equal(shouldCreateArboxHumanRequestTask("no_response", "7"), false);
}

console.log("arbox-task.test.ts: ok");
