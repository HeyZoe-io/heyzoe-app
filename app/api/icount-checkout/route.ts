import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { plan, email } = (await req.json()) as {
      plan?: string;
      email?: string;
    };

    const cid = process.env.ICOUNT_CID?.trim() || "";
    const payPageId = process.env.ICOUNT_PAYPAGE_ID?.trim() || "";

    if (!cid) return NextResponse.json({ error: "missing_icount_cid" }, { status: 500 });
    if (!payPageId) return NextResponse.json({ error: "missing_icount_paypage_id" }, { status: 500 });
    if (!email?.trim()) {
      return NextResponse.json({ error: "missing_email" }, { status: 400 });
    }

    const resolvedPlan = plan === "pro" ? "pro" : "starter";
    const url = new URL(
      `https://app.icount.co.il/m/${encodeURIComponent(cid)}/${encodeURIComponent(payPageId)}`
    );
    url.searchParams.set("email", email.trim());
    url.searchParams.set("custom", resolvedPlan);

    return NextResponse.json({ url: url.toString() });
  } catch (error) {
    console.error("[api/icount-checkout] failed:", error);
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}

