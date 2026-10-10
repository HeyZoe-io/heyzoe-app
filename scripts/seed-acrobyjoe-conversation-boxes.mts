/**
 * בונה ל-AcroByJoe את תיבות דף «שיחה» מתוך מה שג׳ו כבר הזין בסקריפט המכירה ובטאב מוצרים.
 * ברגע שיש תיבות, הוואטסאפ של העסק רץ מהן. לכן מריצים רק אחרי שהקוד של המנוע עלה לפרודקשן.
 *
 * בדיקה בלבד:  npx tsx --env-file=.env.local scripts/seed-acrobyjoe-conversation-boxes.mts
 * כתיבה:       npx tsx --env-file=.env.local scripts/seed-acrobyjoe-conversation-boxes.mts --write
 *
 * לא דורס: נעצר אם כבר יש לעסק תיבות. ההגדרות הישנות ב-social_links נשארות כמו שהן.
 * פולואפים נשארים בדף הפולואפ הרגיל.
 */
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { serviceMetaFromDescription } from "@/lib/product-schedule-slots";
import { SCHEDULE_BOARD_CAPTION } from "@/lib/sales-flow";

const SLUG = "acrobyjoe";
const WRITE = process.argv.includes("--write");
const FREE_TEXT_HINT = "ניתן לכתוב שאלה שאינה מופיעה";

const SHORT_BUTTON: Record<string, string> = {
  "עמידות ידיים / גמישות": "עמידות ידיים/גמישות",
  "שיעור אקרו אישי (1 - 1)": "שיעור אישי 1-1",
  "קורס אקרויוגה אונליין": "קורס אונליין",
  "סדנאות ואירועים מיוחדים": "סדנאות ואירועים",
};

type NodeRow = {
  id: string;
  type: "message" | "question" | "product" | "daytime";
  data: Record<string, unknown>;
  position_x: number;
  position_y: number;
};
type EdgeRow = { source_node_id: string; target_node_id: string; source_handle: string };

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function toBoxPlaceholders(text: string): string {
  return text
    .replaceAll("{price}", "{מחיר}")
    .replaceAll("{duration}", "{משך}")
    .replaceAll("{sessions}", "{מפגשים}")
    .replaceAll("{serviceName}", "{מוצר}");
}

function withHint(text: string): string {
  return `${text.trim()}\n\n${FREE_TEXT_HINT}`;
}

async function main(): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: biz, error: bizErr } = await admin
    .from("businesses")
    .select("id, name, bot_name, social_links")
    .eq("slug", SLUG)
    .maybeSingle();
  if (bizErr || !biz) throw new Error(bizErr?.message ?? "business not found");
  const businessId = Number((biz as { id: number }).id);
  const social = ((biz as { social_links?: Record<string, unknown> }).social_links ?? {}) as Record<string, unknown>;
  const sf = (social.sales_flow ?? {}) as Record<string, unknown>;

  const existing = await admin.from("business_conversation_nodes").select("id").eq("business_id", businessId).limit(1);
  if (existing.error) throw new Error(existing.error.message);
  if ((existing.data ?? []).length) throw new Error("business already has conversation boxes; not overwriting");

  const servicesRes = await admin.from("services").select("service_slug, name, description").eq("business_id", businessId);
  if (servicesRes.error) throw new Error(servicesRes.error.message);
  const services = (servicesRes.data ?? [])
    .map((row) => {
      const r = row as { service_slug?: unknown; name?: unknown; description?: unknown };
      const meta = serviceMetaFromDescription(r.description);
      return {
        slug: str(r.service_slug),
        name: str(r.name),
        kind: str(meta.offer_kind) || "trial",
        price: str(meta.price_text),
        hasSlots: Array.isArray(meta.schedule_slots) && meta.schedule_slots.length > 0,
        order: Number(meta.sort_order ?? 99),
      };
    })
    .filter((s) => s.slug && s.name)
    .sort((a, b) => a.order - b.order);
  if (!services.length) throw new Error("no products");

  const nodes: NodeRow[] = [];
  const edges: EdgeRow[] = [];
  const add = (type: NodeRow["type"], data: Record<string, unknown>, x: number, y: number): string => {
    const id = randomUUID();
    nodes.push({ id, type, data, position_x: x, position_y: y });
    return id;
  };
  const link = (source: string, target: string, handle = "out") =>
    edges.push({ source_node_id: source, target_node_id: target, source_handle: handle });

  const ctaButtons = (Array.isArray(sf.cta_buttons) ? sf.cta_buttons : []) as Array<Record<string, unknown>>;
  const scheduleBtn = ctaButtons.find((b) => b.kind === "schedule");
  const scheduleImage = str(scheduleBtn?.schedule_cta_image_url);
  const media = (url: string, kind: string) =>
    url.startsWith("https://") ? { media_url: url, media_kind: kind === "video" ? "video" : "image" } : {};

  const start = add(
    "message",
    {
      text: str(sf.greeting_body_override) || str(social.welcome_intro),
      is_start: true,
      ...media(str(social.opening_media_url), str(social.opening_media_type)),
    },
    1800,
    300
  );
  const board = add(
    "message",
    { text: str(sf.schedule_board_caption) || SCHEDULE_BOARD_CAPTION, ...media(scheduleImage, "image") },
    1600,
    300
  );
  link(start, board);
  const pick = add(
    "question",
    {
      text: withHint(str(sf.multi_service_question) || str(social.welcome_question)),
      buttons: services.map((s) => SHORT_BUTTON[s.name] ?? s.name),
    },
    1400,
    300
  );
  link(board, pick);

  const slotAck = add("message", { text: str(sf.after_schedule_selection) || "מעולה! נדאג לשבץ אותך לזמן שבחרת!" }, 800, 150);

  const trialCta = add(
    "question",
    {
      text: withHint(toBoxPlaceholders(str(sf.cta_body_after_schedule) || str(sf.cta_body))),
      buttons: ctaButtons.map((b) => str(b.label)).filter(Boolean),
    },
    600,
    200
  );
  link(slotAck, trialCta);

  const trialLink = add(
    "message",
    {
      text:
        "איזו החלטה מדהימה 🙂 נרשמים ממש כאן:\n{קישור}\n\nלאחר ההרשמה אשלח הוראות המשך 🎉\nלוקח לי עד 15 דקות לזהות הרשמה. אפשר בינתיים להמתין בהתרגשות!",
    },
    400,
    0
  );
  const scheduleMsg = add("message", { text: SCHEDULE_BOARD_CAPTION, ...media(scheduleImage, "image") }, 400, 200);
  const membershipsUrl = str(social.memberships_url);
  const membershipsMsg = add(
    "message",
    {
      text: membershipsUrl
        ? `כאן אפשר לראות את כל המנויים והמחירים שלנו:\n${membershipsUrl}`
        : "אשמח לספר על המנויים שלנו. מה חשוב לך לדעת?",
    },
    400,
    380
  );
  const targetsByKind: Record<string, string> = { trial: trialLink, schedule: scheduleMsg, memberships: membershipsMsg };
  ctaButtons.forEach((b, i) => {
    const target = targetsByKind[str(b.kind)];
    if (target) link(trialCta, target, `btn-${i}`);
  });

  const nextOptions = (Array.isArray(sf.followup_after_next_class_options) ? sf.followup_after_next_class_options : []).map(str);
  const nextAsk = add(
    "question",
    {
      text: withHint(str(sf.followup_after_next_class_body) || "שנשריין לך את האימון? 🙂"),
      buttons: nextOptions.length ? nextOptions : ctaButtons.map((b) => str(b.label)),
    },
    200,
    250
  );
  link(scheduleMsg, nextAsk);
  link(membershipsMsg, nextAsk);
  (nextOptions.length ? nextOptions : ctaButtons.map((b) => str(b.label))).forEach((label, i) => {
    const kind = str(ctaButtons.find((b) => str(b.label) === label)?.kind);
    const target = targetsByKind[kind] ?? [trialLink, scheduleMsg, membershipsMsg][i];
    if (target) link(nextAsk, target, `btn-${i}`);
  });

  let courseCta = "";
  const courseButtons = (Array.isArray(sf.cta_course_buttons) ? sf.cta_course_buttons : []) as Array<Record<string, unknown>>;
  const csPhone = str(social.customer_service_phone);
  const ensureCourseCta = (price: string): string => {
    if (courseCta) return courseCta;
    let body = str(sf.cta_course_online_body) || str(sf.cta_course_body);
    if (!price || price === "0") body = body.replace(/\s*המחיר הוא \{price\} שקלים,\s*/, " ");
    courseCta = add(
      "question",
      { text: withHint(toBoxPlaceholders(body)), buttons: courseButtons.map((b) => str(b.label)).filter(Boolean) },
      600,
      650
    );
    courseButtons.forEach((b, i) => {
      const target =
        b.kind === "course_enroll"
          ? add("message", { text: "מעולה! נרשמים כאן:\n{קישור}" }, 400, 600)
          : add("message", { text: csPhone ? `מוזמנים ליצור קשר:\n${csPhone}` : "כתבו לנו כאן ונחזור אליכם בהקדם." }, 400, 760);
      link(courseCta, target, `btn-${i}`);
    });
    return courseCta;
  };

  services.forEach((service, i) => {
    const y = i * 150;
    const product = add("product", { text: "", product_slug: service.slug }, 1200, y);
    link(pick, product, `btn-${i}`);
    const day = add("daytime", { day_text: "", day_buttons: ["", ""], time_text: "", time_buttons: ["", ""] }, 1000, y);
    link(product, day);
    if (service.kind === "course") {
      link(day, ensureCourseCta(service.price));
    } else if (service.kind !== "workshop") {
      link(day, service.hasSlots ? slotAck : trialCta);
    }
  });

  console.log(`business ${businessId}: ${nodes.length} boxes, ${edges.length} arrows`);
  for (const n of nodes) {
    const text = str(n.data.text).replace(/\s+/g, " ").slice(0, 70);
    const buttons = Array.isArray(n.data.buttons) ? ` [${(n.data.buttons as string[]).join(" | ")}]` : "";
    console.log(`- ${n.type}${n.data.is_start ? " (start)" : ""}: ${text}${buttons}${n.data.media_kind ? ` +${n.data.media_kind}` : ""}`);
  }
  if (!WRITE) {
    console.log("dry run only. add --write to save.");
    return;
  }

  const insNodes = await admin.from("business_conversation_nodes").insert(nodes.map((n) => ({ ...n, business_id: businessId })));
  if (insNodes.error) throw new Error(`nodes insert failed: ${insNodes.error.message}`);
  const insEdges = await admin.from("business_conversation_edges").insert(edges.map((e) => ({ ...e, business_id: businessId })));
  if (insEdges.error) {
    await admin.from("business_conversation_nodes").delete().eq("business_id", businessId);
    throw new Error(`edges insert failed, boxes removed: ${insEdges.error.message}`);
  }
  console.log("saved.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exit(1);
});
