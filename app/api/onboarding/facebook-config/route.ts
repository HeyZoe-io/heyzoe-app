import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public config for Facebook JS SDK + Embedded Signup (config_id).
 * META_SOLUTION_ID is the Meta Tech Provider / Embedded Signup solution id.
 */
export async function GET() {
  const appId =
    process.env.NEXT_PUBLIC_META_APP_ID?.trim() ||
    process.env.NEXT_PUBLIC_FACEBOOK_APP_ID?.trim() ||
    "";
  const configId = process.env.META_SOLUTION_ID?.trim() ?? "";
  return NextResponse.json({ appId, configId });
}
