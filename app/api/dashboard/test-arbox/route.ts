import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  loadAccessibleBusinesses,
  normDashboardSlug,
  pickBusinessBySlug,
} from "@/lib/dashboard-business-access";

export const runtime = "nodejs";

const MEMBERSHIP_TYPES_URL =
  "https://arboxserver.arboxapp.com/api/public/v3/membershipTypes";
const FETCH_TIMEOUT_MS = 25_000;
const MAX_BODY_CHARS = 500_000;

/**
 * בדיקה חד-פעמית מול Arbox — GET יחיד ל-membershipTypes, מחזיר סטטוס וגוף גולמי לדיבוג.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { slug?: string };
  try {
    body = (await req.json()) as { slug?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const slug = normDashboardSlug(body.slug ?? "");
  if (!slug) {
    return NextResponse.json({ error: "missing_slug" }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const accessible = await loadAccessibleBusinesses(admin, user.id);
  const biz = pickBusinessBySlug(accessible, slug);
  if (!biz) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const socialRaw = biz.social_links;
  const social =
    socialRaw && typeof socialRaw === "object" && !Array.isArray(socialRaw)
      ? (socialRaw as Record<string, unknown>)
      : {};
  const apiKey = String(social.arbox_api_key ?? "").trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "missing_arbox_api_key", message: "אין מפתח arbox_api_key בשדה social_links של העסק." },
      { status: 400 }
    );
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(MEMBERSHIP_TYPES_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "api-key": apiKey,
      },
      signal: ac.signal,
    });
  } catch (e) {
    clearTimeout(t);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        request_url: MEMBERSHIP_TYPES_URL,
        fetch_error: msg,
        arbox_status: null,
        arbox_headers: null,
        arbox_body_raw: null,
      },
      { status: 200 }
    );
  } finally {
    clearTimeout(t);
  }

  const text = await res.text();
  const truncated = text.length > MAX_BODY_CHARS;
  const raw = truncated ? `${text.slice(0, MAX_BODY_CHARS)}… [truncated, ${text.length} bytes total]` : text;

  let bodyJson: unknown = null;
  const trim = raw.trim();
  if (trim.startsWith("{") || trim.startsWith("[")) {
    try {
      bodyJson = JSON.parse(trim) as unknown;
    } catch {
      bodyJson = null;
    }
  }

  return NextResponse.json({
    request_url: MEMBERSHIP_TYPES_URL,
    request_headers_sent: { Accept: "application/json", "api-key": "[redacted]" },
    arbox_status: res.status,
    arbox_ok: res.ok,
    arbox_content_type: res.headers.get("content-type") ?? null,
    arbox_body_raw: raw,
    arbox_body_json: bodyJson,
    arbox_body_truncated: truncated,
  });
}
