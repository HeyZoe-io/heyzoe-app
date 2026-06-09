"use client";

import { useCallback, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MarketingFlowBuilder from "./MarketingFlowBuilder";
import MarketingLegalityTab from "./MarketingLegalityTab";
import MarketingOpenQuestionsTab from "./MarketingOpenQuestionsTab";
import ZoeConversationsTab, { type ZoeBusinessOption } from "../zoe/ZoeConversationsTab";
import ZoeLeadQuestionsTab from "../zoe/ZoeLeadQuestionsTab";
import type { ZoeAdminSessionSummary } from "@/lib/zoe-admin-conversations";

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

type MarketingSubTab = "flow" | "conversations" | "questions" | "open" | "legal";

function parseSubTab(raw: string | null): MarketingSubTab {
  if (raw === "conversations") return "conversations";
  if (raw === "questions") return "questions";
  if (raw === "open") return "open";
  if (raw === "legal") return "legal";
  return "flow";
}

function marketingSubTabHref(sub: MarketingSubTab): string {
  return sub === "flow" ? "/admin/dashboard?tab=marketing" : `/admin/dashboard?tab=marketing&sub=${sub}`;
}

function MarketingSubTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} style={{ ...tabPill(active), cursor: "pointer", fontFamily: "inherit" }}>
      {label}
    </button>
  );
}

export default function MarketingDashboardClient({
  businesses,
  initialAllSessions = [],
}: {
  businesses: ZoeBusinessOption[];
  initialAllSessions?: ZoeAdminSessionSummary[];
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const sub = parseSubTab(sp.get("sub"));
  const [flowDirty, setFlowDirty] = useState(false);

  const goSubTab = useCallback(
    (target: MarketingSubTab) => {
      if (target === sub) return;
      if (sub === "flow" && flowDirty) {
        window.alert("יש שינויים שלא נשמרו בפלואו. לחצו «שמור» לפני מעבר לטאב אחר.");
        return;
      }
      router.push(marketingSubTabHref(target));
    },
    [flowDirty, router, sub]
  );

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
        <MarketingSubTabButton
          active={sub === "flow"}
          label="בניית הפלואו"
          onClick={() => goSubTab("flow")}
        />
        <MarketingSubTabButton
          active={sub === "conversations"}
          label="שיחות"
          onClick={() => goSubTab("conversations")}
        />
        <MarketingSubTabButton
          active={sub === "questions"}
          label="שאלות שעלו"
          onClick={() => goSubTab("questions")}
        />
        <MarketingSubTabButton
          active={sub === "open"}
          label="עובדות לשאלות פתוחות"
          onClick={() => goSubTab("open")}
        />
        <MarketingSubTabButton
          active={sub === "legal"}
          label="חוקיות"
          onClick={() => goSubTab("legal")}
        />
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
          <MarketingFlowBuilder onDirtyChange={setFlowDirty} />
        ) : sub === "conversations" ? (
          <ZoeConversationsTab businesses={businesses} initialAllSessions={initialAllSessions} />
        ) : sub === "questions" ? (
          <ZoeLeadQuestionsTab />
        ) : sub === "open" ? (
          <MarketingOpenQuestionsTab />
        ) : (
          <MarketingLegalityTab />
        )}
      </div>
    </>
  );
}
