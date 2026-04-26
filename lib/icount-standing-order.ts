/**
 * Best-effort stop for iCount הוראת קבע.
 * iCount has no one-size public call in this repo; optional webhook lets you
 * run automation (Zapier / n8n / iCount API) to find + cancel the standing order by email.
 */
export async function requestIcountStandingOrderStop(params: {
  customerEmail: string;
}): Promise<void> {
  const url = process.env.ICOUNT_STANDING_ORDER_CANCEL_WEBHOOK_URL?.trim();
  if (!url) {
    return;
  }
  const secret = process.env.ICOUNT_STANDING_ORDER_CANCEL_SECRET?.trim() ?? "";
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({ email: params.customerEmail }),
    });
  } catch (e) {
    console.error("[icount-standing-order] webhook failed:", e);
  }
}
