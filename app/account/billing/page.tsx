"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function PlanCard({
  title,
  price,
  bullets,
  primary,
  isCurrent,
  actionLabel,
  actionDisabled,
  onAction,
}: {
  title: string;
  price: string;
  bullets: string[];
  primary?: boolean;
  isCurrent?: boolean;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => void;
}) {
  return (
    <Card
      className={
        isCurrent
          ? "border-fuchsia-300 ring-2 ring-fuchsia-200"
          : primary
          ? "border-fuchsia-200"
          : ""
      }
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-right">{title}</CardTitle>
          {isCurrent ? (
            <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-medium text-fuchsia-700">
              החבילה שלך
            </span>
          ) : null}
        </div>
        <CardDescription className="text-right">{price}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-right">
        <ul className="space-y-1 text-sm text-zinc-700">
          {bullets.map((b) => (
            <li key={b}>- {b}</li>
          ))}
        </ul>
        {actionLabel ? (
          <button
            type="button"
            disabled={actionDisabled}
            onClick={onAction}
            className={
              "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:pointer-events-none disabled:opacity-50 " +
              (primary
                ? "bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
                : "bg-zinc-900 text-white hover:bg-zinc-800")
            }
          >
            {actionLabel}
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AccountBillingPage() {
  const [plan, setPlan] = useState<"basic" | "premium">("basic");
  const [checkoutLoading, setCheckoutLoading] = useState<null | "starter" | "pro">(null);
  const [checkoutError, setCheckoutError] = useState<string>("");
  const sp = useSearchParams();
  const reactivate = sp.get("reactivate") === "1";

  useEffect(() => {
    void fetch("/api/dashboard/settings")
      .then((r) => r.json())
      .then((j) => {
        const p = j?.business?.plan === "premium" ? "premium" : "basic";
        setPlan(p);
      })
      .catch(() => void 0);
  }, []);

  const invoices: Array<{ month: string; amount: string; status: string; href: string }> = [];

  async function startCheckout(target: "starter" | "pro") {
    try {
      setCheckoutError("");
      setCheckoutLoading(target);
      const res = await fetch("/api/account/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: target === "pro" ? "pro" : "starter" }),
      });
      const data = (await res.json().catch(() => null)) as any;
      const url = typeof data?.url === "string" ? data.url : "";
      if (!res.ok || !url) {
        throw new Error(typeof data?.error === "string" ? data.error : "checkout_failed");
      }
      window.location.href = url;
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : "checkout_failed");
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className="text-2xl font-semibold text-zinc-900">חיוב וחבילות</h1>
        <p className="text-sm text-zinc-600">בחר/י חבילה שמתאימה לעסק שלך (Starter / Pro)</p>
      </div>

      {reactivate ? (
        <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4 text-right">
          <p className="text-sm font-semibold text-zinc-900">המנוי לא פעיל כרגע</p>
          <p className="mt-1 text-sm text-zinc-700">
            כדי להמשיך לערוך את הדשבורד, יש לבחור חבילה ולהפעיל מחדש את המנוי.
          </p>
          {checkoutError ? (
            <p className="mt-2 text-sm text-red-600">שגיאה בתשלום: {checkoutError}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 justify-end">
            <button
              type="button"
              onClick={() => void startCheckout("starter")}
              disabled={checkoutLoading != null}
              className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              הפעלת Starter
            </button>
            <button
              type="button"
              onClick={() => void startCheckout("pro")}
              disabled={checkoutLoading != null}
              className="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:opacity-60"
            >
              הפעלת Pro
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            לאחר התשלום תחזרו למערכת אוטומטית. אם לא קורה, רעננו את הדף.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PlanCard
          title="Starter"
          price="₪… / חודש"
          bullets={["דשבורד עסק מלא", "וואטסאפ + פולואפים אוטומטיים", "מסלול מכירה ותבניות"]}
          isCurrent={plan === "basic"}
          actionLabel={plan === "basic" ? undefined : "הפעלה"}
          actionDisabled={checkoutLoading != null}
          onAction={plan === "basic" ? undefined : () => void startCheckout("starter")}
        />
        <PlanCard
          title="Pro"
          price="₪… / חודש"
          bullets={["הכול ב־Starter", "אופטימיזציות ופיצ'רים מתקדמים", "תמיכה מועדפת"]}
          primary
          isCurrent={plan === "premium"}
          actionLabel={plan === "premium" ? undefined : "שדרוג ל־Pro"}
          actionDisabled={checkoutLoading != null}
          onAction={plan === "premium" ? undefined : () => void startCheckout("pro")}
        />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white">
        <div className="px-4 py-3 border-b border-zinc-100">
          <p className="text-sm font-semibold text-zinc-900 text-right">היסטוריית חשבוניות</p>
        </div>
        {invoices.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500 text-right">אין היסטוריית חיובים להצגה</p>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="text-right font-medium px-4 py-2">חודש</th>
                  <th className="text-right font-medium px-4 py-2">סכום</th>
                  <th className="text-right font-medium px-4 py-2">סטטוס</th>
                  <th className="text-right font-medium px-4 py-2">הורדה</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.month} className="border-t border-zinc-100">
                    <td className="px-4 py-2 text-right">{inv.month}</td>
                    <td className="px-4 py-2 text-right">{inv.amount}</td>
                    <td className="px-4 py-2 text-right">{inv.status}</td>
                    <td className="px-4 py-2 text-right">
                      <a className="underline underline-offset-4 text-fuchsia-700" href={inv.href}>
                        הורדה
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-sm text-zinc-600 text-right">חשבוניות נשלחות למייל לאחר התשלום.</p>
    </div>
  );
}

