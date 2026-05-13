"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import MarketingFlowBuilder from "./MarketingFlowBuilder";
import MarketingLegalityTab from "./MarketingLegalityTab";
import MarketingOpenQuestionsTab from "./MarketingOpenQuestionsTab";

const PURPLE = "#7133da";

function tabPill(active: boolean): CSSProperties {
  return {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    border: "1px solid rgba(113,51,218,0.22)",
    background: active ? PURPLE : "#fff",
    color: active ? "#fff" : "#1a0a3c",
  };
}

export default function MarketingDashboardClient() {
  const sp = useSearchParams();
  const subRaw = sp.get("sub");
  const sub = subRaw === "open" ? "open" : subRaw === "legal" ? "legal" : "flow";

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginTop: 18,
          marginBottom: 8,
          justifyContent: "flex-start",
        }}
      >
        <Link href="/admin/dashboard?tab=marketing" prefetch style={tabPill(sub === "flow")}>
          בניית הפלואו
        </Link>
        <Link href="/admin/dashboard?tab=marketing&sub=open" prefetch style={tabPill(sub === "open")}>
          שאלות פתוחות
        </Link>
        <Link href="/admin/dashboard?tab=marketing&sub=legal" prefetch style={tabPill(sub === "legal")}>
          חוקיות
        </Link>
      </div>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(113,51,218,0.18)",
          background: "#fff",
          padding: sub === "flow" ? 0 : 20,
          overflow: "hidden",
        }}
      >
        {sub === "flow" ? (
          <MarketingFlowBuilder />
        ) : sub === "open" ? (
          <MarketingOpenQuestionsTab />
        ) : (
          <MarketingLegalityTab />
        )}
      </div>
    </>
  );
}
