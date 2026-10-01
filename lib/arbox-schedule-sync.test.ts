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
  isAllowedArboxNextPageUrl,
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

assert.equal(
  isAllowedArboxNextPageUrl("https://arboxserver.arboxapp.com/api/public/v3/schedule?page=2"),
  true
);
assert.equal(
  isAllowedArboxNextPageUrl("http://arboxserver.arboxapp.com/api/public/v3/schedule?page=2"),
  true
);
assert.equal(isAllowedArboxNextPageUrl("/v3/schedule?page=2"), true);

async function runPaginationTests(): Promise<void> {
{
  const requested: string[] = [];
  const result = await fetchPaginatedArboxList({
    apiKey: "k",
    firstPath: "/v3/schedule?from_date=2026-10-01",
    fetchPage: (async (path) => {
      requested.push(path);
      if (requested.length === 1) return fakePage({ id: 1, next: "/v3/schedule?page=2" });
      return fakePage({ id: 2, next: null });
    }) as typeof arboxPublicFetch,
  });
  assert.equal(result.ok, true);
  assert.equal(requested[1], "/v3/schedule?page=2");
}
assert.equal(isAllowedArboxNextPageUrl("/api/public/v2/schedule?page=2"), false);
assert.equal(
  isAllowedArboxNextPageUrl("https://evil.example/api/public/v3/schedule?page=2"),
  false
);
assert.equal(isAllowedArboxNextPageUrl("not a url"), false);
assert.equal(isAllowedArboxNextPageUrl(""), false);

function fakePage(input: {
  id: number;
  next?: string | null;
}): Awaited<ReturnType<typeof arboxPublicFetch>> {
  return {
    ok: true,
    status: 200,
    json: {
      data: [{ id: input.id }],
      extra: { pagination: { next_page_url: input.next ?? null } },
    },
    rawText: "",
  };
}

{
  const requested: string[] = [];
  const result = await fetchPaginatedArboxList({
    apiKey: "k",
    firstPath: "/v3/schedule?from_date=2026-10-01&to_date=2026-10-07",
    fetchPage: (async (path) => {
      requested.push(path);
      if (requested.length === 1) {
        return fakePage({
          id: 1,
          next: "https://arboxserver.arboxapp.com/api/public/v3/schedule?page=2",
        });
      }
      return fakePage({ id: 2, next: null });
    }) as typeof arboxPublicFetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rows.length, 2);
  assert.deepEqual(requested, [
    "/v3/schedule?from_date=2026-10-01&to_date=2026-10-07",
    "https://arboxserver.arboxapp.com/api/public/v3/schedule?page=2",
  ]);
}

{
  const requested: string[] = [];
  const warns: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args);
  };
  try {
    const result = await fetchPaginatedArboxList({
      apiKey: "k",
      firstPath: "/v3/schedule?from_date=2026-10-01",
      fetchPage: (async (path) => {
        requested.push(path);
        return fakePage({
          id: 1,
          next: "https://evil.example/api/public/v2/schedule?api-key=secret&page=2",
        });
      }) as typeof arboxPublicFetch,
    });
    assert.equal(result.ok, false);
    assert.equal(requested.length, 1);
    assert.equal(warns.length, 1);
    assert.equal(warns[0]?.[0], "[arbox-pagination] rejected next_page_url");
    const logged = JSON.stringify(warns[0]);
    assert.equal(logged.includes("secret"), false);
    assert.equal(logged.includes("api-key"), false);
    assert.equal(logged.includes("evil.example"), true);
    assert.equal(logged.includes("/api/public/v2/schedule"), true);
  } finally {
    console.warn = originalWarn;
  }
}

{
  const requested: string[] = [];
  const result = await fetchPaginatedArboxList({
    apiKey: "k",
    firstPath: "/v3/schedule?from_date=2026-10-01",
    fetchPage: (async (path) => {
      requested.push(path);
      if (requested.length === 1) {
        return fakePage({
          id: 1,
          next: "http://arboxserver.arboxapp.com/api/public/v3/schedule?page=2",
        });
      }
      return fakePage({ id: 2, next: null });
    }) as typeof arboxPublicFetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.rows.length, 2);
  assert.equal(requested[1], "http://arboxserver.arboxapp.com/api/public/v3/schedule?page=2");
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
      firstPath: "/v3/schedule?from_date=2026-10-01",
      fetchPage: (async () => {
        calls += 1;
        return fakePage({
          id: calls,
          next: `https://arboxserver.arboxapp.com/api/public/v3/schedule?page=${calls + 1}`,
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
    firstPath: "/v3/schedule?from_date=2026-10-01",
    fetchPage: (async () => {
      calls += 1;
      return fakePage({
        id: calls,
        next: calls >= 20 ? null : `https://arboxserver.arboxapp.com/api/public/v3/schedule?page=${calls + 1}`,
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
