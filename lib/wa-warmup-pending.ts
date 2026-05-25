import type { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveWarmupExperienceConfig, type OfferKind, type SalesFlowConfig } from "@/lib/sales-flow";
import { normalizeLineForMenuEcho } from "@/lib/wa-split-answer";

/** נשלחה שאלת «ניסיון קודם» עם כפתורי וואטסאפ */
export const WA_WARMUP_EXPERIENCE_SENT_MODEL = "flow_continuation_warmup_experience";

const EXPERIENCE_ANSWERED_MODELS = ["sales_flow_after_experience", "sales_flow_warmup_extra"] as const;

export type WarmupExperienceMenu = {
  question: string;
  options: string[];
};

type SfServicePick = { name: string; offerKind?: OfferKind | string | null };

export async function buildWarmupExperienceMenu(input: {
  cfg: SalesFlowConfig;
  salesFlowServices: SfServicePick[];
  fetchLastSfServiceEventName: (args: {
    business_slug: string;
    session_id: string;
  }) => Promise<string | null>;
  business_slug: string;
  session_id: string;
}): Promise<WarmupExperienceMenu | null> {
  const named =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0]!.name
      : (await input.fetchLastSfServiceEventName({
          business_slug: input.business_slug,
          session_id: input.session_id,
        })) ?? "";
  if (!named.trim()) return null;

  const svcRow =
    input.salesFlowServices.length === 1
      ? input.salesFlowServices[0] ?? null
      : input.salesFlowServices.find((s) => s.name === named) ?? null;
  const warmKind = (svcRow?.offerKind ?? "trial") as OfferKind;
  const wb = resolveWarmupExperienceConfig(input.cfg, warmKind);
  const q = String(wb.question ?? "").replace(/\{serviceName\}/g, named).trim();
  const opts = [...wb.options].map((o) => String(o ?? "").trim()).filter(Boolean);
  if (!q || opts.length < 2) return null;
  return { question: q, options: opts };
}

/** שאלת חימום נשלחה ועדיין לא נענתה בכפתור / מעבר לשלב הבא */
export async function isWarmupExperienceQuestionPending(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>;
  business_slug: string;
  session_id: string;
}): Promise<boolean> {
  const { data: expSent, error } = await input.admin
    .from("messages")
    .select("created_at")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "assistant")
    .eq("model_used", WA_WARMUP_EXPERIENCE_SENT_MODEL)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !expSent?.created_at) return false;

  const since = String(expSent.created_at);

  const { data: progressed } = await input.admin
    .from("messages")
    .select("id")
    .eq("business_slug", input.business_slug)
    .eq("session_id", input.session_id)
    .eq("role", "assistant")
    .in("model_used", [...EXPERIENCE_ANSWERED_MODELS])
    .gt("created_at", since)
    .limit(1)
    .maybeSingle();

  return !progressed?.id;
}

/** מסיר מהתשובה שאלת חימום ואפשרויות כפתור שהמודל העתיק לטקסט */
export function stripPendingWarmupMenuFromAnswer(text: string, menu: WarmupExperienceMenu): string {
  const qNorm = normalizeLineForMenuEcho(menu.question);
  const labelNorms = menu.options.map((l) => normalizeLineForMenuEcho(l)).filter(Boolean);
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const n = normalizeLineForMenuEcho(line);
    if (!n) {
      out.push(line);
      continue;
    }
    if (qNorm && (n === qNorm || n.includes(qNorm) || qNorm.includes(n))) continue;
    if (labelNorms.some((x) => x === n)) continue;
    if (/^בחרו (אחת|אחד) מהאפשרויות:?$/u.test(line.trim())) continue;
    if (n === "כפתורים" || n === "כפתורים:" || n === "אפשרויות" || n === "אפשרויות:") continue;
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
