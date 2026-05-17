"use client";

import { useCallback, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ZoeGuidelinesClient from "./ZoeGuidelinesClient";
import ZoeConversationsTab, { type ZoeBusinessOption } from "./ZoeConversationsTab";
import ZoeLeadQuestionsTab from "./ZoeLeadQuestionsTab";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

export type ZoeAdminTab = "guidelines" | "conversations" | "questions";

function parseTab(raw: string | null): ZoeAdminTab {
  if (raw === "conversations") return "conversations";
  if (raw === "questions") return "questions";
  return "guidelines";
}

export default function ZoeAdminClient({ businesses }: { businesses: ZoeBusinessOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = parseTab(searchParams.get("tab"));

  const setTab = useCallback(
    (next: ZoeAdminTab) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "guidelines") sp.delete("tab");
      else sp.set("tab", next);
      const q = sp.toString();
      router.replace(q ? `/admin/zoe?${q}` : "/admin/zoe");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-start" }}>
        <button type="button" onClick={() => setTab("guidelines")} style={pill(tab === "guidelines")}>
          חוקיות
        </button>
        <button type="button" onClick={() => setTab("conversations")} style={pill(tab === "conversations")}>
          שיחות
        </button>
        <button type="button" onClick={() => setTab("questions")} style={pill(tab === "questions")}>
          שאלות שעלו
        </button>
      </div>

      {tab === "guidelines" ? (
        <ZoeGuidelinesClient />
      ) : tab === "conversations" ? (
        <ZoeConversationsTab businesses={businesses} />
      ) : (
        <ZoeLeadQuestionsTab />
      )}
    </div>
  );
}
