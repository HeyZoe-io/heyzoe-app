"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function PlanCard({
  title,
  price,
  bullets,
  primary,
}: {
  title: string;
  price: string;
  bullets: string[];
  primary?: boolean;
}) {
  return (
    <Card className={primary ? "border-fuchsia-200" : ""}>
      <CardHeader>
        <CardTitle className="text-right">{title}</CardTitle>
        <CardDescription className="text-right">{price}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-right">
        <ul className="space-y-1 text-sm text-zinc-700">
          {bullets.map((b) => (
            <li key={b}>- {b}</li>
          ))}
        </ul>
        <Link
          href="/account/contact"
          className={
            "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 disabled:pointer-events-none disabled:opacity-50 " +
            (primary
              ? "bg-fuchsia-600 hover:bg-fuchsia-700 text-white"
              : "bg-zinc-900 text-white hover:bg-zinc-800")
          }
        >
          שדרוג
        </Link>
      </CardContent>
    </Card>
  );
}

export default function AccountBillingPage() {
  return (
    <div className="space-y-6">
      <div className="text-right">
        <h1 className="text-2xl font-semibold text-zinc-900">חיוב וחבילות</h1>
        <p className="text-sm text-zinc-600">בחר/י חבילה שמתאימה לעסק שלך</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PlanCard
          title="Basic"
          price="₪0 / חודש"
          bullets={["ניהול עסק ודשבורד", "שיחות והגדרות", "תמיכה בסיסית"]}
        />
        <PlanCard
          title="Premium"
          price="החל מ־₪… / חודש"
          bullets={["חיבור פייסבוק (Pixel + CAPI)", "פיצ'רים מתקדמים", "תמיכה מועדפת"]}
          primary
        />
      </div>

      <p className="text-sm text-zinc-600 text-right">
        חשבוניות נשלחות למייל לאחר התשלום.
      </p>
    </div>
  );
}

