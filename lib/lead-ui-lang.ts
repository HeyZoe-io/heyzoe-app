import type { BusinessKnowledgePack } from "@/lib/business-context";
import { detectMessageLanguage, type DetectedMessageLanguage } from "@/lib/language-detect";
import {
  resolveBusinessContentLanguageFromKnowledge,
  type BusinessContentLanguage,
} from "@/lib/business-content-lang";

export function parseWaUiLang(raw: unknown): BusinessContentLanguage | "" {
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "he" || t === "en" || t === "ru") return t;
  return "";
}

export function detectedToContentLang(
  detected: DetectedMessageLanguage
): BusinessContentLanguage | null {
  if (detected === "he" || detected === "en" || detected === "ru") return detected;
  return null;
}

/**
 * Language for this lead's WhatsApp UI (flow copy + buttons).
 * Latest inbound script wins; otherwise persisted; otherwise the studio default.
 */
export function resolveLeadContentLanguage(input: {
  inboundText?: string;
  persisted?: string | null;
  knowledge?: BusinessKnowledgePack | null;
}): BusinessContentLanguage {
  const fromInbound = detectedToContentLang(detectMessageLanguage(input.inboundText ?? ""));
  if (fromInbound) return fromInbound;
  const persisted = parseWaUiLang(input.persisted);
  if (persisted) return persisted;
  return resolveBusinessContentLanguageFromKnowledge(input.knowledge);
}
