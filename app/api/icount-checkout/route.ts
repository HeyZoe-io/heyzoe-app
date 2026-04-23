import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { plan, email, first_name, last_name, phone } = (await req.json()) as {
      plan?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
    };

    if (!email?.trim()) {
      return NextResponse.json({ error: "missing_email" }, { status: 400 });
    }

    const resolvedPlan = plan === "pro" ? "pro" : "starter";
    const cid =
      (resolvedPlan === "pro"
        ? process.env.ICOUNT_CID_PRO
        : process.env.ICOUNT_CID_STARTER
      )?.trim() || "";
    const payPageId =
      (resolvedPlan === "pro"
        ? process.env.ICOUNT_PAYPAGE_ID_PRO
        : process.env.ICOUNT_PAYPAGE_ID_STARTER
      )?.trim() || "";

    if (!cid) return NextResponse.json({ error: "missing_icount_cid" }, { status: 500 });
    if (!payPageId) return NextResponse.json({ error: "missing_icount_paypage_id" }, { status: 500 });

    const url = new URL(
      `https://app.icount.co.il/m/${encodeURIComponent(cid)}/${encodeURIComponent(payPageId)}`
    );
    url.searchParams.set("email", email.trim());
    url.searchParams.set("first_name", String(first_name ?? "").trim());
    url.searchParams.set("last_name", String(last_name ?? "").trim());
    url.searchParams.set("phone", String(phone ?? "").trim());
    url.searchParams.set("custom", resolvedPlan);

    return NextResponse.json({ url: url.toString() });
  } catch (error) {
    console.error("[api/icount-checkout] failed:", error);
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}

