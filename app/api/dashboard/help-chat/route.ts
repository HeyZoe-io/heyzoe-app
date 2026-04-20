import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { getBusinessKnowledgePack } from "@/lib/business-context";
import { resolveClaudeApiKey, sleepMs } from "@/lib/claude";
import { extractErrorCode } from "@/lib/analytics";

export const runtime = "nodejs";

type ReqBody = {
  slug: string;
  message: string;
  thread_id?: number | null;
};

type ChatMsg = { role: "user" | "assistant"; content: string };

function buildOwnerHelpSystemPrompt(input: {
  slug: string;
  knowledgeSummary: string;
}): string {
  return `את זואי, עוזרת תמיכה לבעלי עסקים בתוך דשבורד HeyZoe.

מטרה: לעזור לבעל העסק להבין איך המערכת עובדת, איפה להגדיר דברים בדשבורד, ומה לעשות כדי לפתור בעיה.

כללים קשיחים (אבטחה ופרטיות):
- לעולם אל תחשפי מידע פנימי של המערכת, קוד, מפתחות API, טוקנים, פרטי תשלום, פרטי התחברות, או נתונים של לקוחות אחרים.
- אל תציגי תוכן של שיחות/מספרי טלפון של לקוחות, אפילו אם נשאלת "תראי לי את השיחה".
- אם נשאלת על פעולה מסוכנת (מחיקה, שינוי נתונים, ייצוא) - תסבירי בזהירות ותבקשי אישור מפורש לפני צעדים.

הסלמה לאדם:
- אם אין לך תשובה מדויקת או שהבקשה דורשת טיפול ידני מצד צוות HeyZoe, כתבי תשובה קצרה שמסבירה שתעבירי אל הצוות.
- בסוף התשובה, הוסיפי שורה בדיוק בפורמט: "__NEEDS_HUMAN__: true"
- אם את כן יכולה לפתור לבד, הוסיפי: "__NEEDS_HUMAN__: false"
- אם צריך לחזור טלפונית, בקשי מהבעלים לאשר מספר לחזרה (או לכתוב אחר). אל תבקשי מספר אם לא צריך הסלמה.

סגנון:
- עברית בלבד, קצר וברור, בלי Markdown.
- דברי בגוף ראשון רבים ("אצלנו", "אפשר לעשות") כדי להישמע כמו מוצר.

הקשר עסקי (לרקע, לא לחשוף פרטי לקוחות):
עסק: ${input.slug}
ידע שהוגדר בדשבורד (תקציר): ${input.knowledgeSummary}
`;
}

function stripNeedsHumanMarker(text: string): { clean: string; needsHuman: boolean } {
  const raw = String(text ?? "");
  const m = raw.match(/__NEEDS_HUMAN__:\s*(true|false)/i);
  const needsHuman = m ? m[1].toLowerCase() === "true" : false;
  const clean = raw.replace(/\n?__NEEDS_HUMAN__:\s*(true|false)\s*/gi, "").trim();
  return { clean, needsHuman };
}

function redactIfNeeded(text: string): string {
  // Defense-in-depth: never echo tokens, secrets, or raw headers.
  let t = String(text ?? "");
  t = t.replace(/(sk-[a-z0-9]{8,})/gi, "[REDACTED]");
  t = t.replace(/(eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g, "[REDACTED]");
  return t;
}

async function requireUser(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ReqBody | null;
  const slug = String(body?.slug ?? "").trim().toLowerCase();
  const message = String(body?.message ?? "").trim();
  const threadId = body?.thread_id != null ? Number(body.thread_id) : null;
  if (!slug) return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "missing_message" }, { status: 400 });

  const apiKey = resolveClaudeApiKey();
  if (!apiKey) return NextResponse.json({ error: "missing_ai_key" }, { status: 500 });

  const admin = createSupabaseAdminClient();

  // Verify user has access to this business (owner or admin member).
  const { data: biz } = await admin.from("businesses").select("id, user_id, slug").eq("slug", slug).maybeSingle();
  if (!biz) return NextResponse.json({ error: "business_not_found" }, { status: 404 });
  const isOwner = String(biz.user_id) === user.id;
  if (!isOwner) {
    const { data: bu } = await admin
      .from("business_users")
      .select("role")
      .eq("business_id", biz.id)
      .eq("user_id", user.id)
      .maybeSingle();
    const allowed = bu?.role === "admin";
    if (!allowed) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Ensure thread exists (or create one).
  let requestId = threadId;
  if (requestId != null && !Number.isFinite(requestId)) requestId = null;

  if (requestId != null) {
    const { data: existing } = await admin
      .from("support_requests")
      .select("id, user_id, business_slug")
      .eq("id", requestId)
      .maybeSingle();
    if (!existing || String(existing.user_id) !== user.id || String(existing.business_slug) !== slug) {
      return NextResponse.json({ error: "thread_not_found" }, { status: 404 });
    }
  } else {
    const { data: created, error } = await admin
      .from("support_requests")
      .insert({ user_id: user.id, business_slug: slug })
      .select("id")
      .maybeSingle();
    if (error || !created?.id) return NextResponse.json({ error: "failed_to_create_thread" }, { status: 500 });
    requestId = Number(created.id);
  }

  // Persist owner message.
  await admin.from("support_request_messages").insert({
    request_id: requestId,
    role: "owner",
    content: message,
    model_used: "owner_help",
  });
  await admin
    .from("support_requests")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
    .eq("id", requestId);

  // Build prompt + history.
  const knowledge = await getBusinessKnowledgePack(slug);
  const knowledgeSummary =
    [
      knowledge?.businessName ? `שם עסק: ${knowledge.businessName}` : "",
      knowledge?.niche ? `נישה: ${knowledge.niche}` : "",
      knowledge?.ctaLink ? `CTA: ${knowledge.ctaLink}` : "",
      knowledge?.schedulePublicUrl ? `מערכת שעות: ${knowledge.schedulePublicUrl}` : "",
    ]
      .filter(Boolean)
      .join(" | ") || "לא הוגדר";

  const { data: historyRows } = await admin
    .from("support_request_messages")
    .select("role, content")
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .limit(14);
  const history: ChatMsg[] = (historyRows ?? [])
    .map((r: any) => ({
      role: r.role === "owner" ? ("user" as const) : ("assistant" as const),
      content: String(r.content ?? ""),
    }))
    .filter((m) => m.content.trim().length > 0);

  const system = buildOwnerHelpSystemPrompt({ slug, knowledgeSummary });

  const client = new Anthropic({ apiKey });
  let assistantText = "";
  let errorCode: string | null = null;
  try {
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 700,
      system,
      messages: history,
    });
    const blocks = Array.isArray((response as any)?.content) ? (response as any).content : [];
    assistantText = blocks
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => String(b.text))
      .join("\n")
      .trim();
  } catch (e) {
    errorCode = extractErrorCode(e);
    assistantText =
      "לא הצלחתי לענות כרגע בגלל תקלה זמנית. אפשר לנסות שוב עוד רגע, ואם זה דחוף אעביר את זה לצוות.";
    assistantText += "\n__NEEDS_HUMAN__: true";
  }

  const redacted = redactIfNeeded(assistantText);
  const { clean, needsHuman } = stripNeedsHumanMarker(redacted);

  // Persist assistant reply.
  await admin.from("support_request_messages").insert({
    request_id: requestId,
    role: "assistant",
    content: clean,
    model_used: "claude-3-5-sonnet-latest",
    error_code: errorCode,
  });
  await admin
    .from("support_requests")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any)
    .eq("id", requestId);

  // Slight delay to keep UI feeling natural (optional)
  await sleepMs(100);

  return NextResponse.json({
    ok: true,
    thread_id: requestId,
    reply: clean,
    needs_human: needsHuman,
    suggested_phone: typeof user.user_metadata?.phone === "string" ? String(user.user_metadata.phone).trim() : "",
  });
}

