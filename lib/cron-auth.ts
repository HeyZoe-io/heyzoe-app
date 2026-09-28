import type { NextRequest } from "next/server";
import { resolveCronSecret } from "@/lib/server-env";

/** Bearer CRON_SECRET. In production a missing secret rejects; in dev it allows. */
export function authorizeCron(req: NextRequest): boolean {
  const secret = resolveCronSecret();
  if (!secret) {
    const isProd = process.env.NODE_ENV === "production";
    if (isProd) return false;
    console.warn("[cron] CRON_SECRET not set — allowing request in dev only");
    return true;
  }
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
