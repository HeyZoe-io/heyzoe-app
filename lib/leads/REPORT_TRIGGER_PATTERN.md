# Report-backed Arbox trigger pattern

Use this when adding a new daily/frequent trigger that reads an Arbox report
(the `membership_cancelled` / A9 shape). Do **not** copy one-off quirks from
older triggers unless this file says so.

## Two-axis registry (templates UI)

`lib/trigger-catalog.ts` is the single source of truth. Each entry has:

| Field | Values | Role |
|---|---|---|
| `activation` | `automatic` \| `manual` | Axis 1 — auto-fire vs owner-initiated campaign |
| `audience` | `leads` \| `members` \| `staff` | Axis 2 — who the campaign targets |
| `implemented` | `boolean` | Live vs planned («בקרוב» card; no toggle / no send) |

Rules:

- `template_triggers.trigger_type` / `isTriggerType` / `TEMPLATE_PRESETS` =
  **automatic + implemented only**. Manual (`manual_*`) and planned types never
  POST/PATCH into `template_triggers`.
- Manual live entries map to M1 `audience_type` via `manualAudienceType`
  (`membership` / `talked_not_registered`). UI lives on the templates page
  (`CampaignSendPanel`); APIs stay under `/api/[slug]/bulk-send/*`.
- Audience rule of thumb: no active membership → leads; has membership → members.
- `recipient` (`customer` \| `staff`) stays separate — who receives the WhatsApp.

## Six layers

1. **Report path + paginator** — dedicated `lib/leads/arbox-*-report.ts` (or
   equivalent). Build `?fromDate&toDate&location_id` and `?page=N` only when
   `page > 1`. Loop with `shouldFetchNextArboxReportPage` from
   `lib/leads/arbox-sales-report.ts` (`ARBOX_REPORT_PAGE_SIZE` = 200).
2. **Matcher / handler** — `syncArbox…ForBusiness`: skip if no enabled rule
   with `template_name`; resolve contact (report `phone`, fallback
   `contacts.arbox_user_id`); send or enqueue.
3. **sync_log + seed** — new table `arbox_*_sync_log` with a grain that matches
   the report (do **not** reuse `arbox_expiring_sync_log`). If the report is
   historical (past events can appear on first enable), add
   `businesses.arbox_*_seeded boolean not null default false` and seed the max
   window **without sending**. Copy A9's `attempts` + `status` retry cap
   (`ARBOX_SYNC_SEND_ATTEMPT_CAP`, `nextCancellationSyncLogAfterDispatch`) —
   see Dedup / retries.
4. **Cron step** — add an isolated try/catch on the **existing** route
   (`arbox-daily-triggers` or `arbox-trial-sync`). **No new Vercel cron**
   (Hobby; schedule stays on cron-job.org).
5. **Registry + preset + slots** — one `TRIGGER_CATALOG` entry, matching
   `TEMPLATE_PRESETS` / `TEMPLATE_PARAM_SLOTS`, and `template-triggers-match`
   load/pick/resolve.
6. **Tests** — pagination (>200, short page, cap), seed vs second pass, param
   resolution, catalog lists.

## Pagination contract

- Live Arbox `next_page_url` is unusable (`http://` + query stripped to `?page`
  only → 400). Treat it as a **boolean only**.
- **Never GET `next_page_url` as a URL.** Repeat the original query with
  `?page=2..N`.
- Stop when `next_page_url` is empty/null **or** this page has `< 200` rows.
- Cap 20 pages and `console.warn` (do not silently truncate).
- **BUG-1** was found on `salesReport` (trial-sync). The same bug exists on
  `allLeadsReport` (and any other Arbox report paginator). `allLeadsReport` has
  its own production fetcher + test (`lib/leads/arbox-all-leads-report.ts`)
  using `shouldFetchNextArboxReportPage` — do not leave a one-off
  `while (next_page_url)` loop on a production report.

## Appearance-based new-lead (A1)

- Fire when a `user_id` **newly appears** in `allLeadsReport` (not in
  `arbox_new_lead_sync_log`), **not** in the in-memory customer set, **not**
  Zoe-sourced (`lead_source === "זואי"`), and **not** already in-app
  (`contacts` by `arbox_user_id` / phone).
- **Do not** match Arbox status strings (Hebrew `"לא נוצר קשר"` or English).
  Status language varies by studio. A Hebrew uncontacted status still fires
  only because the other conditions hold, not because of the string.
- Customer set = `activeMembershipsReport` (`active` ∪
  `activeMemberWithFutureCancel`) ∪ `sessionsReport` (`active`), built once per
  run as a `Set<user_id>`. Do not persist it; do not query per-lead.
- Fetch those two reports **only after** filtering sync_log **and** Zoe-source.
  If every row is already seen or Zoe-created, skip memberships/sessions (a
  Zoe-only “new” row must not trigger the extra GETs). `already_in_app` is
  checked after the customer fetch and is **not** part of that skip.
- Seed (first enable): mark **all** current allLeads `user_id`s seen, set
  `arbox_leads_seeded`, **return without sending**. Only leads that appear after
  activation get the opener.

## Birthday member vs former (customer-set split)

- Same `birthdayReport` window as before.
- Cross each `user_id` with the **A1 customer set** (`fetchArboxCustomerUserIds`):
  - in set → `birthday` (automatic × members)
  - not in set → `birthday_former` (automatic × leads)
- Both catalog entries are `implemented: true`. Separate presets / rules /
  `template_triggers` rows.
- **IO:** +2 customer report GETs (memberships + sessions), flat per business
  on the birthday daily step whenever either rule is enabled (same shape as A1).
- **Dedup (no migration):** PK stays `(business_id, user_id, birthday_year)`.
  Former path stores `birthday_year + 1_000_000` so member vs former never block
  each other in the same celebration year. Scheduled keys use prefixes
  `birthday:` vs `birthday_former:`.

## Seed vs forward-looking

- Historical reports (cancellations, FAIL charges, leads): first run with an
  enabled rule upserts the window into sync_log, sets the seed flag, **returns
  without WhatsApp**. After seed, lookback is typically yesterday+today; **A7/A9
  sequences** widen lookback to `min(30, max(minLookback, max enabled delay_days))`
  so day-7 / day-21 steps still see the row. PK dedup is per `trigger_id`.
  Send on the **due day only** (re-read the report each cron run — do not enqueue).
- **Forward-looking reports** (expiring memberships / packs): no seed flag —
  the API only returns future `end_date`s.

## Dedup / retries

- Terminal sync_log statuses (`seeded`, `sent`, `abandoned`, `no_phone`) skip the row.
- `pending` (or no row) → try send / enqueue.
- Successful immediate send or enqueue → `status=sent` (seen).
- `no_phone` → terminal immediately (`status=no_phone`). Do not retry forever.
- **`gated` does not count toward the retry cap.** A trigger enabled before the Meta
  template is approved stays `pending` with **unchanged `attempts`**, so customers
  are not abandoned before a template exists. Retry when the template is approved.
- **`send_failed` only** increments `attempts`. Cap:
  `ARBOX_SYNC_SEND_ATTEMPT_CAP = 3` (copy this constant + `nextCancellationSyncLogAfterDispatch`).
  After 3 real failures → `status=abandoned` and stop retrying.
- Cap-hit logging is **one `console.warn` per business run** (`abandoned` count +
  `business_id` + reason), not per row — a wide outage must not flood logs.
- Delayed sends: `scheduled_template_sends` has no `body_params` column.
  Encode extra slots in `dedup_key` (last `YYYY-MM-DD` = expiry; `#` suffix =
  `encodeURIComponent` for names) so `scheduled-template-sends` can refill
  `templateSendPayload`.

## Product filter

- Empty `product_filter` = all membership_type_ids.
- Reports that lack `membership_type_id` match by `membership_type_name`
  resolved via `GET /v3/membershipTypes` (one extra GET per business per run,
  only when a filter is set).

## Purchase `item_type_filter` (salesReport class)

- Expiring membership vs punch-card uses **two Arbox reports**
  (`expiringMembershipsReport` / `expiringSessionsReport`). Purchase cannot —
  the v3 report enum has a single `salesReport` (no per-class sales report).
- `template_triggers.item_type_filter text[] null` = optional include-list of
  salesReport `item_type`: `plan` | `session` | `service` | `trial`.
  NULL/empty = all classes. Coexists with `product_filter` (ids).
- Matching prefers more specific rules (ids > item_type > catch-all).
- **No extra Arbox IO** — filter on rows already fetched.
- Migration: `supabase/template_triggers_item_type_filter.sql` (run before deploy).

## Delay mode `none` (immediate confirmations)

- Catalog `delay: "none"` for `purchase`, `credit_refusal`,
  `freeze_created` (and manual campaigns). UI hides before/after + days;
  shows «נשלח מיד»; create/edit force `delay_days=0`.
- Runtime still honors a stored `delay_days > 0` if present (no backfill) —
  existing rows are unchanged.
- Other modes: `after` / `before` / `either` unchanged (`birthday*` → `either`).

## Meta template category (all presets)

Not A9-specific. Apply when writing **any** new trigger preset:

| Intent | Category |
|---|---|
| מבצע / הטבה / עידוד הרשמה / עידוד תשלום / הזמנה לחזור | **MARKETING** |
| הודעת עדכון או אישור נטו, בלי שיווק | **UTILITY** |

Calibration:

- חידוש מנוי + יום הולדת עם הטבה → **MARKETING**
- אישור רכישה + הקפאה + ביטול מנוי → **UTILITY**
- אי־הגעה לשיעור (מנוי, בלי CTA) → **UTILITY**
- אי־הגעה לניסיון עם «מתי נוח לקבוע מחדש» → **MARKETING** (win-back)

- Win-back copy (“נשמח לראותך שוב”) is encouragement to return → MARKETING.
- A dry system confirmation must stay UTILITY so Meta approval is reliable.
- ימים במועדון / שימור (`milestones`) → **MARKETING**
- אימון מספר N ללקוח חדש (`nth_workout`) → **MARKETING**
- פער נוכחות ללא רישום עתידי (`attendance_gap`) → **MARKETING**
- נרשם אחרי ניסיון (C5, אישור הרשמה בלי CTA) → **UTILITY**; לא נרשם אחרי ניסיון (C6) → **MARKETING**
- סיום הקפאה בלי הזמנה (C14, עדכון תאריך בלי הזמנה לחזור) → **UTILITY**; עם הזמנה (C15) → **UTILITY**
- ליד אבוד עם הטבת ניסיון + CTA (`lost_lead`) → **MARKETING**

Existing presets may predate this rule; **new** presets must follow it.

## Missed class / missed trial (C3 / C4)

- Source: `bookingsReport`, paginated (`?page=N`). Missed = past `date` (Israel YMD
  `< today`) **and** `check_in === "No"` (string; not empty, not truthiness).
- C3 `missed_class` (automatic × members): non-trial bookings. Preset **UTILITY**.
- C4 `missed_trial` (automatic × leads): trial product filter (same name/id scope as
  former `trial_attended` / now C5–C6). Preset **MARKETING**.
- **Shared fetch** with post-trial C5/C6 + attendance_gap on `arbox-daily-triggers`: one GET
  loop when any of these rules is enabled; handlers split in memory.
  - Seed window (30d) only when a `missed_*` rule is enabled and
    `arbox_missed_class_seeded` is false — not when only post-trial is live (post-trial
    forces wide past separately when C5/C6 is enabled).
  - Post-trial filters the shared rows to its own lookback in memory.
- Dedup: `arbox_missed_class_sync_log` PK
  `(business_id, user_id, class_date, class_time, class_name)` — no `event_kind`.
- Seed: `businesses.arbox_missed_class_seeded` — first enable marks past no-shows without
  WhatsApp. Retry: A9 `attempts`/`status` (`gated` does not count).
- Migration: `supabase/arbox_missed_class_sync_log.sql` (run before deploy).

## Post-trial registered / not registered (C5 / C6)

Replaces legacy `trial_attended` (clean cut — no active rules in production at cutover).

- Source: `bookingsReport` trial attendance (`check_in="Yes"` + trial scope) **joined** with
  `salesReport` on the same daily cron (+1 sales GET when C5/C6 enabled).
- **Conversion:** `item_type` is `plan` **or** `session`, sale date `>= class_date`, and the
  product is **not** a trial membership (`item_type=trial`, trial membership type ids, or
  trial-like `item_name`). Session punch-cards count as registered (C5).
- C5 `registered_after_trial` / C6 `not_registered_after_trial` — automatic × leads,
  C5 UTILITY (registration confirmation, no CTA) / C6 MARKETING (`first_name`, `class_name`).
- **Decision delay:** `delay_days` after `class_date` (default 3, min 2). Send immediate once
  due; do not use delay as Meta enqueue offset.
- Dedup: `arbox_post_trial_followup_sync_log` PK `(business_id, user_id, class_date)` with
  `outcome` registered | not_registered — one message per attendance.
- Seed: `businesses.arbox_post_trial_followup_seeded` + soft-seed per outcome. A9 retry.
- Migration: `supabase/arbox_post_trial_followup_sync_log.sql` (run before deploy).

## Attendance gap (no future registration)

- Source: `bookingsReport`. Per `user_id`:
  - `last_yes` = max past `date` with **`check_in === "Yes"`** only (registration /
    `check_in="No"` does **not** count as attendance).
  - `gap_days` = Israel YMD `today − last_yes`.
  - `attendance_gap` when `gap_days >= tier` — **no** future-booking filter (former C1
    booked path removed: someone already booked is coming back; messaging is noise).
- **Window ceiling ~30 days:** past fetch is ≤30d (Arbox span cap). A member with no
  `check_in="Yes"` inside that window has no `last_yes` → skipped here. Gaps older than
  ~30d are **out of scope** for this trigger; they belong to a future lost / win-back
  trigger.
- Tiers: separate `template_triggers` rows; `delay_days` = absence tier (7/14/21). UI
  label **«ימי היעדרות»**. Send is **immediate on detection day** (not event+N).
- One past GET when a gap rule is live (shared with trial/missed). **No** future
  bookings GET for attendance gap — that GET is only for freeze ending C14/C15.
- Dedup: `arbox_attendance_gap_sync_log` PK
  `(business_id, user_id, variant, gap_start_date, tier)` where `gap_start_date = last_yes`
  and `variant` is always `'unbooked'` (column kept; booked path gone — no migration).
- Seed: `businesses.arbox_attendance_gap_seeded` — first enable marks current gaps without
  WhatsApp. Soft-seed for new tiers with zero sync_log rows. Retry: A9 `attempts`/`status`.
- Preset: **MARKETING**. Migration: `supabase/arbox_attendance_gap_sync_log.sql`
  (run before deploy).

## Freeze created / ending (A8 / C14 / C15)

- Source: `membersOnHoldReport` (paginated). Fields: `membership_hold_id`, `user_id`,
  `phone`, `start_suspend_time`, `end_suspend_time`, …
- **Cron:** `arbox-daily-triggers` only (not the 15‑minute trial-sync). A8 “immediate”
  = next daily run after the hold appears (confirmation is not urgent).
- A8 `freeze_created` — UTILITY confirmation for a new unseen `membership_hold_id`.
- C14 `freeze_ending_unbooked` / C15 `freeze_ending_booked` — `end_suspend_ymd > today`
  and due by `delay_days` **before** end; split by future booking
  (`today+1…today+14`). Cron prefetches that future GET when freeze ending
  **or** `trial_reminder` needs it — not when only `attendance_gap` is live.
  `trial_reminder` widens the shared window to `today…today+14`; freeze
  still skips `class_date <= today` in memory.
- **Past ends:** rows with `end_suspend_time` ≤ today are never sent for C14/C15
  (`skipped_ended`).
- Dedup:
  - `arbox_freeze_created_sync_log` PK `(business_id, membership_hold_id)` — separate
    table so A8 and C14/C15 never block each other.
  - `arbox_freeze_ending_sync_log` PK `(business_id, membership_hold_id, end_suspend_ymd)`
    with `variant` booked|unbooked as a **column only** — one ending message per hold
    end even if booking state flips.
- Seed: `businesses.arbox_freeze_seeded` + soft-seed when either table is empty after
  the flag is true. Seeds all current (future-ending) holds **without WhatsApp**.
  Retry: A9 `attempts`/`status`.
- Presets: A8 / C14 / C15 UTILITY (C14 is a dry end-date notice, no come-back CTA).
  Ending delay label «ימים לפני סיום ההקפאה».
- Migration: `supabase/arbox_freeze_sync_log.sql` (run before deploy).

## Lost lead win-back (A7)

- Source: `lostLeadsReport` (`fromDate`, `toDate`, `location_id`, `?page=N`).
  Fields: `lead_id`, `lost_date`, `lost_reason_name`, `created_at`, `source_name`,
  `phone`. **`lead_id` == `user_id`**. Phone: report `phone`, then
  `contacts.arbox_user_id = lead_id`. Missing phone → terminal `no_phone`.
- Cron: isolated try/catch on existing `arbox-daily-triggers` (not a new job).
  **IO:** 1 paginated GET per business per daily run when an enabled A7 rule
  with `template_name` exists. No per-lead Arbox calls.
- Catalog: automatic × leads, **`uniquePerBusiness: false`** (manual sequences:
  day 1 / 7 / 21 replace planned D3). Delay **after**, `minDelayDays: 1`, default
  1 day after `lost_date`, no product filter. UI label **«win-back לליד אבוד
  (ארבוקס)»** (Arbox Mark as Lost, not Zoe detection). Preset **MARKETING**
  (`first_name` only). Button QUICK_REPLY **«אשמח לפרטים»**.
- **Due-day send (not enqueue):** each enabled rule fires independently when
  `ymdDiffDays(today, lost_date) === delay_days`. Daily re-fetch is the
  stop-condition: if the lead left `lostLeadsReport` (came back / joined), later
  steps do not send.
- **Button → sales flow:** Meta QUICK_REPLY arrives as inbound text. The tap
  starts sales flow only because **«אשמח לפרטים»** is in
  `SALES_FLOW_START_TRIGGERS` (`lib/sales-flow-start-triggers.ts`) — same as
  `no_response` / `lost_lead`. **Do not tell APEX to change the
  button copy.** If a studio wants different wording, add that exact string to
  `SALES_FLOW_START_TRIGGERS` first; otherwise the tap will not restart the
  sales flow.
- Dedup: `arbox_lost_lead_sync_log` PK `(business_id, trigger_id, lead_id, lost_date)`
  where `lost_date` is **trimmed report text**. A new `lost_date` → new grain →
  re-entry can fire again. Each sequence step has its own `trigger_id`.
- Seed: `businesses.arbox_lost_lead_seeded` — first enable marks the 30-day
  window without WhatsApp. After seed, lookback = `min(30, max(3, max delay))`.
  Soft-seed per `trigger_id` (new rule later): empty log for that id marks the
  current 30-day cohort without send; empty cohort still gets a one-shot
  sentinel (`lead_id=0`, `lost_date=1970-01-01`). Retry: A9 `attempts`/`status`.
- No conflict with `arbox_new_lead` (trial-sync appearance vs daily loss).
- Migrations: `supabase/arbox_lost_lead_sync_log.sql` then
  `supabase/arbox_lost_lead_sync_log_trigger_id.sql` (run before deploy).

## Membership cancelled sequences (A9)

- Lost lead ≠ cancelled member: A7 is leads who never joined (`lostLeadsReport`);
  A9 is former customers (`canceledMembershipsReport`). Different copy.
- Catalog already `uniquePerBusiness: false`. Delay **after** (was `none`),
  `minDelayDays: 0` so day-of-cancel + day 7 / 21 can coexist (replaces planned D4).
  Delay 0 label **«ביום הביטול»**.
- Same due-day + per-`trigger_id` PK as A7:
  `(business_id, trigger_id, user_id, cancelled_time)`.
- **Send-time re-check:** cancel rows are historical (a rejoin does not drop the
  old row). Win-back steps (`delay_days > 0`) cross the A1 customer set
  (`fetchArboxCustomerUserIds`, activeMemberships ∪ sessions). If `user_id` is
  active again → skip send, mark sync_log `seeded` (`skipped_rejoined`). Day-of
  confirmation (`delay 0`) still sends. Lazy fetch: +2 GETs only when a
  delay>0 step is due today. A7 still stops when the lead leaves `lostLeadsReport`.
- Migration: `supabase/arbox_cancellation_sync_log_trigger_id.sql` (run before deploy).

## Days in the club (C8 `milestones`)

- Source: `activeMembershipsReport` rows with active status (`active` ∪
  `activeMemberWithFutureCancel`). Field **`member_since`** (YYYY-MM-DD), not
  `start_date`. Punch-card-only customers are not on this report → skipped.
- Cron: isolated try/catch on `arbox-daily-triggers` next to birthday.
  **IO:** reuses the `activeMembershipsReport` GET already pulled for birthday
  (keep rows with `member_since`, not just `Set<user_id>`). If birthday is off
  and C8 is on: +1 memberships GET, no `sessionsReport`.
- Catalog: automatic × members, **`uniquePerBusiness: false`** (30/90/365
  coexist). Delay **after**, `minDelayDays: 1`, default **90**. Label
  **«ימים במועדון»**. Delay label **«N ימים מההצטרפות»**. Preset **MARKETING**
  (`first_name` only, no button). Meta name `milestones`.
- **Due-day send (not enqueue):** `today === member_since + delay_days`. No
  catch-up.
- Dedup: `arbox_days_in_club_sync_log` PK
  `(business_id, trigger_id, user_id, member_since)`.
- Seed: `businesses.arbox_days_in_club_seeded` — first enable marks members
  already at/past X without WhatsApp. Members not yet at X wait. Soft-seed per
  `trigger_id` with an empty log (sentinel `user_id=0` /
  `member_since=1970-01-01` if nobody is past X). Retry: A9 `attempts`/`status`.
- Schema already exists in Supabase — **no new migration**.

## Nth workout for new customers (C7 `nth_workout`)

- Source: `activeMembershipsReport` (`member_since`) × past `bookingsReport`
  `check_in === "Yes"`. Count classes with `date >= member_since` and
  `date < today`. Workouts **before join do not count**. Punch-card-only
  (no `member_since`) skipped.
- Audience: new members — join within `lookback_days` (1–30, NULL = 30).
  Eligible only if `member_since >= bookings fetch fromDate` (avoid undercount).
- **N** lives in `delay_days` (default 3, min 1). **Window** lives in
  `template_triggers.lookback_days`. Fire when **`yesCount >= N`**, then log
  once (not strict `=== N` — catches a missed cron or two workouts in one day).
- Catalog: automatic × members, **`uniquePerBusiness: false`** (N=3 and N=10
  coexist). Label **«אימון מספר N (לקוח חדש)»**. Delay label **«אימון מספר N»**.
  Preset **MARKETING**, no button. Slots `first_name`, `workout_n` (`{{2}}` is
  dynamic N at send time — same Meta template for N=3 and N=10). Body uses
  **«לאחרונה»** (not «אתמול») because the trigger is count-based, not day-after.
- Dedup: `arbox_nth_workout_sync_log` PK `(business_id, trigger_id, user_id)` —
  **no `member_since`**. A returning member does not get C7 again.
- Seed: `businesses.arbox_nth_workout_seeded` — first enable marks new members
  already at/past N without WhatsApp. Soft-seed per empty `trigger_id`
  (sentinel `user_id=0`). Retry: A9 (`gated` does not count).
- Cron: isolated try/catch on `arbox-daily-triggers` **after** bookings
  prefetch. Reuses `activeMembershipsReport` (birthday/C8) + past
  `bookingsReport` (missed/gap/C5–C6). C7-only: +1 memberships +1 bookings (30d).
- Migration: `supabase/arbox_nth_workout_sync_log.sql` (run before deploy).

## Trial-class reminder (`trial_reminder`)

- Source: `bookingsReport` **future** window (`today … today+14` when this
  rule is live; freeze-ending still ignores `class_date <= today` in memory).
  Same paginated GET as C14/C15 — no extra GET when freeze ending already
  prefetches. No `salesReport` join. Rows have `membership_type_name` only
  (no `membership_type_id`).
- Filter: **same as C4** `bookingMatchesTrialScope` — owner's `product_filter`
  else `businesses.arbox_trial_membership_type_ids` → `/v3/membershipTypes`
  name set. **No `name_fallback` heuristic.** If neither ids nor resolved
  names exist: `skip_reason: "no_trial_scope"`, no WhatsApp (Limitless trials
  are named «אימוני היכרות» / catalog `type=session`, not `trial`). UI
  `showProductFilter: true` + hint that trial products must be set.
- Timing: `delay_direction: before`, day-grain
  `class_date === today + delay_days`. `0` = morning of class; `1` = day
  before. Default delay 1. Send **immediate** on the daily cron of the due
  day (not Meta enqueue offset). Missed cron day = missed reminder (no
  catch-up).
- Audience: leads. Catalog `uniquePerBusiness: true`, `uniqueCreateMode: "warn"`.
- Preset **UTILITY** (reminder, no offer/CTA). Slots: `first_name`,
  `class_name`, `class_time`. Generic body — owner adds arrival/parking
  links before Meta submit.
- Dedup: `arbox_trial_reminder_sync_log` PK
  `(business_id, user_id, class_date, class_time, class_name)` — no
  `booking_id`. A9 retry (`gated` does not increment).
- Seed: `businesses.arbox_trial_reminder_seeded` — first enable marks
  **all upcoming trial bookings in the fetch window** without WhatsApp
  (forward-looking exception, like freeze ending). Soft-seed if flag true +
  empty log; empty cohort still gets sentinel (`user_id=0`,
  `class_date=1970-01-01`).
- Cron: isolated try/catch on `arbox-daily-triggers`. Prefetch skipped when
  the rule is live but no trial product ids are configured.
- Migration: `supabase/arbox_trial_reminder_sync_log.sql` (run before deploy).

## IO (10 businesses)

State the GETs per run: typically **one report GET per business** (plus pages)
on the shared cron, not a new job. Extra `/v3/membershipTypes` only when
filtering. New-lead customer reports (memberships + sessions) only when an
unseen non-Zoe lead remains. Birthday always adds those two customer reports
when a birthday / birthday_former rule is enabled. **C8 `milestones`** reuses
the same `activeMembershipsReport` GET (rows kept); C8-only skips
`sessionsReport`. **C7 `nth_workout`** reuses that memberships GET plus the
shared past `bookingsReport` (force 30d when C7 is live); C7-only:
+1 memberships +1 bookings (30d). **C5/C6 add one salesReport
GET** per business when enabled (+ pages). WhatsApp/Meta cost = new matching
events after seed, not the seed window. **Freeze A8/C14/C15:** +1
`membersOnHoldReport` GET when any freeze rule is live; future bookings GET only
when freeze ending needs it (not when only attendance_gap is live). **A7
lost_lead:** +1 `lostLeadsReport` GET when an enabled A7 rule is live.
**trial_reminder:** 0 extra bookingsReport GETs when freeze ending already
fetches the shared future window; +1 GET when only this rule is live (and
trial product ids are set). +1 `/v3/membershipTypes` when trial ids need
name resolution (same as C4).
