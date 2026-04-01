import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}

async function resolveBusinessForUser(admin: ReturnType<typeof createSupabaseAdminClient>, userId: string) {
  // Prefer explicit primary membership (works for owners + invited users)
  const { data: primaryMembership } = await admin
    .from("business_users")
    .select("business_id, role, is_primary")
    .eq("user_id", userId)
    .eq("is_primary", true)
    .limit(1)
    .maybeSingle();
  if (primaryMembership?.business_id) {
    const { data: biz } = await admin
      .from("businesses")
      .select("id, slug, user_id")
      .eq("id", primaryMembership.business_id)
      .maybeSingle();
    if (biz) return { businessId: biz.id as number, slug: String(biz.slug), isOwner: false };
  }

  const { data: owned } = await admin
    .from("businesses")
    .select("id, slug, user_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned) return { businessId: owned.id as number, slug: String(owned.slug), isOwner: true };

  const { data: membership } = await admin
    .from("business_users")
    .select("business_id, role")
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!membership) return null;

  const { data: biz } = await admin.from("businesses").select("id, slug, user_id").eq("id", membership.business_id).maybeSingle();
  if (!biz) return null;
  return { businessId: biz.id as number, slug: String(biz.slug), isOwner: false };
}

async function ensurePrimaryMembership(admin: ReturnType<typeof createSupabaseAdminClient>, businessId: number, ownerUserId: string) {
  // Ensure the owner exists in business_users as primary admin
  const { data: existing } = await admin
    .from("business_users")
    .select("user_id")
    .eq("business_id", businessId)
    .eq("user_id", ownerUserId)
    .maybeSingle();
  if (existing) return;

  const { error } = await admin.from("business_users").insert({
    business_id: businessId,
    user_id: ownerUserId,
    role: "admin",
    status: "active",
    is_primary: true,
  } as any);
  if (error) throw error;
}

async function requireAdminForBusiness(admin: ReturnType<typeof createSupabaseAdminClient>, businessId: number, userId: string) {
  const { data: row } = await admin
    .from("business_users")
    .select("role, is_primary")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle();
  return row?.role === "admin";
}

async function getAuthUsersByIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userIds: string[]
): Promise<Map<string, { email: string; name: string; confirmed_at: string | null }>> {
  const map = new Map<string, { email: string; name: string; confirmed_at: string | null }>();
  const ids = userIds.filter(Boolean);
  if (!ids.length) return map;

  // Prefer querying auth.users (fast, batch) using service role.
  try {
    const { data, error } = await (admin as any)
      .schema("auth")
      .from("users")
      .select("id, email, raw_user_meta_data, confirmed_at")
      .in("id", ids);

    if (!error && Array.isArray(data)) {
      for (const row of data as any[]) {
        const meta = (row?.raw_user_meta_data && typeof row.raw_user_meta_data === "object")
          ? (row.raw_user_meta_data as Record<string, unknown>)
          : {};
        const name =
          (typeof meta.full_name === "string" ? meta.full_name : "") ||
          (typeof meta.name === "string" ? meta.name : "");
        map.set(String(row.id), {
          email: String(row.email ?? ""),
          name: String(name ?? ""),
          confirmed_at: row.confirmed_at ? String(row.confirmed_at) : null,
        });
      }
      return map;
    }
  } catch {
    // fall back below
  }

  // Fallback: per-user admin API (slower)
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data.user) return;
        const u: any = data.user;
        const name =
          (typeof u.user_metadata?.full_name === "string" ? u.user_metadata.full_name : "") ||
          (typeof u.user_metadata?.name === "string" ? u.user_metadata.name : "");
        map.set(String(u.id), {
          email: String(u.email ?? ""),
          name: String(name ?? ""),
          confirmed_at: u.confirmed_at ? String(u.confirmed_at) : null,
        });
      } catch {
        // ignore
      }
    })
  );

  return map;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const bizInfo = await resolveBusinessForUser(admin, user.id);
    if (!bizInfo) {
      console.info("[api/account/users][GET] no_business", { user_id: user.id });
      return NextResponse.json({ members: [] });
    }

    // Ensure owner is present as primary admin membership for safety rules
    const { data: biz, error: bizErr } = await admin
      .from("businesses")
      .select("user_id, slug")
      .eq("id", bizInfo.businessId)
      .maybeSingle();
    if (bizErr) {
      console.error("[api/account/users][GET] business_select_failed", {
        user_id: user.id,
        business_id: bizInfo.businessId,
        error: bizErr.message,
      });
    }
    if (biz?.user_id) await ensurePrimaryMembership(admin, bizInfo.businessId, String(biz.user_id));

    const { data: rows, error } = await admin
      .from("business_users")
      .select("business_id, user_id, role, status, is_primary")
      .eq("business_id", bizInfo.businessId)
      .order("is_primary", { ascending: false });
    if (error) {
      console.error("[api/account/users][GET] business_users_select_failed", {
        user_id: user.id,
        business_id: bizInfo.businessId,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ids = (rows ?? []).map((r: any) => String(r.user_id));
    const infoById = await getAuthUsersByIds(admin, ids);
    // Auto-activate pending users when they confirm the invite
    const toActivate = (rows ?? [])
      .filter((r: any) => String(r.status ?? "pending") === "pending")
      .filter((r: any) => Boolean(infoById.get(String(r.user_id))?.confirmed_at))
      .map((r: any) => String(r.user_id));
    if (toActivate.length) {
      await admin
        .from("business_users")
        .update({ status: "active" })
        .eq("business_id", bizInfo.businessId)
        .in("user_id", toActivate);
    }

    const members = (rows ?? []).map((r: any) => {
      const uid = String(r.user_id);
      const info = infoById.get(uid) ?? { email: "", name: "", confirmed_at: null };
      const status =
        String(r.status ?? "pending") === "active" || (toActivate.includes(uid) && Boolean(info.confirmed_at))
          ? "active"
          : "pending";
      return {
        user_id: uid,
        role: r.role === "admin" ? "admin" : "employee",
        status,
        is_primary: Boolean(r.is_primary),
        email: info.email,
        name: info.name,
      };
    });

    console.info("[api/account/users][GET] payload", {
      user_id: user.id,
      business_id: bizInfo.businessId,
      business_slug: biz?.slug ? String(biz.slug) : "",
      rows_count: Array.isArray(rows) ? rows.length : 0,
      member_ids: ids,
      members_count: members.length,
      members_preview: members.slice(0, 5),
    });

    // Debug mode: return raw rows to quickly diagnose production data mismatches.
    // Enable by calling /api/account/users?debug=1 (still requires auth).
    const debug = req.nextUrl.searchParams.get("debug") === "1";

    return NextResponse.json(
      debug
        ? {
            members,
            debug: {
              resolved: {
                user_id: user.id,
                business_id: bizInfo.businessId,
                business_slug: biz?.slug ? String(biz.slug) : "",
              },
              raw_business_users_rows: rows ?? [],
            },
          }
        : { members }
    );
  } catch (e: any) {
    console.error("[api/account/users][GET] failed", {
      message: e?.message ? String(e.message) : String(e),
    });
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const role = body.role === "admin" ? "admin" : "employee";
  if (!email || !fullName) return NextResponse.json({ error: "missing_fields" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const bizInfo = await resolveBusinessForUser(admin, user.id);
  if (!bizInfo) return NextResponse.json({ error: "business_not_found" }, { status: 404 });

  const isAdmin = await requireAdminForBusiness(admin, bizInfo.businessId, user.id);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const invite = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/dashboard/login`,
    data: { full_name: fullName },
  } as any);

  if (invite.error || !invite.data.user) {
    return NextResponse.json({ error: invite.error?.message ?? "invite_failed" }, { status: 500 });
  }

  const invitedUserId = String(invite.data.user.id);

  const { error } = await admin.from("business_users").upsert(
    {
      business_id: bizInfo.businessId,
      user_id: invitedUserId,
      role,
      status: "pending",
      is_primary: false,
    },
    { onConflict: "business_id,user_id" } as any
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    member: {
      user_id: invitedUserId,
      role: role === "admin" ? "admin" : "employee",
      status: "pending",
      is_primary: false,
      email,
      name: fullName,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id") ?? "";
  const cancelInvite = url.searchParams.get("cancel_invite") === "1";
  if (!userId) return NextResponse.json({ error: "missing_user_id" }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const bizInfo = await resolveBusinessForUser(admin, user.id);
  if (!bizInfo) return NextResponse.json({ error: "business_not_found" }, { status: 404 });

  const isAdmin = await requireAdminForBusiness(admin, bizInfo.businessId, user.id);
  if (!isAdmin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { data: target } = await admin
    .from("business_users")
    .select("user_id, role, is_primary")
    .eq("business_id", bizInfo.businessId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (target.is_primary) {
    // can’t delete primary unless there's another admin
    const { data: otherAdmins } = await admin
      .from("business_users")
      .select("user_id")
      .eq("business_id", bizInfo.businessId)
      .eq("role", "admin");
    const hasAnotherAdmin = (otherAdmins ?? []).some((x: any) => String(x.user_id) !== userId);
    if (!hasAnotherAdmin) {
      return NextResponse.json({ error: "cannot_delete_primary_without_another_admin" }, { status: 409 });
    }
  }

  const { error } = await admin
    .from("business_users")
    .delete()
    .eq("business_id", bizInfo.businessId)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (cancelInvite) {
    // Best-effort: delete the invited auth user only if it's still unconfirmed.
    try {
      const { data: authUser } = await (admin as any)
        .schema("auth")
        .from("users")
        .select("id, confirmed_at, invited_at")
        .eq("id", userId)
        .maybeSingle();
      const confirmedAt = authUser?.confirmed_at ? String(authUser.confirmed_at) : "";
      const invitedAt = authUser?.invited_at ? String(authUser.invited_at) : "";
      if (!confirmedAt && invitedAt) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true });
}

