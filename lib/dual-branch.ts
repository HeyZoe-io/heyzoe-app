/**
 * שני סניפים לעסק אחד — כרגע רק tshelgine-8774 (תמרה).
 * אותם שיעורים, מערכת / עמוד תשלום / מועדים לפי סניף.
 * הסניף שנבחר נשמר כאירוע בשיחה, בלי עמודה חדשה ב-contacts.
 */
import { fetchLastSalesFlowGreetingResetAt } from "@/lib/analytics";
import { formatScheduleSlotDisplayLabel } from "@/lib/product-schedule-slots";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const DUAL_BRANCH_SLUG = "tshelgine-8774";

export const HEYZOE_SF_BRANCH_PREFIX = "[heyzoe:sf_branch]";

export const DUAL_BRANCHES = [
  { id: "amiad", label: "עמיעד" },
  { id: "kiryat_shmona", label: "קריית שמונה" },
] as const;

export type DualBranchId = (typeof DUAL_BRANCHES)[number]["id"];

export type BranchScheduleSlot = { id: string; day: string; time: string };

export type BranchOffer = {
  paymentPage: string;
  paymentLink: string;
  scheduleSlots: BranchScheduleSlot[];
};

export type BranchOffers = Record<DualBranchId, BranchOffer>;

export type BranchScheduleUrls = Record<DualBranchId, string>;

/** תמונות מערכת שעות לפי סניף — social_links.branch_schedule_image_urls */
export type BranchScheduleImageUrls = Record<DualBranchId, string>;

export type BranchLocation = { address: string; directions: string };

export type BranchLocations = Record<DualBranchId, BranchLocation>;

export function isDualBranchBusiness(slug: string | null | undefined): boolean {
  return String(slug ?? "").trim().toLowerCase() === DUAL_BRANCH_SLUG;
}

export function dualBranchLabel(id: DualBranchId): string {
  return DUAL_BRANCHES.find((b) => b.id === id)?.label ?? id;
}

export function emptyBranchOffer(): BranchOffer {
  return { paymentPage: "", paymentLink: "", scheduleSlots: [] };
}

export function emptyBranchOffers(): BranchOffers {
  return { amiad: emptyBranchOffer(), kiryat_shmona: emptyBranchOffer() };
}

export function emptyBranchScheduleUrls(): BranchScheduleUrls {
  return { amiad: "", kiryat_shmona: "" };
}

export function emptyBranchScheduleImageUrls(): BranchScheduleImageUrls {
  return { amiad: "", kiryat_shmona: "" };
}

export function emptyBranchLocation(): BranchLocation {
  return { address: "", directions: "" };
}

export function emptyBranchLocations(): BranchLocations {
  return { amiad: emptyBranchLocation(), kiryat_shmona: emptyBranchLocation() };
}

export function parseBranchLocations(raw: unknown): BranchLocations {
  const root = asRecord(raw);
  const one = (id: DualBranchId): BranchLocation => {
    const row = asRecord(root?.[id]);
    return {
      address: String(row?.address ?? "").trim(),
      directions: String(row?.directions ?? "").trim(),
    };
  };
  if (!root) return emptyBranchLocations();
  return { amiad: one("amiad"), kiryat_shmona: one("kiryat_shmona") };
}

export function branchLocationsToMeta(locations: BranchLocations): Record<string, unknown> {
  const one = (location: BranchLocation) => ({
    address: location.address.trim(),
    directions: location.directions.trim(),
  });
  return { amiad: one(locations.amiad), kiryat_shmona: one(locations.kiryat_shmona) };
}

export function branchLocationsHaveContent(locations: BranchLocations | null | undefined): boolean {
  if (!locations) return false;
  return DUAL_BRANCHES.some((branch) => locations[branch.id].address || locations[branch.id].directions);
}

/** כתובת שכבר הוחלפה לכתובת הסניף — מזהה איזה סניף פעיל בשיחה. */
export function activeDualBranchFromAddress(
  locations: BranchLocations | null | undefined,
  addressText: string
): DualBranchId | null {
  if (!locations) return null;
  const address = addressText.trim();
  if (!address) return null;
  for (const branch of DUAL_BRANCHES) {
    const branchAddress = locations[branch.id].address.trim();
    if (branchAddress && branchAddress === address) return branch.id;
  }
  return null;
}

export function formatBranchLocationsForPrompt(
  locations: BranchLocations,
  active: DualBranchId | null
): string {
  if (active) {
    const location = locations[active];
    const label = dualBranchLabel(active);
    return [
      `הסניף שנבחר בשיחה: ${label}.`,
      `כתובת: ${location.address.trim() || "לא הוגדרה"}`,
      `הנחיות הגעה: ${location.directions.trim() || "לא הוגדרו"}`,
      `עני על כתובת והגעה רק עבור ${label}. אסור לתת כתובת או הוראות הגעה של הסניף השני.`,
    ].join("\n");
  }
  const lines = DUAL_BRANCHES.map((branch) => {
    const location = locations[branch.id];
    return `- ${branch.label}: כתובת: ${location.address.trim() || "לא הוגדרה"}. הגעה: ${location.directions.trim() || "לא הוגדרה"}.`;
  });
  return [
    "יש שני סניפים. אל תערבבי ביניהם.",
    ...lines,
    "אם עדיין לא נבחר סניף ושואלים איפה אתם — צייני את שני הסניפים בנפרד, כל אחד עם הכתובת וההגעה שלו.",
  ].join("\n");
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function parseSlots(raw: unknown): BranchScheduleSlot[] {
  if (!Array.isArray(raw)) return [];
  const out: BranchScheduleSlot[] = [];
  for (const row of raw) {
    const o = asRecord(row);
    if (!o) continue;
    const day = String(o.day ?? "").trim();
    const time = String(o.time ?? "").trim();
    if (!day && !time) continue;
    out.push({
      id: String(o.id ?? "").trim() || `s${out.length}`,
      day,
      time,
    });
  }
  return out;
}

function parseOneOffer(raw: unknown): BranchOffer {
  const o = asRecord(raw);
  if (!o) return emptyBranchOffer();
  return {
    paymentPage: String(o.payment_page ?? "").trim(),
    paymentLink: String(o.payment_link ?? "").trim(),
    scheduleSlots: parseSlots(o.schedule_slots),
  };
}

export function parseBranchOffers(meta: Record<string, unknown> | null | undefined): BranchOffers {
  const raw = asRecord(meta?.branch_offers);
  if (!raw) return emptyBranchOffers();
  return {
    amiad: parseOneOffer(raw.amiad),
    kiryat_shmona: parseOneOffer(raw.kiryat_shmona),
  };
}

export function branchOffersToMeta(offers: BranchOffers): Record<string, unknown> {
  const one = (offer: BranchOffer) => {
    const url = offer.paymentPage.trim() || offer.paymentLink.trim();
    return {
      payment_page: url,
      payment_link: url,
      schedule_slots: offer.scheduleSlots
        .filter((slot) => slot.day.trim() || slot.time.trim())
        .map((slot) => ({
          id: slot.id,
          day: slot.day.trim(),
          time: slot.time.trim(),
        })),
    };
  };
  return {
    amiad: one(offers.amiad),
    kiryat_shmona: one(offers.kiryat_shmona),
  };
}

export function parseBranchScheduleUrls(raw: unknown): BranchScheduleUrls {
  const o = asRecord(raw);
  if (!o) return emptyBranchScheduleUrls();
  return {
    amiad: String(o.amiad ?? "").trim(),
    kiryat_shmona: String(o.kiryat_shmona ?? "").trim(),
  };
}

export function parseBranchScheduleImageUrls(raw: unknown): BranchScheduleImageUrls {
  return parseBranchScheduleUrls(raw);
}

export function parseDualBranchId(raw: string | null | undefined): DualBranchId | null {
  const id = String(raw ?? "").trim();
  if (id === "amiad" || id === "kiryat_shmona") return id;
  return null;
}

/** התאמה לכפתור / טקסט חופשי של בחירת סניף. */
export function matchDualBranchChoice(text: string, metaInteractiveReplyId?: string): DualBranchId | null {
  const blob = `${metaInteractiveReplyId ?? ""} ${text ?? ""}`.replace(/\s+/g, " ").trim();
  if (!blob) return null;
  if (/קריית[\s\-]*שמונה|קרית[\s\-]*שמונה|kiryat/i.test(blob)) return "kiryat_shmona";
  if (/עמיעד|amiad/i.test(blob)) return "amiad";
  const trimmed = String(text ?? "").trim();
  if (trimmed === "1") return "amiad";
  if (trimmed === "2") return "kiryat_shmona";
  return null;
}

export function dualBranchPickMenu(lang: "he" | "en" | "ru" = "he"): { question: string; labels: string[] } {
  const labels = DUAL_BRANCHES.map((b) => b.label);
  const question =
    lang === "en"
      ? "Which branch works for you?"
      : lang === "ru"
        ? "Какой филиал вам удобен?"
        : "באיזה סניף נוח לך?";
  return { question, labels };
}

function withBranchLabel(text: string, branch: DualBranchId): string {
  const label = dualBranchLabel(branch);
  const base = text.trim();
  if (!base) return `סניף ${label}`;
  if (base.includes(label)) return base;
  return `${base}\nסניף ${label}`;
}

function filledSlots(slots: BranchScheduleSlot[]): BranchScheduleSlot[] {
  return slots.filter((slot) => slot.day.trim() && slot.time.trim());
}

type BranchServiceSlice = {
  name: string;
  paymentLink: string;
  scheduleSlots: { day: string; time: string }[];
  locationText: string;
  branchOffers?: BranchOffers;
};

export function applyDualBranchToService<T extends BranchServiceSlice>(row: T, branch: DualBranchId): T {
  const offer = row.branchOffers?.[branch];
  const slots = filledSlots(offer?.scheduleSlots ?? []);
  const payment = offer?.paymentPage.trim() || offer?.paymentLink.trim() || row.paymentLink;
  return {
    ...row,
    paymentLink: payment,
    scheduleSlots: slots.length ? slots : row.scheduleSlots,
    locationText: withBranchLabel(row.locationText, branch),
  } as T;
}

type BranchKnowledgeSlice = {
  arboxLink: string;
  schedulePublicUrl: string;
  scheduleScanImageUrl?: string;
  addressText: string;
  directionsText: string;
  servicesText: string;
  salesFlowServices: BranchServiceSlice[];
  knowledgeCatalogServices?: BranchServiceSlice[];
  salesFlowConfig?: {
    cta_buttons?: Array<{
      kind?: string;
      schedule_cta_delivery?: string;
      schedule_cta_image_url?: string;
      schedule_cta_image_type?: string;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  } | null;
  branchScheduleUrls?: BranchScheduleUrls;
  branchScheduleImageUrls?: BranchScheduleImageUrls;
  branchLocations?: BranchLocations;
  /** סניף שנבחר בשיחה — אחרי applyDualBranchToKnowledge */
  activeDualBranch?: DualBranchId | null;
};

function branchKnowledgeNote(services: BranchServiceSlice[], branch: DualBranchId): string {
  const lines = services.map((service) => {
    const slots = service.scheduleSlots
      .filter((slot) => slot.day.trim() && slot.time.trim())
      .map((slot) => formatScheduleSlotDisplayLabel(slot))
      .join(", ");
    const link = service.paymentLink.trim() || "לא הוגדר";
    return `- ${service.name}: מועדים ${slots || "ללא מועדי לוח"}; קישור הרשמה: ${link}`;
  });
  return `הסניף שנבחר בשיחה: ${dualBranchLabel(branch)}. מועדים, מערכת שעות וקישור הרשמה — רק של הסניף הזה:\n${lines.join("\n")}`;
}

export function applyDualBranchToKnowledge<T extends BranchKnowledgeSlice>(
  knowledge: T,
  branch: DualBranchId
): T {
  const url = knowledge.branchScheduleUrls?.[branch]?.trim() ?? "";
  const branchImage =
    knowledge.branchScheduleImageUrls?.[branch]?.trim() ||
    String(knowledge.scheduleScanImageUrl ?? "").trim();
  const location = knowledge.branchLocations?.[branch];
  const branchAddress = location?.address.trim() ?? "";
  const branchDirections = location?.directions.trim() ?? "";
  const salesFlowServices = (knowledge.salesFlowServices ?? []).map((row) =>
    applyDualBranchToService(row, branch)
  );
  const knowledgeCatalogServices = (knowledge.knowledgeCatalogServices ?? knowledge.salesFlowServices ?? []).map(
    (row) => applyDualBranchToService(row, branch)
  );
  const placeNote = [
    `כתובת ${dualBranchLabel(branch)}: ${branchAddress || "לא הוגדרה"}`,
    `הנחיות הגעה ${dualBranchLabel(branch)}: ${branchDirections || "לא הוגדרו"}`,
    "אסור לתת כתובת או הוראות הגעה של הסניף השני.",
  ].join("\n");
  const note = [branchKnowledgeNote(salesFlowServices, branch), placeNote].join("\n");
  const prevCfg = knowledge.salesFlowConfig;
  const salesFlowConfig =
    prevCfg && Array.isArray(prevCfg.cta_buttons)
      ? {
          ...prevCfg,
          cta_buttons: prevCfg.cta_buttons.map((btn) => {
            if (btn.kind !== "schedule") return btn;
            if (!branchImage) {
              return {
                ...btn,
                schedule_cta_image_url: "",
                schedule_cta_image_type: "",
              };
            }
            return {
              ...btn,
              schedule_cta_delivery:
                btn.schedule_cta_delivery === "none" ? "none" : btn.schedule_cta_delivery === "link" ? "link" : "image",
              schedule_cta_image_url: branchImage,
              schedule_cta_image_type: "image",
            };
          }),
        }
      : prevCfg;
  return {
    ...knowledge,
    arboxLink: url || knowledge.arboxLink,
    schedulePublicUrl: url || knowledge.schedulePublicUrl,
    scheduleScanImageUrl: branchImage,
    salesFlowConfig: salesFlowConfig ?? prevCfg ?? null,
    addressText: branchAddress || withBranchLabel(knowledge.addressText, branch),
    directionsText: branchDirections || knowledge.directionsText,
    salesFlowServices,
    knowledgeCatalogServices,
    servicesText: [knowledge.servicesText.trim(), note].filter(Boolean).join("\n\n"),
    activeDualBranch: branch,
  } as T;
}

/** כתובת שנשלחת בתיאור המוצר — רק כתובת הסניף שנבחר, בלי כתובת משותפת. */
export function addressForSelectedBranch(
  locations: BranchLocations | null | undefined,
  branch: DualBranchId | null
): string {
  if (!branch || !locations) return "";
  return locations[branch].address.trim();
}

export function paymentLinkForBranch(meta: Record<string, unknown>, branch: DualBranchId | null): string {
  if (branch) {
    const offer = parseBranchOffers(meta)[branch];
    const branched = offer.paymentPage || offer.paymentLink;
    if (branched) return branched;
  }
  return String(meta.payment_link ?? "").trim();
}

export async function fetchLastDualBranchId(input: {
  business_slug: string;
  session_id?: string;
  session_ids?: string[];
}): Promise<DualBranchId | null> {
  if (!isDualBranchBusiness(input.business_slug)) return null;
  const sessionIds = [
    ...(input.session_id ? [input.session_id] : []),
    ...(input.session_ids ?? []),
  ]
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  const unique = [...new Set(sessionIds)];
  if (!unique.length) return null;

  try {
    const supabase = createSupabaseAdminClient();
    let resetAt: string | null = null;
    if (unique.length === 1) {
      resetAt = await fetchLastSalesFlowGreetingResetAt({
        business_slug: input.business_slug,
        session_id: unique[0]!,
      });
    }
    let q = supabase
      .from("messages")
      .select("content, created_at")
      .eq("business_slug", input.business_slug)
      .eq("role", "event")
      .order("created_at", { ascending: false })
      .limit(24);
    q = unique.length === 1 ? q.eq("session_id", unique[0]!) : q.in("session_id", unique);
    if (resetAt) q = q.gt("created_at", resetAt);
    const { data, error } = await q;
    if (error || !data?.length) return null;
    for (const row of data) {
      const content = String(row.content ?? "").trim();
      if (!content.startsWith(HEYZOE_SF_BRANCH_PREFIX)) continue;
      const id = parseDualBranchId(content.slice(HEYZOE_SF_BRANCH_PREFIX.length));
      if (id) return id;
    }
    return null;
  } catch (e) {
    console.error("[dual-branch] fetchLastDualBranchId failed:", e);
    return null;
  }
}
