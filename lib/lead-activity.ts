/** תאריך פעילות אחרונה — תואם לעמודת «שיחה אחרונה» (כולל לידי טמפלייט בלי last_contact_at). */
export function leadConversationAt(row: {
  last_contact_at?: string | null;
  created_at?: string | null;
  not_relevant_at?: string | null;
  human_requested_at?: string | null;
}): string | null {
  return (
    row.last_contact_at ??
    row.human_requested_at ??
    row.not_relevant_at ??
    row.created_at ??
    null
  );
}

export function leadConversationAtMs(row: Parameters<typeof leadConversationAt>[0]): number {
  const at = leadConversationAt(row);
  if (!at) return 0;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

export function sortLeadsByRecentActivity<T extends Parameters<typeof leadConversationAt>[0]>(rows: T[]): T[] {
  return [...rows].sort((a, b) => leadConversationAtMs(b) - leadConversationAtMs(a));
}
