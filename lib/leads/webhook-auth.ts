import type { NextRequest } from "next/server";

/** אימות webhook ללידים נכנסים (Plan Do, דפי נחיתה וכו') — header `x-leads-secret`. */
export function verifyLeadsWebhookSecret(req: NextRequest): boolean {
  const expectedSecret = process.env.LEADS_WEBHOOK_SECRET?.trim() ?? "";
  const providedSecret = req.headers.get("x-leads-secret")?.trim() ?? "";
  return Boolean(expectedSecret) && providedSecret === expectedSecret;
}
