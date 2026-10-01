import assert from "node:assert/strict";
import type { arboxPublicFetch } from "@/lib/crm/adapters/arbox";
import {
  addDaysYmd,
  arboxClassMatchKey,
  catalogFromBoxCategoryRows,
  resolveArboxClassDescriptionFromCatalog,
  fetchPaginatedArboxList,
  findWeeklyClassForStamp,
  hebrewDayLetterFromYmd,
  indexWeeklyClassesByMatchKey,
  arboxClassAlreadyInServices,
  mergeServiceDescriptionPatch,
  normalizeHhmm,
  normalizeTimetableToWeeklyClasses,
  parseArboxClassStamp,
  parseServiceDescriptionObject,
  sanitizeArboxClassDescription,
  shouldFillProductDescriptionFromArbox,
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
  const slots = weeklySlotsFromOccurrences([
    { date: "2026-08-26", start_time: "19:30" }, // Wednesday
    { date: "2026-08-23", start_time: "18:00" }, // Sunday evening
    { date: "2026-08-24", start_time: "07:00" }, // Monday morning
    { date: "2026-08-23", start_time: "09:00" }, // Sunday morning
    { date: "2026-08-25", start_time: "12:15" }, // Tuesday
  ]);
  assert.deepEqual(slots, [
    { day: "א", time: "09:00" },
    { day: "א", time: "18:00" },
    { day: "ב", time: "07:00" },
    { day: "ג", time: "12:15" },
    { day: "ד", time: "19:30" },
  ]);
}

{
  const catalog = catalogFromBoxCategoryRows([
    {
      box_category_id: 53273,
      name: "Handstand (Beginner)",
      description: "<p>Foundational drills.<br>Build strength.</p>",
    },
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
  assert.equal(hs?.description, "Foundational drills.\nBuild strength.");
  assert.equal(classes.some((c) => c.session_name === "Open Jam"), false);
}

{
  // acrobyjoe-style placeholder: is_transparent=0, but the name itself marks it cancelled.
  const catalog = catalogFromBoxCategoryRows([{ box_category_id: 1, name: "Class Cancelled" }]);
  const { classes } = normalizeTimetableToWeeklyClasses(
    [
      { session_name: "Class Cancelled", date: "2026-08-23", start_time: "18:00", is_transparent: 0 },
      { session_name: "Class Cancelled", date: "2026-08-24", start_time: "18:00", is_transparent: 0 },
      { session_name: "class cancelled", date: "2026-08-25", start_time: "18:00", is_transparent: 0 },
      { session_name: " Class Cancelled ", date: "2026-08-26", start_time: "18:00", is_transparent: 0 },
      { session_name: "Class Cancelled Today", date: "2026-08-27", start_time: "18:00", is_transparent: 0 },
    ],
    catalog
  );
  assert.equal(
    classes.some((c) => c.session_name.toLowerCase() === "class cancelled"),
    false,
    "literal placeholder name (any case/whitespace) must never become a product"
  );
  assert.equal(
    classes.some((c) => c.session_name === "Class Cancelled Today"),
    true,
    "only an exact literal match is filtered — a real class whose name happens to contain the phrase is not"
  );
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
    { session_name: "Ghost Class", box_category_id: 999, slots: [{ day: "א", time: "10:00" }], description: "" },
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

assert.equal(
  sanitizeArboxClassDescription("<p>Foundational drills.<br>Build strength.</p>"),
  "Foundational drills.\nBuild strength."
);
assert.equal(sanitizeArboxClassDescription("   "), "");

{
  const catalog = catalogFromBoxCategoryRows([
    {
      box_category_id: 90177,
      name: "PEAK 360",
      description: "<p>הצטרפו לשיעור PEAK 360, מפגש קבוצתי.</p>",
    },
    {
      box_category_id: 87462,
      name: "פילאטיס מזרן",
      description: "חיזוק ליבה על מזרן.",
    },
  ]);
  assert.equal(
    resolveArboxClassDescriptionFromCatalog(catalog, {
      arbox_box_category_id: 90177,
      arbox_class_name: "PEAK 360",
      product_name: "אימון פונקציונלי",
    }),
    "הצטרפו לשיעור PEAK 360, מפגש קבוצתי."
  );
  assert.equal(
    resolveArboxClassDescriptionFromCatalog(catalog, {
      arbox_box_category_id: null,
      arbox_class_name: "פילאטיס מזרן",
    }),
    "חיזוק ליבה על מזרן."
  );
  assert.equal(
    resolveArboxClassDescriptionFromCatalog(catalog, {
      product_name: "פילאטיס מזרן",
    }),
    "חיזוק ליבה על מזרן."
  );
  assert.equal(
    resolveArboxClassDescriptionFromCatalog(catalog, {
      product_name: "אימון פונקציונלי",
    }),
    ""
  );
}

{
  const kept = JSON.stringify({
    description_text: "טקסט שנשמר",
    schedule_slots: [{ day: "א", time: "07:30" }],
    arbox_box_category_id: 103880,
    arbox_class_name: "BODY PUMP",
  });
  assert.equal(
    arboxClassAlreadyInServices([{ description: kept }], {
      box_category_id: 103880,
      session_name: "BODY PUMP",
    }),
    true
  );
  const namedOnly = JSON.stringify({
    description_text: "טקסט שנשמר",
    arbox_class_name: "BODY PUMP",
  });
  assert.equal(
    arboxClassAlreadyInServices([{ description: namedOnly }], {
      box_category_id: 103880,
      session_name: "BODY PUMP",
    }),
    true
  );
  assert.equal(
    arboxClassAlreadyInServices([{ description: kept }], {
      box_category_id: 136407,
      session_name: "פונקציונאלי בייבי",
    }),
    false
  );
}

{
  const existing = JSON.stringify({ description_text: "keep me" });
  assert.equal(shouldFillProductDescriptionFromArbox(existing, "new from arbox"), false);
  assert.equal(shouldFillProductDescriptionFromArbox("{}", "new from arbox"), true);
  assert.equal(shouldFillProductDescriptionFromArbox("", "new from arbox"), true);
  assert.equal(shouldFillProductDescriptionFromArbox("", ""), false);
}

const POISON_NEXT = "http://arboxserver.arboxapp.com/api/public/v3/schedule?page=2";
const FIRST_PATH = "/v3/schedule?from_date=2026-10-01&to_date=2026-10-07&location_id=3068";

function fakePage(input: {
  rows: Record<string, unknown>[];
  next?: string | null;
  ok?: boolean;
  status?: number;
}): Awaited<ReturnType<typeof arboxPublicFetch>> {
  const ok = input.ok !== false;
  return {
    ok,
    status: input.status ?? (ok ? 200 : 500),
    json: ok
      ? { data: input.rows, extra: { pagination: { next_page_url: input.next ?? null } } }
      : null,
    rawText: ok ? "" : "nope",
  };
}

function assertBuiltPage(actual: string, page: number): void {
  assert.equal(actual.startsWith("http"), false);
  assert.equal(actual.includes(POISON_NEXT), false);
  const qIndex = actual.indexOf("?");
  assert.equal(qIndex === -1 ? actual : actual.slice(0, qIndex), "/v3/schedule");
  const qs = new URLSearchParams(qIndex === -1 ? "" : actual.slice(qIndex + 1));
  assert.equal(qs.get("from_date"), "2026-10-01");
  assert.equal(qs.get("to_date"), "2026-10-07");
  assert.equal(qs.get("location_id"), "3068");
  assert.equal(qs.get("limit"), "500");
  if (page <= 1) assert.equal(qs.get("page"), null);
  else assert.equal(qs.get("page"), String(page));
}

async function runPaginationTests(): Promise<void> {
  {
    const requested: string[] = [];
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: FIRST_PATH,
      fetchPage: (async (path) => {
        requested.push(path);
        return fakePage({ rows: [{ schedule_id: 1 }, { schedule_id: 2 }], next: null });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows.length, 2);
    assert.equal(requested.length, 1);
    assertBuiltPage(requested[0]!, 1);
  }

  {
    const requested: string[] = [];
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: FIRST_PATH,
      fetchPage: (async (path) => {
        requested.push(path);
        const page = requested.length;
        const rows =
          page === 1
            ? [{ schedule_id: 1 }]
            : page === 2
              ? [{ schedule_id: 2 }]
              : [{ schedule_id: 3 }];
        return fakePage({
          rows,
          next: page < 3 ? POISON_NEXT : null,
        });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.rows.map((row) => row.schedule_id),
        [1, 2, 3]
      );
    }
    assert.equal(requested.length, 3);
    requested.forEach((url, i) => assertBuiltPage(url, i + 1));
    assert.equal(requested.some((url) => url === POISON_NEXT), false);
  }

  {
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: FIRST_PATH,
      fetchPage: (async (path) => {
        const page = new URLSearchParams(path.split("?")[1] ?? "").get("page");
        if (!page) {
          return fakePage({
            rows: [{ schedule_id: 1 }, { schedule_id: 2 }],
            next: POISON_NEXT,
          });
        }
        return fakePage({
          rows: [{ schedule_id: 2 }, { schedule_id: 3 }],
          next: null,
        });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.rows.map((row) => row.schedule_id),
        [1, 2, 3]
      );
    }
  }

  {
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: "/v3/schedule/boxCategories",
      fetchPage: (async (path) => {
        const page = new URLSearchParams(path.split("?")[1] ?? "").get("page");
        if (!page) {
          return fakePage({
            rows: [{ box_category_id: 9 }],
            next: "http://arboxserver.arboxapp.com/api/public/v3/schedule/boxCategories?page=2",
          });
        }
        return fakePage({
          rows: [{ box_category_id: 9 }, { box_category_id: 10 }],
          next: null,
        });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.rows.map((row) => row.box_category_id),
        [9, 10]
      );
    }
  }

  {
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      const empty = await fetchPaginatedArboxList({
        apiKey: "k",
        firstPath: FIRST_PATH,
        fetchPage: (async (path) => {
          const page = new URLSearchParams(path.split("?")[1] ?? "").get("page");
          if (!page) return fakePage({ rows: [{ schedule_id: 1 }], next: POISON_NEXT });
          return fakePage({ rows: [], next: POISON_NEXT });
        }) as typeof arboxPublicFetch,
      });
      assert.equal(empty.ok, false);
      if (!empty.ok) assert.equal(empty.body, "pagination_no_progress");

      const dupes = await fetchPaginatedArboxList({
        apiKey: "k",
        firstPath: FIRST_PATH,
        fetchPage: (async (path) => {
          const page = new URLSearchParams(path.split("?")[1] ?? "").get("page");
          return fakePage({
            rows: [{ schedule_id: 1 }],
            next: page ? POISON_NEXT : POISON_NEXT,
          });
        }) as typeof arboxPublicFetch,
      });
      assert.equal(dupes.ok, false);
      if (!dupes.ok) assert.equal(dupes.body, "pagination_no_progress");
      assert.equal(
        warns.filter((w) => w[0] === "[arbox-pagination] no progress").length,
        2
      );
      const logged = JSON.stringify(warns);
      assert.equal(logged.includes("api-key"), false);
      assert.equal(logged.includes(POISON_NEXT), false);
    } finally {
      console.warn = originalWarn;
    }
  }

  {
    const requested: string[] = [];
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: FIRST_PATH,
      fetchPage: (async (path) => {
        requested.push(path);
        if (requested.length === 1) {
          return fakePage({ rows: [{ schedule_id: 1 }], next: POISON_NEXT });
        }
        return fakePage({ rows: [], ok: false, status: 400 });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 400);
    assert.equal(requested.length, 2);
    assertBuiltPage(requested[1]!, 2);
  }

  {
    const warns: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args);
    };
    try {
      let calls = 0;
      const result = await fetchPaginatedArboxList({
        apiKey: "k",
        firstPath: FIRST_PATH,
        fetchPage: (async (path) => {
          calls += 1;
          assert.equal(path === POISON_NEXT, false);
          assertBuiltPage(path, calls);
          return fakePage({
            rows: [{ schedule_id: calls }],
            next: POISON_NEXT,
          });
        }) as typeof arboxPublicFetch,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.body, "pagination_cap");
      assert.equal(calls, 20);
      assert.equal(warns.some((w) => w[0] === "[arbox-pagination] cap reached"), true);
    } finally {
      console.warn = originalWarn;
    }
  }

  {
    let calls = 0;
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: FIRST_PATH,
      fetchPage: (async () => {
        calls += 1;
        return fakePage({
          rows: [{ schedule_id: calls }],
          next: calls >= 20 ? null : POISON_NEXT,
        });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.rows.length, 20);
    assert.equal(calls, 20);
  }
}

runPaginationTests()
  .then(() => {
    console.log("arbox-schedule-sync.test.ts: ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
