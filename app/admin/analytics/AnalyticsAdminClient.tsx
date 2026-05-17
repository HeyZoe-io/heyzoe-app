"use client";

import { useCallback, type CSSProperties, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

export type AnalyticsAdminTab = "landing" | "whatsapp";

function parseTab(raw: string | null): AnalyticsAdminTab {
  return raw === "whatsapp" ? "whatsapp" : "landing";
}

export default function AnalyticsAdminClient({
  children,
  range,
  sourceMode,
}: {
  children: ReactNode;
  range: string;
  sourceMode: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const setTab = useCallback(
    (next: AnalyticsAdminTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "landing") sp.delete("tab");
      else sp.set("tab", next);
      const q = sp.toString();
      router.replace(q ? `/admin/analytics?${q}` : "/admin/analytics");
    },
    [router, searchParams]
  );

  const pill = (active: boolean): CSSProperties => ({
    borderRadius: 999,
    padding: "8px 18px",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: "pointer",
    border: active ? `1px solid ${PURPLE}` : "1px solid rgba(113,51,218,0.2)",
    background: active ? "rgba(113,51,218,0.12)" : "#fff",
    color: active ? "#2d1a6e" : MUTED,
    fontWeight: active ? 600 : 400,
  });

  const rangeHref = (k: string) => {
    const sp = new URLSearchParams();
    sp.set("range", k);
    if (tab === "whatsapp") sp.set("tab", "whatsapp");
    if (tab === "landing" && sourceMode === "purchases") sp.set("source", "purchases");
    return `/admin/analytics?${sp.toString()}`;
  };

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18, justifyContent: "flex-start" }}>
        <button type="button" onClick={() => setTab("landing")} style={pill(tab === "landing")}>
          דף נחיתה
        </button>
        <button type="button" onClick={() => setTab("whatsapp")} style={pill(tab === "whatsapp")}>
          ווטסאפ
        </button>
      </div>

      <section
        style={{
          marginTop: 14,
          background: "rgba(255,255,255,0.65)",
          border: "1px solid rgba(113,51,218,0.14)",
          borderRadius: 18,
          padding: 12,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["7", "30", "90"] as const).map((k) => (
            <a
              key={k}
              href={rangeHref(k)}
              style={{
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12,
                border: "1px solid rgba(113,51,218,0.18)",
                background: range === k ? "linear-gradient(135deg,#7133da,#ff92ff)" : "white",
                color: range === k ? "white" : "#3a2a6c",
                textDecoration: "none",
              }}
            >
              {k === "7" ? "7 ימים" : k === "30" ? "30 ימים" : "90 ימים"}
            </a>
          ))}
        </div>
      </section>

      <div style={{ marginTop: 16 }}>{children}</div>
    </>
  );
}
