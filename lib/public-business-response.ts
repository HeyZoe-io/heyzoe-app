import { splitWelcomeForChat } from "@/lib/welcome-message";

/**
 * social_links keys the public chat actually shows.
 * welcome_intro / welcome_question become the welcome bubble.
 * welcome_options become the opening chips.
 * Everything else in that JSON stays on the server.
 */
export const PUBLIC_SOCIAL_LINK_KEYS = ["welcome_intro", "welcome_question", "welcome_options"] as const;

export type PublicBusinessData = {
  slug: string;
  name: string;
  logo_url: string | null;
  service_name: string;
  address: string;
  trial_class: string;
  cta_text: string | null;
  cta_link: string | null;
  /** טקסט בועת הפתיחה (ללא שורות ממוספרות) */
  welcome_message: string;
  /** כפתורי תשובה מהירה להודעת הפתיחה */
  opening_chips: string[];
  bot_name: string;
  primary_color: string;
  secondary_color: string;
};

const DEFAULT_PUBLIC_FOLLOWUPS = ["מה המחיר?", "איפה אתם נמצאים?", "איך נרשמים?", "למי זה מתאים?"];

export function pickPublicSocialLinks(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.welcome_intro === "string") out.welcome_intro = src.welcome_intro;
  if (typeof src.welcome_question === "string") out.welcome_question = src.welcome_question;
  if (Array.isArray(src.welcome_options)) {
    const options = src.welcome_options.filter((item): item is string => typeof item === "string");
    if (options.length > 0) out.welcome_options = options;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function publicBusinessDataFromRow(input: {
  slug: unknown;
  name: unknown;
  niche: unknown;
  logo_url: unknown;
  welcome_message: unknown;
  bot_name: unknown;
  primary_color: unknown;
  secondary_color: unknown;
  cta_text: unknown;
  cta_link: unknown;
  social_links: unknown;
  service_name: unknown;
  service_location: unknown;
}): PublicBusinessData {
  const social = pickPublicSocialLinks(input.social_links);
  const fullWelcome = String(input.welcome_message ?? "נעים להכיר, אני זואי כאן ללוות אותך בדרך שלך.");
  const { body, chips } = splitWelcomeForChat(fullWelcome, social);

  return {
    slug: String(input.slug ?? ""),
    name: String(input.name ?? ""),
    logo_url: (input.logo_url as string | null) ?? null,
    service_name: String(input.service_name ?? input.niche ?? input.name ?? ""),
    address: String(input.service_location ?? ""),
    trial_class: "",
    cta_text: (input.cta_text as string | null) ?? null,
    cta_link: (input.cta_link as string | null) ?? null,
    welcome_message: body || fullWelcome,
    opening_chips: chips,
    bot_name: String(input.bot_name ?? "זואי"),
    primary_color: String(input.primary_color ?? "#ff85cf"),
    secondary_color: String(input.secondary_color ?? "#bc74e9"),
  };
}

export function buildConfiguredPublicBusinessResponse(
  data: PublicBusinessData,
  opts: { variant: "full" | "quick"; requestSlug: string }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    slug: opts.variant === "quick" ? data.slug : opts.requestSlug,
    name: data.name || "העסק שלנו",
    logo_url: data.logo_url || null,
    service_name: data.service_name,
    address: data.address || "",
    trial_class: data.trial_class || "",
    cta_text: data.cta_text || null,
    cta_link: data.cta_link || null,
    welcome: data.welcome_message,
    followups:
      opts.variant === "full"
        ? data.opening_chips.length > 0
          ? data.opening_chips
          : DEFAULT_PUBLIC_FOLLOWUPS
        : data.opening_chips,
    bot_name: data.bot_name,
    primary_color: data.primary_color,
    secondary_color: data.secondary_color,
  };
  if (opts.variant === "full") body.tone = null;
  return body;
}
