import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { HEYZOE_SF_SERVICE_PREFIX } from "@/lib/analytics";
import { offerKindFromServiceMeta, type OfferKind } from "@/lib/sales-flow";

function asSocialRecord(social: unknown): Record<string, unknown> {
  if (!social || typeof social !== "object" || Array.isArray(social)) return {};
  return social as Record<string, unknown>;
}

function parseServiceDescriptionMeta(raw: string): Record<string, unknown> {
  try {
    const trimmed = String(raw ?? "").trim();
    const stripped = trimmed.startsWith("__META__:") ? trimmed.slice("__META__:".length) : trimmed;
    const jsonStart = stripped.indexOf("{");
    const toParse = jsonStart >= 0 ? stripped.slice(jsonStart) : stripped;
    return JSON.parse(toParse.trim() || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

const validHttp = (u: string) => u.startsWith("https://") || u.startsWith("http://");

/** תווית כפתור הרשמה לפולואפ — לפי סוג המוצר שנבחר */
export function registrationCtaLabelForOfferKind(kind: OfferKind): string {
  if (kind === "workshop") return "הרשמה לסדנה";
  if (kind === "course") return "הרשמה לקורס";
  return "הרשמה לשיעור ניסיון";
}

async function fetchLastSfServiceEventNameInSessions(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_ids: string[];
}): Promise<string | null> {
  const sessionIds = input.session_ids.filter(Boolean);
  if (!sessionIds.length) return null;
  const { data, error } = await input.admin
    .from("messages")
    .select("content")
    .eq("business_slug", input.business_slug)
    .in("session_id", sessionIds)
    .eq("role", "event")
    .order("created_at", { ascending: false })
    .limit(24);
  if (error || !data?.length) return null;
  for (const row of data) {
    const c = String(row.content ?? "").trim();
    if (!c.startsWith(HEYZOE_SF_SERVICE_PREFIX)) continue;
    const name = c.slice(HEYZOE_SF_SERVICE_PREFIX.length).trim();
    if (name) return name;
  }
  return null;
}

type ServiceRow = { name: string; description: string | null };

function resolveServiceOfferKind(row: ServiceRow | null | undefined): OfferKind {
  if (!row) return "trial";
  return offerKindFromServiceMeta(parseServiceDescriptionMeta(String(row.description ?? "")));
}

function paymentLinkFromService(row: ServiceRow | null | undefined): string {
  if (!row) return "";
  const meta = parseServiceDescriptionMeta(String(row.description ?? ""));
  return String(meta.payment_link ?? "").trim();
}

/**
 * כפתור הנעה לפעולה לפולואפים — לפי השירות/מוצר האחרון שנבחר בסשן (או שירות יחיד בעסק).
 */
export async function resolveWaFollowupRegistrationCta(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  businessId: number;
  business_slug: string;
  session_ids: string[];
  social_links?: unknown;
}): Promise<{ label: string; url: string; offer_kind: OfferKind } | null> {
  const { data: servicesRaw, error } = await input.admin
    .from("services")
    .select("name, description")
    .eq("business_id", input.businessId)
    .order("id", { ascending: true });

  if (error) {
    console.warn("[wa-followup-registration-cta] services query:", error.message);
    return null;
  }

  const services: ServiceRow[] = (servicesRaw ?? [])
    .map((s) => ({
      name: String((s as { name?: unknown }).name ?? "").trim(),
      description:
        typeof (s as { description?: unknown }).description === "string"
          ? (s as { description: string }).description
          : null,
    }))
    .filter((s) => s.name);

  const lastPickedName = await fetchLastSfServiceEventNameInSessions({
    admin: input.admin,
    business_slug: input.business_slug,
    session_ids: input.session_ids,
  });

  let selected: ServiceRow | null =
    (lastPickedName ? services.find((s) => s.name === lastPickedName) : null) ??
    (services.length === 1 ? services[0]! : null);

  let offerKind = resolveServiceOfferKind(selected);
  let url = paymentLinkFromService(selected);

  if (!validHttp(url)) {
    const withLink = services.find((s) => validHttp(paymentLinkFromService(s)));
    if (withLink) {
      if (!selected) selected = withLink;
      url = paymentLinkFromService(withLink);
      offerKind = resolveServiceOfferKind(selected ?? withLink);
    }
  }

  if (!validHttp(url)) {
    const sl = asSocialRecord(input.social_links);
    const arbox = typeof sl.arbox_link === "string" ? sl.arbox_link.trim() : "";
    if (validHttp(arbox)) {
      return { label: registrationCtaLabelForOfferKind(offerKind), url: arbox, offer_kind: offerKind };
    }
    return null;
  }

  return {
    label: registrationCtaLabelForOfferKind(offerKind),
    url,
    offer_kind: offerKind,
  };
}
