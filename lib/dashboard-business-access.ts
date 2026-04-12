import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export type DashboardBizRow = Record<string, unknown> & {
  id?: number;
  slug?: string;
  created_at?: string;
  user_id?: string;
};

export function normDashboardSlug(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/** עסקים שהמשתמש רשאי לראות: בעלות + חברות ב-business_users */
export async function loadAccessibleBusinesses(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
): Promise<DashboardBizRow[]> {
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
