/**
 * Every {{n}} Meta receives is required. An empty or whitespace-only value is not sent:
 * Meta rejects it (131008) or the lead reads a sentence with a hole in it.
 * Name / emoji fallbacks ("שלום", "😊", "—") are real text and pass.
 */
export const EMPTY_VARIABLE_ERROR = "empty_variable";

type Component = { type?: string; parameters?: Array<{ type?: string; text?: unknown }> };

/** "body {{2}}" for the first empty text parameter, else null. */
export function emptyTemplateVariable(components: readonly Component[] | null | undefined): string | null {
  for (const component of components ?? []) {
    const params = component.parameters ?? [];
    for (let i = 0; i < params.length; i += 1) {
      const param = params[i]!;
      if (param.type !== "text") continue;
      if (!String(param.text ?? "").trim()) return `${String(component.type ?? "body")} {{${i + 1}}}`;
    }
  }
  return null;
}
