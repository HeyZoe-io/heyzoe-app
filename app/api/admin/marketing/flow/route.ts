import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stub — לוגיקת Supabase בשלב מאוחר יותר */
export async function GET() {
  return NextResponse.json({
    nodes: [],
    edges: [],
    is_active: false,
  });
}

/** Stub — לוגיקת שמירה בשלב מאוחר יותר */
export async function POST() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
