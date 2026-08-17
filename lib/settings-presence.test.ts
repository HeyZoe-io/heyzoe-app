import assert from "node:assert/strict";
import { resolvePresencePopup, uniqueOtherEditorNames } from "@/lib/settings-presence";

{
  const names = uniqueOtherEditorNames(
    [
      { user_id: "a", name: "דנה" },
      { user_id: "a", name: "דנה" },
      { client_id: "c1", name: "יוסי" },
    ],
    "משתמש אחר"
  );
  assert.deepEqual(names, ["דנה", "יוסי"]);
}

/** Two regular users: both should see the other. */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: false,
    otherPresences: [{ user_id: "u2", name: "דנה", is_admin: false }],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, true);
  assert.deepEqual(result.editorNames, ["דנה"]);
}

/** Regular user + admin present: customer does not see the popup. */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: false,
    otherPresences: [{ user_id: "admin", name: "ליאור", is_admin: true }],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, false);
  assert.deepEqual(result.editorNames, []);
}

/** Admin viewing while a customer is editing: admin sees the popup. */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: true,
    otherPresences: [{ user_id: "u2", name: "דנה", is_admin: false }],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, true);
  assert.deepEqual(result.editorNames, ["דנה"]);
}

/** Customer + another employee + admin: customer still hidden. */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: false,
    otherPresences: [
      { user_id: "u2", name: "דנה", is_admin: false },
      { user_id: "admin", name: "ליאור", is_admin: true },
    ],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, false);
}

/** Admin sees both other people (customer and another editor). */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: true,
    otherPresences: [
      { user_id: "u2", name: "דנה", is_admin: false },
      { user_id: "u3", name: "יוסי", is_admin: false },
    ],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, true);
  assert.deepEqual(result.editorNames, ["דנה", "יוסי"]);
}

/** Nobody else: no popup. */
{
  const result = resolvePresencePopup({
    currentUserIsAdmin: false,
    otherPresences: [],
    fallbackName: "משתמש אחר",
  });
  assert.equal(result.show, false);
}

console.log("settings-presence.test.ts: ok");
