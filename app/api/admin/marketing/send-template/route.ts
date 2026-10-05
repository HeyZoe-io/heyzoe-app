import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";
import { extractLeadPhoneFromMarketingSession } from "@/lib/marketing-whatsapp";
import { sendMarketingConversationTemplate } from "@/lib/marketing-template-dispatch";
import { normalizePhone } from "@/lib/phone-normalize";

/** שליחת טמפלייט מאושר לליד אחד משיחת זואי אדמין. קריאת Meta אחת לכל שליחה. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sendErrorStatus(error: string): number {
  if (error === "missing_fields" || error === "template_not_approved") {
    return 400;
  }
  if (error === "suppressed_opt_out") return 409;
  return 500;
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.trim().toLowerCase() ?? "";
  if (!email || !isAdminAllowedEmail(email)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { session_id?: string; phone?: string; template_name?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sessionId = String(body.session_id ?? "").trim();
  const fromSession = extractLeadPhoneFromMarketingSession(sessionId);
  const phone =
    fromSession ||
    normalizePhone(String(body.phone ?? "")) ||
    String(body.phone ?? "").replace(/\D/g, "");
  const templateName = String(body.template_name ?? "").trim();
  if (!phone || !templateName) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const result = await sendMarketingConversationTemplate({
      admin,
      phone,
      templateName,
    });
    if (!result.ok) {
      console.error("[admin/marketing/send-template] failed:", result.error, {
        templateName,
      });
      return NextResponse.json({ error: result.error }, { status: sendErrorStatus(result.error) });
    }
    return NextResponse.json({ ok: true, content: result.content });
  } catch (e) {
    console.error("[admin/marketing/send-template] threw:", e);
    return NextResponse.json({ error: "send_failed" }, { status: 500 });
  }
}
