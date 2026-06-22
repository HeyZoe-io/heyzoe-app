import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { isAdminAllowedEmail } from "@/lib/server-env";

export type DashboardBizRow = Record<string, unknown> & {
  id?: number;
  slug?: string;
  created_at?: string;
  user_id?: string;
};

export function normDashboardSlug(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

export type AssertBusinessAccessBusiness = {
  id: number;
  slug: string;
  user_id: string;
  plan?: unknown;
  is_active?: boolean | null;
};

export type AssertBusinessAccessResult =
  | { ok: false; status: 400; error: "missing_business_slug" }
  | { ok: false; status: 404; error: "business_not_found" }
  | { ok: false; status: 403; error: "forbidden" }
  | { ok: true; business: AssertBusinessAccessBusiness };

/** גישה לעסק בודד: אדמין פלטפורמה, בעלות, או membership ב-business_users */
export async function assertBusinessAccess(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  user: { id: string; email?: string | null },
  slug: string
): Promise<AssertBusinessAccessResult> {
  const slugNorm = normDashboardSlug(slug);
  if (!slugNorm) {
    return { ok: false, status: 400, error: "missing_business_slug" };
  }

  const { data: biz } = await admin
    .from("businesses")
    .select("id, slug, user_id, plan, is_active")
    .eq("slug", slugNorm)
    .maybeSingle();

  if (!biz?.id) {
    return { ok: false, status: 404, error: "business_not_found" };
  }

  const business: AssertBusinessAccessBusiness = {
    id: Number(biz.id),
    slug: String(biz.slug ?? slugNorm),
    user_id: String(biz.user_id ?? ""),
    plan: (biz as { plan?: unknown }).plan,
    is_active: (biz as { is_active?: boolean | null }).is_active,
  };

  if (isAdminAllowedEmail(user.email ?? "")) {
    return { ok: true, business };
  }

  if (String(biz.user_id ?? "") === user.id) {
    return { ok: true, business };
  }

  const { data: membership } = await admin
    .from("business_users")
    .select("business_id")
    .eq("user_id", user.id)
    .eq("business_id", biz.id)
    .maybeSingle();

  if (!membership) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  return { ok: true, business };
}

/** עסקים שהמשתמש רשאי לראות: בעלות + חברות ב-business_users */
export async function loadAccessibleBusinesses(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  opts?: { adminAll?: boolean }
): Promise<DashboardBizRow[]> {
  if (opts?.adminAll) {
    const { data } = await admin.from("businesses").select("*").limit(10_000);
    return (data ?? []) as any as DashboardBizRow[];
  }

  const [{ data: owned }, { data: memberships }] = await Promise.all([
    admin.from("businesses").select("*").eq("user_id", userId),
    admin.from("business_users").select("business_id").eq("user_id", userId),
  ]);

  const byId = new Map<string, DashboardBizRow>();
  for (const b of owned ?? []) {
    if (b && typeof b === "object" && (b as DashboardBizRow).id != null) {
      byId.set(String((b as DashboardBizRow).id), b as DashboardBizRow);
    }
  }

  const memberIds = [
    ...new Set(
      (memberships ?? [])
        .map((m: { business_id?: number }) => m.business_id)
        .filter((id): id is number => id != null && Number.isFinite(Number(id)))
        .map((id) => Number(id))
    ),
  ];

  if (memberIds.length > 0) {
    const { data: memberBiz } = await admin.from("businesses").select("*").in("id", memberIds);
    for (const b of memberBiz ?? []) {
      if (
        b &&
        typeof b === "object" &&
        (b as DashboardBizRow).id != null &&
        !byId.has(String((b as DashboardBizRow).id))
      ) {
        byId.set(String((b as DashboardBizRow).id), b as DashboardBizRow);
      }
    }
  }

  return [...byId.values()];
}

export function pickBusinessBySlug(
  accessible: DashboardBizRow[],
  slugNorm: string
): DashboardBizRow | null {
  return accessible.find((b) => normDashboardSlug(b.slug) === slugNorm) ?? null;
}

export function pickFirstBusiness(accessible: DashboardBizRow[]): DashboardBizRow | null {
  if (accessible.length === 0) return null;
  return [...accessible].sort(
    (a, b) =>
      new Date(String(a.created_at ?? 0)).getTime() - new Date(String(b.created_at ?? 0)).getTime()
  )[0];
}
