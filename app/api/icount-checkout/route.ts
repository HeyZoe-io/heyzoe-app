import { NextRequest, NextResponse } from "next/server";
import { normalizeCheckoutPlan, type CheckoutPlan } from "@/lib/plan-prices";

export const runtime = "nodejs";

/** Public iCount pay page for the first-month ₪5 offer (Pro capabilities). */
const INTRO_CID_DEFAULT = "871e3";
const INTRO_PAYPAGE_DEFAULT = "c69175eap50u6ab8b43";

function payPageFor(plan: CheckoutPlan): { cid: string; payPageId: string } {
  if (plan === "intro") {
    return {
      cid: process.env.ICOUNT_CID_INTRO?.trim() || INTRO_CID_DEFAULT,
      payPageId: process.env.ICOUNT_PAYPAGE_ID_INTRO?.trim() || INTRO_PAYPAGE_DEFAULT,
    };
  }
  if (plan === "pro") {
    return {
      cid: process.env.ICOUNT_CID_PRO?.trim() || "",
      payPageId: process.env.ICOUNT_PAYPAGE_ID_PRO?.trim() || "",
    };
  }
  return {
    cid: process.env.ICOUNT_CID_STARTER?.trim() || "",
    payPageId: process.env.ICOUNT_PAYPAGE_ID_STARTER?.trim() || "",
  };
}

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

    const resolvedPlan = normalizeCheckoutPlan(plan);
    const { cid, payPageId } = payPageFor(resolvedPlan);

    if (!cid) {
      return NextResponse.json(
        {
          error:
            resolvedPlan === "pro"
              ? "missing_icount_cid_pro"
              : resolvedPlan === "intro"
                ? "missing_icount_cid_intro"
                : "missing_icount_cid_starter",
        },
        { status: 500 }
      );
    }
    if (!payPageId) {
      return NextResponse.json(
        {
          error:
            resolvedPlan === "pro"
              ? "missing_icount_paypage_id_pro"
              : resolvedPlan === "intro"
                ? "missing_icount_paypage_id_intro"
                : "missing_icount_paypage_id_starter",
        },
        { status: 500 }
      );
    }

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

