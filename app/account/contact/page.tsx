"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function AccountContactPage() {
  const waNumber = "972508318162";
  const waUrl = `https://wa.me/${waNumber}`;
  const mail = "office@heyzoe.io";
  const mailUrl = `mailto:${mail}`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-right">
            משהו לא מסתדר? לא לדאוג :) כתבו לנו מה הבעיה וניצור קשר בהקדם!
          </CardTitle>
          <CardDescription className="text-right">
            בחרו דרך יצירת קשר
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-right">
          <a
            href={waUrl}
            target="_blank"
            rel="noreferrer"
            className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            וואטסאפ
          </a>
          <a
            href={mailUrl}
            className="w-full inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50"
          >
            אימייל
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

