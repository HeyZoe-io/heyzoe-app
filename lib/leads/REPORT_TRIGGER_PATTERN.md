# Report-backed Arbox trigger pattern

Use this when adding a new daily/frequent trigger that reads an Arbox report
(the `membership_cancelled` / A9 shape). Do **not** copy one-off quirks from
older triggers unless this file says so.

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

## Seed vs forward-looking

- **Historical reports** (cancellations, FAIL charges, leads): first run with an
  enabled rule upserts the window into sync_log, sets the seed flag, **returns
  without WhatsApp**. After seed, use a short lookback (typically today +
  yesterday) so late rows still appear; PK dedup prevents resend.
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

- Empty `product_filter` = all types.
- Reports that lack `membership_type_id` match by `membership_type_name`
  resolved via `GET /v3/membershipTypes` (one extra GET per business per run,
  only when a filter is set).

## Meta template category (all presets)

Not A9-specific. Apply when writing **any** new trigger preset:

| Intent | Category |
|---|---|
| מבצע / הטבה / עידוד הרשמה / עידוד תשלום / הזמנה לחזור | **MARKETING** |
| הודעת עדכון או אישור נטו, בלי שיווק | **UTILITY** |

Calibration:

- חידוש מנוי + יום הולדת עם הטבה → **MARKETING**
- אישור רכישה + הקפאה + ביטול מנוי → **UTILITY**

Win-back copy (“נשמח לראותך שוב”) is encouragement to return → MARKETING.
A dry system confirmation must stay UTILITY so Meta approval is reliable.

Existing presets may predate this rule; **new** presets must follow it.

## IO (10 businesses)

State the GETs per run: typically **one report GET per business** (plus pages)
on the shared cron, not a new job. Extra `/v3/membershipTypes` only when
filtering. New-lead customer reports (memberships + sessions) only when an
unseen non-Zoe lead remains. WhatsApp/Meta cost = new matching events after
seed, not the seed window.
