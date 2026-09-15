# TODO: Persist schedule-slot pick menu (`sf_schedule_slot_menu`)

Menu send and button reply are **two HTTP requests**. Today the reply path
re-runs `filterScheduleSlotsByOccurrenceState` against live Arbox. If fullness
flips between those requests, the filtered array shortens and a Twilio ordinal
(`"2"`) can resolve to a **different** slot than the one the user tapped. Meta
usually matches by label text, but the only non-Meta-label client today has no
Arbox — so ordinal drift cannot fire in production yet. This doc is hardening
for later, not a live bug. Do **not** reconstruct the sent list from the
assistant log (`[כפתורים:…]` vs Twilio numbered text; intervening assistant
messages break recovery).

## Approved storage shape

**Column:** `contacts.sf_schedule_slot_menu`  
**Type:** `jsonb` null  
**Default:** `NULL` (existing rows unchanged)

### JSON shape (`v: 1`)

```json
{
  "v": 1,
  "sent_at": "2026-09-15T09:45:41.123Z",
  "service_name": "אימוני כוח - Strength",
  "arbox_class_name": "Strength",
  "slots": [
    {
      "label": "יום ג׳ ב18:30",
      "day": "ג",
      "time": "18:30",
      "date_ymd": "2026-09-15",
      "cycle_start": null,
      "cycle_end": null
    }
  ],
  "change_service_label": "אימון אחר"
}
```

| Field | Purpose |
| --- | --- |
| `v` | Schema version |
| `sent_at` | ISO timestamptz string for staleness |
| `service_name` | Reject if selected service no longer matches |
| `arbox_class_name` | Join key for the one live check (`""` = unstamped → skip Arbox) |
| `slots[]` | Exact order of **slot** buttons after filter + `SCHEDULE_SLOT_PICK_MAX` |
| `slots[].label` | Exact Meta / Twilio label string that was sent |
| `slots[].day` / `time` | Written to `sf_requested_*` on success |
| `slots[].date_ymd` | Occurrence identity for Arbox — **frozen at send**, not re-resolved on reply |
| `slots[].cycle_*` | Course label uniqueness; null for non-course |
| `change_service_label` | Last button; Twilio last ordinal; not an occurrence |

No Arbox `schedule_id`. Occurrence key is `date_ymd + time + arbox_class_name`
(same as `getOccurrenceState`).

**Write:** in `sendScheduleSlotPickMenu` after labels are final.  
**Clear:** on successful pick, change-service, all-full menu, opening reset,
or stale / missing / wrong-service paths.

## Migration SQL (run in Supabase — do not auto-apply from agents)

```sql
-- Pending WhatsApp schedule-slot menu: exact ordered list sent to the lead.
-- Used so button/ordinal reply resolves against the delivered menu, not a re-filtered live list.
alter table if exists public.contacts
  add column if not exists sf_schedule_slot_menu jsonb null;

comment on column public.contacts.sf_schedule_slot_menu is
  'Last schedule-slot pick menu sent: {v, sent_at, service_name, arbox_class_name, slots[{label,day,time,date_ymd,cycle_start,cycle_end}], change_service_label}. Null when none pending.';
```

Suggested repo file when implementing: `supabase/contacts_sf_schedule_slot_menu.sql`.

## Resolution flow (reply)

1. Load `sf_schedule_slot_menu` (never the assistant log).
2. Match tap against the **stored** list only:
   - Meta: label → `slots[].label` (`scheduleSlotPickLabelsMatch`) or `change_service_label`.
   - Twilio: ordinal `1..n` → `slots[i]`; last ordinal → change-service if sent.
3. Change-service → existing reopen path; clear column.
4. Matched slot → **one** `getOccurrenceState` using stored `date_ymd` / `time` /
   `arbox_class_name` (skip if no stamp/creds → fail-open as today).
5. If `full` / `cancelled` → notice for **that** class/time + re-send a **fresh**
   menu (re-filter + rewrite column). Never resolve to a different slot.
6. If `open` / `unknown` / check skipped → existing after-schedule + CTA using
   stored `day` / `time`.

**Do not** call `filterScheduleSlotsByOccurrenceState` on the reply path.

## Staleness (2 hour window)

| Condition | Action |
| --- | --- |
| Column null / invalid / unknown `v` | Clear; re-send fresh menu |
| `service_name` ≠ current selected service | Clear; re-send fresh menu |
| `sent_at` older than **2 hours** | Clear; re-send fresh menu |
| Tap matches nothing in stored list | Invalid-pick path; re-send fresh menu |

**Why 2 hours:** long enough for a normal sales-flow pause; short enough that a
leftover menu does not sit across an afternoon of inventory change. Prefer
re-send over guessing. Stored `date_ymd` already freezes the occurrence week;
the window is UX/staleness, not calendar math.

## `now` consistency (related, already shippable alone)

Menu filter and reply must use the same explicit `Date` from `processIncoming`’s
`nowIso` (`new Date(nowIso)`), so `resolveNextOccurrence` cannot disagree near
midnight. Reply live check after persistence should use stored `date_ymd`, not a
new `resolveNextOccurrence`.

## IO note (when implemented)

| Path | Today | After persistence |
| --- | --- | --- |
| Menu send | Full-list filter (1 Arbox pair per distinct date) | Same |
| Button reply | Full-list filter again | **At most one** `getOccurrenceState` for the matched slot (2s timeout, 60s cache, fail-open) |

## Out of scope

- Fail-open on Arbox timeout/error stays as today.
- CTA full/cancelled notice path unchanged.
- No new npm dependencies.
- Not a live bug while the only ordinal client has no Arbox.
